import { memo, useMemo, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';
import { columnsAt, hasWide, textColumns } from './columns';
import { pacedChars, type PageLine } from './layout';
import { maskCodeLine, maskGenerationLine, type GenerationDifficulty } from './generationMask';
import { calculateGuidedLineDuration, computeLineFixations } from './saccade';
import { charStyles, styleClasses, type StyleRun } from './styledText';
import { useAssetUrl } from './useAssetUrl';

/** Figures get at least this long under the pacer, whatever their caption length. */
const MIN_FIGURE_DWELL_MS = 2000;

/**
 * How a line relates to the pacer:
 * - `static`: pacer off; OVP marks shown.
 * - `ahead`: not reached yet; OVP marks shown.
 * - `active`: the pacer is on this line.
 * - `behind`: already swept; plain text.
 */
export type LineState = 'static' | 'ahead' | 'active' | 'behind';

interface GuidedLineProps {
  line: PageLine;
  index: number;
  state: LineState;
  bookId: string;
  wpm: number;
  /** The active line holds this long before the sweep starts (a new page's first line). */
  startDelayMs: number;
  playing: boolean;
  showOvp: boolean;
  alternateOvpColors: boolean;
  saccadeLength: number;
  quietSweep: boolean;
  /** Generation mode: mask letters at this difficulty; null shows the text as is. */
  maskDifficulty: GenerationDifficulty | null;
  /** Seeds the mask so a line masks the same way every time it's shown. */
  maskSeed: number;
  /** Generation mode: lines unmask as the sweep passes and stay revealed behind it. */
  sweepReveal: boolean;
  /** Height in px for figure lines (they span several text lines). */
  figureHeight: number;
  onDone: (index: number) => void;
}

/** Leading spaces (callout and list indentation, code indentation). */
function indentOf(text: string): number {
  return text.length - text.trimStart().length;
}

export function lineDurationMs(line: PageLine, wpm: number): number {
  const duration = calculateGuidedLineDuration(pacedChars(line), wpm);
  return line.type === 'figure' ? Math.max(MIN_FIGURE_DWELL_MS, duration) : duration;
}

interface TextOptions {
  styles: StyleRun[] | undefined;
  fixations: number[];
  ovp: 'none' | 'static' | 'passing';
  alternate: boolean;
  /** The masked line (`_` per hidden letter), or null to show the text as is. */
  masked: string | null;
  /** Unmask letters as the sweep reaches them. */
  revealing: boolean;
  durationMs: number;
  startDelayMs: number;
  playing: boolean;
}

/**
 * One pass over the line's characters, wrapping OVP marks and masked letters
 * in spans and leaving runs of plain text as strings, inside a span per
 * stretch of inline style. Spans that change when the sweep reaches them get
 * an animation delay proportional to their position; the delay pauses with
 * the sweep, so the two stay in step.
 */
function renderText(text: string, options: TextOptions): ReactNode {
  const { styles, fixations, ovp, alternate, masked, revealing, durationMs, startDelayMs, playing } = options;
  const fixationOrdinal = new Map<number, number>();
  if (ovp !== 'none') fixations.forEach((charIndex, i) => fixationOrdinal.set(charIndex, i));
  if (fixationOrdinal.size === 0 && !masked && !styles && !hasWide(text)) return text;

  // The sweep covers the text after its indentation.
  const lead = indentOf(text);
  const span = Math.max(1, text.length - lead);
  const timed = (charIndex: number): CSSProperties => ({
    animationDelay: `${startDelayMs + ((charIndex - lead) / span) * durationMs}ms`,
    animationPlayState: playing ? 'running' : 'paused',
  });

  const styleAt = styles && charStyles(text.length, styles);
  const parts: ReactNode[] = [];
  let group: ReactNode[] = []; // the current stretch of one style
  let groupStyle = 0;
  let groupStart = 0;
  let run = '';
  const endGroup = () => {
    if (run) group.push(run);
    run = '';
    if (groupStyle && group.length > 0) {
      parts.push(<span key={`s${groupStart}`} className={styleClasses(groupStyle)}>{group}</span>);
    } else {
      parts.push(...group);
    }
    group = [];
  };
  for (let i = 0; i < text.length; i++) {
    const style = styleAt?.[i] ?? 0;
    // Whole code points, so a surrogate pair is never split across spans.
    // A wide character fills exactly two columns.
    const wide = columnsAt(text, i) === 2;
    const char = text.slice(i, text.codePointAt(i)! > 0xffff ? i + 2 : i + 1);
    if (style !== groupStyle) {
      endGroup();
      groupStyle = style;
      groupStart = i;
    }
    const isMask = masked?.[i] === '_';
    const ordinal = fixationOrdinal.get(i);
    if (!isMask && ordinal === undefined && !wide) {
      run += char;
      i += char.length - 1;
      continue;
    }
    if (run) group.push(run);
    run = '';
    const wideClass = wide ? ' wide' : '';
    if (isMask) {
      // The real letter, hidden, keeps the glyph's width and is what the reveal shows.
      group.push(
        <span key={i} className={`mask${revealing ? ' mask-revealing' : ''}${wideClass}`} style={revealing ? timed(i) : undefined}>
          {char}
        </span>,
      );
    } else if (ordinal !== undefined) {
      group.push(
        <span
          key={i}
          className={`ovp${alternate && ordinal % 2 === 1 ? ' ovp-alt' : ''}${ovp === 'passing' ? ' ovp-passing' : ''}${wideClass}`}
          style={ovp === 'passing' ? timed(i) : undefined}
        >
          {char}
        </span>,
      );
    } else {
      group.push(<span key={i} className="wide">{char}</span>);
    }
    i += char.length - 1;
  }
  endGroup();
  return parts;
}

function Figure({ line, bookId, height }: { line: PageLine; bookId: string; height: number }) {
  const url = useAssetUrl(bookId, line.figureSrc);
  return (
    <>
      <div className="figure-image">{url && <img src={url} alt={line.figureCaption ?? ''} draggable={false} />}</div>
      {line.figureCaption && <div className="figure-caption" style={{ maxHeight: height / 2 }}>{line.figureCaption}</div>}
    </>
  );
}

export const GuidedLine = memo(function GuidedLine({
  line,
  index,
  state,
  bookId,
  wpm,
  startDelayMs,
  playing,
  showOvp,
  alternateOvpColors,
  saccadeLength,
  quietSweep,
  maskDifficulty,
  maskSeed,
  sweepReveal,
  figureHeight,
  onDone,
}: GuidedLineProps) {
  const isText = line.type === 'body' || line.type === 'heading';
  const fixations = useMemo(
    () => (isText && showOvp ? computeLineFixations(line.text, saccadeLength) : []),
    [isText, showOvp, line.text, saccadeLength],
  );
  // Seeded by the line's chapter offset, so a line masks the same way however
  // the page is laid out around it. Code keeps its keywords and punctuation;
  // tables mask like prose.
  const masked = useMemo(() => {
    if (!maskDifficulty) return null;
    if (line.type === 'code') return maskCodeLine(line.text, maskDifficulty, maskSeed, line.offset);
    if (isText || line.type === 'table') return maskGenerationLine(line.text, maskDifficulty, maskSeed, line.offset);
    return null;
  }, [isText, line.type, maskDifficulty, maskSeed, line.text, line.offset]);

  const active = state === 'active';
  const durationMs = active ? lineDurationMs(line, wpm) : 0;
  const delayMs = active ? startDelayMs : 0;
  const playState = playing ? 'running' : 'paused';
  const finish = (event: AnimationEvent) => {
    if (event.animationName === 'sweep' || event.animationName === 'pacer-dwell') onDone(index);
  };

  const depthClass = line.depth ? ' in-callout' : '';
  const depthStyle = line.depth ? ({ '--depth': line.depth } as CSSProperties) : undefined;

  if (line.type === 'blank') return <div className={`line${depthClass}`} data-line={index} style={depthStyle} />;

  if (line.type === 'toggle') {
    return (
      <div className={`line fold${depthClass}`} data-line={index} style={depthStyle}>
        {line.text}
      </div>
    );
  }

  if (line.type === 'figure') {
    return (
      <div
        className={`line figure${active ? ' figure-active' : ''}`}
        data-line={index}
        style={{ height: figureHeight }}
      >
        <Figure line={line} bookId={bookId} height={figureHeight} />
        {active && (
          <span
            className="pacer-dwell"
            style={{ animationDuration: `${durationMs}ms`, animationDelay: `${delayMs}ms`, animationPlayState: playState }}
            onAnimationEnd={finish}
          />
        )}
      </div>
    );
  }

  const ovp = !showOvp || state === 'behind' ? 'none' : active ? 'passing' : 'static';
  const keepMasked = masked !== null && masked !== line.text && !(sweepReveal && state === 'behind');
  const lead = indentOf(line.text);
  const classes = [
    'line',
    line.type,
    line.rowStart && 'row-start',
    line.tableHeader && 'table-header',
    line.calloutTitle && 'callout-title',
    line.depth && 'in-callout',
  ].filter(Boolean).join(' ');
  return (
    <div className={classes} data-line={index} style={depthStyle}>
      {active && durationMs > 0 && (
        <span
          className={`sweep${quietSweep ? ' quiet' : ''}`}
          style={{ left: `calc(${lead}ch + var(--sweep-inset, 0px))`, width: `${textColumns(line.text) - lead}ch` }}
          onAnimationEnd={finish}
        >
          <span
            className="sweep-bar"
            style={{ animationDuration: `${durationMs}ms`, animationDelay: `${delayMs}ms`, animationPlayState: playState }}
          />
        </span>
      )}
      {renderText(line.text, {
        styles: line.styles,
        fixations,
        ovp,
        alternate: alternateOvpColors,
        masked: keepMasked ? masked : null,
        revealing: active && sweepReveal,
        durationMs,
        startDelayMs: delayMs,
        playing,
      })}
    </div>
  );
});

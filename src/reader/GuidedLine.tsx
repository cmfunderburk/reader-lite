import { memo, useMemo, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';
import type { PageLine } from './layout';
import { maskGenerationLine, type GenerationDifficulty } from './generationMask';
import { calculateGuidedLineDuration, computeLineFixations } from './saccade';
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

export function lineDurationMs(line: PageLine, wpm: number): number {
  const duration = calculateGuidedLineDuration(line.text.length, wpm);
  return line.type === 'figure' ? Math.max(MIN_FIGURE_DWELL_MS, duration) : duration;
}

interface TextOptions {
  fixations: number[];
  ovp: 'none' | 'static' | 'passing';
  alternate: boolean;
  /** The masked line (`_` per hidden letter), or null to show the text as is. */
  masked: string | null;
  /** Unmask letters as the sweep reaches them. */
  revealing: boolean;
  durationMs: number;
  playing: boolean;
}

/**
 * One pass over the line's characters, wrapping OVP marks and masked letters
 * in spans and leaving runs of plain text as strings. Spans that change when
 * the sweep reaches them get an animation delay proportional to their
 * position; the delay pauses with the sweep, so the two stay in step.
 */
function renderText(text: string, options: TextOptions): ReactNode {
  const { fixations, ovp, alternate, masked, revealing, durationMs, playing } = options;
  const fixationOrdinal = new Map<number, number>();
  if (ovp !== 'none') fixations.forEach((charIndex, i) => fixationOrdinal.set(charIndex, i));
  if (fixationOrdinal.size === 0 && !masked) return text;

  const timed = (charIndex: number): CSSProperties => ({
    animationDelay: `${(charIndex / text.length) * durationMs}ms`,
    animationPlayState: playing ? 'running' : 'paused',
  });

  const parts: ReactNode[] = [];
  let run = '';
  for (let i = 0; i < text.length; i++) {
    const isMask = masked?.[i] === '_';
    const ordinal = fixationOrdinal.get(i);
    if (!isMask && ordinal === undefined) {
      run += text[i];
      continue;
    }
    if (run) parts.push(run);
    run = '';
    if (isMask) {
      // The real letter, hidden, keeps the glyph's width and is what the reveal shows.
      parts.push(
        <span key={i} className={`mask${revealing ? ' mask-revealing' : ''}`} style={revealing ? timed(i) : undefined}>
          {text[i]}
        </span>,
      );
    } else {
      parts.push(
        <span
          key={i}
          className={`ovp${alternate && ordinal! % 2 === 1 ? ' ovp-alt' : ''}${ovp === 'passing' ? ' ovp-passing' : ''}`}
          style={ovp === 'passing' ? timed(i) : undefined}
        >
          {text[i]}
        </span>,
      );
    }
  }
  if (run) parts.push(run);
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
  // the page is laid out around it.
  const masked = useMemo(
    () => (isText && maskDifficulty ? maskGenerationLine(line.text, maskDifficulty, maskSeed, line.offset) : null),
    [isText, maskDifficulty, maskSeed, line.text, line.offset],
  );

  const active = state === 'active';
  const durationMs = active ? lineDurationMs(line, wpm) : 0;
  const playState = playing ? 'running' : 'paused';
  const finish = (event: AnimationEvent) => {
    if (event.animationName === 'sweep' || event.animationName === 'pacer-dwell') onDone(index);
  };

  if (line.type === 'blank') return <div className="line" data-line={index} />;

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
            style={{ animationDuration: `${durationMs}ms`, animationPlayState: playState }}
            onAnimationEnd={finish}
          />
        )}
      </div>
    );
  }

  const ovp = !showOvp || state === 'behind' ? 'none' : active ? 'passing' : 'static';
  const keepMasked = masked !== null && masked !== line.text && !(sweepReveal && state === 'behind');
  return (
    <div className={`line ${line.type}`} data-line={index}>
      {active && durationMs > 0 && (
        <span className={`sweep${quietSweep ? ' quiet' : ''}`} style={{ width: `${line.text.length}ch` }} onAnimationEnd={finish}>
          <span className="sweep-bar" style={{ animationDuration: `${durationMs}ms`, animationPlayState: playState }} />
        </span>
      )}
      {renderText(line.text, {
        fixations,
        ovp,
        alternate: alternateOvpColors,
        masked: keepMasked ? masked : null,
        revealing: active && sweepReveal,
        durationMs,
        playing,
      })}
    </div>
  );
});

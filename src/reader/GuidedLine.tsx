import { memo, useMemo, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';
import type { PageLine } from './layout';
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
  /** Height in px for figure lines (they span several text lines). */
  figureHeight: number;
  onDone: (index: number) => void;
}

export function lineDurationMs(line: PageLine, wpm: number): number {
  const duration = calculateGuidedLineDuration(line.text.length, wpm);
  return line.type === 'figure' ? Math.max(MIN_FIGURE_DWELL_MS, duration) : duration;
}

function renderText(
  text: string,
  fixations: number[],
  ovp: 'none' | 'static' | 'passing',
  alternate: boolean,
  durationMs: number,
  playing: boolean,
): ReactNode {
  if (ovp === 'none' || fixations.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  fixations.forEach((charIndex, i) => {
    if (charIndex > cursor) parts.push(text.slice(cursor, charIndex));
    // While the sweep runs, each mark fades when the sweep reaches it. The
    // delay is paused along with the sweep, so the two stay in step.
    const style: CSSProperties | undefined =
      ovp === 'passing'
        ? {
            animationDelay: `${(charIndex / text.length) * durationMs}ms`,
            animationPlayState: playing ? 'running' : 'paused',
          }
        : undefined;
    parts.push(
      <span
        key={i}
        className={`ovp${alternate && i % 2 === 1 ? ' ovp-alt' : ''}${ovp === 'passing' ? ' ovp-passing' : ''}`}
        style={style}
      >
        {text[charIndex]}
      </span>,
    );
    cursor = charIndex + 1;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
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
  figureHeight,
  onDone,
}: GuidedLineProps) {
  const isText = line.type === 'body' || line.type === 'heading';
  const fixations = useMemo(
    () => (isText && showOvp ? computeLineFixations(line.text, saccadeLength) : []),
    [isText, showOvp, line.text, saccadeLength],
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
  return (
    <div className={`line ${line.type}`} data-line={index}>
      {active && durationMs > 0 && (
        <span className={`sweep${quietSweep ? ' quiet' : ''}`} style={{ width: `${line.text.length}ch` }} onAnimationEnd={finish}>
          <span className="sweep-bar" style={{ animationDuration: `${durationMs}ms`, animationPlayState: playState }} />
        </span>
      )}
      {renderText(line.text, fixations, ovp, alternateOvpColors, durationMs, playing)}
    </div>
  );
});

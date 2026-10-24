import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_WPM, WPM_STEP, clampWpm, lineDurationMs } from './pacer';
import { wrapParagraphs } from './wrap';

// M0 sweep test page: checks that a CSS-driven sweep is smooth on the iPad.
// Replaced by the real reading surface in M2.

const SAMPLE = [
  'It was a bright cold day in April, and the clocks were striking thirteen. This page is a placeholder for testing the pacer: a smooth bar sweeps under each line at the chosen speed, then moves to the next line and wraps back to the top when it reaches the end of the page.',
  'Set the speed slightly below your natural reading pace. Read normally, pausing when you need to. If the sweep overtakes your eyes, your attention has probably drifted. Tap any line to move the pacer there, and use the controls below to pause or change speed.',
  'The sweep is a CSS animation whose duration comes from the line length, so the browser drives every frame and JavaScript only steps from one line to the next when an animation ends. That should stay smooth over the network, because nothing per-frame crosses it.',
];

const MAX_LINE_CHARS = 80;

function useCharsPerLine(ref: React.RefObject<HTMLDivElement | null>): number {
  const [chars, setChars] = useState(MAX_LINE_CHARS);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(100);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    el.appendChild(probe);
    const measure = () => {
      const charWidth = probe.getBoundingClientRect().width / 100;
      if (charWidth > 0) {
        setChars(Math.max(20, Math.min(MAX_LINE_CHARS, Math.floor(el.clientWidth / charWidth))));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      probe.remove();
    };
  }, [ref]);
  return chars;
}

export function App() {
  const pageRef = useRef<HTMLDivElement>(null);
  const charsPerLine = useCharsPerLine(pageRef);
  const lines = wrapParagraphs(SAMPLE, charsPerLine);

  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [playing, setPlaying] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  // Bumped to restart the animation when the pacer jumps to a line.
  const [runId, setRunId] = useState(0);

  const nextTextLine = useCallback(
    (from: number) => {
      for (let i = from; i < lines.length; i++) if (lines[i]) return i;
      return lines.findIndex(Boolean); // end of page: back to the top
    },
    [lines],
  );

  useEffect(() => {
    if (lineIndex >= lines.length || !lines[lineIndex]) setLineIndex(nextTextLine(0));
  }, [lines, lineIndex, nextTextLine]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const jumpTo = (index: number) => {
    setLineIndex(index);
    setRunId((n) => n + 1);
  };

  return (
    <main className="reader">
      <div className="page" ref={pageRef}>
        {lines.map((text, i) => (
          <div
            key={`${charsPerLine}-${i}`}
            className="line"
            onClick={text ? () => jumpTo(i) : undefined}
          >
            {text || ' '}
            {i === lineIndex && text && (
              <span
                key={runId}
                className={`sweep${quiet ? ' quiet' : ''}`}
                style={{ width: `${text.length}ch` }}
                onAnimationEnd={() => jumpTo(nextTextLine(i + 1))}
              >
                <span
                  className="sweep-bar"
                  style={{
                    animationDuration: `${lineDurationMs(text.length, wpm)}ms`,
                    animationPlayState: playing ? 'running' : 'paused',
                  }}
                />
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="controls">
        <button onClick={() => setWpm((w) => clampWpm(w - WPM_STEP))}>−</button>
        <span className="wpm">{wpm} WPM</span>
        <button onClick={() => setWpm((w) => clampWpm(w + WPM_STEP))}>+</button>
        <button className="primary" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => setQuiet((q) => !q)}>{quiet ? 'Normal sweep' : 'Quiet sweep'}</button>
      </div>
    </main>
  );
}

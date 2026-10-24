import { useLayoutEffect, useState, type RefObject } from 'react';

export const MAX_CHARS_PER_LINE = 80;
const MIN_CHARS_PER_LINE = 20;
const MIN_LINES_PER_PAGE = 4;
const LINE_HEIGHT_RATIO = 1.7;

export interface PageMetrics {
  charsPerLine: number;
  linesPerPage: number;
  /** Whole pixels, so every line (and so every page) has the same height. */
  lineHeight: number;
}

/** Measure how many monospace lines and columns fit in the page area. */
export function usePageMetrics(ref: RefObject<HTMLElement | null>, fontSize: number): PageMetrics | null {
  const [metrics, setMetrics] = useState<PageMetrics | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(100);
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${fontSize}px var(--mono)`;
    el.appendChild(probe);

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const charWidth = probe.getBoundingClientRect().width / 100;
        if (charWidth <= 0 || el.clientHeight <= 0) return;
        const lineHeight = Math.round(fontSize * LINE_HEIGHT_RATIO);
        const next: PageMetrics = {
          charsPerLine: Math.max(MIN_CHARS_PER_LINE, Math.min(MAX_CHARS_PER_LINE, Math.floor(el.clientWidth / charWidth))),
          linesPerPage: Math.max(MIN_LINES_PER_PAGE, Math.floor(el.clientHeight / lineHeight)),
          lineHeight,
        };
        setMetrics((prev) =>
          prev && prev.charsPerLine === next.charsPerLine && prev.linesPerPage === next.linesPerPage && prev.lineHeight === next.lineHeight
            ? prev
            : next,
        );
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Web fonts or a late system font swap can change glyph width.
    void document.fonts?.ready.then(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      probe.remove();
    };
  }, [ref, fontSize]);

  return metrics;
}

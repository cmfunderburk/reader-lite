import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { WPM_STEP, clampWpm } from '../pacer';
import { navigate } from '../route';
import { useSettings } from '../settings';
import {
  getBook,
  getChapter,
  getPosition,
  savePosition,
  updateBook,
  type BookRecord,
  type ChapterRecord,
} from '../store/db';
import { GuidedLine, type LineState } from './GuidedLine';
import { isPacedLine, layoutChapter, pageIndexForOffset, type Page } from './layout';
import { lineSpan } from './saccade';
import { SettingsSheet, TocSheet } from './Sheets';
import { usePageGestures } from './usePageGestures';
import { usePageMetrics } from './usePageMetrics';

type PacerState = 'off' | 'playing' | 'paused';

interface Position {
  chapter: number;
  offset: number;
}

/** Offset past any chapter's end: resolves to the chapter's last page. */
const CHAPTER_END = Number.MAX_SAFE_INTEGER;

function firstPacedLine(page: Page | undefined, from = 0): number {
  if (!page) return -1;
  for (let i = from; i < page.lines.length; i++) if (isPacedLine(page.lines[i]!)) return i;
  return -1;
}

export function ReaderView({ bookId }: { bookId: string }) {
  const [settings] = useSettings();
  const [book, setBook] = useState<BookRecord | null>();
  const [position, setPosition] = useState<Position>();
  const [record, setRecord] = useState<ChapterRecord>();
  const [wpm, setWpm] = useState(settings.defaultWpm);
  const [pacer, setPacer] = useState<PacerState>('off');
  const [pacerLine, setPacerLine] = useState(0);
  // Bumped to restart the active line's animation (new line, resync, new page).
  const [runId, setRunId] = useState(0);
  const [toolbars, setToolbars] = useState(false);
  const [sheet, setSheet] = useState<'toc' | 'settings' | null>(null);

  const pageAreaRef = useRef<HTMLDivElement>(null);
  const metrics = usePageMetrics(pageAreaRef, settings.fontSize);

  // Load the book and where we left off.
  useEffect(() => {
    void (async () => {
      const found = await getBook(bookId);
      if (!found) return setBook(null);
      const saved = await getPosition(bookId);
      setBook(found);
      setWpm(found.wpm ?? settings.defaultWpm);
      setPosition({
        chapter: Math.min(saved?.chapter ?? 0, found.chapters.length - 1),
        offset: saved?.offset ?? 0,
      });
      void updateBook(bookId, { lastOpenedAt: Date.now() });
    })();
    // settings.defaultWpm only seeds books without their own WPM, so it isn't a dependency.
  }, [bookId]);

  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    void getChapter(bookId, position.chapter).then((chapter) => {
      if (!cancelled) setRecord(chapter);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, position?.chapter]);

  useEffect(() => {
    if (position) void savePosition({ bookId, ...position, updatedAt: Date.now() });
  }, [bookId, position]);

  // Layout is only valid once the loaded chapter matches the position.
  const layout = useMemo(() => {
    if (!record || !metrics || record.index !== position?.chapter) return undefined;
    return layoutChapter(record.content, metrics.charsPerLine, metrics.linesPerPage);
  }, [record, metrics, position?.chapter]);

  const pageIndex = layout && position ? pageIndexForOffset(layout.pages, position.offset) : 0;
  const page = layout?.pages[pageIndex];

  // A new page (turned, jumped to, or re-flowed) starts the pacer at its top.
  useEffect(() => {
    setPacerLine(Math.max(0, firstPacedLine(page)));
    setRunId((n) => n + 1);
  }, [page]);

  const lastChapter = (book?.chapters.length ?? 1) - 1;

  /** Turn one page; returns false at either end of the book. */
  const turnPage = useCallback(
    (direction: 1 | -1): boolean => {
      if (!layout || !position) return false;
      const target = pageIndex + direction;
      if (target >= 0 && target < layout.pages.length) {
        setPosition({ chapter: position.chapter, offset: layout.pages[target]!.startOffset });
      } else if (direction > 0 && position.chapter < lastChapter) {
        setPosition({ chapter: position.chapter + 1, offset: 0 });
      } else if (direction < 0 && position.chapter > 0) {
        setPosition({ chapter: position.chapter - 1, offset: CHAPTER_END });
      } else {
        return false;
      }
      return true;
    },
    [layout, position, pageIndex, lastChapter],
  );

  const onLineDone = useCallback(
    (index: number) => {
      const next = firstPacedLine(page, index + 1);
      if (next !== -1) {
        setPacerLine(next);
        setRunId((n) => n + 1);
      } else if (!turnPage(1)) {
        setPacer('off'); // end of the book
      }
    },
    [page, turnPage],
  );

  const changeWpm = useCallback(
    (delta: number) => {
      setWpm((current) => {
        const next = clampWpm(current + delta);
        void updateBook(bookId, { wpm: next });
        return next;
      });
    },
    [bookId],
  );

  const togglePlay = useCallback(() => {
    if (pacer === 'playing') {
      setPacer('paused');
    } else {
      setPacer('playing');
      setToolbars(false); // start reading on a clean page
    }
  }, [pacer]);

  // Pause when the app is backgrounded or the screen locks.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPacer((state) => (state === 'playing' ? 'paused' : state));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheet) {
        if (event.key === 'Escape') setSheet(null);
        return;
      }
      // Let a focused control handle its own Space/Enter.
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') turnPage(1);
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') turnPage(-1);
      else if (event.key === ' ') togglePlay();
      else if (event.key === '+' || event.key === '=') changeWpm(WPM_STEP);
      else if (event.key === '-') changeWpm(-WPM_STEP);
      else if (event.key === 'Escape') setPacer('off');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, turnPage, togglePlay, changeWpm]);

  const gestures = usePageGestures({
    onTap: (zone) => {
      if (zone === 'left') turnPage(-1);
      else if (zone === 'right') turnPage(1);
      else setToolbars((shown) => !shown);
    },
    onSwipe: (direction) => turnPage(direction === 'next' ? 1 : -1),
    onLongPress: (target) => {
      const lineEl = target?.closest<HTMLElement>('[data-line]');
      const index = Number(lineEl?.dataset.line ?? NaN);
      if (!page || Number.isNaN(index) || !isPacedLine(page.lines[index]!)) return;
      setPacerLine(index);
      setRunId((n) => n + 1);
      setPacer((state) => (state === 'off' ? 'paused' : state));
    },
  });

  if (book === null) {
    return (
      <main className="library">
        <p className="library-empty">This book isn't on this device any more.</p>
        <button className="button" onClick={() => navigate({ screen: 'library' })}>Back to library</button>
      </main>
    );
  }

  const pacerOn = pacer !== 'off';
  const lineState = (index: number): LineState =>
    !pacerOn ? 'static' : index < pacerLine ? 'behind' : index === pacerLine ? 'active' : 'ahead';

  const totalBookChars = book?.chapters.reduce((sum, c) => sum + c.chars, 0) ?? 0;
  const percent = (() => {
    if (!book || !position || !layout || totalBookChars === 0) return 0;
    const before = book.chapters.slice(0, position.chapter).reduce((sum, c) => sum + c.chars, 0);
    const within = layout.totalChars > 0 ? (page?.startOffset ?? 0) / layout.totalChars : 0;
    return Math.round(((before + within * (book.chapters[position.chapter]?.chars ?? 0)) / totalBookChars) * 100);
  })();

  return (
    <main className="reader">
      <div className="page-area" ref={pageAreaRef} {...gestures}>
        {page && metrics && (
          <div
            className="page"
            style={{
              width: `${metrics.charsPerLine}ch`,
              lineHeight: `${metrics.lineHeight}px`,
              '--line-height': `${metrics.lineHeight}px`,
            } as CSSProperties}
          >
            {page.lines.map((line, index) => (
              <GuidedLine
                key={lineState(index) === 'active' ? `active-${runId}` : `${page.startOffset}-${index}`}
                line={line}
                index={index}
                state={lineState(index)}
                bookId={bookId}
                wpm={wpm}
                playing={pacer === 'playing'}
                showOvp={settings.showOvp}
                alternateOvpColors={settings.alternateOvpColors}
                saccadeLength={settings.saccadeLength}
                quietSweep={settings.quietSweep}
                figureHeight={lineSpan(line, metrics.linesPerPage, metrics.charsPerLine) * metrics.lineHeight}
                onDone={onLineDone}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="reader-footer">
        {layout && position && (
          <>
            p. {pageIndex + 1}/{layout.pages.length} · Ch {position.chapter + 1}/{lastChapter + 1} · {percent}%
            {pacerOn && ` · ${wpm} wpm`}
          </>
        )}
      </footer>

      {toolbars && book && (
        <>
          <header className="toolbar toolbar-top">
            <button className="button subtle" onClick={() => navigate({ screen: 'library' })}>Library</button>
            <span className="toolbar-title">{book.title}</span>
            <button className="button subtle" onClick={() => setSheet('toc')}>Contents</button>
            <button className="button subtle" onClick={() => setSheet('settings')} aria-label="Settings">Aa</button>
          </header>
          <div className="toolbar toolbar-bottom">
            {pacerOn && (
              <button className="button subtle" onClick={() => setPacer('off')}>Pacer off</button>
            )}
            <button className="button primary play" onClick={togglePlay}>
              {pacer === 'playing' ? 'Pause' : 'Play'}
            </button>
            <RepeatButton label="−" ariaLabel="Slower" onStep={() => changeWpm(-WPM_STEP)} />
            <span className="wpm">{wpm} WPM</span>
            <RepeatButton label="+" ariaLabel="Faster" onStep={() => changeWpm(WPM_STEP)} />
          </div>
        </>
      )}

      {sheet === 'toc' && book && position && (
        <TocSheet
          chapters={book.chapters}
          current={position.chapter}
          onSelect={(chapter) => {
            setPosition({ chapter, offset: 0 });
            setSheet(null);
            setToolbars(false);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} />}
    </main>
  );
}

/** A button that repeats while held, for stepping WPM. */
function RepeatButton({ label, ariaLabel, onStep }: { label: string; ariaLabel: string; onStep: () => void }) {
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  useEffect(() => stop, []);
  return (
    <button
      className="button step"
      aria-label={ariaLabel}
      onPointerDown={() => {
        stop();
        onStep();
        timers.current.delay = setTimeout(() => {
          timers.current.repeat = setInterval(onStep, 90);
        }, 400);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onStep();
      }}
    >
      {label}
    </button>
  );
}

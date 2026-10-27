import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { WPM_STEP, clampWpm } from '../pacer';
import { isOutdated, reparseBook } from '../library/importBook';
import { bookProgress, bookWpm, formatDuration } from '../library/progress';
import { navigate } from '../route';
import { useSettings, type ReadingMode } from '../settings';
import {
  getBook,
  getChapter,
  getPosition,
  savePosition,
  updateBook,
  type BookRecord,
  type ChapterRecord,
} from '../store/db';
import { hashToUnitInterval } from './generationTokens';
import { GuidedLine, lineDurationMs, type LineState } from './GuidedLine';
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

/** On a new page the pacer waits this long, so the eyes can get back to the top. */
const PAGE_START_DELAY_MS = 1000;

/** Pacer time from line `fromLine` of page `fromPage` to the chapter's end. */
function msToChapterEnd(pages: Page[], fromPage: number, fromLine: number, wpm: number): number {
  let ms = 0;
  for (let p = fromPage; p < pages.length; p++) {
    const lines = pages[p]!.lines;
    if (p > fromPage) ms += PAGE_START_DELAY_MS;
    for (let i = p === fromPage ? fromLine : 0; i < lines.length; i++) {
      if (isPacedLine(lines[i]!)) ms += lineDurationMs(lines[i]!, wpm);
    }
  }
  return ms;
}

function firstPacedLine(page: Page | undefined, from = 0): number {
  if (!page) return -1;
  for (let i = from; i < page.lines.length; i++) if (isPacedLine(page.lines[i]!)) return i;
  return -1;
}

export function ReaderView({ bookId }: { bookId: string }) {
  const [settings, updateSettings] = useSettings();
  const [book, setBook] = useState<BookRecord | null>();
  const [position, setPosition] = useState<Position>();
  const [record, setRecord] = useState<ChapterRecord>();
  const [wpm, setWpm] = useState(settings.defaultWpm);
  const [pacer, setPacer] = useState<PacerState>('off');
  const [pacerLine, setPacerLine] = useState(0);
  // Bumped to restart the active line's animation (new line, resync, new page).
  const [runId, setRunId] = useState(0);
  // The active line is a new page's first: hold the sweep for PAGE_START_DELAY_MS.
  const [pageStart, setPageStart] = useState(false);
  const [toolbars, setToolbars] = useState(false);
  // Generation mode: show the page unmasked until it's turned.
  const [revealed, setRevealed] = useState(false);
  const [updating, setUpdating] = useState(false);
  // Callouts the reader opened or closed, per chapter (see FlowOptions.toggled).
  const [toggled, setToggled] = useState(() => new Map<number, ReadonlySet<number>>());
  // Set when a toggle re-flows the page, so the pacer moves into what opened instead of the top.
  const pendingToggle = useRef<number | null>(null);
  const shownPage = useRef<string>('');
  const [sheet, setSheet] = useState<'toc' | 'settings' | null>(null);

  const pageAreaRef = useRef<HTMLDivElement>(null);
  const metrics = usePageMetrics(pageAreaRef, settings.fontSize);

  // Load the book and where we left off.
  useEffect(() => {
    void (async () => {
      let found = await getBook(bookId);
      if (!found) return setBook(null);
      if (isOutdated(found)) {
        // Imported by an older parser: rebuild from the stored file first.
        setUpdating(true);
        found = await reparseBook(found).catch(() => found!);
        setUpdating(false);
      }
      const saved = await getPosition(bookId);
      setBook(found);
      setWpm(bookWpm(found, settings));
      setPosition({
        chapter: Math.min(saved?.chapter ?? 0, found.chapters.length - 1),
        offset: saved?.offset ?? 0,
      });
      void updateBook(bookId, { lastOpenedAt: Date.now() });
    })();
    // The settings only seed the WPM when the book opens, so they aren't dependencies.
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
  const chapterToggles = position ? toggled.get(position.chapter) : undefined;
  const layout = useMemo(() => {
    if (!record || !metrics || record.index !== position?.chapter) return undefined;
    return layoutChapter(record.content, metrics.charsPerLine, metrics.linesPerPage, { toggled: chapterToggles });
  }, [record, metrics, position?.chapter, chapterToggles]);

  const pageIndex = layout && position ? pageIndexForOffset(layout.pages, position.offset) : 0;
  const page = layout?.pages[pageIndex];

  // Counted from the pacer's line while it's on, otherwise from the top of the page.
  const pacerOn = pacer !== 'off';
  const remainingMs = useMemo(
    () => (layout ? msToChapterEnd(layout.pages, pageIndex, pacerOn ? pacerLine : 0, wpm) : 0),
    [layout, pageIndex, pacerOn, pacerLine, wpm],
  );

  // A new page (turned, jumped to, or re-flowed) starts the pacer at its top,
  // masked. Opening or closing a callout re-flows the same page instead: the
  // pacer moves to the first line after the toggle.
  useEffect(() => {
    if (!page) return;
    const toggle = pendingToggle.current;
    pendingToggle.current = null;
    const key = `${position?.chapter}:${page.startOffset}:${metrics?.charsPerLine}:${metrics?.linesPerPage}`;
    const samePage = key === shownPage.current;
    shownPage.current = key;
    if (toggle !== null && samePage) {
      const next = firstPacedLine(page, toggle + 1);
      setPacerLine(next >= 0 ? next : Math.max(0, firstPacedLine(page)));
      setPageStart(false);
    } else {
      setPacerLine(Math.max(0, firstPacedLine(page)));
      setPageStart(true);
      setRevealed(false);
    }
    setRunId((n) => n + 1);
    // position and metrics are read for the key; `page` changes whenever they matter.
  }, [page]);

  const generation = settings.mode === 'generation';
  const maskSeed = useMemo(
    () => (position ? Math.floor(hashToUnitInterval(`${bookId}|${position.chapter}`) * 2 ** 32) : 0),
    [bookId, position?.chapter],
  );
  const setMode = useCallback((mode: ReadingMode) => updateSettings({ mode }), [updateSettings]);

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
        setPageStart(false);
        setRunId((n) => n + 1);
      } else if (!turnPage(1)) {
        setPacer('off'); // end of the book
      }
    },
    [page, turnPage],
  );

  // A page with nothing to sweep (only collapsed callouts, say) holds for the
  // page-start pause, then turns.
  useEffect(() => {
    if (pacer !== 'playing' || !page || firstPacedLine(page) !== -1) return;
    const timer = setTimeout(() => {
      if (!turnPage(1)) setPacer('off');
    }, PAGE_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pacer, page, turnPage]);

  const sharedWpm = book?.format === 'wikipedia';
  const changeWpm = useCallback(
    (delta: number) => {
      setWpm((current) => {
        const next = clampWpm(current + delta);
        if (sharedWpm) updateSettings({ wikipediaWpm: next });
        else void updateBook(bookId, { wpm: next });
        return next;
      });
    },
    [bookId, sharedWpm, updateSettings],
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
      else if (event.key === 'g') setMode(generation ? 'guided' : 'generation');
      else if (event.key === 'r' && generation) setRevealed((shown) => !shown);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, turnPage, togglePlay, changeWpm, setMode, generation]);

  const gestures = usePageGestures({
    onTap: (zone) => {
      if (zone === 'left') turnPage(-1);
      else if (zone === 'right') turnPage(1);
      else setToolbars((shown) => !shown);
    },
    onSwipe: (direction) => turnPage(direction === 'next' ? 1 : -1),
    onLongPress: (_x, y) => {
      // Lines don't take pointer events (see .page), so find the one by position.
      const lineEls = pageAreaRef.current?.querySelectorAll<HTMLElement>('[data-line]') ?? [];
      const lineEl = Array.from(lineEls).find((el) => {
        const rect = el.getBoundingClientRect();
        return y >= rect.top && y < rect.bottom;
      });
      const index = Number(lineEl?.dataset.line ?? NaN);
      const line = page?.lines[index];
      if (!line || !position) return;
      if (line.toggleId !== undefined) {
        const id = line.toggleId;
        pendingToggle.current = index;
        setToggled((all) => {
          const next = new Set(all.get(position.chapter));
          if (!next.delete(id)) next.add(id);
          return new Map(all).set(position.chapter, next);
        });
        return;
      }
      if (!isPacedLine(line)) return;
      setPacerLine(index);
      setPageStart(false);
      setRunId((n) => n + 1);
      setPacer((state) => (state === 'off' ? 'paused' : state));
    },
  }, `${position?.chapter}:${page?.startOffset}`);

  if (book === null) {
    return (
      <main className="library">
        <p className="library-empty">This book isn't on this device any more.</p>
        <button className="button" onClick={() => navigate({ screen: 'library' })}>Back to library</button>
      </main>
    );
  }

  const lineState = (index: number): LineState =>
    !pacerOn ? 'static' : index < pacerLine ? 'behind' : index === pacerLine ? 'active' : 'ahead';

  const progress = book && position && page && bookProgress(book.chapters, { chapter: position.chapter, offset: page.startOffset });

  return (
    <main className="reader">
      <header className="reader-header">{book && position ? book.chapters[position.chapter]?.title : ''}</header>
      <div
        className="page-area"
        ref={pageAreaRef}
        style={{ paddingInline: `${settings.pageMargin}%` }}
        {...gestures}
      >
        {updating && <p className="reader-note">Updating this book for the new version…</p>}
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
                startDelayMs={pageStart ? PAGE_START_DELAY_MS : 0}
                playing={pacer === 'playing'}
                showOvp={settings.showOvp}
                alternateOvpColors={settings.alternateOvpColors}
                saccadeLength={settings.saccadeLength}
                quietSweep={settings.quietSweep}
                maskDifficulty={generation && !revealed ? settings.generationDifficulty : null}
                maskSeed={maskSeed}
                sweepReveal={settings.sweepReveal && pacerOn}
                figureHeight={lineSpan(line, metrics.linesPerPage, metrics.charsPerLine) * metrics.lineHeight}
                onDone={onLineDone}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="reader-footer">
        <span className="footer-info">
          {layout && position && (
            <>
              p. {pageIndex + 1}/{layout.pages.length} · Ch {position.chapter + 1}/{lastChapter + 1}
              {progress && ` · ${Math.round(progress.fraction * 100)}%`}
              {pacerOn && ` · ${wpm} wpm · ${formatDuration(remainingMs)} left in ch`}
            </>
          )}
        </span>
        {/* Always reachable, so pausing and resuming doesn't need the toolbars. */}
        <button
          className="footer-play"
          onClick={togglePlay}
          aria-label={pacer === 'playing' ? 'Pause' : 'Play'}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            {pacer === 'playing' ? (
              <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
            ) : (
              <path d="M5 3l8 5-8 5z" fill="currentColor" />
            )}
          </svg>
        </button>
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
            <div className="segmented" role="radiogroup" aria-label="Reading mode">
              {MODES.map(([mode, label]) => (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={settings.mode === mode}
                  className={settings.mode === mode ? 'selected' : ''}
                  onClick={() => setMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            {generation && (
              <button
                className={`button${revealed ? ' primary' : ''}`}
                aria-pressed={revealed}
                onClick={() => setRevealed((shown) => !shown)}
              >
                Reveal
              </button>
            )}
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

const MODES: Array<[ReadingMode, string]> = [['guided', 'Guided'], ['generation', 'Generation']];

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

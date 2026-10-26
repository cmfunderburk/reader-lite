// How far through a book a place is, and how long the rest takes at the
// pacer's speed, from the chapter summaries stored with each book.

import { calculateGuidedLineDuration } from '../reader/saccade';
import type { Settings } from '../settings';
import type { BookRecord, ChapterSummary } from '../store/db';

/** The pacer WPM a book reads at: its own, or for Wikipedia articles the shared one. */
export function bookWpm(book: BookRecord, settings: Settings): number {
  return book.format === 'wikipedia' ? settings.wikipediaWpm || settings.defaultWpm : (book.wpm ?? settings.defaultWpm);
}

export interface BookProgress {
  /** Share of the book's text before the place, 0–1. */
  fraction: number;
  /** Characters the pacer has left to sweep from the place to the end. */
  pacedCharsLeft: number;
}

/**
 * Progress from a place (the start of the book if none). Undefined for a
 * book imported before chapter summaries had reading lengths.
 */
export function bookProgress(
  chapters: ChapterSummary[],
  place: { chapter: number; offset: number } | undefined,
): BookProgress | undefined {
  const current = place?.chapter ?? 0;
  let total = 0;
  let before = 0;
  let pacedLeft = 0;
  for (const [i, { visibleChars, pacedChars }] of chapters.entries()) {
    if (visibleChars === undefined || pacedChars === undefined) return undefined;
    total += visibleChars;
    if (i < current) {
      before += visibleChars;
    } else if (i === current) {
      const within = Math.min(place?.offset ?? 0, visibleChars);
      before += within;
      pacedLeft += visibleChars > 0 ? pacedChars * (1 - within / visibleChars) : 0;
    } else {
      pacedLeft += pacedChars;
    }
  }
  return { fraction: total > 0 ? before / total : 0, pacedCharsLeft: pacedLeft };
}

/** Pacer time for `pacedChars` characters at `wpm`, as each line is timed. */
export function pacedMs(pacedChars: number, wpm: number): number {
  return calculateGuidedLineDuration(pacedChars, wpm);
}

/** "<1m", "12m", "1h 05m". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

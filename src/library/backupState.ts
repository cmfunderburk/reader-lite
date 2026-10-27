// Reading state in backups: where each book is open, its WPM and when it was
// last read, plus the reader settings. Books are matched by id (the SHA-256 of
// their file), so a re-imported file picks its place back up. Places for books
// that aren't on the device yet wait until the book is added.

import {
  getBook,
  getPosition,
  getSetting,
  listBooks,
  listPositions,
  putSetting,
  savePosition,
  updateBook,
  type BookRecord,
  type ChapterSummary,
  type PositionRecord,
} from '../store/db';

export const BACKUP_STATE_FILE = 'reader-lite-backup.json';
const BACKUP_APP = 'reader-lite';
const BACKUP_VERSION = 1;
const PENDING_KEY = 'pendingRestore';
export const LAST_EXPORT_KEY = 'lastExportedAt';

export class BackupError extends Error {}

export interface BackupBook {
  id: string;
  title: string;
  fileName: string;
  addedAt: number;
  lastOpenedAt?: number;
  wpm?: number;
  position?: {
    chapter: number;
    /** Lets the place survive chapters being split or merged by a newer parser. */
    chapterTitle?: string;
    offset: number;
    updatedAt: number;
  };
}

export interface BackupState {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: number;
  settings?: unknown;
  books: BackupBook[];
}

export async function collectState(settings: unknown): Promise<BackupState> {
  const [books, positions] = await Promise.all([listBooks(), listPositions()]);
  const byBook = new Map(positions.map((position) => [position.bookId, position]));
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings,
    books: books.map((book) => {
      const position = byBook.get(book.id);
      return {
        id: book.id,
        title: book.title,
        fileName: book.fileName,
        addedAt: book.addedAt,
        lastOpenedAt: book.lastOpenedAt,
        wpm: book.wpm,
        position: position && {
          chapter: position.chapter,
          chapterTitle: book.chapters[position.chapter]?.title,
          offset: position.offset,
          updatedAt: position.updatedAt,
        },
      };
    }),
  };
}

export function parseBackupState(text: string): BackupState {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError('not a Reader Lite backup');
  }
  const state = value as Partial<BackupState> | null;
  if (state?.app !== BACKUP_APP || !Array.isArray(state.books)) throw new BackupError('not a Reader Lite backup');
  if (typeof state.version !== 'number' || state.version > BACKUP_VERSION) {
    throw new BackupError('this backup is from a newer version of Reader Lite');
  }
  const books = state.books.filter(
    (book): book is BackupBook => typeof book?.id === 'string' && /^[0-9a-f]{64}$/.test(book.id),
  );
  return { ...state, books } as BackupState;
}

/**
 * The chapter titled `title` nearest `index`, or -1. Chapters can split or
 * merge between parser versions, so a place is kept by title where it can be.
 */
export function nearestChapterTitled(chapters: ChapterSummary[], index: number, title: string | undefined): number {
  let best = -1;
  chapters.forEach((chapter, i) => {
    if (chapter.title === title && (best < 0 || Math.abs(i - index) < Math.abs(best - index))) best = i;
  });
  return best;
}

/**
 * What restoring `entry` changes for a book already on the device. The
 * backup's place wins only if it's newer than the device's own.
 */
export function planBookRestore(
  book: BookRecord,
  local: PositionRecord | undefined,
  entry: BackupBook,
): { position?: PositionRecord; changes: Partial<BookRecord> } {
  const changes: Partial<BookRecord> = {};
  if (entry.lastOpenedAt && entry.lastOpenedAt > (book.lastOpenedAt ?? 0)) changes.lastOpenedAt = entry.lastOpenedAt;

  const saved = entry.position;
  if (!saved || (local && local.updatedAt >= saved.updatedAt) || book.chapters.length === 0) {
    if (entry.wpm && !book.wpm) changes.wpm = entry.wpm;
    return { changes };
  }
  if (entry.wpm) changes.wpm = entry.wpm;
  const sameTitle =
    book.chapters[saved.chapter]?.title === saved.chapterTitle || saved.chapterTitle === undefined
      ? saved.chapter
      : nearestChapterTitled(book.chapters, saved.chapter, saved.chapterTitle);
  const chapter = sameTitle >= 0 ? Math.min(sameTitle, book.chapters.length - 1) : Math.min(saved.chapter, book.chapters.length - 1);
  return {
    changes,
    position: { bookId: book.id, chapter, offset: sameTitle >= 0 ? saved.offset : 0, updatedAt: saved.updatedAt },
  };
}

/** Apply one book's backed-up state if the book is here; false if it isn't. */
async function applyBookState(entry: BackupBook): Promise<boolean> {
  const book = await getBook(entry.id);
  if (!book) return false;
  const { position, changes } = planBookRestore(book, await getPosition(book.id), entry);
  if (Object.keys(changes).length > 0) await updateBook(book.id, changes);
  if (position) await savePosition(position);
  return true;
}

export interface RestoreSummary {
  /** Books on the device whose state was restored. */
  restored: number;
  /** Books in the backup that aren't on the device; their places wait for them. */
  waiting: number;
}

export async function restoreState(state: BackupState): Promise<RestoreSummary> {
  const pending = (await getSetting<Record<string, BackupBook>>(PENDING_KEY)) ?? {};
  let restored = 0;
  for (const entry of state.books) {
    if (await applyBookState(entry)) {
      restored++;
      delete pending[entry.id];
    } else {
      pending[entry.id] = entry;
    }
  }
  await putSetting(PENDING_KEY, pending);
  return { restored, waiting: state.books.length - restored };
}

/** After a book is added, restore its place if a backup was waiting for it. */
export async function applyPendingRestore(bookId: string): Promise<void> {
  try {
    const pending = await getSetting<Record<string, BackupBook>>(PENDING_KEY);
    const entry = pending?.[bookId];
    if (!entry) return;
    await applyBookState(entry);
    delete pending[bookId];
    await putSetting(PENDING_KEY, pending);
  } catch {
    // The book is added either way; its place just starts at the beginning.
  }
}

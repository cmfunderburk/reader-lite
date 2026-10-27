import { describe, expect, it } from 'bun:test';
import type { BookRecord, PositionRecord } from '../store/db';
import { BackupError, nearestChapterTitled, parseBackupState, planBookRestore, type BackupBook } from './backupState';

const ID = 'a'.repeat(64);
const book = (titles: string[], extra: Partial<BookRecord> = {}): BookRecord => ({
  id: ID,
  title: 'Book',
  fileName: 'book.epub',
  addedAt: 1,
  chapters: titles.map((title) => ({ title, chars: 100 })),
  ...extra,
});
const entry = (position?: BackupBook['position'], extra: Partial<BackupBook> = {}): BackupBook => ({
  id: ID,
  title: 'Book',
  fileName: 'book.epub',
  addedAt: 1,
  position,
  ...extra,
});
const local = (chapter: number, updatedAt: number): PositionRecord => ({ bookId: ID, chapter, offset: 5, updatedAt });

describe('parseBackupState', () => {
  it('accepts a backup and drops malformed book entries', () => {
    const state = parseBackupState(
      JSON.stringify({ app: 'reader-lite', version: 1, exportedAt: 2, books: [entry(), { id: 'nope' }, null] }),
    );
    expect(state.books.map((b) => b.id)).toEqual([ID]);
  });

  it('rejects other JSON, broken JSON and newer versions', () => {
    expect(() => parseBackupState('{"app":"other","books":[]}')).toThrow(BackupError);
    expect(() => parseBackupState('{')).toThrow('not a Reader Lite backup');
    expect(() => parseBackupState('{"app":"reader-lite","version":9,"books":[]}')).toThrow('newer version');
  });
});

describe('nearestChapterTitled', () => {
  it('picks the same-titled chapter nearest the old index', () => {
    const chapters = book(['A', 'B', 'A', 'C', 'A']).chapters;
    expect(nearestChapterTitled(chapters, 3, 'A')).toBe(2);
    expect(nearestChapterTitled(chapters, 4, 'A')).toBe(4);
    expect(nearestChapterTitled(chapters, 1, 'Z')).toBe(-1);
  });
});

describe('planBookRestore', () => {
  it("restores a newer place, WPM and last-opened time", () => {
    const plan = planBookRestore(
      book(['Intro', 'One', 'Two'], { lastOpenedAt: 10, wpm: 200 }),
      local(0, 50),
      entry({ chapter: 2, chapterTitle: 'Two', offset: 840, updatedAt: 99 }, { wpm: 320, lastOpenedAt: 99 }),
    );
    expect(plan.position).toEqual({ bookId: ID, chapter: 2, offset: 840, updatedAt: 99 });
    expect(plan.changes).toEqual({ wpm: 320, lastOpenedAt: 99 });
  });

  it("keeps the device's own place when it is newer", () => {
    const plan = planBookRestore(
      book(['Intro', 'One'], { wpm: 200 }),
      local(1, 100),
      entry({ chapter: 0, chapterTitle: 'Intro', offset: 3, updatedAt: 50 }, { wpm: 320 }),
    );
    expect(plan.position).toBeUndefined();
    expect(plan.changes).toEqual({});
  });

  it('follows the chapter title when chapters moved, else starts the chapter', () => {
    const moved = planBookRestore(
      book(['Cover', 'Intro', 'One', 'Two']),
      undefined,
      entry({ chapter: 2, chapterTitle: 'Two', offset: 40, updatedAt: 9 }),
    );
    expect(moved.position).toMatchObject({ chapter: 3, offset: 40 });
    const gone = planBookRestore(book(['Intro', 'One']), undefined, entry({ chapter: 5, chapterTitle: 'Six', offset: 40, updatedAt: 9 }));
    expect(gone.position).toMatchObject({ chapter: 1, offset: 0 });
  });
});

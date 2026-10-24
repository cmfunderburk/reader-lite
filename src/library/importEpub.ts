import { EpubError, PARSER_VERSION, parseEpub, type ParsedBook } from '../epub/parse';
import {
  getBook,
  getFile,
  getPosition,
  replaceBookContent,
  saveBook,
  savePosition,
  type AssetRecord,
  type BookRecord,
  type ChapterRecord,
} from '../store/db';

export interface ImportResult {
  book: BookRecord;
  duplicate: boolean;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Ask the browser not to evict our storage. Safari grants this to home-screen apps. */
async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not fatal: storage just stays best-effort.
  }
}

export async function importEpub(file: File): Promise<ImportResult> {
  const data = await file.arrayBuffer();
  const id = await sha256Hex(data);

  const existing = await getBook(id);
  if (existing) return { book: existing, duplicate: true };

  const parsed = await parseEpub(data);
  const book: BookRecord = {
    id,
    title: parsed.title,
    author: parsed.author,
    fileName: file.name,
    addedAt: Date.now(),
    chapters: chapterSummaries(parsed),
    parserVersion: PARSER_VERSION,
  };

  await saveBook(book, chapterRecords(id, parsed), assetRecords(id, parsed), { bookId: id, name: file.name, data });
  void requestPersistence();
  return { book, duplicate: false };
}

function chapterSummaries(parsed: ParsedBook): BookRecord['chapters'] {
  return parsed.chapters.map((chapter) => ({ title: chapter.title, chars: chapter.content.length }));
}

function chapterRecords(bookId: string, parsed: ParsedBook): ChapterRecord[] {
  return parsed.chapters.map((chapter, index) => ({ bookId, index, ...chapter }));
}

function assetRecords(bookId: string, parsed: ParsedBook): AssetRecord[] {
  return parsed.assets.map((asset) => ({
    bookId,
    path: asset.path,
    mediaType: asset.mediaType,
    data: asset.bytes.slice().buffer,
  }));
}

export function isOutdated(book: BookRecord): boolean {
  return (book.parserVersion ?? 1) < PARSER_VERSION;
}

/**
 * Re-parse a book from its stored file with the current parser, keeping its
 * WPM and reading history. Chapters can split or merge, so the saved position
 * moves to the chapter with the same title nearest its old index (start of
 * that chapter if the title changed).
 */
export async function reparseBook(book: BookRecord): Promise<BookRecord> {
  const file = await getFile(book.id);
  if (!file) return book;
  const parsed = await parseEpub(file.data);
  const updated: BookRecord = {
    ...book,
    title: parsed.title,
    author: parsed.author,
    chapters: chapterSummaries(parsed),
    parserVersion: PARSER_VERSION,
  };

  const position = await getPosition(book.id);
  await replaceBookContent(updated, chapterRecords(book.id, parsed), assetRecords(book.id, parsed));
  if (position) {
    const oldTitle = book.chapters[position.chapter]?.title;
    let best = -1;
    updated.chapters.forEach((chapter, index) => {
      if (chapter.title === oldTitle && (best < 0 || Math.abs(index - position.chapter) < Math.abs(best - position.chapter))) {
        best = index;
      }
    });
    await savePosition(
      best >= 0
        ? { ...position, chapter: best, updatedAt: Date.now() }
        : { ...position, chapter: Math.min(position.chapter, updated.chapters.length - 1), offset: 0, updatedAt: Date.now() },
    );
  }
  return updated;
}

export function importErrorMessage(err: unknown): string {
  if (err instanceof EpubError) return err.message;
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return 'not enough storage space on this device';
  return 'unexpected error while importing';
}

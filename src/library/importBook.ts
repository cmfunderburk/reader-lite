import { EpubError, PARSER_VERSION, parseEpub, type ParsedBook } from '../epub/parse';
import { ZipArchive, ZipError } from '../epub/zip';
import { buildStoredZip } from '../epub/zipWriter';
import { imageMediaType, isIncluded, isMarkdownPath, parseMarkdownBook } from '../markdown/book';
import { requestPersistence } from '../store/persistence';
import { applyPendingRestore, BACKUP_STATE_FILE, nearestChapterTitled } from './backupState';
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

/**
 * What to import from a pick: each EPUB on its own, each zip on its own
 * (an EPUB or a zipped folder of Markdown), and all picked Markdown files
 * (with any images picked alongside) together as one book.
 */
export type ImportSource =
  | { kind: 'file'; file: File; label: string }
  | { kind: 'markdown'; files: File[]; folder: string; label: string };

/** Where a picked file sits: its path within a picked folder, else just its name. */
const pickedPath = (file: File) => file.webkitRelativePath || file.name;

export function groupImports(files: File[]): ImportSource[] {
  const sources: ImportSource[] = [];
  const loose: File[] = [];
  for (const file of files) {
    if (/\.(epub|zip)$/i.test(file.name)) sources.push({ kind: 'file', file, label: file.name });
    else if (isMarkdownPath(file.name) || imageMediaType(file.name)) loose.push(file);
  }
  if (loose.some((file) => isMarkdownPath(file.name))) {
    const folder = pickedPath(loose[0]!).includes('/') ? pickedPath(loose[0]!).split('/')[0]! : '';
    const count = loose.filter((file) => isMarkdownPath(file.name)).length;
    sources.push({ kind: 'markdown', files: loose, folder, label: folder || `${count} Markdown ${count === 1 ? 'file' : 'files'}` });
  }
  return sources;
}

export async function importSource(source: ImportSource): Promise<ImportResult> {
  if (source.kind === 'markdown') {
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const file of source.files) {
      const path = pickedPath(file);
      if (isIncluded(path)) files.set(path, new Uint8Array(await file.arrayBuffer()));
    }
    // Keep the pick as one stored zip (sorted, so the same files give the same book id).
    const entries = [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, data]) => ({ name, data }));
    return importMarkdown(files, source.folder, buildStoredZip(entries), `${source.folder || 'notes'}.zip`);
  }

  const { file } = source;
  if (/\.zip$/i.test(file.name)) {
    const data = new Uint8Array(await file.arrayBuffer());
    let zip: ZipArchive;
    try {
      zip = ZipArchive.open(data);
    } catch (err) {
      if (err instanceof ZipError) throw new EpubError('not a valid zip file');
      throw err;
    }
    // An EPUB that was renamed (or zipped by a tool) still has its container.
    if (zip.has('META-INF/container.xml')) return importEpub(file);
    if (zip.has(BACKUP_STATE_FILE)) throw new EpubError('this is a Reader Lite backup; use Restore at the bottom of the library');
    return importMarkdown(await markdownFiles(zip), file.name.replace(/\.zip$/i, ''), data, file.name);
  }
  return importEpub(file);
}

/** The Markdown and image files in a zip, by path. */
async function markdownFiles(zip: ZipArchive): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const name of zip.names()) {
    if (isIncluded(name) && (isMarkdownPath(name) || imageMediaType(name))) files.set(name, await zip.bytes(name));
  }
  return files;
}

async function importMarkdown(
  files: Map<string, Uint8Array>,
  name: string,
  stored: Uint8Array,
  fileName: string,
): Promise<ImportResult> {
  const data = stored.slice().buffer;
  const id = await sha256Hex(data);
  const existing = await getBook(id);
  if (existing) return { book: existing, duplicate: true };

  const parsed = await parseMarkdownBook(files, name);
  const book: BookRecord = {
    id,
    title: parsed.title,
    fileName,
    addedAt: Date.now(),
    chapters: chapterSummaries(parsed),
    format: 'markdown',
    parserVersion: PARSER_VERSION,
  };
  await saveBook(book, chapterRecords(id, parsed), assetRecords(id, parsed), { bookId: id, name: fileName, data });
  await applyPendingRestore(id);
  void requestPersistence();
  return { book, duplicate: false };
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
  await applyPendingRestore(id);
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
  const parsed =
    book.format === 'markdown'
      ? await parseMarkdownBook(await markdownFiles(ZipArchive.open(file.data)), file.name.replace(/\.zip$/i, ''))
      : await parseEpub(file.data);
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
    const best = nearestChapterTitled(updated.chapters, position.chapter, book.chapters[position.chapter]?.title);
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

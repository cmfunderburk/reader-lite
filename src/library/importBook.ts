import { EpubError, PARSER_VERSION, parseEpub, type ParsedBook } from '../epub/parse';
import { ZipArchive, ZipError } from '../epub/zip';
import { buildStoredZip } from '../epub/zipWriter';
import { imageMediaType, isIncluded, isMarkdownPath, parseMarkdownBook } from '../markdown/book';
import { readingLength } from '../reader/layout';
import { requestPersistence } from '../store/persistence';
import { WikipediaError, type WikiArticle } from '../wikipedia/article';
import { ARTICLE_FILE, readWikipediaFile, wikipediaBook, wikipediaFile, type LeadImage } from '../wikipedia/book';
import { applyPendingRestore, BACKUP_STATE_FILE, nearestChapterTitled } from './backupState';
import {
  getBook,
  getFile,
  getPosition,
  replaceBookContent,
  saveBook,
  savePosition,
  updateBook,
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
    if (zip.has(ARTICLE_FILE)) {
      const { article, image } = await readWikipediaFile(zip);
      return importWikipedia(article, image);
    }
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

/**
 * Add a Wikipedia article. Its id comes from its title, so fetching it again
 * (or restoring it) finds the same book. `dailyFor` marks today's article.
 */
export async function importWikipedia(article: WikiArticle, image: LeadImage | undefined, dailyFor?: string): Promise<ImportResult> {
  const id = await sha256Hex(new TextEncoder().encode(`wikipedia:${article.title}`).buffer);
  const existing = await getBook(id);
  if (existing) {
    if (dailyFor && existing.dailyFor !== dailyFor) await updateBook(id, { dailyFor });
    return { book: { ...existing, dailyFor: dailyFor ?? existing.dailyFor }, duplicate: true };
  }

  const parsed = wikipediaBook(article, image);
  const fileName = `${article.title.replaceAll('/', '_')}.wikipedia.zip`;
  const book: BookRecord = {
    id,
    title: parsed.title,
    description: article.description,
    fileName,
    addedAt: Date.now(),
    chapters: chapterSummaries(parsed),
    format: 'wikipedia',
    dailyFor,
    parserVersion: PARSER_VERSION,
  };
  const data = wikipediaFile(article, image).buffer;
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
  return parsed.chapters.map((chapter) => ({
    title: chapter.title,
    chars: chapter.content.length,
    ...readingLength(chapter.content),
  }));
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

const reparsing = new Map<string, Promise<BookRecord>>();

/**
 * Re-parse a book from its stored file with the current parser, keeping its
 * WPM and reading history. Chapters can split or merge, so the saved position
 * moves to the chapter with the same title nearest its old index (start of
 * that chapter if the title changed). A book already being re-parsed (by the
 * library's upgrade, say) isn't parsed twice.
 */
export function reparseBook(book: BookRecord): Promise<BookRecord> {
  let pending = reparsing.get(book.id);
  if (!pending) {
    pending = reparse(book).finally(() => reparsing.delete(book.id));
    reparsing.set(book.id, pending);
  }
  return pending;
}

async function reparse(book: BookRecord): Promise<BookRecord> {
  const file = await getFile(book.id);
  if (!file) return book;
  const parsed = await parseStoredFile(book, file.data, file.name);
  const changes = {
    title: parsed.title,
    author: parsed.author,
    chapters: chapterSummaries(parsed),
    parserVersion: PARSER_VERSION,
  };
  const updated: BookRecord = { ...book, ...changes };

  const position = await getPosition(book.id);
  await replaceBookContent(book.id, changes, chapterRecords(book.id, parsed), assetRecords(book.id, parsed));
  if (position) {
    const best = nearestChapterTitled(updated.chapters, position.chapter, book.chapters[position.chapter]?.title);
    // A place that stays put keeps its time, so a newer backup's place still wins on restore.
    if (best !== position.chapter) {
      await savePosition(
        best >= 0
          ? { ...position, chapter: best, updatedAt: Date.now() }
          : { ...position, chapter: Math.min(position.chapter, updated.chapters.length - 1), offset: 0, updatedAt: Date.now() },
      );
    }
  }
  return updated;
}

const upgradeTried = new Set<string>();

/**
 * Re-parse, one at a time, the books an older parser imported, so the
 * library has their reading lengths and they open without a wait. Each book
 * is tried once per session; `signal` stops before the next book.
 */
export async function upgradeOutdatedBooks(
  books: BookRecord[],
  { signal, onUpdated }: { signal: AbortSignal; onUpdated: () => void },
): Promise<void> {
  for (const book of books) {
    if (signal.aborted) return;
    if (!isOutdated(book) || upgradeTried.has(book.id)) continue;
    upgradeTried.add(book.id);
    try {
      if (!isOutdated(await reparseBook(book))) onUpdated();
    } catch (err) {
      console.error(`Couldn't update “${book.title}”`, err);
    }
  }
}

async function parseStoredFile(book: BookRecord, data: ArrayBuffer, name: string): Promise<ParsedBook> {
  if (book.format === 'markdown') return parseMarkdownBook(await markdownFiles(ZipArchive.open(data)), name.replace(/\.zip$/i, ''));
  if (book.format === 'wikipedia') {
    const { article, image } = await readWikipediaFile(ZipArchive.open(data));
    return wikipediaBook(article, image);
  }
  return parseEpub(data);
}

export function importErrorMessage(err: unknown): string {
  if (err instanceof EpubError || err instanceof WikipediaError) return err.message;
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return 'not enough storage space on this device';
  return 'unexpected error while importing';
}

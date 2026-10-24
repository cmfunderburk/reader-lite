// IndexedDB storage. Binary data is stored as ArrayBuffers rather than Blobs,
// which older Safari versions handled unreliably in IndexedDB.

const DB_NAME = 'reader-lite';
const DB_VERSION = 1;

export interface ChapterSummary {
  title: string;
  chars: number;
}

export interface BookRecord {
  id: string;
  title: string;
  author?: string;
  fileName: string;
  addedAt: number;
  lastOpenedAt?: number;
  chapters: ChapterSummary[];
  /** Pacer WPM remembered for this book (M2). */
  wpm?: number;
  /** What the stored file is; missing means an EPUB. */
  format?: 'epub' | 'markdown';
  /** PARSER_VERSION the content was produced by; missing means 1. */
  parserVersion?: number;
}

export interface ChapterRecord {
  bookId: string;
  index: number;
  title: string;
  content: string;
}

export interface AssetRecord {
  bookId: string;
  path: string;
  mediaType: string;
  data: ArrayBuffer;
}

export interface FileRecord {
  bookId: string;
  name: string;
  data: ArrayBuffer;
}

export interface PositionRecord {
  bookId: string;
  chapter: number;
  /** Non-whitespace characters into the chapter (stable across re-flow; see reader/layout.ts). */
  offset: number;
  updatedAt: number;
}

type StoreName = 'books' | 'chapters' | 'assets' | 'files' | 'positions' | 'settings';

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('chapters', { keyPath: ['bookId', 'index'] });
      db.createObjectStore('assets', { keyPath: ['bookId', 'path'] });
      db.createObjectStore('files', { keyPath: 'bookId' });
      db.createObjectStore('positions', { keyPath: 'bookId' });
      db.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
  const result = await work(tx);
  await done;
  return result;
}

/** All keys whose first component is `bookId`, for compound-key stores. */
function bookRange(bookId: string): IDBKeyRange {
  return IDBKeyRange.bound([bookId], [bookId, []]);
}

export async function listBooks(): Promise<BookRecord[]> {
  const books = await transaction(['books'], 'readonly', (tx) =>
    promisify(tx.objectStore('books').getAll() as IDBRequest<BookRecord[]>),
  );
  return books.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}

export function getBook(id: string): Promise<BookRecord | undefined> {
  return transaction(['books'], 'readonly', (tx) =>
    promisify(tx.objectStore('books').get(id) as IDBRequest<BookRecord | undefined>),
  );
}

export function getChapter(bookId: string, index: number): Promise<ChapterRecord | undefined> {
  return transaction(['chapters'], 'readonly', (tx) =>
    promisify(tx.objectStore('chapters').get([bookId, index]) as IDBRequest<ChapterRecord | undefined>),
  );
}

export function getAsset(bookId: string, path: string): Promise<AssetRecord | undefined> {
  return transaction(['assets'], 'readonly', (tx) =>
    promisify(tx.objectStore('assets').get([bookId, path]) as IDBRequest<AssetRecord | undefined>),
  );
}

export function saveBook(
  book: BookRecord,
  chapters: ChapterRecord[],
  assets: AssetRecord[],
  file: FileRecord,
): Promise<void> {
  return transaction(['books', 'chapters', 'assets', 'files'], 'readwrite', (tx) => {
    tx.objectStore('books').put(book);
    for (const chapter of chapters) tx.objectStore('chapters').put(chapter);
    for (const asset of assets) tx.objectStore('assets').put(asset);
    tx.objectStore('files').put(file);
  });
}

export function getFile(bookId: string): Promise<FileRecord | undefined> {
  return transaction(['files'], 'readonly', (tx) =>
    promisify(tx.objectStore('files').get(bookId) as IDBRequest<FileRecord | undefined>),
  );
}

/** Replace a book's record, chapters and assets after re-parsing its file. */
export function replaceBookContent(book: BookRecord, chapters: ChapterRecord[], assets: AssetRecord[]): Promise<void> {
  return transaction(['books', 'chapters', 'assets'], 'readwrite', (tx) => {
    tx.objectStore('chapters').delete(bookRange(book.id));
    tx.objectStore('assets').delete(bookRange(book.id));
    tx.objectStore('books').put(book);
    for (const chapter of chapters) tx.objectStore('chapters').put(chapter);
    for (const asset of assets) tx.objectStore('assets').put(asset);
  });
}

export function updateBook(id: string, changes: Partial<Omit<BookRecord, 'id'>>): Promise<void> {
  return transaction(['books'], 'readwrite', async (tx) => {
    const store = tx.objectStore('books');
    const book = (await promisify(store.get(id))) as BookRecord | undefined;
    if (book) store.put({ ...book, ...changes });
  });
}

export function deleteBook(id: string): Promise<void> {
  return transaction(['books', 'chapters', 'assets', 'files', 'positions'], 'readwrite', (tx) => {
    tx.objectStore('books').delete(id);
    tx.objectStore('chapters').delete(bookRange(id));
    tx.objectStore('assets').delete(bookRange(id));
    tx.objectStore('files').delete(id);
    tx.objectStore('positions').delete(id);
  });
}

export function getPosition(bookId: string): Promise<PositionRecord | undefined> {
  return transaction(['positions'], 'readonly', (tx) =>
    promisify(tx.objectStore('positions').get(bookId) as IDBRequest<PositionRecord | undefined>),
  );
}

export function listPositions(): Promise<PositionRecord[]> {
  return transaction(['positions'], 'readonly', (tx) =>
    promisify(tx.objectStore('positions').getAll() as IDBRequest<PositionRecord[]>),
  );
}

export function savePosition(position: PositionRecord): Promise<void> {
  return transaction(['positions'], 'readwrite', (tx) => {
    tx.objectStore('positions').put(position);
  });
}

export function getSetting<T>(key: string): Promise<T | undefined> {
  return transaction(['settings'], 'readonly', (tx) =>
    promisify(tx.objectStore('settings').get(key) as IDBRequest<T | undefined>),
  );
}

export function putSetting<T>(key: string, value: T): Promise<void> {
  return transaction(['settings'], 'readwrite', (tx) => {
    tx.objectStore('settings').put(value, key);
  });
}

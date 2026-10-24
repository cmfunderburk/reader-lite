import { EpubError, parseEpub } from '../epub/parse';
import { getBook, saveBook, type BookRecord } from '../store/db';

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
    chapters: parsed.chapters.map((chapter) => ({ title: chapter.title, chars: chapter.content.length })),
  };

  await saveBook(
    book,
    parsed.chapters.map((chapter, index) => ({ bookId: id, index, ...chapter })),
    parsed.assets.map((asset) => ({
      bookId: id,
      path: asset.path,
      mediaType: asset.mediaType,
      data: asset.bytes.slice().buffer,
    })),
    { bookId: id, name: file.name, data },
  );
  void requestPersistence();
  return { book, duplicate: false };
}

export function importErrorMessage(err: unknown): string {
  if (err instanceof EpubError) return err.message;
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return 'not enough storage space on this device';
  return 'unexpected error while importing';
}

// Export and restore. "Reading state" is a small JSON file: places, WPMs and
// settings. "Everything" is a zip of that plus every book's original file, so
// a new device (or the native app) can be set up from one file.

import { EpubError } from '../epub/parse';
import { ZipArchive, ZipError, decodeText } from '../epub/zip';
import { storedZipParts, type ZipEntryInput } from '../epub/zipWriter';
import { getFile, listBooks, putSetting } from '../store/db';
import { isListed } from '../wikipedia/daily';
import {
  BACKUP_STATE_FILE,
  BackupError,
  collectState,
  LAST_EXPORT_KEY,
  parseBackupState,
  restoreState,
  type RestoreSummary,
} from './backupState';
import { importErrorMessage, importSource } from './importBook';

const BOOKS_FOLDER = 'books/';
const today = () => new Date().toISOString().slice(0, 10);

/** An export ready to hand over; it counts as the last export only once saved (see saveExport). */
export interface Export {
  file: File;
  exportedAt: number;
}

export async function exportReadingState(settings: unknown): Promise<Export> {
  const state = await collectState(settings);
  const file = new File([JSON.stringify(state, null, 1)], `reader-lite-state-${today()}.json`, { type: 'application/json' });
  return { file, exportedAt: state.exportedAt };
}

export async function exportEverything(settings: unknown): Promise<Export> {
  const state = await collectState(settings);
  const entries: ZipEntryInput[] = [{ name: BACKUP_STATE_FILE, data: new TextEncoder().encode(JSON.stringify(state, null, 1)) }];
  // Today's article joins the library only once opened; restored without its date, an unopened one would never show or be cleared.
  for (const book of (await listBooks()).filter(isListed)) {
    const file = await getFile(book.id);
    // The file name is only for people browsing the zip; restore goes by content.
    if (file) entries.push({ name: `${BOOKS_FOLDER}${book.id}/${file.name.replaceAll('/', '_')}`, data: new Uint8Array(file.data) });
  }
  const file = new File(storedZipParts(entries), `reader-lite-backup-${today()}.zip`, { type: 'application/zip' });
  return { file, exportedAt: state.exportedAt };
}

/** Save an export and, unless the share sheet was closed, record it as the last one. */
export async function saveExport({ file, exportedAt }: Export): Promise<void> {
  if (await saveFile(file)) await putSetting(LAST_EXPORT_KEY, exportedAt);
}

export interface RestoreResult extends RestoreSummary {
  settings?: unknown;
  added: number;
  failed: string[];
}

/** Restore from either kind of export. Books already here are kept as they are. */
export async function restoreBackup(file: File, onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  if (!/\.zip$/i.test(file.name)) {
    const state = parseBackupState(await file.text());
    return { ...(await restoreState(state)), settings: state.settings, added: 0, failed: [] };
  }

  let zip: ZipArchive;
  try {
    zip = ZipArchive.open(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ZipError) throw new BackupError('not a valid zip file');
    throw err;
  }
  if (!zip.has(BACKUP_STATE_FILE)) throw new BackupError('not a Reader Lite backup');
  const state = parseBackupState(decodeText(await zip.bytes(BACKUP_STATE_FILE)));

  const bookFiles = zip.names().filter((name) => name.startsWith(BOOKS_FOLDER) && !name.endsWith('/'));
  let added = 0;
  const failed: string[] = [];
  for (const [i, name] of bookFiles.entries()) {
    onProgress?.(i, bookFiles.length);
    const fileName = name.split('/').pop()!;
    try {
      const bytes = await zip.bytes(name);
      const result = await importSource({ kind: 'file', file: new File([bytes.slice()], fileName), label: fileName });
      if (!result.duplicate) added++;
    } catch (err) {
      failed.push(`${fileName} (${importErrorMessage(err)})`);
    }
  }
  onProgress?.(bookFiles.length, bookFiles.length);
  return { ...(await restoreState(state)), settings: state.settings, added, failed };
}

export function restoreErrorMessage(err: unknown): string {
  if (err instanceof BackupError || err instanceof EpubError) return err.message;
  return importErrorMessage(err);
}

/**
 * Hand a file to the user: the share sheet where there is one (iPad: Save to
 * Files), else a download. False if the share sheet was closed without saving.
 */
export async function saveFile(file: File): Promise<boolean> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false; // closed the share sheet
      throw err;
    }
    return true;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

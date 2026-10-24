import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../route';
import { sanitizeSettings, useSettings } from '../settings';
import { deleteBook, getSetting, listBooks, listPositions, type BookRecord, type PositionRecord } from '../store/db';
import { formatBytes, storageStatus, type StorageStatus } from '../store/persistence';
import { exportEverything, exportReadingState, restoreBackup, restoreErrorMessage, saveFile, type RestoreResult } from './backup';
import { LAST_EXPORT_KEY } from './backupState';
import { isListed } from '../wikipedia/daily';
import { WikipediaSection } from '../wikipedia/WikipediaSection';
import { groupImports, importErrorMessage, importSource } from './importBook';

/** Folder picking, where the browser offers it (desktop; possibly not iPad). */
const canPickFolders = typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
const ACCEPT = '.epub,.zip,.md,.markdown,application/epub+zip,application/zip,text/markdown,image/*';

interface ImportStatus {
  fileName: string;
  state: 'working' | 'done' | 'duplicate' | 'failed';
  message?: string;
}

function progressLabel(book: BookRecord, position: PositionRecord | undefined): string {
  const where = position
    ? `ch ${position.chapter + 1} of ${book.chapters.length}`
    : `${book.chapters.length} ${book.chapters.length === 1 ? 'chapter' : 'chapters'}`;
  const opened = book.lastOpenedAt ? `opened ${new Date(book.lastOpenedAt).toLocaleDateString()}` : 'not opened yet';
  return [where, book.wpm && `${book.wpm} wpm`, opened].filter(Boolean).join(' · ');
}

function restoreMessage(result: RestoreResult): string {
  const books = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`;
  const parts = [
    result.added > 0 && `added ${books(result.added)}`,
    result.restored > 0 && `restored your place in ${books(result.restored)}`,
    result.waiting > 0 &&
      `${books(result.waiting)} ${result.waiting === 1 ? "isn't" : "aren't"} on this device yet; ${result.waiting === 1 ? 'its place' : 'their places'} will be restored when added`,
    result.failed.length > 0 && `couldn't add ${result.failed.join(', ')}`,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return 'Nothing to restore.';
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/** Storage and backup: how much the library takes, whether it's kept, export and restore. */
function BackupSection({ bookCount, onRestored }: { bookCount: number; onRestored: () => Promise<void> }) {
  const [settings, updateSettings] = useSettings();
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [lastExport, setLastExport] = useState<number | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setStorage(await storageStatus());
    setLastExport(await getSetting<number>(LAST_EXPORT_KEY).catch(() => undefined));
  }, []);
  useEffect(() => {
    void load();
  }, [load, bookCount]);

  /** Run an export or restore; `busy` is the progress text shown meanwhile. */
  const run = async (label: string, progress: string, work: () => Promise<string | null>) => {
    setBusy(progress);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (err) {
      console.error(err);
      setMessage(`${label} failed: ${restoreErrorMessage(err)}`);
    } finally {
      setBusy(null);
      void load();
    }
  };

  const onExport = (everything: boolean) =>
    run('Export', 'Preparing the export…', async () => {
      await saveFile(everything ? await exportEverything(settings) : await exportReadingState(settings));
      return null;
    });

  const onRestore = (file: File | undefined) => {
    if (restoreInput.current) restoreInput.current.value = '';
    if (!file) return;
    void run('Restore', 'Restoring…', async () => {
      const result = await restoreBackup(file, (done, total) => setBusy(`Adding books: ${done} of ${total} done…`));
      updateSettings(sanitizeSettings(result.settings));
      await onRestored();
      return restoreMessage(result);
    });
  };

  const kept =
    storage?.persisted === true ? 'kept by the system' : storage?.persisted === false ? 'may be cleared if the device runs low on space' : null;
  return (
    <section className="library-backup">
      <h2>Backup</h2>
      <p className="backup-note">
        {[storage?.usageBytes !== undefined && `${formatBytes(storage.usageBytes)} on this device`, kept].filter(Boolean).join(', ')}
        {storage && '. '}
        {lastExport ? `Last exported ${new Date(lastExport).toLocaleDateString()}.` : 'Not exported yet.'}
      </p>
      <div className="library-actions wrap">
        <button className="button" disabled={!!busy} onClick={() => void onExport(false)}>
          Export reading state
        </button>
        <button className="button" disabled={!!busy} onClick={() => void onExport(true)}>
          Export everything
        </button>
        <button className="button" disabled={!!busy} onClick={() => restoreInput.current?.click()}>
          Restore…
        </button>
      </div>
      <input
        ref={restoreInput}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        hidden
        onChange={(event) => onRestore(event.target.files?.[0])}
      />
      <p className="backup-note">
        Reading state is a small file with your places, speeds and settings. Everything adds the books themselves, for
        setting up another device.
      </p>
      {(busy ?? message) && (
        <p className="backup-status" role="status">
          {busy ?? message}
        </p>
      )}
    </section>
  );
}

export function Library() {
  const [books, setBooks] = useState<BookRecord[] | null>(null);
  const [positions, setPositions] = useState(new Map<string, PositionRecord>());
  const [statuses, setStatuses] = useState<ImportStatus[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [bookList, positionList] = await Promise.all([listBooks(), listPositions()]);
      setBooks(bookList.filter(isListed));
      setPositions(new Map(positionList.map((position) => [position.bookId, position])));
    } catch {
      setLoadError('Could not open the library storage on this device.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFiles = async (files: FileList | null) => {
    const sources = groupImports(Array.from(files ?? []));
    if (fileInput.current) fileInput.current.value = '';
    if (folderInput.current) folderInput.current.value = '';
    if (files?.length && sources.length === 0) {
      setStatuses([{ fileName: files[0]!.name, state: 'failed', message: 'not an EPUB, a zip, or Markdown' }]);
    }
    for (const source of sources) {
      const update = (status: Omit<ImportStatus, 'fileName'>) =>
        setStatuses((prev) => [...prev.filter((s) => s.fileName !== source.label), { fileName: source.label, ...status }]);
      update({ state: 'working' });
      try {
        const result = await importSource(source);
        update({ state: result.duplicate ? 'duplicate' : 'done', message: result.book.title });
      } catch (err) {
        console.error(err);
        update({ state: 'failed', message: importErrorMessage(err) });
      }
      await refresh();
    }
  };

  const onRemove = async (book: BookRecord) => {
    if (!confirm(`Remove “${book.title}” from this device?`)) return;
    await deleteBook(book.id);
    await refresh();
  };

  const continueBook = books?.find((book) => book.lastOpenedAt);

  return (
    <main className="library">
      <header className="library-header">
        <h1>Reader Lite</h1>
        <div className="library-actions">
          {canPickFolders && (
            <button className="button" onClick={() => folderInput.current?.click()}>
              Add folder
            </button>
          )}
          <button className="button primary" onClick={() => fileInput.current?.click()}>
            Add book
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => void onFiles(event.target.files)}
        />
        <input
          ref={folderInput}
          type="file"
          // @ts-expect-error: non-standard, but in every current browser engine
          webkitdirectory=""
          hidden
          onChange={(event) => void onFiles(event.target.files)}
        />
      </header>

      {statuses.length > 0 && (
        <ul className="import-statuses">
          {statuses.map((status) => (
            <li key={status.fileName} className={`import-status ${status.state}`}>
              {status.state === 'working' && `Importing ${status.fileName}…`}
              {status.state === 'done' && `Added “${status.message}”`}
              {status.state === 'duplicate' && `Already in the library: “${status.message}”`}
              {status.state === 'failed' && `Couldn't import ${status.fileName}: ${status.message}`}
            </li>
          ))}
        </ul>
      )}

      {loadError && <p className="library-empty">{loadError}</p>}

      {continueBook && (
        <section className="continue">
          <span className="continue-label">Continue</span>
          <button
            className="continue-book"
            onClick={() => navigate({ screen: 'book', bookId: continueBook.id })}
          >
            {continueBook.title}
          </button>
        </section>
      )}

      <WikipediaSection />

      {books?.length === 0 && <p className="library-empty">No books yet. Add an EPUB, or Markdown notes (a zipped folder or several .md files), from Files.</p>}

      <ul className="book-list">
        {books?.map((book) => (
          <li key={book.id} className="book-row">
            <button className="book-open" onClick={() => navigate({ screen: 'book', bookId: book.id })}>
              <span className="book-title">{book.title}</span>
              {(book.author ?? book.description) && <span className="book-author">{book.author ?? book.description}</span>}
              <span className="book-meta">{progressLabel(book, positions.get(book.id))}</span>
            </button>
            <button className="button subtle" onClick={() => void onRemove(book)} aria-label={`Remove ${book.title}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      {books && <BackupSection bookCount={books.length} onRestored={refresh} />}
    </main>
  );
}

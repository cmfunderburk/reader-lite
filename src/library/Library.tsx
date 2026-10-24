import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../route';
import { deleteBook, listBooks, listPositions, type BookRecord, type PositionRecord } from '../store/db';
import { importEpub, importErrorMessage } from './importEpub';

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

export function Library() {
  const [books, setBooks] = useState<BookRecord[] | null>(null);
  const [positions, setPositions] = useState(new Map<string, PositionRecord>());
  const [statuses, setStatuses] = useState<ImportStatus[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [bookList, positionList] = await Promise.all([listBooks(), listPositions()]);
      setBooks(bookList);
      setPositions(new Map(positionList.map((position) => [position.bookId, position])));
    } catch {
      setLoadError('Could not open the library storage on this device.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (fileInput.current) fileInput.current.value = '';
    for (const file of list) {
      const update = (status: Omit<ImportStatus, 'fileName'>) =>
        setStatuses((prev) => [...prev.filter((s) => s.fileName !== file.name), { fileName: file.name, ...status }]);
      update({ state: 'working' });
      try {
        const result = await importEpub(file);
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
        <button className="button primary" onClick={() => fileInput.current?.click()}>
          Add EPUB
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".epub,application/epub+zip"
          multiple
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

      {books?.length === 0 && <p className="library-empty">No books yet. Add an EPUB from Files to get started.</p>}

      <ul className="book-list">
        {books?.map((book) => (
          <li key={book.id} className="book-row">
            <button className="book-open" onClick={() => navigate({ screen: 'book', bookId: book.id })}>
              <span className="book-title">{book.title}</span>
              {book.author && <span className="book-author">{book.author}</span>}
              <span className="book-meta">{progressLabel(book, positions.get(book.id))}</span>
            </button>
            <button className="button subtle" onClick={() => void onRemove(book)} aria-label={`Remove ${book.title}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

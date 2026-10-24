import { useEffect, useRef, useState } from 'react';
import { ASSET_SCHEME } from '../epub/content';
import { navigate } from '../route';
import {
  getAsset,
  getBook,
  getChapter,
  getPosition,
  savePosition,
  updateBook,
  type BookRecord,
  type ChapterRecord,
} from '../store/db';

// M1 preview for checking imports: chapters rendered as plain blocks.
// Replaced by the guided reading surface in M2.

interface BookPreviewProps {
  bookId: string;
  chapter?: number;
}

const FIGURE_URL = /^\[FIGURE_URL:(.+)\]$/i;
const FIGURE_CAPTION = /^\[FIGURE\s+(.+)\]$/i;
const HEADING = /^(#{1,6})\s+(.+)$/;

function FigureImage({ bookId, src }: { bookId: string; src: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!src.startsWith(ASSET_SCHEME)) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    void getAsset(bookId, src.slice(ASSET_SCHEME.length)).then((asset) => {
      if (!asset || cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([asset.data], { type: asset.mediaType }));
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bookId, src]);
  return url ? <img className="preview-figure" src={url} alt="" /> : null;
}

function ChapterBlocks({ bookId, content }: { bookId: string; content: string }) {
  return (
    <>
      {content.split('\n\n').map((block, i) => {
        const figure = block.match(FIGURE_URL);
        if (figure) return <FigureImage key={i} bookId={bookId} src={figure[1]!} />;
        const caption = block.match(FIGURE_CAPTION);
        if (caption) return <p key={i} className="preview-caption">{caption[1]}</p>;
        const heading = block.match(HEADING);
        if (heading) return <p key={i} className={`preview-heading level-${heading[1]!.length}`}>{heading[2]}</p>;
        return <p key={i}>{block}</p>;
      })}
    </>
  );
}

export function BookPreview({ bookId, chapter }: BookPreviewProps) {
  const [book, setBook] = useState<BookRecord | null>();
  const [record, setRecord] = useState<ChapterRecord>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getBook(bookId).then((found) => {
      setBook(found ?? null);
      if (found) void updateBook(bookId, { lastOpenedAt: Date.now() });
    });
  }, [bookId]);

  // No chapter in the route: resume from the saved position.
  useEffect(() => {
    if (chapter !== undefined) return;
    void getPosition(bookId).then((position) =>
      navigate({ screen: 'book', bookId, chapter: position?.chapter ?? 0 }, { replace: true }),
    );
  }, [bookId, chapter]);

  useEffect(() => {
    if (chapter === undefined) return;
    void getChapter(bookId, chapter).then(setRecord);
    void savePosition({ bookId, chapter, offset: 0, updatedAt: Date.now() });
    scrollRef.current?.scrollTo(0, 0);
  }, [bookId, chapter]);

  if (book === null) {
    return (
      <main className="preview">
        <p className="library-empty">This book isn't on this device any more.</p>
        <button className="button" onClick={() => navigate({ screen: 'library' })}>Back to library</button>
      </main>
    );
  }
  if (!book || chapter === undefined) return null;

  const goTo = (index: number) => navigate({ screen: 'book', bookId, chapter: index });
  const last = book.chapters.length - 1;

  return (
    <main className="preview">
      <header className="preview-toolbar">
        <button className="button subtle" onClick={() => navigate({ screen: 'library' })}>Library</button>
        <select
          className="chapter-select"
          value={chapter}
          onChange={(event) => goTo(Number(event.target.value))}
          aria-label="Chapter"
        >
          {book.chapters.map((c, i) => (
            <option key={i} value={i}>{c.title}</option>
          ))}
        </select>
      </header>

      <div className="preview-scroll" ref={scrollRef}>
        <article className="preview-text">
          {record?.index === chapter && <ChapterBlocks bookId={bookId} content={record.content} />}
        </article>
      </div>

      <footer className="preview-footer">
        <button className="button" disabled={chapter <= 0} onClick={() => goTo(chapter - 1)}>Previous</button>
        <span className="preview-position">{chapter + 1} / {book.chapters.length}</span>
        <button className="button" disabled={chapter >= last} onClick={() => goTo(chapter + 1)}>Next</button>
      </footer>
    </main>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ASSET_SCHEME } from '../epub/content';
import { importErrorMessage } from '../library/importBook';
import { bookProgress, bookWpm, formatDuration, pacedMs } from '../library/progress';
import { navigate } from '../route';
import { useSettings } from '../settings';
import type { BookRecord } from '../store/db';
import { useAssetUrl } from '../reader/useAssetUrl';
import { LEAD_IMAGE_PATH } from './article';
import { randomArticle, storedTodaysArticle, todaysArticle } from './daily';

type TodayState = { state: 'loading' } | { state: 'ready'; book: BookRecord } | { state: 'failed'; message: string };

function TodayCard({ book }: { book: BookRecord }) {
  const [settings] = useSettings();
  const image = useAssetUrl(book.id, `${ASSET_SCHEME}${LEAD_IMAGE_PATH}`);
  const length = bookProgress(book.chapters, undefined);
  const wpm = bookWpm(book, settings);
  return (
    <button className="wiki-today" onClick={() => navigate({ screen: 'book', bookId: book.id })}>
      {image && <img className="wiki-image" src={image} alt="" draggable={false} />}
      <span className="wiki-text">
        <span className="wiki-label">Today's featured article</span>
        <span className="wiki-title">{book.title}</span>
        {book.description && <span className="wiki-description">{book.description}</span>}
        {length && <span className="wiki-length">{formatDuration(pacedMs(length.pacedCharsLeft, wpm))} at {wpm} wpm</span>}
      </span>
    </button>
  );
}

/** Today's featured article and a random one, on the library screen. */
export function WikipediaSection() {
  const [today, setToday] = useState<TodayState>({ state: 'loading' });
  const [random, setRandom] = useState<{ busy: boolean; message?: string }>({ busy: false });

  const loadToday = useCallback(async () => {
    // What's stored shows at once (offline too); fetch only if today's isn't stored.
    const stored = await storedTodaysArticle().catch(() => undefined);
    if (stored) return setToday({ state: 'ready', book: stored });
    setToday((prev) => (prev.state === 'ready' ? prev : { state: 'loading' }));
    try {
      setToday({ state: 'ready', book: await todaysArticle() });
    } catch (err) {
      setToday((prev) => (prev.state === 'ready' ? prev : { state: 'failed', message: importErrorMessage(err) }));
    }
  }, []);

  useEffect(() => {
    void loadToday();
    const onVisible = () => document.visibilityState === 'visible' && void loadToday();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadToday]);

  const openRandom = async () => {
    setRandom({ busy: true });
    try {
      const book = await randomArticle();
      navigate({ screen: 'book', bookId: book.id });
    } catch (err) {
      setRandom({ busy: false, message: `Couldn't get an article: ${importErrorMessage(err)}.` });
    }
  };

  return (
    <section className="wikipedia">
      {today.state === 'ready' && <TodayCard book={today.book} />}
      {today.state === 'loading' && <p className="wiki-note">Fetching today's featured article…</p>}
      {today.state === 'failed' && (
        <p className="wiki-note">
          Couldn't get today's featured article: {today.message}.{' '}
          <button className="link-button" onClick={() => void loadToday()}>
            Try again
          </button>
        </p>
      )}
      <div className="wiki-actions">
        <button className="button" disabled={random.busy} onClick={() => void openRandom()}>
          {random.busy ? 'Finding an article…' : 'Random featured article'}
        </button>
        {random.message && <span className="wiki-note">{random.message}</span>}
      </div>
    </section>
  );
}

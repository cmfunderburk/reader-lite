// Today's featured article is fetched ahead of time (at launch and whenever
// the app comes back to the foreground), so it's there to read offline. It
// joins the library once opened; an unopened one is cleared when the next
// day's arrives. Random featured articles are fetched on request.

import { importWikipedia } from '../library/importBook';
import { deleteBook, getBook, listBooks, type BookRecord } from '../store/db';
import { fetchFeatured, fetchImage, fetchRandomFeatured, utcDate, type WikiArticle } from './article';

let fetchingToday: Promise<BookRecord> | null = null;

/** Today's article if it's already stored (works offline). */
export async function storedTodaysArticle(): Promise<BookRecord | undefined> {
  const today = utcDate(new Date());
  return (await listBooks()).find((book) => book.dailyFor === today);
}

/** Today's article, fetching and storing it if it isn't stored yet. */
export function todaysArticle(): Promise<BookRecord> {
  fetchingToday ??= (async () => {
    const today = utcDate(new Date());
    const book = (await storedTodaysArticle()) ?? (await addArticle(await fetchFeatured(today), today));
    for (const old of await listBooks()) {
      if (old.dailyFor && old.dailyFor !== today && !old.lastOpenedAt) await deleteBook(old.id);
    }
    return book;
  })().finally(() => {
    fetchingToday = null;
  });
  return fetchingToday;
}

export async function randomArticle(): Promise<BookRecord> {
  return addArticle(await fetchRandomFeatured());
}

async function addArticle(article: WikiArticle, dailyFor?: string): Promise<BookRecord> {
  const { book } = await importWikipedia(article, await fetchImage(article.imageUrl), dailyFor);
  return (await getBook(book.id)) ?? book;
}

/** Library rows: Wikipedia articles appear once they've been opened. */
export function isListed(book: BookRecord): boolean {
  return book.format !== 'wikipedia' || !!book.lastOpenedAt;
}

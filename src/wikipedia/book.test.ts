import { describe, expect, it } from 'bun:test';
import { ZipArchive } from '../epub/zip';
import { LEAD_IMAGE_PATH, type WikiArticle } from './article';
import { readWikipediaFile, wikipediaBook, wikipediaFile } from './book';

const article: WikiArticle = {
  title: 'Battle of Schliengen',
  url: 'https://en.wikipedia.org/wiki/Battle_of_Schliengen',
  description: '1796 battle',
  extract: 'Lead.\n\n\n== Background ==\nContext.',
  featuredOn: '2026-10-24',
  imageUrl: 'https://upload.wikimedia.org/x.jpg',
  fetchedAt: 1,
};

describe('wikipediaFile', () => {
  it('round-trips the article and its lead image, and rebuilds the same book', async () => {
    const image = { bytes: new Uint8Array([0xff, 0xd8, 1, 2, 3]), mediaType: 'image/jpeg' };
    const restored = await readWikipediaFile(ZipArchive.open(wikipediaFile(article, image)));
    expect(restored.article).toEqual(article);
    expect(restored.image).toEqual(image);
    const book = wikipediaBook(restored.article, restored.image);
    expect(book.chapters.map((c) => c.title)).toEqual(['Battle of Schliengen', 'Background']);
    expect(book.assets).toEqual([{ path: LEAD_IMAGE_PATH, mediaType: 'image/jpeg', bytes: image.bytes }]);
  });

  it('works without an image', async () => {
    const restored = await readWikipediaFile(ZipArchive.open(wikipediaFile(article, undefined)));
    expect(restored.image).toBeUndefined();
    expect(wikipediaBook(restored.article, undefined).chapters[0]!.content).not.toContain('FIGURE');
  });
});

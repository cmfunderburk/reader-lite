import { expect, test } from 'bun:test';
import { parseMarkdownBook, compareReadingOrder, isIncluded } from './book';

const encode = (text: string) => new TextEncoder().encode(text);

test('reading order puts a folder index first and files before subfolders, in natural order', () => {
  expect(['g/10-z.md', 'g/2-b.md', 'g/sub/a.md', 'g/00-index.md', 'g/README.md', 'a.md'].sort(compareReadingOrder)).toEqual([
    'a.md',
    'g/00-index.md',
    'g/README.md',
    'g/2-b.md',
    'g/10-z.md',
    'g/sub/a.md',
  ]);
});

test('skips hidden folders and dependency trees', () => {
  expect(['notes/a.md', 'notes/.obsidian/x.md', '.git/y.md', 'p/node_modules/z/README.md', 'p/.venv/r.md'].filter(isIncluded)).toEqual(['notes/a.md']);
});

test('builds a chapter per file, titled and grouped by folder, with linked images', async () => {
  const book = await parseMarkdownBook(
    new Map([
      ['docs/README.md', encode('# The Docs\n\nSee [[intro]].')],
      ['docs/guide/01-intro.md', encode('---\ntitle: Intro\n---\nText ![[fig.png]]\n\n![[fig.png]]')],
      ['docs/guide/fig.png', new Uint8Array([1, 2, 3])],
      ['docs/guide/unused.png', new Uint8Array([4])],
      ['docs/untitled.md', encode('no heading')],
    ]),
    'docs.zip',
  );
  expect(book.title).toBe('The Docs');
  expect(book.chapters.map((c) => c.title)).toEqual(['The Docs', 'untitled', 'guide · Intro']);
  expect(book.chapters[2]!.content).toBe('Text\n\n[FIGURE_URL:asset:docs/guide/fig.png]');
  expect(book.assets.map((a) => [a.path, a.mediaType])).toEqual([['docs/guide/fig.png', 'image/png']]);
});

test('rejects an import with no Markdown in it', async () => {
  await expect(parseMarkdownBook(new Map([['a.txt', encode('x')]]), 'x')).rejects.toThrow('no Markdown files found');
});

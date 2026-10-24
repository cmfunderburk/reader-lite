import { describe, expect, test } from 'bun:test';
import { layoutChapter, pageIndexForOffset, visibleChars } from './layout';

const CHAPTER = [
  '# Chapter One',
  'The first paragraph has enough words to wrap across several lines at narrow widths.',
  'A second paragraph follows, also long enough to wrap a few times when the page is narrow.',
  '[FIGURE_URL:asset:a.png]',
  '[FIGURE A caption]',
  'The last paragraph closes the chapter.',
].join('\n\n');

describe('layoutChapter', () => {
  test('line offsets count non-whitespace characters', () => {
    const { pages, totalChars } = layoutChapter('ab cd\n\nef', 80, 10);
    const lines = pages.flatMap((page) => page.lines);
    expect(lines.map((line) => [line.text, line.offset])).toEqual([['ab cd', 0], ['', 4], ['ef', 4]]);
    expect(totalChars).toBe(6);
  });

  test('total character count is the same at every width', () => {
    const totals = [20, 40, 80].map((width) => layoutChapter(CHAPTER, width, 8).totalChars);
    expect(new Set(totals).size).toBe(1);
  });

  test('an offset maps to the page holding the same text after re-flow', () => {
    const wide = layoutChapter(CHAPTER, 80, 6);
    const narrow = layoutChapter(CHAPTER, 24, 6);
    // Take the start of the last wide page and find it in the narrow layout.
    const offset = wide.pages[wide.pages.length - 1]!.startOffset;
    const page = narrow.pages[pageIndexForOffset(narrow.pages, offset)]!;
    const next = narrow.pages[pageIndexForOffset(narrow.pages, offset) + 1];
    expect(page.startOffset).toBeLessThanOrEqual(offset);
    expect(next === undefined || next.startOffset > offset).toBe(true);
  });

  test('an empty chapter still has one page', () => {
    expect(layoutChapter('', 80, 10).pages).toEqual([{ lines: [], startOffset: 0 }]);
  });
});

describe('pageIndexForOffset', () => {
  const pages = [0, 100, 250].map((startOffset) => ({ lines: [], startOffset }));

  test('finds the last page starting at or before the offset', () => {
    expect(pageIndexForOffset(pages, 0)).toBe(0);
    expect(pageIndexForOffset(pages, 99)).toBe(0);
    expect(pageIndexForOffset(pages, 100)).toBe(1);
    expect(pageIndexForOffset(pages, 10_000)).toBe(2);
  });
});

test('visibleChars ignores whitespace', () => {
  expect(visibleChars(' a b\tc\n')).toBe(3);
});

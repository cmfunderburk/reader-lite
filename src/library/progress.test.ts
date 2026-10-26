import { describe, expect, test } from 'bun:test';
import { styled } from '../epub/content';
import { layoutChapter, readingLength } from '../reader/layout';
import { bookProgress, formatDuration, pacedMs } from './progress';

const chapter = (visibleChars: number, pacedChars: number) => ({ title: '', chars: 0, visibleChars, pacedChars });

describe('bookProgress', () => {
  const chapters = [chapter(100, 120), chapter(200, 240), chapter(100, 120)];

  test('counts the whole book from no place', () => {
    expect(bookProgress(chapters, undefined)).toEqual({ fraction: 0, pacedCharsLeft: 480 });
  });

  test('counts from a place partway through a chapter', () => {
    expect(bookProgress(chapters, { chapter: 1, offset: 100 })).toEqual({ fraction: 0.5, pacedCharsLeft: 120 + 120 });
  });

  test('is unknown for a book imported before reading lengths', () => {
    expect(bookProgress([{ title: '', chars: 10 }], undefined)).toBeUndefined();
  });
});

describe('readingLength', () => {
  const content = `# Title\n\nA paragraph with ${styled('italic', 'some')} words in it.\n\n[CALLOUT answer -]Answer\n\nHidden text.\n\n[/CALLOUT]`;

  test('visible characters match the layout at any width', () => {
    expect(readingLength(content).visibleChars).toBe(layoutChapter(content, 30, 10).totalChars);
  });

  test('paced characters skip collapsed callouts and style marks', () => {
    expect(readingLength(content).pacedChars).toBe('Title'.length + 'A paragraph with some words in it.'.length);
  });
});

test('pacedMs and formatDuration', () => {
  expect(pacedMs(1000, 200)).toBe(60_000); // 200 words of 5 characters
  expect(formatDuration(20_000)).toBe('<1m');
  expect(formatDuration(12 * 60_000)).toBe('12m');
  expect(formatDuration(65 * 60_000)).toBe('1h 05m');
});

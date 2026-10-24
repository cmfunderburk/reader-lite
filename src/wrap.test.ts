import { expect, test } from 'bun:test';
import { wrapParagraphs } from './wrap';

test('wraps on word boundaries and separates paragraphs with a blank line', () => {
  expect(wrapParagraphs(['aa bb cc', 'dd'], 5)).toEqual(['aa bb', 'cc', '', 'dd']);
});

test('keeps an over-long word on its own line', () => {
  expect(wrapParagraphs(['abcdefgh ij'], 5)).toEqual(['abcdefgh', 'ij']);
});

import { describe, expect, test } from 'bun:test';
import { textColumns, fitIndex } from './columns';
import { CELL_SEPARATOR } from '../epub/content';
import { flowTable, wrapWords } from './blocks';

describe('columns', () => {
  test('counts CJK as two columns and combining marks as none', () => {
    expect(textColumns('abc')).toBe(3);
    expect(textColumns('眉語')).toBe(4);
    expect(textColumns('Méiyu')).toBe(5);
    expect(textColumns('𠀀')).toBe(2);
  });

  test('cuts at the width without splitting a wide character or surrogate pair', () => {
    expect(fitIndex('ab眉語', 3)).toBe(2);
    expect(fitIndex('ab眉語', 4)).toBe(3);
    expect(fitIndex('𠀀𠀀', 3)).toBe(2);
    expect(fitIndex('眉', 1)).toBe(1);
  });
});

describe('wide characters in line flow', () => {
  test('wrapped lines fit their width in columns', () => {
    const text = 'Eyebrow Talk (眉語; Méiyǔ) was published by the New Learning Society (新學會社; Xīnxué huìshè) in Shanghai';
    const lines = wrapWords(text, 30);
    for (const line of lines) expect(textColumns(line)).toBeLessThanOrEqual(30);
    expect(lines.join(' ')).toBe(text);
  });

  test('a run of ideographs breaks by columns', () => {
    expect(wrapWords('勸告著作出版界宜注意文化', 10)).toEqual(['勸告著作出', '版界宜注意', '文化']);
  });

  test('table columns align by columns', () => {
    const lines = flowTable(0, [`中文${CELL_SEPARATOR}a`, `xy${CELL_SEPARATOR}b`], 40).map((l) => l.text);
    expect(lines.map((l) => textColumns(l))).toEqual([7, 7]);
  });
});

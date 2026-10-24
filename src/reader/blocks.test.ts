import { describe, expect, test } from 'bun:test';
import { CELL_SEPARATOR, EMPTY_CODE_LINE, SPANNED_CELL } from '../epub/content';
import { flowCode, flowTable, wrapWords } from './blocks';
import { layoutChapter, visibleChars } from './layout';
import { flowTextIntoLines } from './saccade';

const S = CELL_SEPARATOR;

describe('wrapWords', () => {
  test('breaks words longer than the width', () => {
    expect(wrapWords('see https://example.com/long/path now', 10)).toEqual(['see', 'https://ex', 'ample.com/', 'long/path', 'now']);
  });
});

describe('flowCode', () => {
  test('keeps short lines, indentation and empty lines', () => {
    expect(flowCode(['def f():', EMPTY_CODE_LINE, '    return 1'], 40).map((l) => l.text)).toEqual(['def f():', '', '    return 1']);
  });

  test('wraps long lines at a space, continuing past the indent', () => {
    expect(flowCode(['    total = first_value + second_value'], 24).map((l) => l.text)).toEqual([
      '    total = first_value',
      '      + second_value',
    ]);
  });

  test('hard-breaks long lines without a usable space', () => {
    expect(flowCode(['x = aaaaaaaaaaaaaaaaaaaa'], 12).map((l) => l.text)).toEqual(['x = aaaaaaaa', '  aaaaaaaaaa', '  aa']);
  });
});

describe('flowTable', () => {
  test('aligns columns at their natural width when they fit', () => {
    const lines = flowTable(1, [`Kind${S}Names`, `Strings${S}repr str`], 40);
    expect(lines.map((l) => l.text)).toEqual(['Kind     Names', 'Strings  repr str']);
    expect(lines.map((l) => [l.rowStart, l.tableHeader])).toEqual([[true, true], [true, false]]);
  });

  test('wraps cells within their columns when the table is too wide', () => {
    const lines = flowTable(0, [`Attribute management${S}__getattr__ __getattribute__ __setattr__`], 30);
    expect(lines.map((l) => l.text)).toEqual([
      'Attribute    __getattr__',
      'management   __getattribute__',
      '             __setattr__',
    ]);
    expect(lines.map((l) => l.rowStart)).toEqual([true, false, false]);
    expect(Math.max(...lines.map((l) => l.text.length))).toBeLessThanOrEqual(30);
  });

  test('lays spanning cells across their columns without widening them', () => {
    const lines = flowTable(0, [`a${S}b${S}c`, `A footnote that spans all three columns${S}${SPANNED_CELL}${S}${SPANNED_CELL}`], 20);
    expect(lines.map((l) => l.text)).toEqual(['a  b  c', 'A footnote that', 'spans all three', 'columns']);
  });

  test('reads rows one by one when there are too many columns', () => {
    const lines = flowTable(0, [['a', 'b', 'c', 'd', 'e'].join(S)], 20);
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(lines.map((l) => l.rowStart)).toEqual([true, false, false, false, false]);
  });
});

test('code and tables keep chapter offsets independent of line width', () => {
  const content = [
    'Intro paragraph with words.',
    `[CODE]\nfor item in collection.Items:\n${EMPTY_CODE_LINE}\n    print(item.value, item.other_value, sep=", ")`,
    `[TABLE 1]\nCategory${S}Method names\nAttribute management${S}__getattr__ __getattribute__ __setattr__ __delattr__`,
    'Outro.',
  ].join('\n\n');
  const totals = [24, 40, 80].map((width) => layoutChapter(content, width, 10).totalChars);
  expect(new Set(totals).size).toBe(1);
  expect(totals[0]).toBe(visibleChars(content.replace('[CODE]', '').replace('[TABLE 1]', '').replaceAll(S, '').replaceAll(EMPTY_CODE_LINE, '')));
});

test('normalizeText leaves code alone', () => {
  const layout = layoutChapter('[CODE]\nx = collections.OrderedDict()', 80, 10);
  expect(layout.pages[0]!.lines[0]!.text).toBe('x = collections.OrderedDict()');
});

describe('callouts and lists', () => {
  const content = [
    'Intro.',
    '[CALLOUT question .]Predict first',
    'Where does the time go?',
    '[CALLOUT answer -]Answer',
    'The river, because its tables hold nearly all the entries.',
    '[/CALLOUT]',
    '[/CALLOUT]',
    '[LIST]\n• first item that is long enough to wrap\n  ◦ nested',
    'After.',
  ].join('\n\n');

  test('indents callout content, shows titles, and collapses folded callouts to a toggle', () => {
    const lines = flowTextIntoLines(content, 30);
    expect(lines.map((l) => [l.type, l.text, l.depth ?? 0])).toEqual([
      ['body', 'Intro.', 0],
      ['blank', '', 0],
      ['body', '  Predict first', 1],
      ['body', '  Where does the time go?', 1],
      ['blank', '', 1],
      ['toggle', '    ▸ Answer', 2],
      ['blank', '', 0],
      ['body', '• first item that is long', 0],
      ['body', '  enough to wrap', 0],
      ['body', '  ◦ nested', 0],
      ['blank', '', 0],
      ['body', 'After.', 0],
    ]);
    expect(lines[2]!.calloutTitle).toBe(true);
  });

  test('a toggled callout opens, and positions after it do not move', () => {
    const closed = layoutChapter(content, 30, 50);
    const open = layoutChapter(content, 30, 50, { toggled: new Set([1]) });
    const text = (layout: typeof closed) => layout.pages.flatMap((p) => p.lines);
    expect(text(open).some((l) => l.text.includes('The river'))).toBe(true);
    expect(text(open).find((l) => l.type === 'toggle')!.text).toBe('    ▾ Answer');
    expect(closed.totalChars).toBe(open.totalChars);
    const after = (layout: typeof closed) => text(layout).find((l) => l.text === 'After.')!.offset;
    expect(after(closed)).toBe(after(open));
  });
});

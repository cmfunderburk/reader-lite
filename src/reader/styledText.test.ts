import { describe, expect, test } from 'bun:test';
import { styled } from '../epub/content';
import { flowTable, wrapStyled } from './blocks';
import { layoutChapter } from './layout';
import { flowTextIntoLines } from './saccade';
import { charStyles, lineStyles, parseStyles, styleClasses } from './styledText';

const ITALIC = 0b1;
const BOLD = 0b10;
const HIGHLIGHT = 0b1000;

/** Each line's text with its styled stretches bracketed, e.g. `a [i:b c] d`. */
function show(lines: { text: string; styles?: { start: number; end: number; style: number }[] }[]): string[] {
  return lines.map(({ text, styles = [] }) => {
    let out = text;
    for (const run of [...styles].reverse()) {
      out = `${out.slice(0, run.start)}[${run.style}:${out.slice(run.start, run.end)}]${out.slice(run.end)}`;
    }
    return out;
  });
}

describe('parseStyles', () => {
  test('strips the marks and records each character’s styles', () => {
    expect(parseStyles(`a ${styled('bold', `b ${styled('italic', 'c')}`)}`)).toEqual({
      text: 'a b c',
      styles: [0, 0, BOLD, BOLD, BOLD | ITALIC],
    });
  });
});

describe('lineStyles', () => {
  test('follows the visible characters across re-wrapped lines', () => {
    const source = parseStyles(`one ${styled('italic', 'two three')} four`);
    expect(show(['one two', 'three four'].map((text, i) => ({ text, styles: lineStyles(['one two', 'three four'], source)[i] })))).toEqual([
      `one [${ITALIC}:two]`,
      `[${ITALIC}:three] four`,
    ]);
  });

  test('a space is styled only between two characters sharing the style', () => {
    const source = parseStyles(`${styled('highlight', 'a b')} c`);
    expect(show([{ text: 'a b c', styles: lineStyles(['a b c'], source)[0] }])).toEqual([`[${HIGHLIGHT}:a b] c`]);
  });

  test('unstyled text has no runs', () => {
    expect(lineStyles(['plain'], parseStyles('plain'))).toEqual([undefined]);
  });
});

describe('styled line flow', () => {
  test('wraps by the visible text only', () => {
    expect(show(wrapStyled(`${styled('bold', 'abcd')} efgh`, 9))).toEqual([`[${BOLD}:abcd] efgh`]);
  });

  test('marks never count toward offsets', () => {
    const plain = 'Some words to read, and more words after them.';
    const marked = `Some ${styled('italic', 'words')} to read, and ${styled('bold', 'more words')} after them.`;
    expect(layoutChapter(marked, 20, 10).totalChars).toBe(layoutChapter(plain, 20, 10).totalChars);
    const lines = (content: string) => flowTextIntoLines(content, 20).map((line) => line.text);
    expect(lines(marked)).toEqual(lines(plain));
  });

  test('styles shift with list bullets and callout indentation', () => {
    const lines = flowTextIntoLines(`[CALLOUT note .]Note\n\n[LIST]\n• ${styled('italic', 'item')}\n\n[/CALLOUT]`, 40);
    expect(show(lines.filter((line) => line.styles))).toEqual([`  • [${ITALIC}:item]`]);
  });

  test('headings keep their styles; toggle titles drop them', () => {
    const lines = flowTextIntoLines(`# A ${styled('italic', 'Title')}\n\n[CALLOUT answer -]${styled('bold', 'Answer')}\n\nHidden.\n\n[/CALLOUT]`, 40);
    expect(show(lines)).toEqual([`A [${ITALIC}:Title]`, '', '  ▸ Answer']);
  });

  test('table cells keep their styles in their columns', () => {
    const S = '\u001f';
    expect(show(flowTable(0, [`a${S}${styled('bold', 'bb')}`], 40))).toEqual([`a  [${BOLD}:bb]`]);
  });
});

test('charStyles and styleClasses', () => {
  expect(Array.from(charStyles(4, [{ start: 1, end: 3, style: BOLD }]))).toEqual([0, BOLD, BOLD, 0]);
  expect(styleClasses(ITALIC | BOLD)).toBe('s-italic s-bold');
});

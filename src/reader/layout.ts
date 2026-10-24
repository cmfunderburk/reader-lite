import { flowTextIntoLines, groupIntoPages, type GuidedLine } from './saccade';

// Positions are counted in non-whitespace characters from the start of a
// chapter. Line flow only changes whitespace, so an offset stays valid across
// font sizes, line widths and rotations.

export interface PageLine extends GuidedLine {
  /** Non-whitespace characters in the chapter before this line. */
  offset: number;
}

export interface Page {
  lines: PageLine[];
  startOffset: number;
}

export interface ChapterLayout {
  pages: Page[];
  /** Non-whitespace characters in the whole chapter. */
  totalChars: number;
}

export function visibleChars(text: string): number {
  let count = 0;
  for (const char of text) if (!/\s/.test(char)) count++;
  return count;
}

export function layoutChapter(content: string, charsPerLine: number, linesPerPage: number): ChapterLayout {
  let offset = 0;
  const lines: PageLine[] = flowTextIntoLines(content, charsPerLine).map((line) => {
    const placed = { ...line, offset };
    offset += visibleChars(line.text);
    return placed;
  });

  const pages = groupIntoPages(lines, linesPerPage, charsPerLine).map((pageLines) => ({
    lines: pageLines,
    startOffset: pageLines[0]!.offset,
  }));
  return { pages: pages.length > 0 ? pages : [{ lines: [], startOffset: 0 }], totalChars: offset };
}

/** The page containing `offset`: the last page starting at or before it. */
export function pageIndexForOffset(pages: Page[], offset: number): number {
  let index = 0;
  for (let i = 1; i < pages.length; i++) {
    if (pages[i]!.startOffset <= offset) index = i;
    else break;
  }
  return index;
}

/** Lines the pacer visits: everything except blank spacer lines. */
export function isPacedLine(line: GuidedLine): boolean {
  return line.type !== 'blank';
}

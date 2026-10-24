import { flowTextIntoLines, groupIntoPages, lineChars, visibleChars, type FlowOptions, type GuidedLine } from './saccade';

export { visibleChars };

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

export function layoutChapter(
  content: string,
  charsPerLine: number,
  linesPerPage: number,
  options: FlowOptions = {},
): ChapterLayout {
  let offset = 0;
  const lines: PageLine[] = flowTextIntoLines(content, charsPerLine, options).map((line) => {
    const placed = { ...line, offset };
    offset += lineChars(line);
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

/** Lines the pacer visits: everything with something to read (not spacers, toggles or empty code lines). */
export function isPacedLine(line: GuidedLine): boolean {
  return line.type === 'figure' || (line.type !== 'blank' && line.type !== 'toggle' && line.text.trim() !== '');
}

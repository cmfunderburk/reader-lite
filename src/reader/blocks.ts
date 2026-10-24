// Lays out code and table blocks (see epub/content.ts for their format) for
// the current line width. Only whitespace is added or removed, never
// visible characters, so position offsets (reader/layout.ts) stay valid at
// any width.

import { CELL_SEPARATOR, EMPTY_CODE_LINE, SPANNED_CELL } from '../epub/content';
import type { GuidedLine } from './saccade';

const COLUMN_GAP = 2;
/** Below this many characters per column, a table is read row by row instead. */
const MIN_COLUMN_WIDTH = 4;

/** Split text into chunks of at most `width` characters, breaking long words. */
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (current) lines.push(current);
      current = '';
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    const joined = current ? `${current} ${word}` : word;
    if (joined.length <= width) {
      current = joined;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Code keeps its lines and indentation. A line too long for the width breaks
 * at a space in its second half if there is one, otherwise at the width, and
 * continues indented two past the original line.
 */
export function flowCode(lines: string[], width: number): GuidedLine[] {
  const out: GuidedLine[] = [];
  for (const raw of lines) {
    const line = raw === EMPTY_CODE_LINE ? '' : raw;
    const indent = line.length - line.trimStart().length;
    const continuation = ' '.repeat(Math.min(indent + 2, Math.floor(width / 2)));
    let rest = line;
    let prefix = '';
    while (prefix.length + rest.length > width) {
      const room = width - prefix.length;
      let cut = rest.lastIndexOf(' ', room);
      if (cut <= room / 2) cut = room;
      out.push({ text: prefix + rest.slice(0, cut).trimEnd(), type: 'code' });
      rest = rest.slice(cut).trimStart();
      prefix = continuation;
    }
    if (rest || !prefix) out.push({ text: prefix + rest, type: 'code' });
  }
  return out;
}

interface Cell {
  text: string;
  column: number;
  span: number;
}

/** A row's cells, each covering its column and any SPANNED_CELL columns after it. */
function rowCells(row: string[]): Cell[] {
  const cells: Cell[] = [];
  row.forEach((text, column) => {
    const last = cells[cells.length - 1];
    if (text === SPANNED_CELL && last) last.span++;
    else cells.push({ text: text === SPANNED_CELL ? '' : text, column, span: 1 });
  });
  return cells;
}

/**
 * Column widths that fit `available`, favouring each column's natural width.
 * Spanning cells don't count: they wrap across whatever their columns get.
 */
function columnWidths(rows: Cell[][], columns: number, available: number): number[] {
  const single = (i: number) => rows.flatMap((row) => row.filter((cell) => cell.column === i && cell.span === 1));
  const natural = Array.from({ length: columns }, (_, i) => Math.max(1, ...single(i).map((cell) => cell.text.length)));
  if (natural.reduce((a, b) => a + b, 0) <= available) return natural;

  const longestWord = Array.from({ length: columns }, (_, i) =>
    Math.min(natural[i]!, Math.max(1, ...single(i).flatMap((cell) => cell.text.split(/\s+/).map((w) => w.length)))),
  );
  const minimum = longestWord.reduce((a, b) => a + b, 0);
  if (minimum > available) {
    // Even the longest words don't fit: equal columns, long words broken.
    const base = Math.floor(available / columns);
    return Array.from({ length: columns }, (_, i) => base + (i < available % columns ? 1 : 0));
  }

  // Start from the longest words and share out the rest by how much more each column wants.
  const widths = [...longestWord];
  const want = natural.map((n, i) => n - longestWord[i]!);
  const totalWant = want.reduce((a, b) => a + b, 0);
  let extra = available - minimum;
  for (let i = 0; i < columns; i++) {
    const share = Math.floor(((available - minimum) * want[i]!) / totalWant);
    widths[i]! += share;
    extra -= share;
  }
  for (let i = 0; extra > 0 && i < columns; i++) {
    if (widths[i]! < natural[i]!) {
      widths[i]!++;
      extra--;
    }
  }
  return widths;
}

/**
 * A table as aligned columns. Cells too wide for their column wrap within
 * it, so a row can take several lines; `rowStart` marks each row's first.
 * A table with too many columns for the width is read row by row, a cell per line.
 */
export function flowTable(headerRows: number, rowLines: string[], width: number): GuidedLine[] {
  const parsed = rowLines.map((line) => line.split(CELL_SEPARATOR));
  const columns = Math.max(...parsed.map((row) => row.length));
  const rows = parsed.map((row) => rowCells(Array.from({ length: columns }, (_, i) => row[i] ?? '')));
  const available = width - COLUMN_GAP * (columns - 1);

  if (available < columns * MIN_COLUMN_WIDTH) {
    // Each cell on its own line(s), rows marked by their first line.
    return rows.flatMap((row, r) =>
      row
        .filter((cell) => cell.text)
        .flatMap((cell) => wrapWords(cell.text, width))
        .map((text, k) => ({ text, type: 'table' as const, rowStart: k === 0, tableHeader: r < headerRows })),
    );
  }

  const widths = columnWidths(rows, columns, available);
  const cellWidth = (cell: Cell) =>
    widths.slice(cell.column, cell.column + cell.span).reduce((a, b) => a + b, 0) + COLUMN_GAP * (cell.span - 1);
  // Give spanning cells any width left over, through the last column they cover.
  for (const cell of rows.flat().filter((c) => c.span > 1)) {
    const spare = available - widths.reduce((a, b) => a + b, 0);
    const grow = Math.min(spare, cell.text.length - cellWidth(cell));
    if (grow > 0) widths[cell.column + cell.span - 1]! += grow;
  }
  const out: GuidedLine[] = [];
  rows.forEach((row, r) => {
    const cells = row.map((cell) => wrapWords(cell.text, cellWidth(cell)));
    const height = Math.max(1, ...cells.map((lines) => lines.length));
    for (let k = 0; k < height; k++) {
      const text = cells
        .map((lines, i) => (lines[k] ?? '').padEnd(cellWidth(row[i]!)))
        .join(' '.repeat(COLUMN_GAP))
        .trimEnd();
      out.push({ text, type: 'table', rowStart: k === 0, tableHeader: r < headerRows });
    }
  });
  return out;
}

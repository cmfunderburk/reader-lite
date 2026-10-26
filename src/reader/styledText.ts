// Inline styles on laid-out lines. Content carries style marks (see
// epub/content.ts); the line flow strips them before measuring and wrapping,
// then gives each line its characters' styles as runs. Line flow only moves
// whitespace, so the visible characters of the wrapped lines, in order, are
// those of the source, and each takes the style its source character had.

import { INLINE_STYLES, styleBit } from '../epub/content';

/** Characters [start, end) of a line's text, in the styles set in `style` (bits; see styleBit). */
export interface StyleRun {
  start: number;
  end: number;
  style: number;
}

export interface StyledText {
  /** The text without marks. */
  text: string;
  /** Each character's style bits. */
  styles: number[];
}

const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

export function parseStyles(marked: string): StyledText {
  let text = '';
  const styles: number[] = [];
  let current = 0;
  for (let i = 0; i < marked.length; i++) {
    const bit = styleBit(marked[i]!);
    if (bit) {
      current ^= bit;
    } else {
      text += marked[i];
      styles.push(current);
    }
  }
  return { text, styles };
}

/**
 * Style runs for lines flowed from `source` (only whitespace changed). A
 * space takes the styles of the characters on both sides, so a highlighted
 * phrase reads as one band but a styled word's trailing space doesn't.
 */
export function lineStyles(lines: string[], source: StyledText): Array<StyleRun[] | undefined> {
  if (!source.styles.some(Boolean)) return lines.map(() => undefined);
  let cursor = 0;
  return lines.map((line) => {
    const styles = new Array<number>(line.length).fill(0);
    for (let i = 0; i < line.length; i++) {
      if (isSpace(line[i])) continue;
      while (isSpace(source.text[cursor])) cursor++;
      styles[i] = source.styles[cursor++] ?? 0;
    }
    for (let i = 0; i < line.length; i++) {
      if (!isSpace(line[i])) continue;
      let before = i - 1;
      while (before >= 0 && isSpace(line[before])) before--;
      let after = i + 1;
      while (after < line.length && isSpace(line[after])) after++;
      styles[i] = before >= 0 && after < line.length ? styles[before]! & styles[after]! : 0;
    }
    return toRuns(styles);
  });
}

function toRuns(styles: number[]): StyleRun[] | undefined {
  const runs: StyleRun[] = [];
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i]!;
    const last = runs[runs.length - 1];
    if (last && last.end === i && last.style === style) last.end = i + 1;
    else if (style) runs.push({ start: i, end: i + 1, style });
  }
  return runs.length > 0 ? runs : undefined;
}

/** Runs moved right by `by` characters, for text placed after an indent or prefix. */
export function shiftRuns(runs: StyleRun[] | undefined, by: number): StyleRun[] | undefined {
  return runs && by ? runs.map((run) => ({ ...run, start: run.start + by, end: run.end + by })) : runs;
}

/** Each character's style bits, from a line's runs. */
export function charStyles(length: number, runs: StyleRun[]): Uint8Array {
  const styles = new Uint8Array(length);
  for (const run of runs) styles.fill(run.style, run.start, Math.min(run.end, length));
  return styles;
}

/** CSS classes for a set of style bits: `s-italic`, `s-bold`, … */
export function styleClasses(style: number): string {
  return INLINE_STYLES.filter((_, i) => style & (1 << i)).map((name) => `s-${name}`).join(' ');
}

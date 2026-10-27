// Character widths on the monospace grid. CJK and other East Asian wide
// characters fall back to a proportional font that is wider than one cell, so
// they take two columns (and render in a two-column box; see GuidedLine).
// Combining marks sit on the character before them and take none.

const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, symbols and punctuation
  [0x3041, 0x33ff], // Kana, Bopomofo, CJK compatibility
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe4f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // Emoji
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd], // CJK extensions B and on
];

const COMBINING = /\p{Mn}/u;

/** Whether the code point takes two columns. */
export function isWide(code: number): boolean {
  if (code < 0x1100) return false;
  return WIDE.some(([lo, hi]) => code >= lo && code <= hi);
}

/** Whether the text has any character that takes two columns. */
export function hasWide(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (columnsAt(text, i) === 2) return true;
  return false;
}

/** Columns taken by the character starting at `text[i]` (0 for a low surrogate, counted with its pair). */
export function columnsAt(text: string, i: number): number {
  const code = text.charCodeAt(i);
  if (code < 0x300) return 1;
  if (code >= 0xdc00 && code <= 0xdfff) return 0;
  const point = text.codePointAt(i)!;
  if (isWide(point)) return 2;
  return COMBINING.test(String.fromCodePoint(point)) ? 0 : 1;
}

/** Columns the text takes on the grid. */
export function textColumns(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) total += columnsAt(text, i);
  return total;
}

/**
 * The index to cut `text` at so the part before it fits in `width` columns,
 * never splitting a surrogate pair. Takes at least one character, so a
 * wide character in a one-column width still moves forward.
 */
export function fitIndex(text: string, width: number): number {
  let used = 0;
  let i = 0;
  while (i < text.length) {
    const next = text.codePointAt(i)! > 0xffff ? i + 2 : i + 1;
    const add = columnsAt(text, i);
    if (used + add > width && i > 0) break;
    used += add;
    i = next;
  }
  return i;
}

/** Pad with spaces to `width` columns. */
export function padColumns(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - textColumns(text)));
}

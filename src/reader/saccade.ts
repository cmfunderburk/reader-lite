// Copied from Reader@f2d4f14 src/lib/saccade.ts, trimmed to fixation scoring,
// line timing, line flow and page grouping. Dropped: focus targets (focus
// pacer style), recall/paragraph tokenizers, PDF equation markers and
// asset-base figure URLs. Page grouping takes the current line width instead
// of the fixed GUIDED_LINE_WIDTH.

import { CALLOUT_END, CODE_MARKER, LIST_MARKER, TABLE_MARKER, stripStyles } from '../epub/content';
import { flowCode, flowTable, wrapStyled } from './blocks';
import { shiftRuns, type StyleRun } from './styledText';
import { calculateORP, normalizeText, wordPenalty } from './tokenizer';

export const GUIDED_FIGURE_MIN_LINE_SPAN_RATIO = 0.28;
export const GUIDED_FIGURE_MIN_LINE_SPAN_FLOOR = 5;
export const GUIDED_FIGURE_CAPTION_EXTRA_SPAN_MAX = 3;

export type GuidedLineType = 'body' | 'heading' | 'blank' | 'figure' | 'code' | 'table' | 'toggle';

export interface GuidedLine {
  text: string;
  type: GuidedLineType;
  level?: number;  // 1-6 for headings
  figureSrc?: string;
  figureCaption?: string;
  /** Table lines: the first line of a row, and rows in the table's header. */
  rowStart?: boolean;
  tableHeader?: boolean;
  /** Callout nesting level; the text is indented two columns per level. */
  depth?: number;
  /** A callout's title line. */
  calloutTitle?: boolean;
  /** A collapsible callout's toggle line: its number in the chapter. */
  toggleId?: number;
  /** Characters counted toward offsets, when not the visible text's (toggle lines). */
  chars?: number;
  /** Inline styles (italic, bold, …) over parts of the text. */
  styles?: StyleRun[];
}

/**
 * Calculate how long a guided line should be displayed, in milliseconds.
 * Uses character count as the basis: 5 characters = 1 word at the given WPM.
 */
export function calculateGuidedLineDuration(textLength: number, wpm: number): number {
  if (textLength <= 0 || wpm <= 0) return 0;
  return (textLength / 5) * (60000 / wpm);
}

/**
 * Compute character indices within a line where fixation ORP highlights should appear.
 * Returns absolute character positions into lineText for each fixation point.
 *
 * Uses a scoring model that penalizes short and function words, preferring
 * fixations on longer content words.
 */
export function computeLineFixations(lineText: string, guidedLength: number): number[] {
  const words: { word: string; start: number; orpPos: number }[] = [];
  const regex = /\S+/g;
  let m;
  while ((m = regex.exec(lineText)) !== null) {
    const word = m[0];
    words.push({
      word,
      start: m.index,
      orpPos: m.index + calculateORP(word),
    });
  }

  if (words.length === 0) return [];

  const aggression = Math.max(0, Math.min(1, (guidedLength - 7) / 8));
  const skipScale = 0.8 + 0.4 * aggression;
  const maxJump = guidedLength + 6;

  // First fixation: skip short first word if a second word exists
  const firstIdx = (words[0]!.word.length <= 3 && words.length > 1) ? 1 : 0;
  const fixations: number[] = [words[firstIdx]!.orpPos];
  let lastFixIdx = firstIdx;

  while (true) {
    const lastPos = fixations[fixations.length - 1]!;
    const target = lastPos + guidedLength;

    // Score candidates within max jump window
    let bestIdx = -1;
    let bestScore = Infinity;
    let bestLen = 0;

    for (let i = lastFixIdx + 1; i < words.length; i++) {
      const word = words[i]!;
      if (word.orpPos - lastPos > maxJump) continue;
      const score = Math.abs(word.orpPos - target)
        + skipScale * wordPenalty(word.word);
      if (score < bestScore - 0.001
          || (Math.abs(score - bestScore) < 0.001 && word.word.length > bestLen)) {
        bestIdx = i;
        bestScore = score;
        bestLen = word.word.length;
      }
    }

    // Fallback: if nothing in window, take best remaining forward word
    if (bestIdx === -1) {
      for (let i = lastFixIdx + 1; i < words.length; i++) {
        const word = words[i]!;
        const score = Math.abs(word.orpPos - target)
          + skipScale * wordPenalty(word.word);
        if (score < bestScore - 0.001
            || (Math.abs(score - bestScore) < 0.001 && word.word.length > bestLen)) {
          bestIdx = i;
          bestScore = score;
          bestLen = word.word.length;
        }
      }
    }

    if (bestIdx === -1) break;

    fixations.push(words[bestIdx]!.orpPos);
    lastFixIdx = bestIdx;
  }

  return fixations;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const FIGURE_URL_PATTERN = /^\[FIGURE_URL:(.+)\]$/i;
const FIGURE_CAPTION_PATTERN = /^\[FIGURE\s+(.+)\]$/i;

/**
 * Detect if a line is a markdown heading.
 */
function detectHeading(line: string): { isHeading: boolean; level: number; text: string } {
  const match = line.match(HEADING_PATTERN);
  if (match) {
    return { isHeading: true, level: match[1]!.length, text: match[2]! };
  }
  return { isHeading: false, level: 0, text: line };
}

/**
 * Word-wrap a paragraph (with style marks) into lines of specified width,
 * spacing out run-together sentences unless `normalize` is false.
 */
function wrapParagraph(text: string, lineWidth: number, normalize = true): GuidedLine[] {
  // Words longer than the line (URLs, identifiers) are broken rather than clipped.
  return wrapStyled(text, lineWidth, normalize ? normalizeText : undefined).map((line) => ({ ...line, type: 'body' }));
}

/**
 * Flow text into fixed-width lines using word wrapping.
 * Respects paragraph breaks (double newlines) and markdown headings.
 * Collapses single newlines into spaces to reflow ragged extractions.
 */
export interface FlowOptions {
  /** Callouts (numbered in chapter order) whose open/closed state the reader flipped. */
  toggled?: ReadonlySet<number>;
}

interface OpenCallout {
  open: boolean;
  /** Index in the output of its toggle line, if collapsible. */
  toggleAt: number;
  /** Index in the output where its content starts. */
  contentAt: number;
}

const CALLOUT_PATTERN = /^\[CALLOUT (\w+) ([-+.])\](.*)$/;
const INDENT = '  ';

/** A list item with a hanging indent: continuation lines align after the bullet. */
function flowListItem(item: string, width: number): GuidedLine[] {
  const match = item.match(/^( *)(\S+) (.*)$/);
  if (!match) return wrapParagraph(item, width, false);
  const lead = match[1]! + match[2]! + ' ';
  const room = width - lead.length;
  if (room < 12) return wrapParagraph(item.trim(), width, false);
  return wrapStyled(match[3]!, room, normalizeText).map((line, i) => ({
    text: (i === 0 ? lead : ' '.repeat(lead.length)) + line.text,
    type: 'body',
    ...(line.styles && { styles: shiftRuns(line.styles, lead.length) }),
  }));
}

/**
 * Flow a chapter's content into lines of at most `lineWidth` characters.
 * Callout content is indented two columns per level (`depth`). A collapsed
 * callout shows only its toggle line, which counts the hidden content's
 * characters (`chars`) so positions don't move when it opens or closes.
 */
export function flowTextIntoLines(text: string, lineWidth: number, options: FlowOptions = {}): GuidedLine[] {
  // Split into blocks (paragraphs/headings separated by blank lines)
  const blocks = text
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  const lines: GuidedLine[] = [];
  const stack: OpenCallout[] = [];
  let calloutCount = 0;
  let afterTitle = false;

  const depth = () => stack.length;
  const push = (...added: GuidedLine[]) => {
    const d = depth();
    for (const line of added) {
      const indented = line.type !== 'figure' && !!line.text;
      lines.push(
        d === 0
          ? line
          : {
              ...line,
              depth: d,
              text: indented ? INDENT.repeat(d) + line.text : line.text,
              styles: indented ? shiftRuns(line.styles, INDENT.length * d) : line.styles,
            },
      );
    }
  };
  const blank = () => {
    if (lines.length > 0 && lines[lines.length - 1]!.type !== 'blank') push({ text: '', type: 'blank' });
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const width = Math.max(10, lineWidth - INDENT.length * depth());
    const blockLines = block.split('\n');
    const first = blockLines[0]!;

    const callout = first.match(CALLOUT_PATTERN);
    if (callout) {
      const [, , fold, rawTitle] = callout;
      const id = calloutCount++;
      const title = rawTitle!.trim();
      const plainTitle = stripStyles(title);
      const flipped = options.toggled?.has(id) ?? false;
      const open = fold === '.' || (fold === '+') !== flipped;
      blank();
      const entry: OpenCallout = { open: true, toggleAt: -1, contentAt: 0 };
      stack.push(entry);
      if (fold !== '.') {
        entry.toggleAt = lines.length;
        push({ text: `${open ? '▾' : '▸'} ${plainTitle}`, type: 'toggle', toggleId: id, chars: visibleChars(plainTitle) });
      } else if (plainTitle) {
        push(...wrapParagraph(title, width).map((line) => ({ ...line, calloutTitle: true })));
      }
      entry.open = open;
      entry.contentAt = lines.length;
      afterTitle = fold === '.' ? !!plainTitle : true;
      continue;
    }

    if (first === CALLOUT_END) {
      const entry = stack.pop();
      if (entry && !entry.open && entry.toggleAt >= 0) {
        // Hidden content still counts toward positions, through the toggle line.
        const hidden = lines.splice(entry.contentAt);
        const toggle = lines[entry.toggleAt]!;
        toggle.chars = (toggle.chars ?? 0) + hidden.reduce((sum, line) => sum + lineChars(line), 0);
      }
      afterTitle = false;
      continue;
    }

    if (!afterTitle) blank();
    afterTitle = false;

    // Code and tables keep their own line structure (see epub/content.ts).
    const tableMarker = first.match(/^\[TABLE (\d+)\]$/);
    if (first === CODE_MARKER || (tableMarker && first.startsWith(TABLE_MARKER))) {
      push(
        ...(tableMarker
          ? flowTable(Number(tableMarker[1]), blockLines.slice(1), width)
          : flowCode(blockLines.slice(1), width)),
      );
      continue;
    }

    if (first === LIST_MARKER) {
      push(...blockLines.slice(1).flatMap((item) => flowListItem(item, width)));
      continue;
    }

    const figureUrlMarker = block.match(FIGURE_URL_PATTERN);
    if (figureUrlMarker) {
      const figureSrc = figureUrlMarker[1]!.trim();
      let figureCaption: string | undefined;

      const next = blocks[i + 1];
      if (next !== undefined && !FIGURE_URL_PATTERN.test(next)) {
        const captionMatch = next.match(FIGURE_CAPTION_PATTERN);
        if (captionMatch) {
          figureCaption = stripStyles(captionMatch[1]!).trim();
          i += 1;
        }
      }

      push({
        text: figureCaption || 'Figure',
        type: 'figure',
        figureSrc,
        figureCaption,
      });
      continue;
    }

    // Check if first line is a heading
    const heading = detectHeading(first.trim());

    if (heading.isHeading) {
      // Headings wrap like body text so they never overflow the line width.
      for (const wrapped of wrapParagraph(heading.text, width)) {
        push({ ...wrapped, type: 'heading', level: heading.level });
      }
      // If there's more content after the heading line, process it as a paragraph
      const restOfBlock = blockLines.slice(1).join(' ').trim();
      if (restOfBlock.length > 0) {
        blank();
        push(...wrapParagraph(restOfBlock, width));
      }
    } else {
      // Regular paragraph - collapse newlines into spaces and word wrap.
      // normalizeText only touches prose: in code, `a.B` is not a sentence break.
      push(...wrapParagraph(block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(), width));
    }
  }

  return lines;
}

/** Characters a line contributes to chapter offsets (see reader/layout.ts). */
export function lineChars(line: GuidedLine): number {
  return line.chars ?? visibleChars(line.text);
}

export function visibleChars(text: string): number {
  let count = 0;
  for (const char of text) if (!/\s/.test(char)) count++;
  return count;
}

/** Lines a figure reserves on a page: a base span plus room for a long caption. */
export function estimateFigureLineSpan(
  line: GuidedLine,
  figureBaseLineSpan: number,
  lineWidth: number
): number {
  if (line.type !== 'figure') return 1;

  // Reserve extra page budget for long captions so trailing text
  // is pushed to the next page instead of being clipped at viewport bottom.
  const captionText = (line.figureCaption || line.text || '').trim();
  const estimatedCaptionLines = captionText.length > 0
    ? Math.ceil(captionText.length / lineWidth)
    : 1;
  const captionExtraSpan = Math.min(
    GUIDED_FIGURE_CAPTION_EXTRA_SPAN_MAX,
    Math.max(0, estimatedCaptionLines - 1)
  );

  return Math.max(1, figureBaseLineSpan + captionExtraSpan);
}

/** Base number of lines a figure occupies for a given page size. */
export function figureBaseLineSpan(linesPerPage: number): number {
  return Math.max(
    GUIDED_FIGURE_MIN_LINE_SPAN_FLOOR,
    Math.round(linesPerPage * GUIDED_FIGURE_MIN_LINE_SPAN_RATIO)
  );
}

/** Line slots a line occupies on a page of `linesPerPage` lines (never more than a page). */
export function lineSpan(line: GuidedLine, linesPerPage: number, lineWidth: number): number {
  const baseSpan = Math.min(linesPerPage, figureBaseLineSpan(linesPerPage));
  return Math.min(linesPerPage, estimateFigureLineSpan(line, baseSpan, lineWidth));
}

/**
 * Group lines into pages of at most `linesPerPage` line slots, where a figure
 * takes several slots. Blank lines that would open a page are dropped.
 */
export function groupIntoPages<T extends GuidedLine>(
  lines: T[],
  linesPerPage: number,
  lineWidth: number
): T[][] {
  const pages: T[][] = [];
  if (linesPerPage <= 0 || lines.length === 0) return pages;

  let currentPage: T[] = [];
  let usedSpan = 0;

  for (const line of lines) {
    // A blank line at the top of a page is wasted space.
    if (currentPage.length === 0 && line.type === 'blank') continue;
    const span = lineSpan(line, linesPerPage, lineWidth);

    if (currentPage.length > 0 && usedSpan + span > linesPerPage) {
      pages.push(currentPage);
      currentPage = [];
      usedSpan = 0;
    }

    currentPage.push(line);
    usedSpan += span;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

// Copied from Reader@f2d4f14 src/lib/saccade.ts, trimmed to fixation scoring,
// line timing, line flow and page grouping. Dropped: focus targets (focus
// pacer style), recall/paragraph tokenizers, PDF equation markers and
// asset-base figure URLs. Page grouping takes the current line width instead
// of the fixed GUIDED_LINE_WIDTH.

import { calculateORP, normalizeText, wordPenalty } from './tokenizer';

export const GUIDED_FIGURE_MIN_LINE_SPAN_RATIO = 0.28;
export const GUIDED_FIGURE_MIN_LINE_SPAN_FLOOR = 5;
export const GUIDED_FIGURE_CAPTION_EXTRA_SPAN_MAX = 3;

export type GuidedLineType = 'body' | 'heading' | 'blank' | 'figure';

export interface GuidedLine {
  text: string;
  type: GuidedLineType;
  level?: number;  // 1-6 for headings
  figureSrc?: string;
  figureCaption?: string;
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
 * Word-wrap a paragraph into lines of specified width.
 */
function wrapParagraph(text: string, lineWidth: number): GuidedLine[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const lines: GuidedLine[] = [];
  let currentLine = '';

  for (const word of words) {
    const wouldBe = currentLine.length === 0 ? word : currentLine + ' ' + word;

    if (wouldBe.length <= lineWidth) {
      currentLine = wouldBe;
    } else {
      if (currentLine.length > 0) {
        lines.push({ text: currentLine, type: 'body' });
      }
      if (word.length > lineWidth) {
        lines.push({ text: word, type: 'body' });
        currentLine = '';
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push({ text: currentLine, type: 'body' });
  }

  return lines;
}

/**
 * Flow text into fixed-width lines using word wrapping.
 * Respects paragraph breaks (double newlines) and markdown headings.
 * Collapses single newlines into spaces to reflow ragged extractions.
 */
export function flowTextIntoLines(text: string, lineWidth: number): GuidedLine[] {
  const normalized = normalizeText(text);

  // Split into blocks (paragraphs/headings separated by blank lines)
  const blocks = normalized
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  const lines: GuidedLine[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const figureUrlMarker = block.match(FIGURE_URL_PATTERN);

    if (figureUrlMarker) {
      const figureSrc = figureUrlMarker[1]!.trim();
      let figureCaption: string | undefined;

      const next = blocks[i + 1];
      if (next !== undefined && !FIGURE_URL_PATTERN.test(next)) {
        const captionMatch = next.match(FIGURE_CAPTION_PATTERN);
        if (captionMatch) {
          figureCaption = captionMatch[1]!.trim();
          i += 1;
        }
      }

      lines.push({
        text: figureCaption || 'Figure',
        type: 'figure',
        figureSrc,
        figureCaption,
      });

      if (i < blocks.length - 1 && lines.length > 0 && lines[lines.length - 1]!.type !== 'blank') {
        lines.push({ text: '', type: 'blank' });
      }
      continue;
    }

    // Check if first line is a heading
    const firstLine = block.split('\n')[0]!.trim();
    const heading = detectHeading(firstLine);

    if (heading.isHeading) {
      // Add blank line before heading (if not first)
      if (lines.length > 0 && lines[lines.length - 1]!.type !== 'blank') {
        lines.push({ text: '', type: 'blank' });
      }
      // Headings wrap like body text so they never overflow the line width.
      for (const wrapped of wrapParagraph(heading.text, lineWidth)) {
        lines.push({ text: wrapped.text, type: 'heading', level: heading.level });
      }
      // Add blank line after heading
      lines.push({ text: '', type: 'blank' });

      // If there's more content after the heading line, process it as a paragraph
      const restOfBlock = block.split('\n').slice(1).join(' ').trim();
      if (restOfBlock.length > 0) {
        lines.push(...wrapParagraph(restOfBlock, lineWidth));
      }
    } else {
      // Regular paragraph - collapse newlines into spaces and word wrap
      const paragraph = block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      lines.push(...wrapParagraph(paragraph, lineWidth));
    }

    // Add blank line between blocks (not after last)
    if (i < blocks.length - 1) {
      // Only add if last line isn't already blank
      if (lines.length > 0 && lines[lines.length - 1]!.type !== 'blank') {
        lines.push({ text: '', type: 'blank' });
      }
    }
  }

  return lines;
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

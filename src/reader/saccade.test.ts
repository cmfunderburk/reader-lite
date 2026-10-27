// Tests copied from Reader@f2d4f14 src/lib/saccade.test.ts for the functions
// kept here, adapted to the trimmed signatures.
import { describe, expect, it } from 'bun:test';
import { calculateGuidedLineDuration, computeLineFixations, flowTextIntoLines, groupIntoPages } from './saccade';

describe('calculateGuidedLineDuration', () => {
  it('returns 0 for empty text or zero WPM', () => {
    expect(calculateGuidedLineDuration(0, 300)).toBe(0);
    expect(calculateGuidedLineDuration(50, 0)).toBe(0);
    expect(calculateGuidedLineDuration(-1, 300)).toBe(0);
    expect(calculateGuidedLineDuration(50, -10)).toBe(0);
  });

  it('treats 5 characters as 1 word', () => {
    // At 300 WPM, 1 word = 60000/300 = 200ms
    expect(calculateGuidedLineDuration(5, 300)).toBe(200);
  });

  it('scales linearly with character count', () => {
    const wpm = 300;
    const dur10 = calculateGuidedLineDuration(10, wpm);
    expect(calculateGuidedLineDuration(20, wpm)).toBe(dur10 * 2);
    expect(calculateGuidedLineDuration(40, wpm)).toBe(dur10 * 4);
  });

  it('scales inversely with WPM', () => {
    expect(calculateGuidedLineDuration(50, 300)).toBe(calculateGuidedLineDuration(50, 600) * 2);
  });

  it('computes correct duration for a typical 80-char line', () => {
    // 80 chars = 16 words. At 300 WPM: 16/300 * 60000 = 3200ms
    expect(calculateGuidedLineDuration(80, 300)).toBe(3200);
  });

  it('computes correct duration at common WPM settings', () => {
    expect(calculateGuidedLineDuration(50, 200)).toBe(3000);
    expect(calculateGuidedLineDuration(50, 400)).toBe(1500);
    expect(calculateGuidedLineDuration(50, 600)).toBe(1000);
  });
});

describe('computeLineFixations', () => {
  it('returns at least one fixation for non-empty text', () => {
    expect(computeLineFixations('Hello world', 10).length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for empty text', () => {
    expect(computeLineFixations('', 10)).toEqual([]);
  });

  it('skips short first words', () => {
    // First fixation should NOT be on 'A' (char 0) — should skip to 'wonderful'
    expect(computeLineFixations('A wonderful day', 10)[0]).toBeGreaterThan(0);
  });

  it('produces fixation indices within text bounds', () => {
    const text = 'The quick brown fox jumps over the lazy dog near the river bank';
    for (const idx of computeLineFixations(text, 10)) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(text.length);
    }
  });

  it('produces monotonically increasing fixation positions', () => {
    const fixations = computeLineFixations('Reading is a complex cognitive process that involves multiple brain regions', 10);
    for (let i = 1; i < fixations.length; i++) {
      expect(fixations[i]!).toBeGreaterThan(fixations[i - 1]!);
    }
  });

  it('prefers longer content words over short function words', () => {
    const fixations = computeLineFixations('a pharmaceutical', 10);
    expect(fixations.length).toBe(1);
    expect(fixations[0]).toBeGreaterThan(1);
  });
});

describe('computeLineFixations around surrogate pairs', () => {
  it('never lands on the second half of a pair', () => {
    const line = 'Let (𝑥𝑦) be 𝑥𝑦𝑧 and 𝑥 again in this line';
    for (const length of [7, 10, 13]) {
      for (const pos of computeLineFixations(line, length)) {
        const code = line.charCodeAt(pos);
        expect(code >= 0xdc00 && code <= 0xdfff).toBe(false);
      }
    }
  });
});

describe('figure handling', () => {
  it('parses direct figure URLs with captions', () => {
    const lines = flowTextIntoLines('[FIGURE_URL:asset:OEBPS/a.jpg]\n\n[FIGURE Example lead image.]', 80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      type: 'figure',
      figureSrc: 'asset:OEBPS/a.jpg',
      figureCaption: 'Example lead image.',
    });
  });

  it('pushes following text to later pages when a figure appears near page end', () => {
    const text = [
      'Alpha line one.', '', 'Beta line two.', '',
      '[FIGURE_URL:asset:fig.jpg]', '', '[FIGURE 4.1. Caption]', '',
      'Gamma after figure.', '', 'Delta after figure.',
    ].join('\n');
    const pages = groupIntoPages(flowTextIntoLines(text, 80), 6, 80);

    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages[0]!.some((line) => line.type === 'figure')).toBe(false);
    expect(pages[1]!.some((line) => line.type === 'figure')).toBe(true);
    expect(pages[1]!.some((line) => line.text.includes('Gamma after figure.'))).toBe(false);
  });
});

describe('flowTextIntoLines', () => {
  it('wraps long headings instead of overflowing the line', () => {
    const lines = flowTextIntoLines('## A heading that is much too long for the line', 20);
    expect(lines.filter((line) => line.type === 'heading').map((line) => line.text)).toEqual([
      'A heading that is', 'much too long for', 'the line',
    ]);
    expect(lines.every((line) => line.text.length <= 20)).toBe(true);
  });
});

describe('groupIntoPages', () => {
  it('does not start a page with a blank line', () => {
    const pages = groupIntoPages(flowTextIntoLines('one\n\ntwo\n\nthree', 80), 2, 80);
    expect(pages.map((page) => page.map((line) => line.text))).toEqual([['one', ''], ['two', ''], ['three']]);
  });
});

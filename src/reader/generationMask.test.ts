import { describe, expect, it } from 'bun:test';
import { maskCodeLine, maskGenerationLine } from './generationMask';

function getWordTokens(line: string): string[] {
  return line.trim().split(/\s+/);
}

function letterCount(token: string): number {
  return (token.match(/[A-Za-z]/g) || []).length;
}

function maskCount(token: string): number {
  return (token.match(/_/g) || []).length;
}

function hasConsecutiveMasks(token: string): boolean {
  return /__/.test(token);
}

describe('generationMask', () => {
  it('returns deterministic masking for a fixed seed', () => {
    const line = 'retrieval practice improves durable memory';
    const maskedA = maskGenerationLine(line, 'normal', 42, 0);
    const maskedB = maskGenerationLine(line, 'normal', 42, 0);
    expect(maskedA).toBe(maskedB);
    expect(maskedA).not.toBe(line);
  });

  it('reshuffles masking across different seeds', () => {
    const line = 'retrieval practice improves durable memory';
    const maskedA = maskGenerationLine(line, 'normal', 1001, 2);
    const maskedB = maskGenerationLine(line, 'normal', 1002, 2);
    expect(maskedA).not.toBe(maskedB);
  });

  it('masks every eligible word and exempts function words, proper nouns, acronyms, and numbers', () => {
    const allEligible = 'retrieval practice improves durable memory';
    const allEligibleMasked = maskGenerationLine(allEligible, 'normal', 5, 0);
    getWordTokens(allEligibleMasked).forEach((token) => {
      expect(maskCount(token)).toBeGreaterThan(0);
    });

    const line = 'we discussed entropy with Alice and NASA in 2026.';
    const masked = maskGenerationLine(line, 'hard', 7, 1);

    expect(masked).toContain('Alice');
    expect(masked).toContain('NASA');
    expect(masked).toContain('2026');
    expect(masked).toContain('and');
    expect(masked).not.toContain('discussed');
    expect(masked).not.toContain('entropy');
    expect(masked).not.toBe(line);
  });

  it('masks standalone title-cased words in heading-like lines', () => {
    const headingLine = 'Learning Is Misunderstood';
    const masked = maskGenerationLine(headingLine, 'normal', 9, 0);
    expect(masked).not.toContain('Misunderstood');
  });

  it('applies per-word mask caps (<=25% normal, <=40% hard)', () => {
    const line = 'retrieval practice improves durable memory formation substantially';
    const originalTokens = getWordTokens(line);
    const normal = maskGenerationLine(line, 'normal', 33, 4);
    const hard = maskGenerationLine(line, 'hard', 33, 4);

    const normalTokens = getWordTokens(normal);
    const hardTokens = getWordTokens(hard);

    for (let i = 0; i < normalTokens.length; i++) {
      const originalLetters = letterCount(originalTokens[i]!);
      const normalMasks = maskCount(normalTokens[i]!);
      const hardMasks = maskCount(hardTokens[i]!);

      expect(normalMasks).toBeLessThanOrEqual(Math.floor(originalLetters * 0.25));
      expect(hardMasks).toBeLessThanOrEqual(Math.floor(originalLetters * 0.4));
    }

    const normalUnderscores = (normal.match(/_/g) || []).length;
    const hardUnderscores = (hard.match(/_/g) || []).length;
    expect(hardUnderscores).toBeGreaterThan(normalUnderscores);
  });

  it('masks recall difficulty to first/last letters for every word', () => {
    const line = 'we discussed entropy with Alice and NASA in 2026';
    const maskedA = maskGenerationLine(line, 'recall', 1, 0);
    const maskedB = maskGenerationLine(line, 'recall', 99, 0);

    expect(maskedA).toBe(maskedB);
    expect(maskedA).toBe('we d_______d e_____y w__h A___e a_d N__A in 2026');
  });

  it('never places consecutive masked letters in a word', () => {
    const line = 'retrieval substantially unconventional groundbreaking methodologies';
    for (let seed = 0; seed < 24; seed++) {
      const masked = maskGenerationLine(line, 'hard', seed, 3);
      const tokens = getWordTokens(masked);
      tokens.forEach((token) => {
        expect(hasConsecutiveMasks(token)).toBe(false);
      });
    }
  });

  it('masks each hyphen-separated word independently', () => {
    const line = 'practice-practice-practice';
    const masked = maskGenerationLine(line, 'normal', 1, 0);
    const segments = masked.split('-');

    expect(segments).toHaveLength(3);
    segments.forEach((segment) => {
      expect(maskCount(segment)).toBeGreaterThan(0);
    });
  });

  it('does not treat capitalized German common nouns as proper nouns', () => {
    const line = 'Die Bedeutung eines Wortes ist sein Gebrauch in der Sprache.';
    const masked = maskGenerationLine(line, 'hard', 17, 0);

    expect(masked).not.toContain('Bedeutung');
    expect(masked).not.toContain('Wortes');
    expect(masked).not.toContain('Gebrauch');
    expect(masked).not.toContain('Sprache');
  });

  it('preserves German multi-word names while masking nearby nouns', () => {
    const line = 'Ich las die Notizen von Ludwig Wittgenstein gestern.';
    const masked = maskGenerationLine(line, 'hard', 21, 0);

    expect(masked).toContain('Ludwig');
    expect(masked).toContain('Wittgenstein');
    expect(masked).not.toContain('Notizen');
  });

  it('preserves names connected by lowercase particles', () => {
    const line = 'Das Werk von Ludwig von Mises ist bekannt.';
    const masked = maskGenerationLine(line, 'hard', 29, 0);

    expect(masked).toContain('Ludwig');
    expect(masked).toContain('Mises');
    expect(masked).not.toContain('Werk');
  });

  it('masks content words in mixed German/English text with German cues', () => {
    const line = 'Die learning strategy ist retrieval practice.';
    const masked = maskGenerationLine(line, 'hard', 50, 0);
    // German cues (Die, ist) are not in FUNCTION_WORDS so they get masked too
    expect(masked).not.toContain('Die');
    expect(masked).not.toContain('ist');
    expect(masked).not.toContain('learning');
    expect(masked).not.toContain('strategy');
  });

  it('treats short lines (< 3 alpha tokens) as non-German regardless of cues', () => {
    const line = 'Die Katze.';
    const masked = maskGenerationLine(line, 'hard', 50, 0);
    // Only 2 alpha tokens — too short for German detection
    // "Katze" is title-cased mid-sentence, treated as proper noun in English mode
    expect(masked).toContain('Katze');
  });

  it('treats all-caps tokens as acronyms and preserves them', () => {
    const line = 'NASA FBI CIA DHS TSA';
    const masked = maskGenerationLine(line, 'normal', 50, 0);
    expect(masked).toBe(line);
  });

  it('returns function-word-only lines unmasked', () => {
    const line = 'the and or but if so';
    const masked = maskGenerationLine(line, 'normal', 50, 0);
    expect(masked).toBe(line);
  });

  it('splits hyphenated tokens and masks each segment independently in recall mode', () => {
    const line = 'state-of-the-art';
    const masked = maskGenerationLine(line, 'recall', 1, 0);
    const segments = masked.split('-');
    expect(segments[0]).toBe('s___e'); // state
    expect(segments[1]).toBe('of');    // too short
    expect(segments[2]).toBe('t_e');   // 3 letters: first-last masks middle
    expect(segments[3]).toBe('a_t');   // art
  });

  it('preserves whitespace structure of the original line', () => {
    const line = '  retrieval   practice  ';
    const masked = maskGenerationLine(line, 'normal', 50, 0);
    expect(masked.startsWith('  ')).toBe(true);
    expect(masked.endsWith('  ')).toBe(true);
    expect(masked).toMatch(/\S {3}\S/);
  });

  it('handles empty and whitespace-only lines', () => {
    expect(maskGenerationLine('', 'normal', 1, 0)).toBe('');
    expect(maskGenerationLine('   ', 'normal', 1, 0)).toBe('   ');
  });
});

describe('maskCodeLine', () => {
  it('keeps keywords, punctuation and indentation, and masks identifiers part by part', () => {
    const line = '    for item in update_regrets(table, row):';
    const masked = maskCodeLine(line, 'normal', 7, 3);
    expect(masked.length).toBe(line.length);
    expect(masked.startsWith('    for ')).toBe(true);
    expect(masked).toContain(' in ');
    expect(masked).toContain('_');
    expect(masked.replace(/_/g, '').length).toBeLessThan(line.replace(/_/g, '').length);
    expect(masked.endsWith('):')).toBe(true);
    // The snake_case underscore stays at its place.
    expect(masked[line.indexOf('update_regrets') + 'update'.length]).toBe('_');
  });

  it('is deterministic and keeps first and last letters in recall', () => {
    const line = 'SELECT customer_id FROM orders';
    expect(maskCodeLine(line, 'hard', 1, 0)).toBe(maskCodeLine(line, 'hard', 1, 0));
    expect(maskCodeLine(line, 'recall', 1, 0)).toBe('SELECT c______r_id FROM o____s');
  });
});

describe('maskGenerationLine with surrogate pairs', () => {
  it('keeps masks aligned after characters outside the BMP', () => {
    const line = 'the 𝑥𝑦abcdefgh word';
    const masked = maskGenerationLine(line, 'hard', 1, 0);
    expect(masked.length).toBe(line.length);
    expect(masked.slice(0, 8)).toBe('the 𝑥𝑦');
    expect(masked[15]).toBe('h'); // the word's last letter stays
  });
});

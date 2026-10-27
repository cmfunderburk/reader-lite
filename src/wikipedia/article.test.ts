import { describe, expect, it } from 'bun:test';
import { CODE_MARKER } from '../epub/content';
import { articleChapters, plainTex, type WikiArticle } from './article';

const article = (extract: string): WikiArticle => ({
  title: 'Pythagorean theorem',
  url: 'https://en.wikipedia.org/wiki/Pythagorean_theorem',
  description: 'Relation in Euclidean geometry',
  extract,
  featuredOn: '2026-10-24',
  fetchedAt: 0,
});

// The shape the Action API returns with explaintext and exsectionformat=wiki.
const MATH_RUN = (tex: string) => `\n  \n    \n      \n        a\n        \n          2\n        \n      \n    \n    {\\displaystyle ${tex}}\n  \n`;

describe('articleChapters', () => {
  it('makes the lead and each top-level section a chapter, with sub-headings and one paragraph per line', () => {
    const chapters = articleChapters(
      article('Lead one.[1]\nLead two [citation needed].\n\n\n== History ==\nOld.\n\n=== Babylon ===\nTablets.\n\n\n== References ==\nRef list.'),
      true,
    );
    expect(chapters.map((c) => c.title)).toEqual(['Pythagorean theorem', 'History']);
    expect(chapters[0]!.content).toBe(
      '# Pythagorean theorem\n\n[FIGURE_URL:asset:lead-image]\n\n[FIGURE Pythagorean theorem: Relation in Euclidean geometry]\n\nLead one.\n\nLead two.',
    );
    expect(chapters[1]!.content.split('\n\n')).toEqual([
      '# History',
      'Old.',
      '## Babylon',
      'Tablets.',
      'From the Wikipedia article “Pythagorean theorem”, available under CC BY-SA 4.0: https://en.wikipedia.org/wiki/Pythagorean_theorem',
    ]);
  });

  it('keeps display maths as TeX and rejoins inline maths with its sentence', () => {
    const extract =
      `The equation:\n${MATH_RUN('a^{2}+b^{2}=c^{2}.')}\nNamed for Pythagoras.\n` +
      `Lengths such as \u2060${MATH_RUN('{\\sqrt {2}}')}\u2060, \u2060${MATH_RUN('\\pi r^{2}')}\u2060. More text.`;
    const blocks = articleChapters(article(extract), false)[0]!.content.split('\n\n');
    expect(blocks.slice(1, 5)).toEqual([
      'The equation:',
      `${CODE_MARKER}\na^{2}+b^{2}=c^{2}.`,
      'Named for Pythagoras.',
      'Lengths such as √2, π r². More text.',
    ]);
  });

  it('guards text that looks like markup', () => {
    expect(articleChapters(article('# not a heading'), false)[0]!.content).toContain('\u200b# not a heading');
  });
});

describe('plainTex', () => {
  it('renders common inline TeX readably and leaves the unusual as written', () => {
    expect(plainTex('c={\\sqrt {a^{2}+b^{2}}}')).toBe('c=√(a²+b²)');
    expect(plainTex('\\frac {1}{2}\\cdot \\theta \\leq \\pi')).toBe('1/2· θ ≤ π');
    expect(plainTex('\\int _{0}^{1}f')).toBe('\\int _0¹f');
  });
});

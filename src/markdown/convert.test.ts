import { describe, expect, test } from 'bun:test';
import { CELL_SEPARATOR as S, EMPTY_CODE_LINE, styled } from '../epub/content';
import { parseStyles } from '../reader/styledText';
import { convertMarkdown, flattenInline, markdownTitle, type MarkdownContext } from './convert';

const context: MarkdownContext = {
  resolveImage: (src) => (src.endsWith('chart.png') ? `notes/${src.split('/').pop()}` : undefined),
  linkTitle: (target) => (target === '02-update-rules' ? 'The Update Rules' : undefined),
};
const convert = (source: string) => convertMarkdown(source, context);

describe('flattenInline', () => {
  test('keeps emphasis and code spans as styles, and links and wikilinks as text', () => {
    expect(flattenInline('**Bold**, *it*, _em_, `a_b * c`, [link](http://x.y/(z)), [[02-update-rules]], [[x|alias]], [[02-update-rules#Regrets]]', context)).toBe(
      `${styled('bold', 'Bold')}, ${styled('italic', 'it')}, ${styled('italic', 'em')}, ${styled('code', 'a_b * c')}, link, The Update Rules, alias, The Update Rules › Regrets`,
    );
    expect(flattenInline('==key== ~~old~~ <mark>hi</mark>', context)).toBe(
      `${styled('highlight', 'key')} ${styled('strike', 'old')} ${styled('highlight', 'hi')}`,
    );
    // Bold italic: the marks nest differently, but every letter is both.
    const { text, styles } = parseStyles(flattenInline('***both***', context));
    expect(text).toBe('both');
    expect(new Set(styles)).toEqual(new Set([0b11]));
  });

  test('leaves snake_case and arithmetic alone, and decodes entities', () => {
    expect(flattenInline('update_regrets and 3 * 4 * 5 &amp; x\\_y', context)).toBe('update_regrets and 3 * 4 * 5 & x_y');
  });
});

describe('convertMarkdown', () => {
  test('takes the title from front matter, else the first heading', () => {
    expect(convert('---\ntitle: "From front matter"\ntags: [a]\n---\n# Heading\n\nText.')).toEqual({
      title: 'From front matter',
      content: '# Heading\n\nText.',
    });
    expect(convert('Intro.\n\n# First *H1*\n\n## Sub').title).toBe('First H1');
    expect(markdownTitle('Setext title\n===\n')).toBeUndefined();
  });

  test('keeps fenced code verbatim, including blank lines and # comments', () => {
    expect(convert('Before:\n\n```rust\nfn f() {\n\n    # not a heading\n}\n```\nAfter.').content).toBe(
      `Before:\n\n[CODE]\nfn f() {\n${EMPTY_CODE_LINE}\n    # not a heading\n}\n\nAfter.`,
    );
  });

  test('turns callouts into callout blocks, with their fold and nesting', () => {
    expect(convert('> [!question] Predict first\n> Where?\n>\n> > [!answer]-\n> > The river.\n\n> Plain quote.').content).toBe(
      [
        '[CALLOUT question .]Predict first',
        'Where?',
        '[CALLOUT answer -]Answer',
        'The river.',
        '[/CALLOUT]',
        '[/CALLOUT]',
        '[CALLOUT quote .]',
        'Plain quote.',
        '[/CALLOUT]',
      ].join('\n\n'),
    );
  });

  test('turns lists into list blocks with nesting, numbers and tasks', () => {
    expect(convert('- one\n  continued\n  - nested\n- [x] done\n\n1. first\n2. second').content).toBe(
      '[LIST]\n• one continued\n  ◦ nested\n☑ done\n\n[LIST]\n1. first\n2. second',
    );
  });

  test('ends a list at a fence and resumes after it', () => {
    expect(convert('1. step\n\n   ```\n   code\n   ```\n2. next').content).toBe('[LIST]\n1. step\n\n[CODE]\ncode\n\n[LIST]\n2. next');
  });

  test('turns pipe tables into table blocks', () => {
    expect(convert('| # | Chapter |\n|---|:---|\n| 1 | [[02-update-rules]] |\n| 2 | a \\| b |').content).toBe(
      `[TABLE 1]\n#${S}Chapter\n1${S}The Update Rules\n2${S}a | b`,
    );
  });

  test('turns image-only paragraphs into figures and drops missing images', () => {
    expect(convert('![A chart](img/chart.png)\n\n![[chart.png]]\n\n![Gone](gone.png)').content).toBe(
      '[FIGURE_URL:asset:notes/chart.png]\n\n[FIGURE A chart]\n\n[FIGURE_URL:asset:notes/chart.png]\n\nGone',
    );
  });

  test('handles headings, rules, setext headings, comments and markup lookalikes', () => {
    expect(convert('Title\n---\n\n***\n\n%% hidden %%\n\n<!-- also\nhidden -->\n\n\\# not a heading\n\n## Closed ##').content).toBe(
      '## Title\n\n* * *\n\n​# not a heading\n\n## Closed',
    );
  });
});

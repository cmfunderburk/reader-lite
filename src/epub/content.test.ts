import { describe, expect, test } from 'bun:test';
import { xhtml } from '../../test/epub-builder';
import { CELL_SEPARATOR, EMPTY_CODE_LINE, SPANNED_CELL, collapseStyled, convertBody, segmentContent, stripStyles, styled } from './content';
import { bodyOf, parseXhtml } from './xml';

function convert(html: string, images: string[] = []) {
  const body = bodyOf(parseXhtml(xhtml(html)))!;
  return convertBody(body, { resolveImage: (src) => (images.includes(src) ? `OEBPS/${src}` : undefined) });
}

function content(html: string, images: string[] = []): string {
  return convert(html, images).map(segmentContent).join('\n\n');
}

describe('convertBody', () => {
  test('emits headings and whitespace-collapsed paragraphs', () => {
    expect(content('<h2>Part  One</h2><p>Some\n   <em>inline</em> text.</p><div><p>Nested</p></div>')).toBe(
      `## Part One\n\nSome ${styled('italic', 'inline')} text.\n\nNested`,
    );
  });

  test('keeps inline styles, balanced within each block', () => {
    expect(content('<p><b>Bold</b>, <i>it <em>still</em> it</i>, <code>x</code>, <mark>m</mark>, <del>d</del></p>')).toBe(
      `${styled('bold', 'Bold')}, ${styled('italic', 'it still it')}, ${styled('code', 'x')}, ${styled('highlight', 'm')}, ${styled('strike', 'd')}`,
    );
    // A style around several blocks is closed and reopened at each.
    expect(content('<em><p>One</p><p>Two</p></em>')).toBe(`${styled('italic', 'One')}\n\n${styled('italic', 'Two')}`);
    expect(content('<h2>A <em>Title</em></h2><p><b> </b></p><p>End</p>')).toBe(`## A ${styled('italic', 'Title')}\n\nEnd`);
  });

  test('turns images into figure markers with figcaption or alt captions', () => {
    expect(content('<figure><img src="a.png"/><figcaption>Fig 1. A [b]</figcaption></figure>', ['a.png'])).toBe(
      '[FIGURE_URL:asset:OEBPS/a.png]\n\n[FIGURE Fig 1. A (b)]',
    );
    expect(content('<p><img src="a.png" alt="A chart"/></p>', ['a.png'])).toBe(
      '[FIGURE_URL:asset:OEBPS/a.png]\n\n[FIGURE A chart]',
    );
  });

  test('ignores placeholder alt text and images missing from the book', () => {
    expect(content('<img src="a.png" alt="image"/><img src="gone.png" alt="Gone"/>', ['a.png'])).toBe(
      '[FIGURE_URL:asset:OEBPS/a.png]',
    );
  });

  test('keeps the caption of an image-less figure as text', () => {
    expect(content('<figure><figcaption>Listing 1</figcaption><pre>code</pre></figure>')).toBe('[CODE]\ncode\n\nListing 1');
  });

  test('drops page-break markers and note references', () => {
    expect(content('<p>Before<span epub:type="pagebreak">23</span> after<a epub:type="noteref">1</a>.</p>')).toBe(
      'Before after.',
    );
    expect(content('<p>repeated<sup><a data-type="noteref" href="#n">a</a></sup> text.</p>')).toBe('repeated text.');
  });

  test('drops linked superscript footnote markers but keeps exponents', () => {
    expect(content('<p>than they are.<sup><a href="#n5">5</a></sup> Then x<sup>2</sup>.</p>')).toBe(
      'than they are. Then x2.',
    );
    expect(content('<p>more popular.<a href="n.xhtml#8"><sup>8</sup></a> See page <a href="#p23">23</a>.</p>')).toBe(
      'more popular. See page 23.',
    );
  });

  test('guards text that looks like a heading or marker', () => {
    expect(content('<p># not a heading</p>')).toBe('​# not a heading');
  });

  test('renders horizontal rules as scene breaks', () => {
    expect(content('<p>a</p><hr/><p>b</p>')).toBe('a\n\n* * *\n\nb');
  });

  test('keeps code line breaks and indentation, with callout images as numbers', () => {
    expect(
      content(
        '<pre data-type="programlisting">\n<code>def f(x):</code>\n\n\treturn x.Upper()  <a class="co"><img src="1.png" alt="1" width="12"/></a>\n</pre>',
        ['1.png'],
      ),
    ).toBe(`[CODE]\ndef f(x):\n${EMPTY_CODE_LINE}\n    return x.Upper()  (1)`);
  });

  test('joins a callout number to its explanation and keeps long terms apart', () => {
    expect(
      content('<dl><dt><a><img src="1.png" alt="1" width="12"/></a></dt><dd><p>x is kept.</p></dd><dt>A longer term</dt><dd>Defined.</dd></dl>', ['1.png']),
    ).toBe('(1) x is kept.\n\nA longer term\n\nDefined.');
  });

  test('treats small images as inline icons rather than figures', () => {
    expect(content('<p>Note <img src="i.png" width="16" height="16" alt="warning"/> this.</p>', ['i.png'])).toBe('Note this.');
  });

  test('keeps tables as rows of cells after their caption', () => {
    const S = CELL_SEPARATOR;
    expect(
      content(
        '<table><caption>Table 1. Names</caption><thead><tr><th>Kind</th><th>Names</th></tr></thead>' +
          '<tbody><tr><td><p>Strings</p></td><td><p><code>__repr__  __str__</code></p></td></tr>' +
          '<tr><td colspan="2">Both</td></tr><tr><td></td><td></td></tr></tbody></table>',
      ),
    ).toBe(`Table 1. Names\n\n[TABLE 1]\nKind${S}Names\nStrings${S}${styled('code', '__repr__ __str__')}\nBoth${S}${SPANNED_CELL}`);
  });

  test('reads one-column tables as ordinary content', () => {
    expect(content('<table><tr><td><p>Boxed</p><p>text</p></td></tr></table>')).toBe('Boxed\n\ntext');
  });

  test('splits into titled segments at split points', () => {
    const body = bodyOf(parseXhtml(xhtml('<p>front</p><h2 id="one">One</h2><p>1</p><h2 id="two">Two</h2><p>2</p>')))!;
    const [one, two] = Array.from(body.getElementsByTagName('*')).filter((el) => el.localName === 'h2');
    const segments = convertBody(body, {
      resolveImage: () => undefined,
      splitAt: new Map([[one!, 'Chapter One'], [two!, 'Chapter Two']]),
    });
    expect(segments.map((s) => [s.title, segmentContent(s)])).toEqual([
      [undefined, 'front'],
      ['Chapter One', '## One\n\n1'],
      ['Chapter Two', '## Two\n\n2'],
    ]);
  });
});

test('collapseStyled collapses spaces around style marks as if they weren’t there', () => {
  expect(stripStyles(collapseStyled(` a ${styled('code', 'b ')} ${styled('bold', ' c')} `))).toBe('a b c');
  expect(collapseStyled(`Some ${styled('italic', ' inline ')} text`)).toBe(`Some ${styled('italic', 'inline')} text`);
});

import { describe, expect, test } from 'bun:test';
import { xhtml } from '../../test/epub-builder';
import { convertBody, segmentContent } from './content';
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
      '## Part One\n\nSome inline text.\n\nNested',
    );
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
    expect(content('<figure><figcaption>Listing 1</figcaption><pre>code</pre></figure>')).toBe('code\n\nListing 1');
  });

  test('drops page-break markers and note references', () => {
    expect(content('<p>Before<span epub:type="pagebreak">23</span> after<a epub:type="noteref">1</a>.</p>')).toBe(
      'Before after.',
    );
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

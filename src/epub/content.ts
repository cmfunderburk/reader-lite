// Converts a chapter's XHTML body into the guided reader's content format:
// blocks separated by blank lines, `#` headings, and [FIGURE_URL:…] /
// [FIGURE caption] markers (see flowTextIntoLines). Inline formatting is
// flattened to plain text.

import { childElements, collapseWhitespace, localName } from './xml';

export interface ContentSegment {
  /** Title supplied by a split point, if this segment starts at one. */
  title?: string;
  blocks: string[];
}

export interface ConvertOptions {
  /** Resolve an <img> src to an archive path, or undefined if it isn't in the book. */
  resolveImage: (src: string) => string | undefined;
  /** Elements that start a new segment, mapped to that segment's title. */
  splitAt?: Map<Element, string | undefined>;
}

export const ASSET_SCHEME = 'asset:';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const SKIPPED = new Set(['head', 'script', 'style', 'noscript', 'template', 'title']);
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'div', 'dl',
  'dt', 'figcaption', 'footer', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tr', 'ul',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SKIPPED_EPUB_TYPES = new Set(['pagebreak', 'noteref']);

// Text that would otherwise be read as a heading or a marker by the line flow.
const MARKUP_LOOKALIKE = /^(#{1,6}\s|\[(FIGURE|EQN_))/i;

export function convertBody(body: Element, options: ConvertOptions): ContentSegment[] {
  return new Converter(options).run(body);
}

/** Join a segment's blocks into the content string the line flow consumes. */
export function segmentContent(segment: ContentSegment): string {
  return segment.blocks.join('\n\n');
}

export function segmentHasText(segment: ContentSegment): boolean {
  return segment.blocks.some((block) => !block.startsWith('[FIGURE'));
}

// Alt text that names the element rather than describing it.
const PLACEHOLDER_ALT = /^((image|img|figure|fig|picture|photo|graphic|cover|illustration)\s*[\d.]*|.*\.(jpe?g|png|gif|svg|webp))$/i;

function altCaption(el: Element): string {
  const alt = sanitizeCaption(el.getAttribute('alt') ?? '');
  return PLACEHOLDER_ALT.test(alt) ? '' : alt;
}

function sanitizeCaption(text: string): string {
  return collapseWhitespace(text).replace(/\[/g, '(').replace(/\]/g, ')');
}

/**
 * A linked superscript marker: <sup><a href="#n5">5</a></sup> or
 * <a href="#n5"><sup>5</sup></a>. Unlinked superscripts (exponents) and plain
 * number links (index entries, cross-references) stay.
 */
function isFootnoteMarker(el: Element, name: string): boolean {
  const inner = name === 'sup' ? 'a' : 'sup';
  return /^[\s\d*†‡§,\[\]]+$/.test(el.textContent ?? '')
    && Array.from(el.getElementsByTagName('*')).some((child) => localName(child) === inner);
}

function epubTypes(el: Element): string[] {
  const value = el.getAttribute('epub:type') ?? el.getAttribute('role') ?? '';
  return value.split(/\s+/).map((t) => t.replace(/^doc-/, ''));
}

class Converter {
  private readonly segments: ContentSegment[] = [];
  private current: ContentSegment = { blocks: [] };
  private inline = '';
  private pendingCaption: string | undefined;

  constructor(private readonly options: ConvertOptions) {}

  run(body: Element): ContentSegment[] {
    this.visitChildren(body);
    this.flushInline();
    this.segments.push(this.current);
    return this.segments.filter((s) => s.blocks.length > 0);
  }

  private visitChildren(el: Element): void {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === TEXT_NODE) this.inline += node.nodeValue ?? '';
      else if (node.nodeType === ELEMENT_NODE) this.visit(node as Element);
    }
  }

  private visit(el: Element): void {
    const name = localName(el);
    const split = this.options.splitAt;
    if (split?.has(el)) this.startSegment(split.get(el));

    if (SKIPPED.has(name)) return;
    if (epubTypes(el).some((t) => SKIPPED_EPUB_TYPES.has(t))) return;
    if ((name === 'sup' || name === 'a') && isFootnoteMarker(el, name)) return;

    if (HEADINGS.has(name)) return this.heading(el, Number(name[1]));
    if (name === 'img' || name === 'image') return this.image(el);
    if (name === 'figure') return this.figure(el);
    if (name === 'math') {
      this.inline += ` ${el.getAttribute('alttext') ?? el.textContent ?? ''} `;
      return;
    }
    if (name === 'br' || name === 'td' || name === 'th') {
      this.inline += ' ';
      if (name !== 'br') this.visitChildren(el);
      return;
    }
    if (name === 'hr') {
      this.flushInline();
      this.current.blocks.push('* * *');
      return;
    }
    if (BLOCKS.has(name)) {
      this.flushInline();
      this.visitChildren(el);
      this.flushInline();
      return;
    }
    this.visitChildren(el);
  }

  private heading(el: Element, level: number): void {
    this.flushInline();
    this.visitChildren(el);
    const text = collapseWhitespace(this.inline);
    this.inline = '';
    if (text) this.current.blocks.push(`${'#'.repeat(level)} ${text}`);
  }

  private image(el: Element): void {
    const src = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('xlink:href');
    const path = src ? this.options.resolveImage(src) : undefined;
    if (!path) return;

    this.flushInline();
    this.current.blocks.push(`[FIGURE_URL:${ASSET_SCHEME}${path}]`);
    const caption = this.pendingCaption ?? altCaption(el);
    this.pendingCaption = undefined;
    if (caption) this.current.blocks.push(`[FIGURE ${caption}]`);
  }

  private figure(el: Element): void {
    this.flushInline();
    const captionEl = childElements(el).find((child) => localName(child) === 'figcaption');
    const caption = captionEl ? sanitizeCaption(captionEl.textContent ?? '') : '';
    this.pendingCaption = caption || undefined;

    for (const node of Array.from(el.childNodes)) {
      if (node === captionEl) continue;
      if (node.nodeType === TEXT_NODE) this.inline += node.nodeValue ?? '';
      else if (node.nodeType === ELEMENT_NODE) this.visit(node as Element);
    }
    this.flushInline();

    // A figure without an image (e.g. a code listing) keeps its caption as text.
    if (this.pendingCaption) this.pushText(this.pendingCaption);
    this.pendingCaption = undefined;
  }

  private startSegment(title: string | undefined): void {
    this.flushInline();
    this.segments.push(this.current);
    this.current = { title, blocks: [] };
  }

  private flushInline(): void {
    const text = collapseWhitespace(this.inline);
    this.inline = '';
    if (text) this.pushText(text);
  }

  private pushText(text: string): void {
    this.current.blocks.push(MARKUP_LOOKALIKE.test(text) ? `​${text}` : text);
  }
}

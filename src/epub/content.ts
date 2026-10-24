// Converts a chapter's XHTML body into the guided reader's content format:
// blocks separated by blank lines, `#` headings, [FIGURE_URL:…] /
// [FIGURE caption] markers, and code and table blocks (see
// flowTextIntoLines). Inline formatting is flattened to plain text.
//
// Code and table blocks are laid out by the reader for the current line
// width, so they keep their structure here:
//   [CODE]                  [TABLE <header rows>]
//   line one                cell<US>cell<US>cell
//       indented line       cell<US>cell<US>cell
// An empty code line is stored as EMPTY_CODE_LINE so it can't end the block,
// table cells are separated by the ASCII unit separator, and the columns a
// colspan cell covers after its first hold SPANNED_CELL.

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
export const CODE_MARKER = '[CODE]';
export const TABLE_MARKER = '[TABLE';
export const CELL_SEPARATOR = '\u001f';
export const EMPTY_CODE_LINE = '\u001e';
/** Fills the columns a spanning (colspan) cell covers after its first. */
export const SPANNED_CELL = '\u001d';
/** A list: one item per line, `<indent><bullet> <text>`. */
export const LIST_MARKER = '[LIST]';
/**
 * A callout (or quote) wraps the blocks between `[CALLOUT <type> <fold>]<title>`
 * and `[/CALLOUT]`. Fold is `-` (collapsed), `+` (expanded, collapsible) or
 * `.` (always open).
 */
export const CALLOUT_START = '[CALLOUT ';
export const CALLOUT_END = '[/CALLOUT]';

const TAB_WIDTH = 4;
/** A <dt> this short is a callout number or bullet, joined to its <dd>. */
const SHORT_TERM_CHARS = 6;
/** Images this small (by their width/height attributes) are inline icons, not figures. */
const ICON_MAX_PX = 32;

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
const MARKUP_LOOKALIKE = /^(#{1,6}\s|\[(FIGURE|EQN_|CODE\]|TABLE|LIST\]|CALLOUT|\/CALLOUT))/i;

export function convertBody(body: Element, options: ConvertOptions): ContentSegment[] {
  return new Converter(options).run(body);
}

/** Join a segment's blocks into the content string the line flow consumes. */
export function segmentContent(segment: ContentSegment): string {
  return segment.blocks.join('\n\n');
}

function expandTabs(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const char of line) out += char === '\t' ? ' '.repeat(TAB_WIDTH - (out.length % TAB_WIDTH)) : char;
  return out;
}

/** A numbered callout image (O'Reilly-style code annotations) as text. */
function calloutText(el: Element): string | undefined {
  const alt = (el.getAttribute('alt') ?? '').trim();
  return /^\d{1,2}$/.test(alt) ? `(${alt})` : undefined;
}

function isIcon(el: Element): boolean {
  const size = (attr: string) => Number.parseFloat(el.getAttribute(attr) ?? '');
  return size('width') <= ICON_MAX_PX || size('height') <= ICON_MAX_PX;
}

/** A <pre>'s text with its line breaks and indentation intact. */
function preformattedText(node: Node): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      out += child.nodeValue ?? '';
    } else if (child.nodeType === ELEMENT_NODE) {
      const el = child as Element;
      const name = localName(el);
      if (name === 'br') out += '\n';
      else if (name === 'img' || name === 'image') out += calloutText(el) ?? '';
      else if (!SKIPPED.has(name) && !epubTypes(el).includes('pagebreak')) out += preformattedText(el);
    }
  }
  return out;
}

/** Text that would be read as a heading or a marker, made safe with a zero-width prefix. */
export function guardMarkup(text: string): string {
  return MARKUP_LOOKALIKE.test(text) ? `\u200b${text}` : text;
}

/** A code block from preformatted text, or undefined if it's empty. */
export function codeBlock(text: string): string | undefined {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => expandTabs(line).trimEnd());
  while (lines.length > 0 && !lines[0]) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
  if (lines.length === 0) return undefined;
  return [CODE_MARKER, ...lines.map((line) => line || EMPTY_CODE_LINE)].join('\n');
}

/** A table block from rows of cell texts, or undefined if there are no rows. */
export function tableBlock(headerRows: number, rows: string[][]): string | undefined {
  if (rows.length === 0) return undefined;
  const clean = (cell: string) => (cell === SPANNED_CELL ? cell : cell.replace(/[\u001d-\u001f\n]/g, ' '));
  return [`${TABLE_MARKER} ${headerRows}]`, ...rows.map((row) => row.map(clean).join(CELL_SEPARATOR))].join('\n');
}

function closestTable(el: Element): Element | null {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (localName(parent) === 'table') return parent;
  }
  return null;
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

/** Semantic types from epub:type, ARIA roles, or O'Reilly's data-type. */
function epubTypes(el: Element): string[] {
  const value = [el.getAttribute('epub:type'), el.getAttribute('role'), el.getAttribute('data-type')].join(' ');
  return value.split(/\s+/).filter(Boolean).map((t) => t.replace(/^doc-/, ''));
}

class Converter {
  private readonly segments: ContentSegment[] = [];
  private current: ContentSegment = { blocks: [] };
  private inline = '';
  private pendingCaption: string | undefined;
  /** A short <dt> (callout number) waiting to prefix its <dd>'s text. */
  private pendingTerm: string | undefined;

  constructor(private readonly options: ConvertOptions) {}

  run(body: Element): ContentSegment[] {
    this.visitChildren(body);
    this.flushInline();
    this.flushTerm();
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
    if (name === 'pre') return this.preformatted(el);
    if (name === 'table') return this.table(el);
    if (name === 'dt') return this.term(el);
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
    this.flushTerm();
    this.visitChildren(el);
    const text = collapseWhitespace(this.inline);
    this.inline = '';
    if (text) this.current.blocks.push(`${'#'.repeat(level)} ${text}`);
  }

  private image(el: Element): void {
    if (isIcon(el)) {
      const callout = calloutText(el);
      if (callout) this.inline += ` ${callout} `;
      return;
    }
    const src = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('xlink:href');
    const path = src ? this.options.resolveImage(src) : undefined;
    if (!path) return;

    this.flushInline();
    this.flushTerm();
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

  private preformatted(el: Element): void {
    this.flushInline();
    this.flushTerm();
    const block = codeBlock(preformattedText(el));
    if (block) this.current.blocks.push(block);
  }

  private table(el: Element): void {
    this.flushInline();
    this.flushTerm();
    const rows = Array.from(el.getElementsByTagName('*')).filter(
      (row) => localName(row) === 'tr' && closestTable(row) === el,
    );
    const cellsOf = (row: Element) => childElements(row).filter((cell) => ['td', 'th'].includes(localName(cell)));
    const columns = Math.max(0, ...rows.map((row) => cellsOf(row).length));

    // One-column tables are boxes or layout scaffolding: read them as content.
    if (columns <= 1) {
      this.visitChildren(el);
      this.flushInline();
      return;
    }

    const caption = childElements(el).find((child) => localName(child) === 'caption');
    if (caption) {
      this.visitChildren(caption);
      this.flushInline();
    }

    let headerRows = 0;
    let inHeader = true;
    const lines: string[][] = [];
    for (const row of rows) {
      const cells = cellsOf(row);
      const isHeader = localName(row.parentElement!) === 'thead' || cells.every((cell) => localName(cell) === 'th');
      const texts: string[] = [];
      for (const cell of cells) {
        texts.push(this.cellText(cell));
        const span = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);
        for (let i = 1; i < Math.min(span, columns); i++) texts.push(SPANNED_CELL);
      }
      if (texts.every((text) => !text || text === SPANNED_CELL)) continue;
      if (inHeader && isHeader) headerRows++;
      else inHeader = false;
      lines.push(texts);
    }
    const block = tableBlock(headerRows, lines);
    if (block) this.current.blocks.push(block);
  }

  /** A table cell flattened to one line of text. */
  private cellText(cell: Element): string {
    const blocks = new Converter({ resolveImage: () => undefined }).run(cell).flatMap((segment) => segment.blocks);
    const text = blocks
      .map((block) => (block.startsWith(CODE_MARKER) ? block.split('\n').slice(1).join(' ') : block))
      .filter((block) => !block.startsWith('[FIGURE') && !block.startsWith(TABLE_MARKER))
      .join(' ');
    return collapseWhitespace(text.replace(/[\u001d-\u001f]/g, ' '));
  }

  private term(el: Element): void {
    this.flushInline();
    this.flushTerm();
    this.visitChildren(el);
    const text = collapseWhitespace(this.inline);
    this.inline = '';
    if (text.length <= SHORT_TERM_CHARS) this.pendingTerm = text || undefined;
    else this.pushText(text);
  }

  private flushTerm(): void {
    const term = this.pendingTerm;
    this.pendingTerm = undefined;
    if (term) this.pushText(term);
  }

  private startSegment(title: string | undefined): void {
    this.flushInline();
    this.flushTerm();
    this.segments.push(this.current);
    this.current = { title, blocks: [] };
  }

  private flushInline(): void {
    const text = collapseWhitespace(this.inline);
    this.inline = '';
    if (text) this.pushText(text);
  }

  private pushText(text: string): void {
    if (this.pendingTerm) {
      text = `${this.pendingTerm} ${text}`;
      this.pendingTerm = undefined;
    }
    this.current.blocks.push(guardMarkup(text));
  }
}

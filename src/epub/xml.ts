// Namespace-agnostic DOM helpers. EPUB metadata is namespaced XML and chapter
// files are XHTML that is sometimes not well-formed, so lookups go by
// localName and XHTML falls back to the forgiving HTML parser.

export class EpubError extends Error {}

const ELEMENT_NODE = 1;

// Text is already decoded by the time it's parsed, so the declaration carries
// nothing useful, and some parsers (happy-dom) reject valid single-quoted ones.
function stripXmlDeclaration(text: string): string {
  return text.replace(/^\uFEFF?\s*<\?xml[^>]*\?>/, '');
}

function hasParseError(doc: Document): boolean {
  return doc.getElementsByTagName('parsererror').length > 0;
}

export function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(stripXmlDeclaration(text), 'application/xml');
  if (hasParseError(doc)) throw new EpubError(`could not parse ${what}`);
  return doc;
}

/** Parse XHTML strictly, falling back to HTML (e.g. for undeclared &nbsp; entities). */
export function parseXhtml(text: string): Document {
  text = stripXmlDeclaration(text);
  const strict = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (!hasParseError(strict)) return strict;
  return new DOMParser().parseFromString(text, 'text/html');
}

export function localName(el: Element): string {
  return el.localName.toLowerCase();
}

export function elementsByLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((el) => localName(el) === name);
}

export function firstByLocalName(root: Document | Element, name: string): Element | undefined {
  return elementsByLocalName(root, name)[0];
}

export function childElements(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === ELEMENT_NODE);
}

export function bodyOf(doc: Document): Element | undefined {
  return firstByLocalName(doc, 'body');
}

export function collapseWhitespace(text: string): string {
  return text.replace(/­/g, '').replace(/\s+/g, ' ').trim();
}

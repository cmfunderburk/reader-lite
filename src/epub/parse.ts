import {
  convertBody,
  segmentContent,
  segmentHasText,
  type ContentSegment,
} from './content';
import {
  EpubError,
  bodyOf,
  childElements,
  collapseWhitespace,
  elementsByLocalName,
  firstByLocalName,
  localName,
  parseXhtml,
  parseXml,
} from './xml';
import { ZipArchive, ZipError } from './zip';

export { EpubError };

export interface ParsedChapter {
  title: string;
  content: string;
}

export interface ParsedAsset {
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface ParsedBook {
  title: string;
  author?: string;
  chapters: ParsedChapter[];
  assets: ParsedAsset[];
}

interface ManifestItem {
  path: string;
  mediaType: string;
  properties: string[];
}

interface TocEntry {
  path: string;
  fragment?: string;
  label: string;
  depth: number;
}

/** Spine files longer than this with no TOC-driven split get Reader's heading split. */
const MONOLITHIC_CHAPTER_CHARS = 100_000;


const FONT_PATH = /\.(otf|ttf|ttc|eot|woff2?)$/i;
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

const IMAGE_TYPES: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

export async function parseEpub(data: ArrayBuffer | Uint8Array): Promise<ParsedBook> {
  let zip: ZipArchive;
  try {
    zip = ZipArchive.open(data);
  } catch (err) {
    throw new EpubError(err instanceof ZipError ? `not a valid EPUB (${err.message})` : 'not a valid EPUB');
  }

  await rejectDrm(zip);

  const opfPath = await findPackagePath(zip);
  const opf = parseXml(await zip.text(opfPath), 'package document');
  const opfDir = dirname(opfPath);

  const manifest = new Map<string, ManifestItem>();
  for (const item of elementsByLocalName(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    manifest.set(id, {
      path: resolvePath(opfDir, href).path,
      mediaType: item.getAttribute('media-type') ?? '',
      properties: (item.getAttribute('properties') ?? '').split(/\s+/),
    });
  }

  const spinePaths = elementsByLocalName(opf, 'itemref')
    .filter((ref) => ref.getAttribute('linear') !== 'no')
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? '')?.path)
    .filter((path): path is string => !!path && zip.has(path));

  const toc = await readToc(zip, opf, manifest);
  const imagePaths = new Set<string>();
  const chapters: ParsedChapter[] = [];
  let hasText = false;

  for (const spinePath of spinePaths) {
    const doc = parseXhtml(await zip.text(spinePath));
    const body = bodyOf(doc);
    if (!body) continue;

    const fileEntries = toc.filter((entry) => entry.path === spinePath);
    const tocSplit = tocSplitPoints(body, fileEntries);
    const splitAt = tocSplit ?? headingSplitPoints(body);
    const segments = mergeStubSegments(convertBody(body, {
      splitAt,
      resolveImage: (src) => {
        const { path } = resolvePath(dirname(spinePath), src);
        if (!zip.has(path)) return undefined;
        imagePaths.add(path);
        return path;
      },
    }));

    // When the TOC split the file, its fragment entries title the later
    // segments; only an entry for the whole file can title the first.
    const fileTitle = shallowestEntry(tocSplit ? fileEntries.filter((entry) => !entry.fragment) : fileEntries)?.label;

    segments.forEach((segment, index) => {
      if (segment.blocks.length === 0) return;
      hasText ||= segmentHasText(segment);
      chapters.push({
        title: segment.title
          ?? (index === 0 ? fileTitle : undefined)
          ?? firstHeading(segment)
          ?? fallbackTitle(segment, chapters[chapters.length - 1]),
        content: segmentContent(segment),
      });
    });
  }

  if (!hasText) {
    throw new EpubError('no readable text found in this EPUB');
  }

  const mediaTypes = new Map([...manifest.values()].map((item) => [item.path, item.mediaType]));
  const assets: ParsedAsset[] = [];
  for (const path of imagePaths) {
    assets.push({
      path,
      mediaType: mediaTypes.get(path) || IMAGE_TYPES[extension(path)] || 'application/octet-stream',
      bytes: await zip.bytes(path),
    });
  }

  const metadataText = (name: string) =>
    elementsByLocalName(opf, name)
      .map((el) => collapseWhitespace(el.textContent ?? '').replace(/[\s;,]+$/, ''))
      .filter(Boolean);

  return {
    title: metadataText('title')[0] ?? 'Untitled',
    author: metadataText('creator').join(', ') || undefined,
    chapters,
    assets,
  };
}

async function rejectDrm(zip: ZipArchive): Promise<void> {
  if (zip.has('META-INF/rights.xml')) throw new EpubError('this EPUB is DRM-protected');
  if (!zip.has('META-INF/encryption.xml')) return;

  // encryption.xml is also used for harmless font obfuscation; anything else
  // encrypted means DRM.
  const encryption = parseXml(await zip.text('META-INF/encryption.xml'), 'encryption.xml');
  const isDrm = elementsByLocalName(encryption, 'encrypteddata').some((data) => {
    const algorithm = firstByLocalName(data, 'encryptionmethod')?.getAttribute('Algorithm') ?? '';
    const uri = firstByLocalName(data, 'cipherreference')?.getAttribute('URI') ?? '';
    return !FONT_OBFUSCATION.has(algorithm) && !FONT_PATH.test(uri);
  });
  if (isDrm) throw new EpubError('this EPUB is DRM-protected');
}

async function findPackagePath(zip: ZipArchive): Promise<string> {
  if (!zip.has('META-INF/container.xml')) throw new EpubError('missing META-INF/container.xml');
  const container = parseXml(await zip.text('META-INF/container.xml'), 'container.xml');
  const path = firstByLocalName(container, 'rootfile')?.getAttribute('full-path');
  if (!path || !zip.has(path)) throw new EpubError('missing package document');
  return path;
}

async function readToc(zip: ZipArchive, opf: Document, manifest: Map<string, ManifestItem>): Promise<TocEntry[]> {
  const items = [...manifest.values()];

  const nav = items.find((item) => item.properties.includes('nav'));
  if (nav && zip.has(nav.path)) {
    const entries = readNavToc(parseXhtml(await zip.text(nav.path)), dirname(nav.path));
    if (entries.length > 0) return entries;
  }

  const spine = firstByLocalName(opf, 'spine');
  const ncx = manifest.get(spine?.getAttribute('toc') ?? '') ?? items.find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncx && zip.has(ncx.path)) {
    return readNcxToc(parseXml(await zip.text(ncx.path), 'NCX table of contents'), dirname(ncx.path));
  }
  return [];
}

function readNavToc(doc: Document, baseDir: string): TocEntry[] {
  const navs = elementsByLocalName(doc, 'nav');
  const tocNav = navs.find((nav) => (nav.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc')) ?? navs[0];
  const list = tocNav && childElements(tocNav).find((el) => localName(el) === 'ol');
  if (!list) return [];

  const entries: TocEntry[] = [];
  const walk = (ol: Element, depth: number) => {
    for (const li of childElements(ol).filter((el) => localName(el) === 'li')) {
      const children = childElements(li);
      const link = children.find((el) => localName(el) === 'a');
      const href = link?.getAttribute('href');
      const label = collapseWhitespace(link?.textContent ?? '');
      if (href && label) entries.push({ ...resolvePath(baseDir, href), label, depth });
      const nested = children.find((el) => localName(el) === 'ol');
      if (nested) walk(nested, depth + 1);
    }
  };
  walk(list, 0);
  return entries;
}

function readNcxToc(doc: Document, baseDir: string): TocEntry[] {
  const navMap = firstByLocalName(doc, 'navmap');
  if (!navMap) return [];

  const entries: TocEntry[] = [];
  const walk = (parent: Element, depth: number) => {
    for (const point of childElements(parent).filter((el) => localName(el) === 'navpoint')) {
      const children = childElements(point);
      const labelEl = children.find((el) => localName(el) === 'navlabel');
      const label = collapseWhitespace(labelEl?.textContent ?? '');
      const src = children.find((el) => localName(el) === 'content')?.getAttribute('src');
      if (src && label) entries.push({ ...resolvePath(baseDir, src), label, depth });
      walk(point, depth + 1);
    }
  };
  walk(navMap, 0);
  return entries;
}

/**
 * Split a spine file at TOC anchors when its shallowest TOC entries point at
 * two or more fragments inside it (typical of Gutenberg-style single-file books).
 * Deeper entries (sections nested under a chapter) never split.
 */
function tocSplitPoints(body: Element, entries: TocEntry[]): Map<Element, string> | undefined {
  if (entries.length === 0) return undefined;
  const minDepth = Math.min(...entries.map((entry) => entry.depth));
  const anchors = new Map<string, string>();
  for (const entry of entries) {
    if (entry.depth === minDepth && entry.fragment && !anchors.has(entry.fragment)) {
      anchors.set(entry.fragment, entry.label);
    }
  }
  if (anchors.size < 2) return undefined;

  const points = new Map<Element, string>();
  for (const el of Array.from(body.getElementsByTagName('*'))) {
    const id = el.getAttribute('id');
    const label = id ? anchors.get(id) : undefined;
    if (label) points.set(el, label);
  }
  return points.size >= 2 ? points : undefined;
}

/**
 * Reader's fallback for monolithic files without a usable TOC: split at
 * top-level h1–h3 when there are at least two of them.
 */
function headingSplitPoints(body: Element): Map<Element, string> | undefined {
  if ((body.textContent ?? '').length < MONOLITHIC_CHAPTER_CHARS) return undefined;
  const headings = childElements(body).filter((el) => /^h[1-3]$/.test(localName(el)));
  if (headings.length < 2) return undefined;
  return new Map(headings.map((el) => [el, collapseWhitespace(el.textContent ?? '') || 'Untitled']));
}

const normalizeTitle = (text: string) => text.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A segment holding nothing but its own title. */
function isTitleStub(segment: ContentSegment): boolean {
  const title = segment.title && normalizeTitle(segment.title);
  return !!title && segment.blocks.every((block) => normalizeTitle(block) === title);
}

/**
 * Merge title-only stubs into the following segment. Some TOCs list a title and
 * its byline as separate entries into the same file (JEP does), which would
 * otherwise split an article into a one-line chapter and the body.
 */
export function mergeStubSegments(segments: ContentSegment[]): ContentSegment[] {
  const merged: ContentSegment[] = [];
  let pending: ContentSegment | undefined;
  for (const segment of segments) {
    const current: ContentSegment = pending
      ? {
          title: [pending.title, segment.title].filter(Boolean).join(' — ') || undefined,
          blocks: [...pending.blocks, ...segment.blocks],
        }
      : segment;
    pending = undefined;
    if (isTitleStub(current)) pending = current;
    else merged.push(current);
  }
  if (pending) merged.push(pending);
  return merged;
}

/** The shallowest entry, preferring one that points at the whole file. */
function shallowestEntry(entries: TocEntry[]): TocEntry | undefined {
  return entries.reduce<TocEntry | undefined>(
    (best, entry) =>
      !best || entry.depth < best.depth || (entry.depth === best.depth && !entry.fragment && best.fragment) ? entry : best,
    undefined,
  );
}

/** Untitled files are usually a cover, or a long chapter continuing across files. */
function fallbackTitle(segment: ContentSegment, previous: ParsedChapter | undefined): string {
  if (!previous) return segmentHasText(segment) ? 'Start' : 'Cover';
  return `${previous.title.replace(/ \(continued\)$/, '')} (continued)`;
}

function firstHeading(segment: ContentSegment): string | undefined {
  const heading = segment.blocks.find((block) => /^#{1,6}\s/.test(block));
  return heading?.replace(/^#{1,6}\s+/, '');
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function extension(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

/** Resolve an href relative to a directory inside the archive. */
export function resolvePath(baseDir: string, href: string): { path: string; fragment?: string } {
  const hashIndex = href.indexOf('#');
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? undefined : decodeSafely(href.slice(hashIndex + 1)) || undefined;

  const parts = rawPath.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const segment of decodeSafely(rawPath).split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return { path: parts.join('/'), fragment };
}

function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Turns a set of Markdown files (a zipped folder, a picked folder, or several
// picked files) into one book: a chapter per file, ordered by path with each
// folder's index first, and the images they reference as assets.

import { EpubError, resolvePath, type ParsedAsset, type ParsedBook } from '../epub/parse';
import { decodeText } from '../epub/zip';
import { convertMarkdown, markdownTitle } from './convert';

const MARKDOWN = /\.(md|markdown|mdown)$/i;
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
};
/** Folders that hold tooling or dependencies, never notes. */
const IGNORED_FOLDERS = new Set(['node_modules', '__pycache__', '__MACOSX', 'site-packages', 'venv', 'target', 'dist', 'build']);
const INDEX_NAMES = /^(\d*[-_ ]*)?(index|readme|_index|home)$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN.test(path);
}

export function imageMediaType(path: string): string | undefined {
  return IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
}

/** Paths worth importing: no hidden folders or dependency trees. */
export function isIncluded(path: string): boolean {
  const segments = path.split('/');
  return segments.every((segment, i) => !(segment.startsWith('.') || (i < segments.length - 1 && IGNORED_FOLDERS.has(segment))));
}

const baseName = (path: string) => path.split('/').pop()!.replace(MARKDOWN, '');
const dirName = (path: string) => path.split('/').slice(0, -1).join('/');

/**
 * Reading order: a folder's files before its subfolders, an index or README
 * first, then names in natural order (so `2-` comes before `10-`).
 */
export function compareReadingOrder(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const aFile = i === as.length - 1;
    const bFile = i === bs.length - 1;
    if (as[i] === bs[i] && !aFile && !bFile) continue;
    if (aFile !== bFile) return aFile ? -1 : 1;
    if (aFile && bFile) {
      const aIndex = INDEX_NAMES.test(baseName(a));
      const bIndex = INDEX_NAMES.test(baseName(b));
      if (aIndex !== bIndex) return aIndex ? -1 : 1;
    }
    return as[i]!.localeCompare(bs[i]!, undefined, { numeric: true, sensitivity: 'base' });
  }
  return as.length - bs.length;
}

/** The folder every path sits inside, if they share one (a zipped folder's top level). */
function commonRoot(paths: string[]): string {
  const first = paths[0]!.split('/');
  let depth = first.length - 1;
  for (const path of paths) {
    const segments = path.split('/');
    let shared = 0;
    while (shared < depth && shared < segments.length - 1 && segments[shared] === first[shared]) shared++;
    depth = shared;
  }
  return first.slice(0, depth).join('/');
}

/**
 * Build a book from Markdown files keyed by path. `name` (the zip or folder
 * name) titles the book when it has no root index with a title.
 */
export async function parseMarkdownBook(files: Map<string, Uint8Array>, name: string): Promise<ParsedBook> {
  const paths = [...files.keys()].filter((path) => isMarkdownPath(path) && isIncluded(path)).sort(compareReadingOrder);
  if (paths.length === 0) throw new EpubError('no Markdown files found');

  const root = commonRoot(paths);
  const relative = (path: string) => (root ? path.slice(root.length + 1) : path);
  const sources = new Map(paths.map((path) => [path, decodeText(files.get(path)!)]));
  const titles = new Map(paths.map((path) => [path, markdownTitle(sources.get(path)!) ?? baseName(path)]));

  // Wikilinks name files without folder or extension; embeds name images the same way.
  const byBaseName = new Map<string, string>();
  for (const path of paths) byBaseName.set(baseName(path).toLowerCase(), path);
  const imagesByName = new Map<string, string>();
  for (const path of files.keys()) if (imageMediaType(path)) imagesByName.set(path.split('/').pop()!.toLowerCase(), path);

  const used = new Set<string>();
  const chapters = paths.map((path) => {
    const converted = convertMarkdown(sources.get(path)!, {
      linkTitle: (target) => {
        const linked = byBaseName.get(target.replace(MARKDOWN, '').split('/').pop()!.toLowerCase());
        return linked ? titles.get(linked) : undefined;
      },
      resolveImage: (src) => {
        if (/^[a-z]+:/i.test(src)) return undefined; // remote images aren't available offline
        const direct = resolvePath(dirName(path), src.split('?')[0]!).path;
        const found = files.has(direct) && imageMediaType(direct) ? direct : imagesByName.get(src.split('/').pop()!.toLowerCase());
        if (found) used.add(found);
        return found;
      },
    });
    const folder = dirName(relative(path));
    const title = converted.title ?? baseName(path);
    return { title: folder ? `${folder.replaceAll('/', ' / ')} · ${title}` : title, content: converted.content };
  });

  const assets: ParsedAsset[] = [...used].map((path) => ({ path, mediaType: imageMediaType(path)!, bytes: files.get(path)! }));
  const rootIndex = paths.find((path) => dirName(relative(path)) === '' && INDEX_NAMES.test(baseName(path)));
  const fallback = root.split('/').pop() || name || chapters[0]!.title;
  return {
    title: (rootIndex && markdownTitle(sources.get(rootIndex)!)) || fallback,
    chapters,
    assets,
  };
}

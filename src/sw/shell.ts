// What the offline shell is: the HTML page plus every same-origin file it
// references (Bun's content-hashed script and stylesheet chunks, the icon and
// the manifest). Shared by the service worker and its tests.

export const SHELL_PATH = '/';
export const SHELL_CACHE = 'reader-lite-shell';

/** Same-origin paths in the page's src and href attributes, in order, without repeats. */
export function shellAssetPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/\b(?:src|href)=["'](\/(?!\/)[^"'?#]*)/g)) {
    if (match[1] !== SHELL_PATH) paths.add(match[1]!);
  }
  return [...paths];
}

/** Content-hashed chunks never change under the same name, so a cached copy can be reused. */
export function isHashedChunk(path: string): boolean {
  return /-[a-z0-9]{8,}\.[a-z0-9]+$/.test(path);
}

export type WorkerMessage = { type: 'check-update'; scriptPath: string };
export type PageMessage = { type: 'update-ready' };

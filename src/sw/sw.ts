// The service worker: the app opens from its cached shell straight away,
// whether or not the desktop serving it is awake, and refreshes the shell in
// the background. Pages ask whether a newer version is cached and offer a
// reload; they are never swapped out from under the reader.

import { isHashedChunk, SHELL_CACHE, SHELL_PATH, shellAssetPaths, type PageMessage, type WorkerMessage } from './shell';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') {
    // Every path is the app (hash routes); the cached page answers at once.
    event.respondWith(cached(SHELL_PATH).then((response) => response ?? fetch(request)));
    event.waitUntil(refreshShell().catch(() => undefined));
    return;
  }
  event.respondWith(cached(url.pathname).then((response) => response ?? fetch(request)));
});

self.addEventListener('message', (event) => {
  const message = event.data as WorkerMessage;
  if (message?.type !== 'check-update') return;
  const source = event.source as Client | null;
  event.waitUntil(
    refreshShell()
      .catch(() => undefined)
      .then(async () => {
        const html = await (await cached(SHELL_PATH))?.text();
        // The cached page no longer loads the script this page is running.
        if (html && !shellAssetPaths(html).includes(message.scriptPath)) {
          source?.postMessage({ type: 'update-ready' } satisfies PageMessage);
        }
      }),
  );
});

async function cached(path: string): Promise<Response | undefined> {
  const cache = await caches.open(SHELL_CACHE);
  return cache.match(path);
}

let refreshing: Promise<void> | null = null;

/** Fetch the page; if it changed, cache everything it needs, then switch to it. */
function refreshShell(): Promise<void> {
  refreshing ??= (async () => {
    const response = await fetch(SHELL_PATH, { cache: 'no-store' });
    if (!response.ok) return;
    const html = await response.text();
    const cache = await caches.open(SHELL_CACHE);
    if ((await (await cache.match(SHELL_PATH))?.text()) === html) return;

    // Fetch everything before caching anything, so a failed update never
    // leaves a page whose scripts are missing.
    const paths = shellAssetPaths(html);
    const fetched: [string, Response][] = [];
    for (const path of paths) {
      if (isHashedChunk(path) && (await cache.match(path))) continue;
      const asset = await fetch(path, { cache: 'no-store' });
      if (!asset.ok) throw new Error(`${path}: ${asset.status}`);
      fetched.push([path, asset]);
    }
    for (const [path, asset] of fetched) await cache.put(path, asset);
    await cache.put(SHELL_PATH, new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } }));

    const keep = new Set([SHELL_PATH, ...paths].map((path) => new URL(path, self.location.origin).href));
    for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

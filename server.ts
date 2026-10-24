import index from './index.html';

// Bind to loopback only; the iPad reaches this through `tailscale serve`.
const hostname = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 5418);
const development = process.env.NODE_ENV !== 'production';

// In development the service worker would serve a stale cached build over
// hot reloading, so dev serves one that removes itself.
const RETIRE_WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll())
    .then((clients) => clients.forEach((client) => client.navigate(client.url)))
));`;

async function serviceWorker(): Promise<string> {
  if (development) return RETIRE_WORKER;
  const build = await Bun.build({ entrypoints: ['./src/sw/sw.ts'], target: 'browser', minify: true });
  if (!build.success) throw new AggregateError(build.logs, 'service worker build failed');
  return build.outputs[0]!.text();
}

const noCache = { 'Cache-Control': 'no-cache' };
const publicFile = (name: string, type: string) =>
  new Response(Bun.file(`./public/${name}`), { headers: { 'Content-Type': type, ...noCache } });

const server = Bun.serve({
  hostname,
  port,
  development,
  routes: {
    '/sw.js': new Response(await serviceWorker(), { headers: { 'Content-Type': 'text/javascript;charset=utf-8', ...noCache } }),
    '/apple-touch-icon.png': publicFile('apple-touch-icon.png', 'image/png'),
    '/icon-512.png': publicFile('icon-512.png', 'image/png'),
    '/*': index,
  },
});

console.log(`reader-lite on ${server.url} (${development ? 'dev' : 'prod'})`);

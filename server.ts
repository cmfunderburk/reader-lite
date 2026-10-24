import index from './index.html';

// Bind to loopback only; the iPad reaches this through `tailscale serve`.
const hostname = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 5418);
const development = process.env.NODE_ENV !== 'production';

const server = Bun.serve({
  hostname,
  port,
  development,
  routes: {
    '/*': index,
  },
});

console.log(`reader-lite on ${server.url} (${development ? 'dev' : 'prod'})`);

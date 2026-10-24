import { describe, expect, it } from 'bun:test';
import { isHashedChunk, shellAssetPaths } from './shell';

describe('shellAssetPaths', () => {
  it("lists the page's same-origin files once each, skipping external and protocol-relative ones", () => {
    const html = `<link rel="manifest" href="/manifest-d3b80few.webmanifest" />
      <link rel="apple-touch-icon" href="/apple-touch-icon-5pjpccfz.png" />
      <link rel="stylesheet" crossorigin href="/chunk-x375vje8.css">
      <link rel="preconnect" href="https://example.com/">
      <script src="//cdn.example.com/x.js"></script>
      <script type="module" crossorigin src="/chunk-aj27mrxp.js?v=1"></script>
      <a href="/">home</a><img src='/chunk-x375vje8.css'>`;
    expect(shellAssetPaths(html)).toEqual([
      '/manifest-d3b80few.webmanifest',
      '/apple-touch-icon-5pjpccfz.png',
      '/chunk-x375vje8.css',
      '/chunk-aj27mrxp.js',
    ]);
  });

  it('recognises content-hashed chunks', () => {
    expect(isHashedChunk('/chunk-aj27mrxp.js')).toBe(true);
    expect(isHashedChunk('/apple-touch-icon-5pjpccfz.png')).toBe(true);
    expect(isHashedChunk('/apple-touch-icon.png')).toBe(false);
  });
});

import { expect, test } from 'bun:test';
import { ZipArchive } from './zip';
import { buildStoredZip, crc32 } from './zipWriter';

test('crc32 matches the standard check value', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});

test('stored zips round-trip through the reader, with UTF-8 names', async () => {
  const zip = ZipArchive.open(
    buildStoredZip([
      { name: 'notes/ünïcode.md', data: new TextEncoder().encode('# Hi') },
      { name: 'notes/img.png', data: new Uint8Array([1, 2, 3]) },
    ]),
  );
  expect(zip.names()).toEqual(['notes/ünïcode.md', 'notes/img.png']);
  expect(await zip.text('notes/ünïcode.md')).toBe('# Hi');
  expect([...(await zip.bytes('notes/img.png'))]).toEqual([1, 2, 3]);
});

import { describe, expect, test } from 'bun:test';
import { buildZip } from '../../test/epub-builder';
import { ZipArchive, ZipError, decodeText } from './zip';

describe('ZipArchive', () => {
  test('reads stored and deflated entries, skipping directories', async () => {
    const zip = ZipArchive.open(
      await buildZip([
        { name: 'dir/', data: '' },
        { name: 'stored.txt', data: 'plain' },
        { name: 'dir/deflated.txt', data: 'squeezed '.repeat(50), deflate: true },
      ]),
    );
    expect(zip.names()).toEqual(['stored.txt', 'dir/deflated.txt']);
    expect(await zip.text('stored.txt')).toBe('plain');
    expect(await zip.text('dir/deflated.txt')).toBe('squeezed '.repeat(50));
  });

  test('rejects data that is not a ZIP', () => {
    expect(() => ZipArchive.open(new TextEncoder().encode('definitely not a zip file'))).toThrow(ZipError);
  });

  test('reports missing entries', async () => {
    const zip = ZipArchive.open(await buildZip([{ name: 'a', data: 'x' }]));
    expect(zip.has('b')).toBe(false);
    await expect(zip.bytes('b')).rejects.toThrow('missing entry: b');
  });
});

describe('decodeText', () => {
  test('defaults to UTF-8', () => {
    expect(decodeText(new TextEncoder().encode('café'))).toBe('café');
  });

  test('honours a declared single-byte encoding', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?>caf'), 0xe9]);
    expect(decodeText(bytes).endsWith('café')).toBe(true);
  });
});

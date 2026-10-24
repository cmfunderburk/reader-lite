import { describe, expect, test } from 'bun:test';
import { buildEpub } from '../../test/epub-builder';
import { EpubError, parseEpub, resolvePath } from './parse';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('parseEpub', () => {
  test('reads metadata, spine order and EPUB 3 nav titles', async () => {
    const book = await parseEpub(
      await buildEpub({
        title: 'A Book',
        author: 'Some Author',
        chapters: [
          ['text/one.xhtml', '<h1>Heading One</h1><p>First.</p>'],
          ['text/two.xhtml', '<p>Second.</p>'],
        ],
        nav: '<li><a href="text/one.xhtml">Chapter One</a></li><li><a href="text/two.xhtml">Chapter Two</a></li>',
      }),
    );
    expect(book.title).toBe('A Book');
    expect(book.author).toBe('Some Author');
    expect(book.chapters).toEqual([
      { title: 'Chapter One', content: '# Heading One\n\nFirst.' },
      { title: 'Chapter Two', content: 'Second.' },
    ]);
  });

  test('falls back to the EPUB 2 NCX table of contents', async () => {
    const book = await parseEpub(
      await buildEpub({
        chapters: [['c1.xhtml', '<p>Text.</p>']],
        ncx: '<navPoint id="n1"><navLabel><text>From NCX</text></navLabel><content src="c1.xhtml"/></navPoint>',
      }),
    );
    expect(book.title).toBe('Untitled');
    expect(book.chapters[0]?.title).toBe('From NCX');
  });

  test('splits a single-file book at top-level TOC fragments', async () => {
    const book = await parseEpub(
      await buildEpub({
        chapters: [['all.xhtml', '<p>Front matter.</p><h2 id="c1">I</h2><p>One.</p><h2 id="c2">II</h2><p>Two.</p>']],
        nav: '<li><a href="all.xhtml#c1">Chapter I</a></li><li><a href="all.xhtml#c2">Chapter II</a></li>',
      }),
    );
    expect(book.chapters.map((c) => c.title)).toEqual(['Start', 'Chapter I', 'Chapter II']);
    expect(book.chapters[1]?.content).toBe('## I\n\nOne.');
  });

  test('does not split at nested section entries', async () => {
    const book = await parseEpub(
      await buildEpub({
        chapters: [['ch1.xhtml', '<h1>Ch 1</h1><h2 id="s1">1.1</h2><p>a</p><h2 id="s2">1.2</h2><p>b</p>']],
        nav: '<li><a href="ch1.xhtml">Chapter 1</a><ol><li><a href="ch1.xhtml#s1">1.1</a></li><li><a href="ch1.xhtml#s2">1.2</a></li></ol></li>',
      }),
    );
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1']);
  });

  test('names untitled files as cover or continuation and skips non-linear items', async () => {
    const book = await parseEpub(
      await buildEpub({
        chapters: [
          ['cover.xhtml', '<img src="cover.png"/>'],
          ['a.xhtml', '<p>Start of a long chapter.</p>'],
          ['a2.xhtml', '<p>More of it.</p>'],
          ['notes.xhtml', '<p>Hidden notes.</p>'],
        ],
        nav: '<li><a href="a.xhtml">Long Chapter</a></li>',
        spineAttributes: { 'notes.xhtml': 'linear="no"' },
        extraManifest: '<item id="img" href="cover.png" media-type="image/png"/>',
        extraFiles: [{ name: 'OEBPS/cover.png', data: PNG }],
      }),
    );
    expect(book.chapters.map((c) => c.title)).toEqual(['Cover', 'Long Chapter', 'Long Chapter (continued)']);
    expect(book.assets).toEqual([{ path: 'OEBPS/cover.png', mediaType: 'image/png', bytes: PNG }]);
  });

  test('rejects DRM-protected books but allows font obfuscation', async () => {
    const encryption = (uri: string, algorithm: string) => ({
      name: 'META-INF/encryption.xml',
      data: `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`,
    });
    const chapters: Array<[string, string]> = [['c.xhtml', '<p>Text.</p>']];
    const aes = 'http://www.w3.org/2001/04/xmlenc#aes128-cbc';

    await expect(parseEpub(await buildEpub({ chapters, extraFiles: [encryption('OEBPS/c.xhtml', aes)] }))).rejects.toThrow(
      'DRM-protected',
    );
    for (const file of [
      encryption('OEBPS/fonts/a.ttc', 'http://www.idpf.org/2008/embedding'),
      encryption('fonts/b.bin', 'http://ns.adobe.com/pdf/enc#RC'),
      encryption('OEBPS/fonts/c.otf', aes),
    ]) {
      const book = await parseEpub(await buildEpub({ chapters, extraFiles: [file] }));
      expect(book.chapters).toHaveLength(1);
    }
  });

  test('rejects files that are not EPUBs or have no text', async () => {
    await expect(parseEpub(new TextEncoder().encode('nope'))).rejects.toBeInstanceOf(EpubError);
    await expect(parseEpub(await buildEpub({ chapters: [['c.xhtml', '<p>  </p>']] }))).rejects.toThrow('no readable text');
  });
});

describe('resolvePath', () => {
  test('resolves relative paths, fragments and escapes', () => {
    expect(resolvePath('OEBPS/text', '../images/a%20b.png')).toEqual({ path: 'OEBPS/images/a b.png', fragment: undefined });
    expect(resolvePath('OEBPS', './ch1.xhtml#sec-2')).toEqual({ path: 'OEBPS/ch1.xhtml', fragment: 'sec-2' });
    expect(resolvePath('', 'content.opf')).toEqual({ path: 'content.opf', fragment: undefined });
  });
});

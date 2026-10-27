// Builds small in-memory EPUBs (as ZIP bytes) for tests.

export interface ZipFile {
  name: string;
  data: string | Uint8Array;
  deflate?: boolean;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Writes a ZIP. CRCs are left as zero: the reader under test doesn't check them. */
export async function buildZip(files: ZipFile[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const body = file.deflate ? await deflateRaw(raw) : raw;
    const method = file.deflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length + body.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(body, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const directorySize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + directorySize + eocd.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export interface EpubSpec {
  title?: string;
  author?: string;
  /** Spine documents in reading order: [path relative to OEBPS, body HTML]. */
  chapters: Array<[string, string]>;
  /** EPUB 3 nav <ol> contents, or omit for no nav. */
  nav?: string;
  /** EPUB 2 NCX <navMap> contents. */
  ncx?: string;
  extraFiles?: ZipFile[];
  extraManifest?: string;
  spineAttributes?: Record<string, string>;
}

export function xhtml(body: string): string {
  return `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head><body>${body}</body></html>`;
}

export async function buildEpub(spec: EpubSpec): Promise<Uint8Array> {
  const items = spec.chapters.map(([path], i) => `<item id="c${i}" href="${path}" media-type="application/xhtml+xml"/>`);
  if (spec.nav !== undefined) items.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  if (spec.ncx !== undefined) items.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  const spine = spec.chapters
    .map(([path], i) => `<itemref idref="c${i}"${spec.spineAttributes?.[path] ? ` ${spec.spineAttributes[path]}` : ''}/>`)
    .join('');

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>${spec.title ? `<dc:title>${spec.title}</dc:title>` : ''}${spec.author ? `<dc:creator>${spec.author}</dc:creator>` : ''}</metadata>
  <manifest>${items.join('')}${spec.extraManifest ?? ''}</manifest>
  <spine${spec.ncx !== undefined ? ' toc="ncx"' : ''}>${spine}</spine>
</package>`;

  const files: ZipFile[] = [
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      deflate: true,
    },
    { name: 'OEBPS/content.opf', data: opf, deflate: true },
    ...spec.chapters.map(([path, body]) => ({ name: `OEBPS/${path}`, data: xhtml(body), deflate: true })),
  ];
  if (spec.nav !== undefined) {
    files.push({ name: 'OEBPS/nav.xhtml', data: xhtml(`<nav epub:type="toc"><ol>${spec.nav}</ol></nav>`), deflate: true });
  }
  if (spec.ncx !== undefined) {
    files.push({
      name: 'OEBPS/toc.ncx',
      data: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${spec.ncx}</navMap></ncx>`,
    });
  }
  files.push(...(spec.extraFiles ?? []));
  return buildZip(files);
}

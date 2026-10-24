// Minimal read-only ZIP archive reader for EPUBs. Supports stored and
// deflated entries (all an EPUB uses); inflates with the platform's
// DecompressionStream, so it needs no dependencies.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  localHeaderOffset: number;
}

export class ZipError extends Error {}

export class ZipArchive {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private readonly entries = new Map<string, ZipEntry>();

  private constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.readCentralDirectory();
  }

  static open(data: ArrayBuffer | Uint8Array): ZipArchive {
    return new ZipArchive(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async bytes(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`missing entry: ${name}`);
    if (entry.flags & 0x1) throw new ZipError(`encrypted entry: ${name}`);

    const offset = entry.localHeaderOffset;
    if (this.view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
      throw new ZipError(`bad local header: ${name}`);
    }
    const nameLength = this.view.getUint16(offset + 26, true);
    const extraLength = this.view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    const raw = this.data.subarray(start, start + entry.compressedSize);

    if (entry.method === METHOD_STORED) return raw;
    if (entry.method === METHOD_DEFLATE) return inflateRaw(raw);
    throw new ZipError(`unsupported compression method ${entry.method}: ${name}`);
  }

  async text(name: string): Promise<string> {
    return decodeText(await this.bytes(name));
  }

  private readCentralDirectory(): void {
    const eocd = this.findEndOfCentralDirectory();
    const count = this.view.getUint16(eocd + 10, true);
    const directoryOffset = this.view.getUint32(eocd + 16, true);
    if (count === 0xffff || directoryOffset === 0xffffffff) {
      throw new ZipError('ZIP64 archives are not supported');
    }

    const nameDecoder = new TextDecoder('utf-8');
    let offset = directoryOffset;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > this.data.length || this.view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
        throw new ZipError('corrupt central directory');
      }
      const flags = this.view.getUint16(offset + 8, true);
      const method = this.view.getUint16(offset + 10, true);
      const compressedSize = this.view.getUint32(offset + 20, true);
      const nameLength = this.view.getUint16(offset + 28, true);
      const extraLength = this.view.getUint16(offset + 30, true);
      const commentLength = this.view.getUint16(offset + 32, true);
      const localHeaderOffset = this.view.getUint32(offset + 42, true);
      const name = nameDecoder.decode(this.data.subarray(offset + 46, offset + 46 + nameLength));

      if (!name.endsWith('/')) {
        this.entries.set(name, { name, method, flags, compressedSize, localHeaderOffset });
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
  }

  private findEndOfCentralDirectory(): number {
    const lowest = Math.max(0, this.data.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
    for (let offset = this.data.length - EOCD_MIN_SIZE; offset >= lowest; offset--) {
      if (this.view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
    }
    throw new ZipError('not a ZIP archive');
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode XML/XHTML bytes, honouring a BOM or an XML declaration's encoding. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);

  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = head.match(/^\s*<\?xml[^>]*encoding=["']([\w.-]+)["']/i)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // Unknown label: fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

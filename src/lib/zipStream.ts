/**
 * Streaming ZIP writing and reading for workspace backups.
 *
 * JSZip keeps every entry (and the whole archive while loading) in the page's
 * memory, and the old export serialized the whole workspace into one string
 * first. At archive scale that is several copies of a few hundred megabytes in
 * one tab. These helpers keep memory bounded to one chunk at a time:
 *
 * - `StreamingZipWriter` deflates each entry through `CompressionStream`
 *   (deflate-raw) as it is produced and keeps the compressed output as Blob
 *   parts (Blob bytes live outside the JS heap and may be paged to disk);
 *   the archive is one Blob assembled from those parts.
 * - `openZip` reads only the central directory of a File/Blob; entries are
 *   read on demand from slices of the file (`DecompressionStream` for
 *   deflated entries, a zero-copy slice for stored ones).
 *
 * Plain PKZIP (no ZIP64): archives stay below 4 GiB. Archives written by JSZip
 * (older backups, including ones with data descriptors) read the same way,
 * because sizes and offsets come from the central directory. Works in browsers
 * and in Node 22 (Blob, CompressionStream and DecompressionStream are global).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (PKZIP), continuing from `previous` for incremental use. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Largest archive these helpers write or read (no ZIP64). */
export const ZIP32_LIMIT = 0xffff_fff0;
const BLOB_PART_BYTES = 8 * 1024 * 1024;

function dosDateTime(date: Date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() >> 1) & 31);
  const day = (((Math.max(1980, date.getFullYear()) - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

class ByteWriter {
  private view: DataView;
  readonly bytes: Uint8Array;
  private offset = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(value: number) { this.view.setUint16(this.offset, value, true); this.offset += 2; return this; }
  u32(value: number) { this.view.setUint32(this.offset, value >>> 0, true); this.offset += 4; return this; }
  raw(value: Uint8Array) { this.bytes.set(value, this.offset); this.offset += value.length; return this; }
}

export type ZipEntryInfo = { name: string; method: 0 | 8; crc: number; size: number; compressedSize: number; offset: number };

/** Collects compressed output into Blob parts of bounded size. */
class BlobSink {
  private parts: Blob[] = [];
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  bytes = 0;
  push(chunk: Uint8Array) {
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    this.bytes += chunk.length;
    if (this.pendingBytes >= BLOB_PART_BYTES) this.flush();
  }
  flush() {
    if (!this.pending.length) return;
    this.parts.push(new Blob(this.pending as BlobPart[]));
    this.pending = [];
    this.pendingBytes = 0;
  }
  blob() {
    this.flush();
    return new Blob(this.parts);
  }
}

export type EntrySource = Uint8Array | Blob | AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

async function* iterate(source: EntrySource): AsyncIterable<Uint8Array> {
  if (source instanceof Uint8Array) { yield source; return; }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    for (let start = 0; start < source.size; start += BLOB_PART_BYTES) yield new Uint8Array(await source.slice(start, start + BLOB_PART_BYTES).arrayBuffer());
    return;
  }
  for await (const chunk of source as AsyncIterable<Uint8Array>) yield chunk;
}

/** Writes a ZIP archive entry by entry; `finish()` returns the archive as a Blob. */
export class StreamingZipWriter {
  private parts: Blob[] = [];
  private central: Uint8Array[] = [];
  private offset = 0;
  private names = new Set<string>();
  private readonly stamp = dosDateTime(new Date());
  readonly entries: ZipEntryInfo[] = [];

  get bytesWritten() { return this.offset; }

  /** Adds one entry. `observe` sees every uncompressed chunk (for hashing). */
  async add(name: string, source: EntrySource, options: { compress?: boolean; observe?: (chunk: Uint8Array) => void } = {}): Promise<ZipEntryInfo> {
    if (this.names.has(name)) throw new Error(`Duplicate archive entry ${name}.`);
    this.names.add(name);
    const compress = options.compress !== false;
    let crc = 0, size = 0;
    const sink = new BlobSink();
    if (compress) {
      const stream = new CompressionStream("deflate-raw");
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      const draining = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          sink.push(value);
        }
      })();
      try {
        for await (const chunk of iterate(source)) {
          if (!chunk.length) continue;
          crc = crc32(chunk, crc);
          size += chunk.length;
          options.observe?.(chunk);
          await writer.write(chunk);
        }
        await writer.close();
      } catch (error) {
        await writer.abort(error).catch(() => undefined);
        throw error;
      }
      await draining;
    } else {
      for await (const chunk of iterate(source)) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        options.observe?.(chunk);
        sink.push(chunk);
      }
    }
    const data = sink.blob();
    const nameBytes = new TextEncoder().encode(name);
    const method = compress ? 8 : 0;
    const header = new ByteWriter(30 + nameBytes.length)
      .u32(0x04034b50).u16(20).u16(0x0800).u16(method).u16(this.stamp.time).u16(this.stamp.day)
      .u32(crc).u32(data.size).u32(size).u16(nameBytes.length).u16(0).raw(nameBytes);
    const info: ZipEntryInfo = { name, method, crc, size, compressedSize: data.size, offset: this.offset };
    if (this.offset + header.bytes.length + data.size > ZIP32_LIMIT || size > ZIP32_LIMIT) throw new Error("The archive would exceed the 4 GB ZIP limit.");
    this.parts.push(new Blob([header.bytes as BlobPart]), data);
    this.offset += header.bytes.length + data.size;
    this.central.push(new ByteWriter(46 + nameBytes.length)
      .u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(method).u16(this.stamp.time).u16(this.stamp.day)
      .u32(crc).u32(data.size).u32(size).u16(nameBytes.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(info.offset).raw(nameBytes).bytes);
    this.entries.push(info);
    return info;
  }

  finish(mimeType = "application/zip"): Blob {
    if (this.entries.length > 0xffff) throw new Error("The archive has too many entries.");
    const centralSize = this.central.reduce((sum, part) => sum + part.length, 0);
    const end = new ByteWriter(22).u32(0x06054b50).u16(0).u16(0).u16(this.entries.length).u16(this.entries.length).u32(centralSize).u32(this.offset).u16(0);
    return new Blob([...this.parts, new Blob(this.central as BlobPart[]), new Blob([end.bytes as BlobPart])], { type: mimeType });
  }
}

export type ZipReaderEntry = {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  dir: boolean;
};

export class ZipFormatError extends Error {}

/** Reads the central directory of a ZIP archive held in a Blob/File (nothing else is read). */
export async function openZip(file: Blob): Promise<Map<string, ZipReaderEntry>> {
  if (file.size < 22) throw new ZipFormatError("Not a ZIP archive.");
  const tailStart = Math.max(0, file.size - (0xffff + 22));
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tail[index] === 0x50 && tail[index + 1] === 0x4b && tail[index + 2] === 0x05 && tail[index + 3] === 0x06) { eocd = index; break; }
  }
  if (eocd < 0) throw new ZipFormatError("The ZIP end record is missing.");
  const end = new DataView(tail.buffer, tail.byteOffset + eocd, 22);
  const count = end.getUint16(10, true);
  const centralSize = end.getUint32(12, true);
  const centralOffset = end.getUint32(16, true);
  if (centralOffset === 0xffffffff || count === 0xffff) throw new ZipFormatError("ZIP64 archives are not supported.");
  if (centralOffset + centralSize > file.size) throw new ZipFormatError("The ZIP directory is outside the file.");
  const central = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipReaderEntry>();
  let position = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > central.length || view.getUint32(position, true) !== 0x02014b50) throw new ZipFormatError("The ZIP directory is damaged.");
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true);
    const compressedSize = view.getUint32(position + 20, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const name = decoder.decode(central.subarray(position + 46, position + 46 + nameLength));
    position += 46 + nameLength + extraLength + commentLength;
    if (entries.has(name)) throw new ZipFormatError("The ZIP contains a duplicate entry.");
    entries.set(name, { name, method, flags, crc, compressedSize, size, localOffset, dir: name.endsWith("/") });
  }
  return entries;
}

async function entryData(file: Blob, entry: ZipReaderEntry): Promise<Blob> {
  const header = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (header.byteLength < 30 || header.getUint32(0, true) !== 0x04034b50) throw new ZipFormatError("A ZIP entry header is damaged.");
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (start + entry.compressedSize > file.size) throw new ZipFormatError("A ZIP entry is truncated.");
  return file.slice(start, start + entry.compressedSize);
}

/** Streams an entry's uncompressed bytes in chunks. */
export async function* readZipEntryChunks(file: Blob, entry: ZipReaderEntry): AsyncIterable<Uint8Array> {
  const data = await entryData(file, entry);
  if (entry.method === 0) {
    for await (const chunk of iterate(data)) yield chunk;
    return;
  }
  if (entry.method !== 8) throw new ZipFormatError("A ZIP entry uses an unsupported compression method.");
  const stream = (data.stream() as unknown as ReadableStream<Uint8Array>).pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > entry.size) throw new ZipFormatError("A ZIP entry expands beyond its recorded size.");
      yield value;
    }
  } catch (error) {
    if (error instanceof ZipFormatError) throw error;
    throw new ZipFormatError("A ZIP entry could not be decompressed.");
  } finally {
    reader.releaseLock();
  }
}

/** An entry's bytes in one array (bounded entries only: manifests, record chunks). */
export async function readZipEntryBytes(file: Blob, entry: ZipReaderEntry, onChunk?: (chunk: Uint8Array) => void): Promise<Uint8Array> {
  const out = new Uint8Array(entry.size);
  let offset = 0;
  for await (const chunk of readZipEntryChunks(file, entry)) {
    if (offset + chunk.length > out.length) throw new ZipFormatError("A ZIP entry expands beyond its recorded size.");
    out.set(chunk, offset);
    offset += chunk.length;
    onChunk?.(chunk);
  }
  if (offset !== entry.size) throw new ZipFormatError("A ZIP entry is shorter than its recorded size.");
  return out;
}

/** An entry as a Blob: a zero-copy slice of the archive for stored entries. */
export async function readZipEntryBlob(file: Blob, entry: ZipReaderEntry, type = "application/octet-stream"): Promise<Blob> {
  if (entry.method === 0) {
    const data = await entryData(file, entry);
    return new Blob([data], { type });
  }
  const sink = new BlobSink();
  for await (const chunk of readZipEntryChunks(file, entry)) sink.push(chunk);
  const blob = sink.blob();
  return new Blob([blob], { type });
}

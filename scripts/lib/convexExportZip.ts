/**
 * Streaming reader for a Convex snapshot export ZIP (`npx convex export
 * --include-file-storage --path <zip>`).
 *
 * Layout, as the backend's own importer recognizes it (patterns from the
 * `convex-local-backend` binary that `npx convex dev --local` downloads; the
 * CLI only downloads the server-built ZIP, see
 * node_modules/convex/src/cli/lib/convexExport.ts and the `--format zip` help in
 * node_modules/convex/src/cli/lib/command.ts):
 *
 *   README.md                                   export notes
 *   <table>/documents.jsonl                     one JSON document per line (`_id`, `_creationTime`, fields)
 *   <table>/generated_schema.jsonl              line 1: inferred shape (a JSON string);
 *                                               further lines: `{ "<_id>": overrides }` for values plain
 *                                               JSON can't carry (int64, bytes, special floats)
 *   _storage/documents.jsonl                    file metadata: `_id`, `_creationTime`, `sha256` (base64), `size`, `contentType`
 *   _storage/<storageId>[.<ext>]                file bytes (the importer's pattern: optional prefix, `_storage/`, id, optional extension)
 *   _components/<name>/<table>/documents.jsonl  component tables (e.g. Better Auth), same layout, nested
 *
 * Reads only the central directory up front; entries are streamed from disk
 * (inflate for deflate entries) with CRC-32 checked, and ZIP64 is supported
 * because exports with files easily pass 4 GB or 65,535 entries.
 */
import { open, type FileHandle } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { createInflateRaw, crc32 } from "node:zlib";
import { createHash } from "node:crypto";

export type ZipEntry = { name: string; method: number; crc: number; compressedSize: number; size: number; localOffset: number };

const MAX32 = 0xffffffff;

export class ZipArchive {
  private constructor(readonly path: string, private readonly handle: FileHandle, readonly entries: Map<string, ZipEntry>, readonly directoryDigest: string) {}

  static async open(path: string): Promise<ZipArchive> {
    const handle = await open(path, "r");
    try {
      const { size } = await handle.stat();
      if (size < 22) throw new Error("Not a ZIP archive.");
      const tailLength = Math.min(size, 0xffff + 22 + 20);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);
      let eocd = -1;
      for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
      if (eocd < 0) throw new Error("The ZIP end record is missing.");
      let count = tail.readUInt16LE(eocd + 10);
      let directorySize = tail.readUInt32LE(eocd + 12);
      let directoryOffset = tail.readUInt32LE(eocd + 16);
      if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
        const record = Buffer.alloc(56);
        await handle.read(record, 0, 56, Number(tail.readBigUInt64LE(eocd - 20 + 8)));
        if (record.readUInt32LE(0) !== 0x06064b50) throw new Error("The ZIP64 end record is damaged.");
        count = Number(record.readBigUInt64LE(32));
        directorySize = Number(record.readBigUInt64LE(40));
        directoryOffset = Number(record.readBigUInt64LE(48));
      } else if (count === 0xffff || directoryOffset === MAX32) throw new Error("The ZIP64 locator is missing.");
      if (directoryOffset + directorySize > size) throw new Error("The ZIP directory is outside the file.");
      const directory = Buffer.alloc(directorySize);
      await handle.read(directory, 0, directorySize, directoryOffset);
      const entries = new Map<string, ZipEntry>();
      const digest = createHash("sha256");
      let position = 0;
      for (let index = 0; index < count; index++) {
        if (directory.readUInt32LE(position) !== 0x02014b50) throw new Error("The ZIP directory is damaged.");
        const method = directory.readUInt16LE(position + 10);
        const crc = directory.readUInt32LE(position + 16);
        let compressedSize = directory.readUInt32LE(position + 20);
        let uncompressed = directory.readUInt32LE(position + 24);
        const nameLength = directory.readUInt16LE(position + 28);
        const extraLength = directory.readUInt16LE(position + 30);
        const commentLength = directory.readUInt16LE(position + 32);
        let localOffset = directory.readUInt32LE(position + 42);
        const name = directory.toString("utf8", position + 46, position + 46 + nameLength);
        let extra = position + 46 + nameLength;
        const extraEnd = extra + extraLength;
        while (extra + 4 <= extraEnd) {
          const id = directory.readUInt16LE(extra);
          const length = directory.readUInt16LE(extra + 2);
          if (id === 0x0001) {
            let field = extra + 4;
            if (uncompressed === MAX32) { uncompressed = Number(directory.readBigUInt64LE(field)); field += 8; }
            if (compressedSize === MAX32) { compressedSize = Number(directory.readBigUInt64LE(field)); field += 8; }
            if (localOffset === MAX32) { localOffset = Number(directory.readBigUInt64LE(field)); }
          }
          extra += 4 + length;
        }
        position = extraEnd + commentLength;
        if (entries.has(name)) throw new Error(`The ZIP contains ${name} twice.`);
        if (!name.endsWith("/")) entries.set(name, { name, method, crc, compressedSize, size: uncompressed, localOffset });
        digest.update(`${name}\0${crc}\0${uncompressed}\n`);
      }
      return new ZipArchive(path, handle, entries, digest.digest("hex"));
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async close() { await this.handle.close(); }

  /** The entry's uncompressed bytes as a stream; the CRC-32 and size are checked at the end. */
  async stream(entry: ZipEntry): Promise<Readable> {
    const header = Buffer.alloc(30);
    await this.handle.read(header, 0, 30, entry.localOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`The ZIP header of ${entry.name} is damaged.`);
    const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (entry.method !== 0 && entry.method !== 8) throw new Error(`${entry.name} uses an unsupported compression method.`);
    const raw = entry.compressedSize === 0 ? Readable.from([]) : createReadStream(this.path, { start, end: start + entry.compressedSize - 1 });
    let crc = 0;
    let size = 0;
    const check = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        callback(null, chunk);
      },
      flush(callback) {
        callback(crc >>> 0 === entry.crc >>> 0 && size === entry.size ? null : new Error(`${entry.name} is corrupt (checksum or size mismatch).`));
      },
    });
    const source = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
    source.on("error", (error) => check.destroy(error));
    return source.pipe(check);
  }

  async bytes(entry: ZipEntry): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.stream(entry)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async *lines(entry: ZipEntry): AsyncGenerator<string> {
    const reader = createInterface({ input: await this.stream(entry), crlfDelay: Infinity });
    for await (const line of reader) if (line.trim()) yield line;
  }
}

export type ExportStorageFile = { id: string; sha256: string | null; size: number; contentType?: string; entry?: ZipEntry };
export type ExportLayout = {
  tables: Map<string, ZipEntry>;
  generatedSchemas: Map<string, ZipEntry>;
  storageMetadata?: ZipEntry;
  storageBlobs: Map<string, ZipEntry>;
  components: Set<string>;
  systemTables: Set<string>;
  unknown: string[];
};

const STORAGE_BLOB = /^_storage\/([^/.]+)(?:\.[^/]+)?$/;

/** Sorts entries into the documented layout; anything else is reported, never guessed at. */
export function exportLayout(archive: ZipArchive): ExportLayout {
  const layout: ExportLayout = { tables: new Map(), generatedSchemas: new Map(), storageBlobs: new Map(), components: new Set(), systemTables: new Set(), unknown: [] };
  for (const entry of archive.entries.values()) {
    const name = entry.name;
    if (name === "README.md") continue;
    const component = /^_components\/([^/]+)\//.exec(name);
    if (component) { layout.components.add(component[1]); continue; }
    if (name === "_storage/documents.jsonl") { layout.storageMetadata = entry; continue; }
    if (name === "_storage/generated_schema.jsonl") continue;
    const blob = STORAGE_BLOB.exec(name);
    if (blob) {
      if (layout.storageBlobs.has(blob[1])) throw new Error(`The export holds file ${blob[1]} twice.`);
      layout.storageBlobs.set(blob[1], entry);
      continue;
    }
    const table = /^([^/]+)\/(documents|generated_schema)\.jsonl$/.exec(name);
    if (table) {
      if (table[1].startsWith("_")) { layout.systemTables.add(table[1]); continue; }
      (table[2] === "documents" ? layout.tables : layout.generatedSchemas).set(table[1], entry);
      continue;
    }
    layout.unknown.push(name);
  }
  return layout;
}

/** Ids whose documents need generated-schema overrides (values plain JSON can't carry). */
export async function overriddenIds(archive: ZipArchive, entry: ZipEntry | undefined): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!entry) return ids;
  let first = true;
  for await (const line of archive.lines(entry)) {
    const value: unknown = JSON.parse(line);
    if (first) {
      first = false;
      if (typeof value !== "string") throw new Error(`${entry.name}: the first line must be the inferred shape string.`);
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${entry.name}: an override line is not an object.`);
    for (const id of Object.keys(value)) ids.add(id);
  }
  return ids;
}

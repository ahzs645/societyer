// Browser-side ZIP writer. Produces stored (uncompressed, method 0) archives,
// which is the format Word/PowerPoint/Excel actually require for their OOXML
// container parts — they decompress fine but break on some deflate variants.
// Stored is also dead simple to encode (no compressor in the bundle).
//
// Used by:
//   - lib/docx.ts (to assemble the .docx package)
//   - downloadStoredZip below (used by MeetingDetail's outbox-bundle export)
//
// File format reference: PKWARE APPNOTE.TXT, sections 4.3.7 (local header) and
// 4.3.12 (central directory header).

export function createStoredZip(files: Record<string, string | Uint8Array | ArrayBuffer | Blob>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = zipContentBytesSync(content, encoder);
    const crc = crc32(data);
    const localHeader = concatBytes(
      le32(0x04034b50),
      le16(20),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(crc),
      le32(data.length),
      le32(data.length),
      le16(nameBytes.length),
      le16(0),
      nameBytes,
    );
    const centralHeader = concatBytes(
      le32(0x02014b50),
      le16(20),
      le16(20),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(crc),
      le32(data.length),
      le32(data.length),
      le16(nameBytes.length),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(0),
      le32(offset),
      nameBytes,
    );
    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(...centralParts);
  const endOfCentralDirectory = concatBytes(
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(centralParts.length),
    le16(centralParts.length),
    le32(centralDirectory.length),
    le32(offset),
    le16(0),
  );

  return concatBytes(...localParts, centralDirectory, endOfCentralDirectory);
}

export function downloadStoredZip({
  filename,
  files,
}: {
  filename: string;
  files: Record<string, string | Uint8Array | ArrayBuffer | Blob>;
}) {
  const zipBytes = createStoredZip(files);
  const blob = new Blob([zipBytes], { type: "application/zip" });
  triggerBlobDownload(blob, ensureExtension(filename, "zip"));
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ensureExtension(filename: string, ext: string): string {
  const stripped = filename.replace(/\.(doc|docx|pdf|html?|rtf|odt|zip)$/i, "");
  return `${stripped}.${ext}`;
}

function zipContentBytesSync(content: string | Uint8Array | ArrayBuffer | Blob, encoder: TextEncoder) {
  if (typeof content === "string") return encoder.encode(content);
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  throw new Error("Blob ZIP entries must be converted to bytes before calling createStoredZip.");
}

function le16(value: number) {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function le32(value: number) {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

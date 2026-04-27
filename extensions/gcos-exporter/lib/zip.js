export function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = utf8(file.name);
    const data = file.data instanceof Uint8Array ? file.data : utf8(String(file.data ?? ""));
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
  return concatBytes(
    ...localParts,
    centralDirectory,
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(centralParts.length),
    le16(centralParts.length),
    le32(centralDirectory.length),
    le32(offset),
    le16(0),
  );
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function le16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function le32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(...parts) {
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

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

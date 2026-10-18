/** PDF readers accept the `%PDF-` header anywhere in the first 1024 bytes. */
export function hasPdfSignature(bytes: ArrayBuffer) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024));
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  }
  return false;
}

/** DOCX/XLSX are ZIP containers: local file header `PK\x03\x04`. */
export function hasZipSignature(bytes: ArrayBuffer) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  return head.length === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** Legacy Office (.doc, .xls, .ppt, .msg) compound file: D0 CF 11 E0. */
export function hasOleSignature(bytes: ArrayBuffer) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  return head.length === 4 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
}

export function imageMimeType(bytes: ArrayBuffer) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
  return undefined;
}

export function extensionOf(name: string | undefined) {
  return (name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export const LEGACY_LABELS: Record<string, string> = {
  doc: "Word 97–2003 (.doc)",
  xls: "Excel 97–2003 (.xls)",
  ppt: "PowerPoint 97–2003 (.ppt)",
  msg: "Outlook message (.msg)",
  pages: "Apple Pages",
};

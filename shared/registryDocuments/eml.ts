/**
 * Attachments of an RFC 822 email (.eml), for registry imports.
 *
 * `extractBytes` reads an .eml's headers and first text part only. The
 * Corporations Canada incorporation email carries the Corporation Information
 * Sheet and the Initial ISC filing as PDF attachments, so the import pulls
 * them out here and reads each as its own document.
 *
 * Only `application/pdf` parts (or parts named `*.pdf`) and attached messages
 * (`message/rfc822`) are returned; base64 and quoted-printable bodies are
 * decoded. Pure: no runtime imports.
 */

export type EmlAttachment = {
  /** The attachment's file name; attached messages always end in ".eml". */
  name: string;
  contentType: "application/pdf" | "message/rfc822";
  bytes: Uint8Array;
};

type MimeHeaders = Map<string, string>;

/** Most attachments one message may yield, and how deep multipart nesting is followed. */
const MAX_ATTACHMENTS = 20;
const MAX_DEPTH = 6;

/** Bytes as a string of char codes 0–255 (not windows-1252, which remaps 0x80–0x9F). */
function binaryString(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return out;
}

function binaryBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INDEX = new Map([...BASE64].map((char, index) => [char, index]));

/** Base64 to bytes, ignoring line breaks and anything else outside the alphabet. */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let length = 0;
  for (let index = 0; index + 1 < clean.length; index += 4) {
    const a = BASE64_INDEX.get(clean[index]) ?? 0;
    const b = BASE64_INDEX.get(clean[index + 1]) ?? 0;
    const c = index + 2 < clean.length ? BASE64_INDEX.get(clean[index + 2]) ?? 0 : -1;
    const d = index + 3 < clean.length ? BASE64_INDEX.get(clean[index + 3]) ?? 0 : -1;
    out[length++] = (a << 2) | (b >> 4);
    if (c >= 0) out[length++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[length++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, length);
}

/** Quoted-printable to bytes: soft line breaks removed, =XX decoded. */
export function decodeQuotedPrintableBytes(text: string): Uint8Array {
  const joined = text.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let index = 0; index < joined.length; index += 1) {
    const char = joined[index];
    const hex = char === "=" ? joined.slice(index + 1, index + 3) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      index += 2;
    } else {
      out.push(joined.charCodeAt(index) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.trim() || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** RFC 2047 encoded words in a header value ("=?utf-8?Q?Fiche_d=27information?="), in their own charset. */
export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, payload: string) => {
      const bytes = encoding.toUpperCase() === "B"
        ? decodeBase64(payload)
        : decodeQuotedPrintableBytes(payload.replace(/_/g, " "));
      return decodeCharset(bytes, charset.replace(/\*.*$/, ""));
    });
}

function parseHeaders(text: string): MimeHeaders {
  const headers: MimeHeaders = new Map();
  for (const line of text.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const match = /^([!-9;-~]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (!headers.has(name)) headers.set(name, match[2].trim());
  }
  return headers;
}

/** Header parameters, with RFC 2231 continuations (`filename*0*=`, `filename*1*=`) joined and decoded. */
function headerParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  type Pieces = { parts: Map<number, { text: string; encoded: boolean }>; charset?: string };
  const pieces = new Map<string, Pieces>();
  for (const match of value.matchAll(/;\s*([^=;\s]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/g)) {
    const rawName = match[1].toLowerCase();
    let raw = match[2].trim();
    if (raw.startsWith("\"")) raw = raw.slice(1, -1).replace(/\\(.)/g, "$1");
    const continued = /^(.+?)\*(\d+)(\*)?$/.exec(rawName);
    const extended = /^(.+?)\*$/.exec(rawName);
    if (continued || extended) {
      const name = (continued ?? extended)![1];
      const index = continued ? Number(continued[2]) : 0;
      const encoded = Boolean(continued ? continued[3] : extended);
      const entry: Pieces = pieces.get(name) ?? { parts: new Map() };
      let text = raw;
      if (encoded && index === 0) {
        const charsetMatch = /^([^']*)'[^']*'(.*)$/.exec(raw);
        if (charsetMatch) {
          entry.charset = charsetMatch[1] || "utf-8";
          text = charsetMatch[2];
        }
      }
      entry.parts.set(index, { text, encoded });
      pieces.set(name, entry);
    } else {
      params.set(rawName, decodeEncodedWords(raw));
    }
  }
  for (const [name, entry] of pieces) {
    const ordered = [...entry.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => part);
    const bytes: number[] = [];
    for (const part of ordered) {
      if (part.encoded) {
        for (let index = 0; index < part.text.length; index += 1) {
          const hex = part.text[index] === "%" ? part.text.slice(index + 1, index + 3) : "";
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
            bytes.push(parseInt(hex, 16));
            index += 2;
          } else bytes.push(part.text.charCodeAt(index) & 0xff);
        }
      } else {
        for (const char of new TextEncoder().encode(part.text)) bytes.push(char);
      }
    }
    params.set(name, decodeCharset(Uint8Array.from(bytes), entry.charset ?? "utf-8"));
  }
  return params;
}

function mediaType(headers: MimeHeaders): string {
  return (headers.get("content-type") ?? "text/plain").split(";")[0].trim().toLowerCase();
}

function decodeBody(body: string, headers: MimeHeaders): Uint8Array {
  const encoding = (headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
  if (encoding === "base64") return decodeBase64(body);
  if (encoding === "quoted-printable") return decodeQuotedPrintableBytes(body);
  return binaryBytes(body);
}

function splitHeaderAndBody(text: string): { header: string; body: string } {
  const match = /\r?\n\r?\n/.exec(text);
  if (!match) return { header: text, body: "" };
  return { header: text.slice(0, match.index), body: text.slice(match.index + match[0].length) };
}

/** The parts of a multipart body, between `--boundary` lines and before `--boundary--`. */
function multipartParts(body: string, boundary: string): string[] {
  const parts: string[] = [];
  const marker = `--${boundary}`;
  const lines = body.split(/\r?\n/);
  let current: string[] | null = null;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === `${marker}--`) {
      if (current) parts.push(current.join("\n"));
      current = null;
      break;
    }
    if (trimmed === marker) {
      if (current) parts.push(current.join("\n"));
      current = [];
      continue;
    }
    current?.push(line);
  }
  if (current) parts.push(current.join("\n"));
  return parts;
}

function safeFileName(name: string): string {
  // Keep the base name only, and never control characters.
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function collect(text: string, depth: number, out: EmlAttachment[]) {
  if (depth > MAX_DEPTH || out.length >= MAX_ATTACHMENTS) return;
  const { header, body } = splitHeaderAndBody(text);
  const headers = parseHeaders(header);
  const type = mediaType(headers);
  if (type.startsWith("multipart/")) {
    const boundary = headerParams(headers.get("content-type") ?? "").get("boundary");
    if (!boundary) return;
    for (const part of multipartParts(body, boundary)) collect(part, depth + 1, out);
    return;
  }
  // The top-level message body itself is never an attachment.
  if (depth === 0) return;
  const disposition = headers.get("content-disposition") ?? "";
  const named = headerParams(disposition).get("filename") ?? headerParams(headers.get("content-type") ?? "").get("name") ?? "";
  const fileName = safeFileName(named);
  const isPdf = type === "application/pdf" || (/\.pdf$/i.test(fileName) && (type === "application/octet-stream" || /attachment/i.test(disposition)));
  const isMessage = type === "message/rfc822";
  if (!isPdf && !isMessage) return;
  const bytes = decodeBody(body, headers);
  if (!bytes.byteLength) return;
  const index = out.length + 1;
  if (isPdf) {
    out.push({ name: fileName ? (/\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`) : `attachment-${index}.pdf`, contentType: "application/pdf", bytes });
    return;
  }
  const subject = decodeEncodedWords(parseHeaders(splitHeaderAndBody(binaryString(bytes)).header).get("subject") ?? "");
  const messageName = safeFileName(fileName || subject).replace(/[<>:"|?*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  out.push({ name: messageName ? (/\.eml$/i.test(messageName) ? messageName : `${messageName}.eml`) : `attached-message-${index}.eml`, contentType: "message/rfc822", bytes });
}

/**
 * The PDF and attached-message parts of an .eml, decoded. Text parts, images
 * and other attachments are skipped. An attached message is returned whole
 * (as `.eml` bytes); read its own attachments by calling this again.
 */
export function emlAttachments(source: Uint8Array | string): EmlAttachment[] {
  const text = binaryString(typeof source === "string" ? new TextEncoder().encode(source) : source);
  const out: EmlAttachment[] = [];
  collect(text, 0, out);
  return out;
}

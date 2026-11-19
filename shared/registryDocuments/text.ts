/**
 * Text helpers for registry documents. Input is the `text` of an intake
 * extract (`extractBytes`): pdf.js lines with TABs between columns, or an
 * .eml with raw quoted-printable and HTML bodies. Plain `pdftotext -layout`
 * output also works: runs of three or more spaces become TABs.
 */
import { decodeEncodedWords, decodeQuotedPrintableBytes } from "./eml";
import type { RegistryAddress } from "./types";

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Quoted-printable text: soft line breaks joined, then each run of =XX
 * escapes (either hex case) decoded as UTF-8 bytes with eml.ts's decoder.
 * Encoded words go through eml.ts too, which honours their charset.
 */
function decodeQuotedPrintable(text: string): string {
  return text.replace(/=\r?\n/g, "").replace(/(?:=[0-9A-Fa-f]{2})+/g, (run) => new TextDecoder("utf-8", { fatal: false }).decode(decodeQuotedPrintableBytes(run)));
}

function stripHtml(text: string): string {
  return text
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<br\s*\/?>|<\/?(?:p|div|tr|li|h\d|table|header|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<\/?[a-zA-Z][\w:-]*(?:\s[^<>]*)?\/?>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (entity, code: string) =>
      code[0] === "#" ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : HTML_ENTITIES[code.toLowerCase()] ?? entity);
}

/** True when the text is an email extract (header lines first). */
export function isEmailText(text: string): boolean {
  return /^(?:From|To|Subject|Date):/m.test(text.slice(0, 600)) && /^Subject:/m.test(text.slice(0, 1200));
}

/**
 * Undo email transport encoding and layout noise: quoted-printable, RFC 2047
 * headers, HTML tags, MIME boundaries and base64 lines; NBSP to space; long
 * space runs to TABs; lines trimmed. Page breaks (form feeds) are kept.
 */
export function normalizeRegistryText(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n");
  const quotedPrintable = /Content-Transfer-Encoding:\s*quoted-printable/i.test(text) || (text.match(/=\n/g) ?? []).length >= 3 || /=C3=[89AB][0-9A-F]|=3D"/i.test(text);
  if (quotedPrintable) text = decodeQuotedPrintable(text);
  text = decodeEncodedWords(text);
  if (/<\/?(?:p|br|td|tr|table|div|h\d|html|strong)\b/i.test(text)) text = stripHtml(text);
  return text
    .split("\n")
    .filter((line) => !/^\s*-{2,}=?_?Part_[\w.]+(?:--)?\s*$/.test(line) && !/^\s*-{2,}[\w=.]{12,}(?:--)?\s*$/.test(line))
    .filter((line) => !/^\s*Content-(?:Type|Transfer-Encoding|Disposition|ID|Description):/i.test(line) && !/^\s*(?:boundary|charset|filename|name)=/i.test(line))
    .filter((line) => !/^\s*[A-Za-z0-9+/]{60,}={0,2}\s*$/.test(line))
    .map((line) => line.replace(/[\u00a0\u202f]/g, " ").trim().replace(/ {3,}/g, "\t").replace(/ *\t[\t ]*/g, "\t").replace(/ {2,}/g, " "))
    .join("\n");
}

export type RegistryPage = { number: number; lines: string[]; text: string };

/** Pages split on form feeds (pdftotext) or the blank-line run an intake page break leaves (pdf.js). */
export function splitPages(normalized: string): RegistryPage[] {
  const parts = normalized.includes("\f") ? normalized.split("\f") : normalized.split(/\n{4,}/);
  return parts.map((text, index) => ({ number: index + 1, lines: text.split("\n"), text })).filter((page) => page.text.trim());
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "November 19, 2026" or "2026-11-19" → "2026-11-19". */
export function parseRegistryDate(value: string): string | undefined {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(value);
  if (!long) return undefined;
  const month = MONTHS.findIndex((name) => name.startsWith(long[1].toLowerCase()) && long[1].length >= 3);
  if (month < 0) return undefined;
  return `${long[3]}-${String(month + 1).padStart(2, "0")}-${long[2].padStart(2, "0")}`;
}

/** "11:59 AM" → "11:59"; "1:05:30 PM" → "13:05". Hours outside 1–12 with AM/PM are not a time. */
export function parseClockTime(value: string): string | undefined {
  const match = /\b(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*([AP])\.?M\.?/i.exec(value);
  if (!match) return undefined;
  const clock = Number(match[1]);
  if (clock < 1 || clock > 12) return undefined;
  let hour = clock % 12;
  if (match[3].toUpperCase() === "P") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/** Fast, stable 53-bit string hash (cyrb53), as 14 hex characters. */
export function hashText(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Comparison key: case, accents, punctuation and spacing ignored. */
export function matchKey(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const PROVINCES: Record<string, string> = {
  "british columbia": "BC", alberta: "AB", saskatchewan: "SK", manitoba: "MB", ontario: "ON", quebec: "QC",
  "new brunswick": "NB", "nova scotia": "NS", "prince edward island": "PE", "newfoundland and labrador": "NL",
  yukon: "YT", "northwest territories": "NT", nunavut: "NU",
};
const PROVINCE_CODES = new Set(Object.values(PROVINCES));

/** Province name or code → two-letter code. */
export function provinceCode(value: string): string | undefined {
  const trimmed = value.trim();
  if (PROVINCE_CODES.has(trimmed.toUpperCase())) return trimmed.toUpperCase();
  return PROVINCES[matchKey(trimmed)];
}

/** "PRINCE GEORGE" → "Prince George"; mixed case is left alone. */
export function tidyCase(value: string): string {
  if (/[a-z]/.test(value)) return value;
  return value.toLowerCase().replace(/(^|[\s\-'/(])([a-z])/g, (_whole, lead: string, char: string) => lead + char.toUpperCase());
}

function postalCode(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact) ? `${compact.slice(0, 3)} ${compact.slice(3)}` : value.trim();
}

const CITY_LINE = /^(.+?)[,\s]+(BC|AB|SK|MB|ON|QC|NB|NS|PE|NL|YT|NT|NU|British Columbia|Alberta|Ontario|Quebec)[,\s]+([A-Z]\d[A-Z]\s?\d[A-Z]\d)\b/i;

/** Address lines ("741 Example Street", "Prince George BC V2M 3V3", "CANADA") → a structured address. */
export function parseAddressLines(lines: string[]): RegistryAddress | undefined {
  const clean = lines.map((line) => line.trim()).filter(Boolean);
  const cityIndex = clean.findIndex((line) => CITY_LINE.test(line));
  if (cityIndex < 1) return undefined;
  const match = CITY_LINE.exec(clean[cityIndex])!;
  const streetLines = clean.slice(0, cityIndex);
  let street = tidyCase(streetLines.join(", "));
  let unit: string | undefined;
  const unitMatch = /^(?:(?:unit|suite|apt\.?|#)\s*([\w-]+)\s*[-,]\s*)(.+)$/i.exec(street) ?? null;
  if (unitMatch) {
    unit = unitMatch[1];
    street = unitMatch[2];
  }
  const country = clean.slice(cityIndex + 1).find((line) => /^[A-Za-z .]+$/.test(line));
  return {
    street,
    ...(unit ? { unit } : {}),
    city: tidyCase(match[1].replace(/,$/, "").trim()),
    provinceState: provinceCode(match[2]) ?? match[2].toUpperCase(),
    postalCode: postalCode(match[3]),
    country: country ? tidyCase(country) : "Canada",
  };
}

export function formatAddress(address: RegistryAddress): string {
  return [address.unit ? `${address.unit} - ${address.street}` : address.street, [address.city, address.provinceState, address.postalCode].filter(Boolean).join(" "), address.country].join(", ");
}

/** Index of the first line matching, at or after `from`. */
export function findLine(lines: string[], pattern: RegExp, from = 0): number {
  for (let index = Math.max(0, from); index < lines.length; index++) if (pattern.test(lines[index])) return index;
  return -1;
}

/** The next non-empty line after `index`, with its position. */
export function nextNonEmpty(lines: string[], index: number): { line: string; index: number } | undefined {
  for (let cursor = index + 1; cursor < lines.length; cursor++) if (lines[cursor].trim()) return { line: lines[cursor].trim(), index: cursor };
  return undefined;
}

/** The previous non-empty line before `index`. */
export function previousNonEmpty(lines: string[], index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor--) if (lines[cursor].trim()) return lines[cursor].trim();
  return undefined;
}

/** "Label: value" on one line, or the value on the next line. */
export function labelValue(lines: string[], label: RegExp): { value: string; snippet: string } | undefined {
  const index = findLine(lines, label);
  if (index < 0) return undefined;
  const rest = lines[index].replace(label, "").replace(/^[\s:\t]+/, "").trim();
  if (rest) return { value: rest, snippet: lines[index] };
  const next = nextNonEmpty(lines, index);
  return next ? { value: next.line, snippet: `${lines[index]} ${next.line}` } : undefined;
}

export function snippetOf(value: string, limit = 180): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Stage 2 dispatcher: bytes + file name → IntakeExtract. Runtime-neutral; the
 * legacy-format converter (LibreOffice) and the OCR engine and rasterizer are
 * injected by the host (web worker, Node CLI, Electron). Legacy Word, Excel and
 * PowerPoint files, PPTX and XPS are also read natively, so a host without
 * LibreOffice still reads them. */
import { blocksFromPlainText, finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeRow } from "../blocks";
import { extractDoc, readCompoundStreams } from "./doc";
import { extractDocx } from "./docx";
import { extractImage } from "./image";
import { extractMsg } from "./msg";
import { OCR_IMAGE_EXTENSIONS, type OcrHost } from "./ocr";
import { extractPdf, type PdfJsModule } from "./pdf";
import { extractPpt, extractPptx, extractXps } from "./slides";
import { extractXls } from "./xls";
import { extractXlsx } from "./xlsx";
import { EXTRACTABLE_EXTENSIONS, extensionOf, TEXT_EXTENSIONS } from "./extensions";

export type LegacyConverter = (bytes: Uint8Array, fileName: string, target: "docx" | "xlsx") => Promise<Uint8Array | null>;
export type ExtractOptions = { convertLegacy?: LegacyConverter; pdfjs?: PdfJsModule; maxAttachmentDepth?: number; ocr?: OcrHost };

export { extensionOf, TEXT_EXTENSIONS, EXTRACTABLE_EXTENSIONS, OCR_IMAGE_EXTENSIONS };

/** The format of a file with no (or a misleading) extension, from its first bytes. */
export function sniffExtension(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 512));
  if (head.startsWith("%PDF-")) return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (head.startsWith("\x89PNG")) return "png";
  if (head.startsWith("II*\0") || head.startsWith("MM\0*")) return "tif";
  if (head.trimStart().startsWith("{\\rtf")) return "rtf";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    try {
      const streams = readCompoundStreams(bytes);
      if (streams.has("WordDocument")) return "doc";
      if (streams.has("Workbook") || streams.has("Book")) return "xls";
      if (streams.has("PowerPoint Document")) return "ppt";
      if ([...streams.keys()].some((name) => name.startsWith("__substg1.0_"))) return "msg";
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (head.startsWith("PK\x03\x04")) {
    if (head.includes("word/")) return "docx";
    if (head.includes("xl/")) return "xlsx";
    if (head.includes("ppt/")) return "pptx";
    if (/FixedDocSeq|\.fdseq|Documents\//.test(head)) return "xps";
    return "zip";
  }
  if (/^(?:from|received|return-path|message-id|mime-version|date|subject):/im.test(head.slice(0, 200))) return "eml";
  const sample = bytes.subarray(0, 2048);
  if (sample.length && [...sample].every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127))) return "txt";
  return undefined;
}

function unsupported(reason: string): IntakeExtract {
  return { method: "unsupported", methodVersion: INTAKE_EXTRACT_VERSION, blocks: [], text: "", warnings: [reason] };
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return utf8.replace(/^﻿/, "");
}

export async function extractBytes(fileName: string, bytes: Uint8Array, options: ExtractOptions = {}, depth = 0): Promise<IntakeExtract> {
  let ext = extensionOf(fileName);
  if (!bytes.byteLength) return unsupported("Zero-byte file.");
  // No extension (or one no extractor knows): read the format from the bytes.
  if (!EXTRACTABLE_EXTENSIONS.has(ext) && !OCR_IMAGE_EXTENSIONS.has(ext)) {
    const sniffed = sniffExtension(bytes);
    if (!sniffed || sniffed === "zip") return unsupported(`No text extractor for .${ext || "(no extension)"} files.`);
    return extractBytes(`${fileName}.${sniffed}`, bytes, options, depth);
  }
  if (ext === "docx" || ext === "docm" || ext === "dotx" || ext === "dotm") return extractDocx(bytes);
  if (ext === "pdf") return extractPdf(bytes, { pdfjs: options.pdfjs, ocr: options.ocr });
  if (OCR_IMAGE_EXTENSIONS.has(ext)) return extractImage(fileName, bytes, options.ocr);
  if (ext === "pptx" || ext === "pptm" || ext === "potx" || ext === "ppsx") return extractPptx(bytes);
  if (ext === "ppt" || ext === "pps") return extractPpt(bytes);
  if (ext === "xps" || ext === "oxps") return extractXps(bytes);
  if (ext === "xlsx" || ext === "xlsm") return extractXlsx(bytes);
  if (ext === "msg") {
    const { extract, attachments } = extractMsg(bytes);
    const nested: NonNullable<IntakeExtract["attachments"]> = [];
    if (depth < (options.maxAttachmentDepth ?? 2)) {
      for (const attachment of attachments) {
        if (!EXTRACTABLE_EXTENSIONS.has(extensionOf(attachment.name))) {
          nested.push({ name: attachment.name, error: "Attachment type is not extractable." });
          continue;
        }
        try {
          nested.push({ name: attachment.name, extract: await extractBytes(attachment.name, attachment.bytes, options, depth + 1) });
        } catch (error) {
          nested.push({ name: attachment.name, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    return { ...extract, attachments: nested };
  }
  if (["doc", "odt", "wpd", "rtf"].includes(ext) || ext === "xls" || ext === "ods") {
    const target = ext === "xls" || ext === "ods" ? "xlsx" : "docx";
    if (ext === "rtf" && !options.convertLegacy) return textExtract(stripRtf(decodeText(bytes)));
    // Word and Excel 97–2003 without LibreOffice (browser, or a failed conversion): read the binary directly.
    const direct = () => {
      // Some ".doc" files are RTF or HTML saved under a Word name.
      const head = new TextDecoder("latin1").decode(bytes.subarray(0, 64)).trimStart();
      if (head.startsWith("{\\rtf")) return textExtract(stripRtf(decodeText(bytes)));
      // HTML saved under a Word or Excel name (web exports, report tools): tables stay tables.
      if (/^<(?:!doctype html|html)/i.test(head) || (bytes[0] !== 0xd0 && /<table[\s>]/i.test(new TextDecoder("latin1").decode(bytes.subarray(0, 4096))))) return htmlExtract(decodeText(bytes));
      try {
        return ext === "xls" ? extractXls(bytes) : extractDoc(bytes);
      } catch (error) {
        return unsupported(`This .${ext} could not be read without LibreOffice: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const hasDirect = ext === "doc" || ext === "xls";
    if (!options.convertLegacy) return hasDirect ? direct() : unsupported(`Legacy .${ext} needs LibreOffice conversion, which is not available in this runtime.`);
    const converted = await options.convertLegacy(bytes, fileName, target);
    if (!converted) return hasDirect ? direct() : unsupported(`LibreOffice could not convert this .${ext} file.`);
    const extract = target === "xlsx" ? await extractXlsx(converted) : await extractDocx(converted);
    // A conversion that comes back empty (an unusual or damaged file) gets a second reading.
    if (!extract.text.trim() && hasDirect) {
      const fallback = direct();
      if (fallback.text.trim()) return { ...fallback, warnings: [...fallback.warnings, "LibreOffice returned no text; read directly from the binary."] };
    }
    return { ...extract, method: target === "xlsx" ? "libreoffice-xlsx" : "libreoffice-docx", warnings: [...extract.warnings, `Converted from .${ext} with LibreOffice; page numbers are approximate.`] };
  }
  if (ext === "eml") return emlExtract(decodeText(bytes));
  if (TEXT_EXTENSIONS.has(ext)) {
    const raw = decodeText(bytes);
    return ext === "html" || ext === "htm" ? htmlExtract(raw) : textExtract(raw);
  }
  return unsupported(`No text extractor for .${ext || "(no extension)"} files.`);
}

/** RFC 822 message: From/To/Cc/Date/Subject become email_header blocks (as .msg does); the
 * first text/plain part (or the whole body) becomes paragraphs. No MIME decoding beyond that. */
function emlExtract(raw: string): IntakeExtract {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const split = normalized.search(/\n\n/);
  const headerText = split >= 0 ? normalized.slice(0, split) : "";
  if (!/^(?:[\w-]+:\s?.*\n?)+/.test(headerText) || !/^(?:from|to|subject|date|received|message-id|mime-version):/im.test(headerText)) return textExtract(raw);
  const headers: Record<string, string> = {};
  for (const line of headerText.replace(/\n[ \t]+/g, " ").split("\n")) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (match && ["from", "to", "cc", "subject", "date"].includes(match[1].toLowerCase())) headers[match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()] = match[2].trim().replace(/,\s*(?=[^,]*<)/g, "; ");
  }
  let body = normalized.slice(split + 2);
  const boundary = /boundary="?([^";\n]+)"?/i.exec(headerText)?.[1];
  if (boundary) {
    const parts = body.split(`--${boundary}`);
    const plain = parts.find((part) => /content-type:\s*text\/plain/i.test(part)) ?? parts.find((part) => /content-type:\s*text\//i.test(part));
    body = plain ? plain.slice(Math.max(0, plain.search(/\n\n/)) + 2) : "";
  }
  const drafts: DraftBlock[] = ["From", "To", "Cc", "Subject", "Date"].filter((key) => headers[key]).map((key) => ({ kind: "email_header" as const, text: `${key}: ${headers[key]}`, style: key }));
  drafts.push(...blocksFromPlainText(body).map((draft) => ({ ...draft, page: undefined })));
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "eml-headers", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, emailHeaders: headers, warnings: [] };
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
function htmlText(fragment: string): string {
  return fragment
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h\d)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (entity, code: string) => code[0] === "#" ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : HTML_ENTITIES[code.toLowerCase()] ?? entity);
}

/** HTML → paragraphs, with each <table> as a table block (cells keep their R{row}C{col}). */
function htmlExtract(raw: string): IntakeExtract {
  const drafts: DraftBlock[] = [];
  const body = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, "");
  let cursor = 0;
  const pushText = (fragment: string) => {
    for (const paragraph of htmlText(fragment).split(/\n{2,}/)) if (paragraph.trim()) drafts.push({ kind: "paragraph", text: paragraph.replace(/[ \t]+\n/g, "\n").trim() });
  };
  for (const match of body.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    pushText(body.slice(cursor, match.index));
    cursor = (match.index ?? 0) + match[0].length;
    const rows: IntakeRow[] = [];
    for (const row of match[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...row[0].matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map((cell, column) => {
        const span = Number(/colspan\s*=\s*"?(\d+)/i.exec(cell[2])?.[1] ?? 1);
        return { text: htmlText(cell[3]).replace(/\s+/g, " ").trim(), cell: `R${rows.length + 1}C${column + 1}`, ...(span > 1 ? { colSpan: span } : {}), ...(cell[1].toLowerCase() === "h" ? { header: true } : {}) };
      });
      if (cells.length) rows.push({ cells });
    }
    if (rows.length) drafts.push({ kind: "table", rows });
  }
  pushText(body.slice(cursor));
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "plain-text", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, warnings: [] };
}

function textExtract(raw: string): IntakeExtract {
  const { blocks, text } = finalizeBlocks(blocksFromPlainText(raw));
  return { method: "plain-text", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, warnings: [] };
}

function stripRtf(value: string): string {
  return value.replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^}]*\}/g, "").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
}

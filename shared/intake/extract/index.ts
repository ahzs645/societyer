/** Stage 2 dispatcher: bytes + file name → IntakeExtract. Runtime-neutral; the
 * legacy-format converter (LibreOffice) and OCR are injected by Node/Electron hosts. */
import { blocksFromPlainText, finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract } from "../blocks";
import { extractDoc } from "./doc";
import { extractDocx } from "./docx";
import { extractMsg } from "./msg";
import { extractPdf, type PdfJsModule } from "./pdf";
import { extractXlsx } from "./xlsx";
import { EXTRACTABLE_EXTENSIONS, extensionOf, TEXT_EXTENSIONS } from "./extensions";

export type LegacyConverter = (bytes: Uint8Array, fileName: string, target: "docx" | "xlsx") => Promise<Uint8Array | null>;
export type ExtractOptions = { convertLegacy?: LegacyConverter; pdfjs?: PdfJsModule; maxAttachmentDepth?: number };

export { extensionOf, TEXT_EXTENSIONS, EXTRACTABLE_EXTENSIONS };

function unsupported(reason: string): IntakeExtract {
  return { method: "unsupported", methodVersion: INTAKE_EXTRACT_VERSION, blocks: [], text: "", warnings: [reason] };
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return utf8.replace(/^﻿/, "");
}

export async function extractBytes(fileName: string, bytes: Uint8Array, options: ExtractOptions = {}, depth = 0): Promise<IntakeExtract> {
  const ext = extensionOf(fileName);
  if (!bytes.byteLength) return unsupported("Zero-byte file.");
  if (ext === "docx" || ext === "docm" || ext === "dotx") return extractDocx(bytes);
  if (ext === "pdf") return extractPdf(bytes, { pdfjs: options.pdfjs });
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
  if (["doc", "odt", "wpd", "rtf", "ppt", "pptx"].includes(ext) || ext === "xls" || ext === "ods") {
    const target = ext === "xls" || ext === "ods" ? "xlsx" : "docx";
    if (ext === "rtf" && !options.convertLegacy) return textExtract(stripRtf(decodeText(bytes)));
    // Word 97–2003 without LibreOffice (browser): read the binary directly (text and approximate tables).
    const direct = () => {
      // Some ".doc" files are RTF or HTML saved under a Word name.
      const head = new TextDecoder("latin1").decode(bytes.subarray(0, 64)).trimStart();
      if (head.startsWith("{\\rtf")) return textExtract(stripRtf(decodeText(bytes)));
      if (/^<(?:!doctype html|html)/i.test(head)) return textExtract(decodeText(bytes).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|tr|li|h\d)>/gi, "\n\n").replace(/<[^>]+>/g, ""));
      try {
        return extractDoc(bytes);
      } catch (error) {
        return unsupported(`This .doc could not be read without LibreOffice: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    if (!options.convertLegacy) return ext === "doc" ? direct() : unsupported(`Legacy .${ext} needs LibreOffice conversion, which is not available in this runtime.`);
    const converted = await options.convertLegacy(bytes, fileName, target);
    if (!converted) return ext === "doc" ? direct() : unsupported(`LibreOffice could not convert this .${ext} file.`);
    const extract = target === "xlsx" ? await extractXlsx(converted) : await extractDocx(converted);
    return { ...extract, method: target === "xlsx" ? "libreoffice-xlsx" : "libreoffice-docx", warnings: [...extract.warnings, `Converted from .${ext} with LibreOffice; page numbers are approximate.`] };
  }
  if (ext === "eml") return emlExtract(decodeText(bytes));
  if (TEXT_EXTENSIONS.has(ext)) {
    const raw = decodeText(bytes);
    return textExtract(ext === "html" || ext === "htm" ? raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|tr|li|h\d)>/gi, "\n\n").replace(/<[^>]+>/g, "") : raw);
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

function textExtract(raw: string): IntakeExtract {
  const { blocks, text } = finalizeBlocks(blocksFromPlainText(raw));
  return { method: "plain-text", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, warnings: [] };
}

function stripRtf(value: string): string {
  return value.replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^}]*\}/g, "").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
}

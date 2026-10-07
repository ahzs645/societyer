/** Stage 2 dispatcher: bytes + file name → IntakeExtract. Runtime-neutral; the
 * legacy-format converter (LibreOffice) and OCR are injected by Node/Electron hosts. */
import { blocksFromPlainText, finalizeBlocks, INTAKE_EXTRACT_VERSION, type IntakeExtract } from "../blocks";
import { extractDocx } from "./docx";
import { extractMsg } from "./msg";
import { extractPdf, type PdfJsModule } from "./pdf";
import { extractXlsx } from "./xlsx";

export type LegacyConverter = (bytes: Uint8Array, fileName: string, target: "docx" | "xlsx") => Promise<Uint8Array | null>;
export type ExtractOptions = { convertLegacy?: LegacyConverter; pdfjs?: PdfJsModule; maxAttachmentDepth?: number };

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,6})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "tsv", "json", "html", "htm", "xml", "eml", "rtf"]);
export const EXTRACTABLE_EXTENSIONS = new Set(["docx", "docm", "dotx", "pdf", "xlsx", "xlsm", "msg", "doc", "xls", "odt", "ods", "wpd", "pptx", "ppt", ...TEXT_EXTENSIONS]);

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
    if (!options.convertLegacy) return unsupported(`Legacy .${ext} needs LibreOffice conversion, which is not available in this runtime.`);
    const converted = await options.convertLegacy(bytes, fileName, target);
    if (!converted) return unsupported(`LibreOffice could not convert this .${ext} file.`);
    const extract = target === "xlsx" ? await extractXlsx(converted) : await extractDocx(converted);
    return { ...extract, method: target === "xlsx" ? "libreoffice-xlsx" : "libreoffice-docx", warnings: [...extract.warnings, `Converted from .${ext} with LibreOffice; page numbers are approximate.`] };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    const raw = decodeText(bytes);
    return textExtract(ext === "html" || ext === "htm" ? raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|tr|li|h\d)>/gi, "\n\n").replace(/<[^>]+>/g, "") : raw);
  }
  return unsupported(`No text extractor for .${ext || "(no extension)"} files.`);
}

function textExtract(raw: string): IntakeExtract {
  const { blocks, text } = finalizeBlocks(blocksFromPlainText(raw));
  return { method: "plain-text", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, warnings: [] };
}

function stripRtf(value: string): string {
  return value.replace(/\\par[d]?/g, "\n").replace(/\{\\\*[^}]*\}/g, "").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
}

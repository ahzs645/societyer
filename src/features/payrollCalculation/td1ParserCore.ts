import { parsePayrollTd1Evidence, type PayrollTd1EvidenceInput, type PayrollTd1Form, type PayrollTd1InputField, type PayrollTd1ParseResult, type PayrollTd1TextItem } from "../../../shared/payrollTd1";
import type { OcrHost, OcrRecognition } from "../../../shared/intake/extract/ocr";
import type { PdfJsModule } from "../../../shared/intake/extract/pdf";

export type Td1ParseProgress = { stage: "reading" | "ocr" | "complete"; page?: number; total?: number };
export type Td1FileParseOptions = { expectedYear: number; expectedForm: PayrollTd1Form; onProgress?: (progress: Td1ParseProgress) => void; signal?: AbortSignal; forceOcr?: boolean };
export type Td1ByteParseOptions = Td1FileParseOptions & { pdfjs?: PdfJsModule; ocrHost?: OcrHost; createOcrHost?: () => Promise<OcrHost & { terminate?(): Promise<void> }> };
const MAX_BYTES = 10 * 1024 * 1024;
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Local TD1 parsing cancelled.", "AbortError"); }
function mediaType(bytes: Uint8Array): PayrollTd1ParseResult["source"]["mediaType"] {
  if (new TextDecoder().decode(bytes.subarray(0, 512)).includes("%PDF-")) return "application/pdf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  throw new Error("Choose a local PDF, PNG or JPEG of one completed federal TD1 or TD1BC form.");
}
export function td1OcrItems(recognition: OcrRecognition, page: number): PayrollTd1TextItem[] {
  if (!recognition.width || !recognition.height) throw new Error("The local OCR host did not supply image dimensions.");
  const baselines = new Map<number, number[]>();
  for (const word of recognition.words) { const list = baselines.get(word.line) ?? []; list.push(word.bbox.y1); baselines.set(word.line, list); }
  const lineY = new Map([...baselines].map(([line, values]) => { values.sort((a, b) => a - b); return [line, values[Math.floor(values.length / 2)]]; }));
  // Dollar signs and descenders have lower individual bounding boxes. The OCR
  // engine's line membership preserves their actual common text baseline.
  return recognition.words.filter(word => word.text.trim()).map(word => ({ text: word.text, page, x: word.bbox.x0 / recognition.width * 612, y: (1 - lineY.get(word.line)! / recognition.height) * 792, width: (word.bbox.x1 - word.bbox.x0) / recognition.width * 612, height: (word.bbox.y1 - word.bbox.y0) / recognition.height * 792, confidence: word.confidence }));
}

/** Runtime-neutral byte parser used inside the local browser worker and by
 * synthetic tests with the same pdf.js/OCR host interfaces. No network upload. */
export async function parseTd1Bytes(bytes: Uint8Array, options: Td1ByteParseOptions): Promise<PayrollTd1ParseResult> {
  aborted(options.signal);
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error("A TD1 import must contain one local file no larger than 10 MiB.");
  const type = mediaType(bytes), digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer), sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  let host = options.ocrHost, ownedHost = false, document: any;
  const ensureOcr = async () => { if (!host && options.createOcrHost) { host = await options.createOcrHost(); ownedHost = true; } if (!host) throw new Error("This scan needs local OCR. Enable the bundled local OCR worker or enter the reviewed fields manually; no document is sent to an external service."); return host; };
  const input: PayrollTd1EvidenceInput = { expectedForm: options.expectedForm, expectedYear: options.expectedYear, sha256, mediaType: type, pageCount: 1, method: "pdf_text", fields: [], textItems: [] };
  options.onProgress?.({ stage: "reading" });
  try {
    if (type !== "application/pdf") {
      const ocr = await ensureOcr(); if (!ocr.decodeImage) throw new Error("The local OCR host cannot decode this image; use a PDF or enter reviewed values manually.");
      const { recognizeUpright } = await import("../../../shared/intake/extract/ocr");
      options.onProgress?.({ stage: "ocr", page: 1, total: 1 });
      const recognized = await recognizeUpright(ocr.engine, async (rotation, probe) => { aborted(options.signal); const image = await ocr.decodeImage!(bytes, type === "image/png" ? "td1.png" : "td1.jpg", { rotation, maxPixels: probe ? 2_500_000 : 12_000_000 }); if (!image) throw new Error("The local OCR host could not read this image."); return image; });
      input.textItems = td1OcrItems(recognized.recognition, 1); input.method = "local_ocr";
    } else {
      const pdfjs = options.pdfjs ?? await import("pdfjs-dist/legacy/build/pdf.mjs");
      document = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, verbosity: 0, ...(host?.pdfjsDocumentOptions ?? {}), ...(host?.pdfjsWasmUrl ? { wasmUrl: host.pdfjsWasmUrl } : {}) }).promise;
      if (document.numPages > 2) throw new Error("Upload one complete TD1 or TD1BC form of at most two pages. Combined or additional forms must be reviewed separately.");
      input.pageCount = document.numPages;
      const rawFields = await document.getFieldObjects().catch(() => null);
      for (const [name, values] of Object.entries(rawFields ?? {})) for (const value of values as any[]) {
        // Identification fields and their values are excluded at extraction,
        // before either parsing or worker messages can carry private identity.
        if (/Identification|Last_name|First_name|SIN|DOB|Address|Postal|NR_country|Certification/i.test(name)) continue;
        if (value.type !== "text" && value.type !== "checkbox" && value.type !== "radiobutton") continue;
        (input.fields as PayrollTd1InputField[]).push({ name, type: value.type, value: value.value, page: Number(value.page) + 1, rect: value.rect, exportValues: value.exportValues });
      }
      const recognizedFields = input.fields!.some(value => /\.number\d+_subform\[0\]\.Amount/.test(value.name));
      input.method = recognizedFields ? "acroform" : "pdf_text";
      for (let page = 1; page <= document.numPages; page++) {
        aborted(options.signal); options.onProgress?.({ stage: "reading", page, total: document.numPages });
        const source = await document.getPage(page), viewport = source.getViewport({ scale: 1 }), content = await source.getTextContent();
        for (const item of content.items as any[]) if (typeof item.str === "string" && item.str.trim()) input.textItems.push({ text: item.str, page, x: Number(item.transform?.[4] ?? 0) / viewport.width * 612, y: Number(item.transform?.[5] ?? 0) / viewport.height * 792, width: Number(item.width ?? 0) / viewport.width * 612, height: Math.abs(Number(item.height ?? item.transform?.[3] ?? 10)) / viewport.height * 792 });
      }
      const initial = parsePayrollTd1Evidence(input), characters = input.textItems.reduce((sum, item) => sum + item.text.length, 0);
      if (options.forceOcr || characters < 100 || !recognizedFields && initial.fields.totalClaimCents.value === null) {
        if (options.ocrHost || options.createOcrHost) {
          const ocr = await ensureOcr(), { recognizeUpright } = await import("../../../shared/intake/extract/ocr"), text: PayrollTd1TextItem[] = [];
          // Image masks and decoders inside pdf.js also need the worker's
          // OffscreenCanvas factory. Reopen with the lazily loaded OCR host.
          if (ownedHost && ocr.pdfjsDocumentOptions) {
            await document.destroy();
            document = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, verbosity: 0, ...ocr.pdfjsDocumentOptions, ...(ocr.pdfjsWasmUrl ? { wasmUrl: ocr.pdfjsWasmUrl } : {}) }).promise;
          }
          for (let page = 1; page <= document.numPages; page++) {
            aborted(options.signal); options.onProgress?.({ stage: "ocr", page, total: document.numPages });
            const source = await document.getPage(page), viewport = source.getViewport({ scale: 1 });
            const recognized = await recognizeUpright(ocr.engine, (rotation, probe) => { aborted(options.signal); const max = probe ? 2_500_000 : Math.min(12_000_000, ocr.maxPixels ?? 12_000_000), scale = Math.min((ocr.dpi ?? 300) / 72, Math.sqrt(max / (viewport.width * viewport.height))); return ocr.renderPdfPage(source, { rotation, scale }); });
            text.push(...td1OcrItems(recognized.recognition, page));
          }
          input.textItems = text; input.method = characters < 100 ? "local_ocr" : "mixed";
        } else if (characters < 100) throw new Error("This scanned form needs the bundled local OCR worker; no form data was sent off-device.");
      }
    }
    aborted(options.signal); const result = parsePayrollTd1Evidence(input); options.onProgress?.({ stage: "complete", total: input.pageCount }); return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof Error && /^(?:Choose a local|A TD1|This scan|This scanned|This runtime|The local OCR|Upload one complete)/.test(error.message)) throw error;
    throw new Error("The local form could not be read safely. Use an unlocked PDF or clearer scan, or enter declarations manually after reviewing the original.");
  } finally { await document?.destroy?.(); if (ownedHost) await (host as OcrHost & { terminate?(): Promise<void> })?.terminate?.(); }
}

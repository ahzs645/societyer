import { parseTd1Bytes, type Td1FileParseOptions } from "./td1ParserCore";
import type { PayrollTd1ParseResult } from "../../../shared/payrollTd1";
export { parseTd1Bytes, td1OcrItems } from "./td1ParserCore";
export type { Td1FileParseOptions, Td1ByteParseOptions, Td1ParseProgress } from "./td1ParserCore";
import type { Td1ParseProgress } from "./td1ParserCore";
const MAX_BYTES = 10 * 1024 * 1024;
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException("Local TD1 parsing cancelled.", "AbortError"); }

/** Worker messages contain only the sanitized result/progress, never raw text,
 * identity fields, original filenames or document bytes on the return path. */
export async function parseTd1File(file: File, options: Td1FileParseOptions): Promise<PayrollTd1ParseResult> {
  aborted(options.signal);
  if (file.size > MAX_BYTES) throw new Error("A TD1 import must contain one local file no larger than 10 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer()); aborted(options.signal);
  if (typeof Worker === "undefined") return parseTd1Bytes(bytes, options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./td1Parser.worker.ts", import.meta.url), { type: "module" });
    const close = () => { options.signal?.removeEventListener("abort", cancel); worker.terminate(); };
    const cancel = () => { close(); reject(new DOMException("Local TD1 parsing cancelled.", "AbortError")); };
    options.signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; result?: PayrollTd1ParseResult; progress?: Td1ParseProgress; message?: string }>) => {
      if (event.data.type === "progress") options.onProgress?.(event.data.progress!);
      else if (event.data.type === "result") { close(); resolve(event.data.result!); }
      else if (event.data.type === "error") { close(); reject(new Error(event.data.message ?? "Local TD1 parsing failed; review the original form manually.")); }
      // pdf.js announces its embedded worker handler with a protocol-specific
      // ready message. Only our typed result/error messages finish this job.
    };
    worker.onerror = () => { close(); reject(new Error("The bundled local TD1 worker could not start. Review the form manually; no document was uploaded.")); };
    worker.postMessage({ bytes, expectedForm: options.expectedForm, expectedYear: options.expectedYear, forceOcr: Boolean(options.forceOcr) }, [bytes.buffer]);
  });
}

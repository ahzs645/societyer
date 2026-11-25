import { MAX_SOURCE } from "../../../shared/insuranceClauses";

export type ClauseSource = {
  label: string;
  reference: string;
  version: string;
  inputKey?: string;
  publication?: string;
};
export type SourcePart = { text: string; location: string };
export type ClauseInput = {
  key: string;
  label: string;
  version?: string;
  parts?: SourcePart[];
  load?: () => Promise<SourcePart[]>;
};
export async function insuranceSourceParts(
  name: string,
  bytes: ArrayBuffer,
): Promise<SourcePart[]> {
  if (bytes.byteLength > 25 * 1024 * 1024)
    throw new Error(
      "Select a file of 25 MB or less, or paste the insurance section.",
    );
  if (/\.txt$/i.test(name))
    return [{ text: new TextDecoder().decode(bytes), location: "Text file" }];
  let blocks;
  if (/\.pdf$/i.test(name)) {
    const [{ extractPdf }, pdfjs, worker] = await Promise.all([
      import("../../../shared/intake/extract/pdf"),
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const extracted = await extractPdf(new Uint8Array(bytes), { pdfjs });
    if (extracted.emptyPages?.length || extracted.warnings.length)
      throw new Error(
        "The PDF could not be read completely. Paste the relevant wording and its page number.",
      );
    blocks = extracted.blocks;
  } else if (/\.docx$/i.test(name)) {
    const { extractDocx } = await import("../../../shared/intake/extract/docx");
    blocks = (await extractDocx(new Uint8Array(bytes))).blocks;
  } else
    throw new Error(
      "Choose a PDF, DOCX or text file, or paste the original clause.",
    );
  const byPage = new Map<string, string[]>();
  for (const block of blocks) {
    if (!block.text.trim()) continue;
    const key = block.page ? `Page ${block.page}` : "Document text";
    const parts = byPage.get(key) ?? [];
    parts.push(block.text);
    byPage.set(key, parts);
  }
  if (!byPage.size)
    throw new Error(
      "No readable text. Paste the original clause with its source reference.",
    );
  return [...byPage].map(([location, text]) => ({
    location,
    text: text.join("\n"),
  }));
}

export function sourceChunks(parts: SourcePart[]) {
  const chunks: {
    text: string;
    spans: { start: number; end: number; location: string }[];
  }[] = [];
  for (const part of parts) {
    let remaining = part.text.trim();
    while (remaining) {
      let chunk = chunks.at(-1);
      if (
        !chunk ||
        chunk.text.length + Math.min(remaining.length, MAX_SOURCE) + 1 >
          MAX_SOURCE
      ) {
        chunk = { text: "", spans: [] };
        chunks.push(chunk);
      }
      let count = Math.min(MAX_SOURCE, remaining.length);
      if (count < remaining.length) {
        const space = remaining.lastIndexOf(" ", count);
        if (space > MAX_SOURCE / 2) count = space;
      }
      const piece = remaining.slice(0, count);
      const start = chunk.text.length ? chunk.text.length + 1 : 0;
      chunk.text += (start ? "\n" : "") + piece;
      chunk.spans.push({
        start,
        end: chunk.text.length,
        location: part.location,
      });
      remaining = remaining.slice(count).trimStart();
    }
  }
  return chunks;
}

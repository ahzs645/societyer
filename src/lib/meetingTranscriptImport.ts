import { openZip, readZipEntryChunks, crc32 } from "./zipStream";

const encoder = new TextEncoder();
const JSON_LIMIT = 16 * 1024 * 1024;

/** Originals remain in SharePoint. Only bounded transcript chunks enter Convex. */
export async function* meetingTranscriptChunks(file: File): AsyncGenerator<string> {
  let name = file.name; let input: AsyncIterable<Uint8Array> = blobChunks(file);
  if (/\.zip$/i.test(name)) {
    // Bound the directory before openZip allocates it (untrusted ZIP headers).
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
    let centralSize = Infinity;
    for (let i = tail.length - 22; i >= 0; i--) if (new DataView(tail.buffer).getUint32(i, true) === 0x06054b50) { centralSize = new DataView(tail.buffer).getUint32(i + 12, true); break; }
    if (centralSize > 2 * 1024 * 1024) throw new Error("The ZIP directory exceeds the safe import limit. The original is still attached.");
    const entries = await openZip(file);
    if (entries.size > 1000) throw new Error("ZIP imports support up to 1,000 entries.");
    let expanded = 0;
    for (const entry of entries.values()) {
      if (entry.name.includes("\\") || entry.name.startsWith("/") || entry.name.split("/").includes("..") || entry.flags & 1) throw new Error("Unsafe or encrypted ZIP entry.");
      expanded += entry.size;
      if (expanded > 1_000_000_000) throw new Error("ZIP expands beyond 1 GB. Extract the transcript separately.");
    }
    const candidates = [...entries.values()].filter(e => !e.dir && /\.(txt|vtt|srt|json)$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name));
    // Prefer the human transcript to JSON metadata or duplicate caption formats.
    candidates.sort((a, b) => score(a.name) - score(b.name) || a.name.localeCompare(b.name));
    const entry = candidates[0];
    if (!entry || entry.size > 500_000_000) throw new Error("No supported transcript found in this ZIP. The archive is attached.");
    name = entry.name;
    input = (async function* () {
      let total = 0; let crc = 0;
      for await (const chunk of readZipEntryChunks(file, entry)) {
        total += chunk.length; if (total > entry.size || total > 500_000_000) throw new Error("ZIP transcript exceeds its declared size.");
        crc = crc32(chunk, crc); yield chunk;
      }
      if (total !== entry.size || crc !== entry.crc) throw new Error("ZIP transcript checksum mismatch.");
    })();
  }
  const json = /\.json$/i.test(name);
  if (json) {
    let bytes = 0; let text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    for await (const chunk of input) { bytes += chunk.length; if (bytes > JSON_LIMIT) throw new Error("JSON extraction supports up to 16 MB. Attach larger exports as originals or export TXT/VTT instead."); text += decoder.decode(chunk, { stream: true }); }
    const data = JSON.parse(text + decoder.decode());
    const body = typeof data.text === "string" ? data.text : Array.isArray(data.segments) ? data.segments.map((s: any) => typeof s.text === "string" ? `${typeof s.speaker === "string" ? `${s.speaker}: ` : ""}${s.text}` : "").filter(Boolean).join("\n") : "";
    if (!body.trim()) throw new Error("Whisper JSON must contain text or segments[].text.");
    yield* splitText(body); return;
  }
  if (!/\.(txt|vtt|srt)$/i.test(name)) throw new Error("This recording is attached. Import its transcript separately when available.");
  const captions = /\.(vtt|srt)$/i.test(name);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = ""; let output = ""; let cue = false; let skip = false;
  const lineText = (line: string) => {
    line = line.replace(/^\uFEFF/, "").replace(/\r$/, "");
    if (!captions) return `${line}\n`;
    if (!line.trim()) { cue = false; skip = false; return ""; }
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) { skip = true; return ""; }
    if (skip || /^WEBVTT\b/.test(line)) return "";
    if (/\d{1,2}:\d{2}.*-->/.test(line)) { cue = true; return ""; }
    if (!cue) return "";
    return `${line.replace(/<v(?:\.[^ >]+)?\s+([^>]+)>/gi, "$1: ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")}\n`;
  };
  for await (const bytes of input) {
    pending += decoder.decode(bytes, { stream: true });
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      output += lineText(pending.slice(0, end)); pending = pending.slice(end + 1);
      while (encoder.encode(output).length > 48_000) { const head = safePrefix(output); yield head; output = output.slice(head.length); }
    }
    // Plain text can have a single enormous line; caption lines have a strict bound.
    if (pending.length > 48_000) {
      if (captions) throw new Error("Caption line exceeds 48,000 characters.");
      while (pending.length > 12_000) { output += pending.slice(0, 12_000); pending = pending.slice(12_000); }
      while (encoder.encode(output).length > 48_000) { const head = safePrefix(output); yield head; output = output.slice(head.length); }
    }
  }
  pending += decoder.decode(); output += lineText(pending);
  yield* splitText(output);
}
function score(name: string) { return /\.txt$/i.test(name) ? 0 : /\.vtt$/i.test(name) ? 1 : /\.srt$/i.test(name) ? 2 : 3; }
function safePrefix(text: string) { let end = Math.min(12_000, text.length); if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--; return text.slice(0, end); }
function* splitText(text: string) { while (text) { const head = safePrefix(text); yield head; text = text.slice(head.length); } }
async function* blobChunks(blob: Blob) { const reader = blob.stream().getReader(); try { for (;;) { const { done, value } = await reader.read(); if (done) break; yield value; } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); } }

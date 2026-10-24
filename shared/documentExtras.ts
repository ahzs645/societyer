import { cleanDocumentImage, cleanDocumentLink } from "./documentRichContent";
export type DocumentAnnexure = { title: string; columns: string[]; rows: string[][] };
export type DocumentAttachment = { name: string; mimeType: "application/pdf" | "image/png" | "image/jpeg"; dataUrl: string };
export type DocumentExtras = { termsAndConditions?: string; bankDetails?: Array<{ label: string; value: string }>; paymentUrl?: string; annexures?: DocumentAnnexure[]; attachments?: DocumentAttachment[] };
export type DocumentCustomTable = { columns: Array<{ label: string; width?: number; align?: "left" | "right" }>; rows: string[][] };
export type DocumentSummaryRow = { label: string; value: string; strong?: boolean };
export function cleanDocumentAttachment(attachment: DocumentAttachment): DocumentAttachment {
  if (!attachment || typeof attachment.name !== "string" || attachment.name.length > 200 || !["application/pdf", "image/png", "image/jpeg"].includes(attachment.mimeType)) throw new Error("Choose a named PDF, PNG or JPEG attachment.");
  const { dataUrl, mimeType } = attachment;
  if (mimeType === "application/pdf") {
    if (typeof dataUrl !== "string" || dataUrl.length > 600000 || !/^data:application\/pdf;base64,JVBERi0[a-z\d+/]*={0,2}$/i.test(dataUrl)) throw new Error("Choose a PDF attachment smaller than 440 KB.");
  } else cleanDocumentImage(dataUrl);
  return { name: attachment.name, mimeType, dataUrl };
}
export function cleanDocumentExtras(input?: DocumentExtras): DocumentExtras {
  if (!input) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("Choose valid document details.");
  const attachments = (input.attachments ?? []).map(cleanDocumentAttachment);
  if (attachments.length > 6 || attachments.reduce((sum, item) => sum + item.dataUrl.length, 0) > 600000) throw new Error("Keep document attachments below 440 KB in total, with at most six files.");
  const text = (value: unknown, max: number) => { if (typeof value !== "string" || value.length > max) throw new Error("Document detail text is too long."); return value; };
  const annexures = (input.annexures ?? []).map((annexure) => {
    if (!annexure.columns?.length || annexure.columns.length > 12 || annexure.rows.length > 500) throw new Error("Use at most twelve annexure columns and five hundred rows.");
    return { title: text(annexure.title, 200), columns: annexure.columns.map((column) => text(column, 100)), rows: annexure.rows.map((row) => { if (row.length !== annexure.columns.length) throw new Error("Annexure rows must match their columns."); return row.map((cell) => text(cell, 1000)); }) };
  });
  if (annexures.length > 10 || (input.bankDetails?.length ?? 0) > 12) throw new Error("Use at most ten annexures and twelve bank fields.");
  const result: DocumentExtras = { ...(input.termsAndConditions ? { termsAndConditions: text(input.termsAndConditions, 12000) } : {}), ...(input.paymentUrl ? { paymentUrl: cleanDocumentLink(input.paymentUrl) } : {}), ...(input.bankDetails ? { bankDetails: input.bankDetails.map((row) => ({ label: text(row.label, 100), value: text(row.value, 300) })) } : {}), ...(annexures.length ? { annexures } : {}), ...(attachments.length ? { attachments } : {}) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 700000) throw new Error("Reduce document annexures, terms or attachments to keep the combined details below 700 KB.");
  return result;
}
export function documentAmountInWords(cents: number, currency: string): string {
  const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const group = (number: number): string => number < 20 ? small[number] : number < 100 ? `${tens[Math.floor(number / 10)]}${number % 10 ? `-${small[number % 10]}` : ""}` : `${small[Math.floor(number / 100)]} hundred${number % 100 ? ` ${group(number % 100)}` : ""}`;
  if (!Number.isSafeInteger(cents)) throw new Error("Use an integer document total in cents.");
  const absolute = Math.abs(cents); let whole = Math.floor(absolute / 100), scale = 0; const words: string[] = [], units = ["", "thousand", "million", "billion", "trillion"];
  if (!whole) words.push("zero");
  while (whole) { const part = whole % 1000; if (part) words.unshift(`${group(part)}${units[scale] ? ` ${units[scale]}` : ""}`); whole = Math.floor(whole / 1000); scale++; }
  const value = `${cents < 0 ? "minus " : ""}${words.join(" ")} ${currency} and ${String(absolute % 100).padStart(2, "0")}/100`;
  return value[0].toUpperCase() + value.slice(1);
}

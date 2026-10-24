import { cleanDocumentImage } from "./documentRichContent";
import type { InvoiceLine } from "./invoicing";
export const INVOICE_LINE_DETAIL_KEYS = ["manufacturer", "partNumber", "upc", "ean", "isbn", "customField", "batchNumber"] as const;
export function cleanInvoiceLineDetails(raw: Partial<InvoiceLine>): Partial<InvoiceLine> {
  const result: Partial<InvoiceLine> = {};
  for (const key of INVOICE_LINE_DETAIL_KEYS) if (raw[key] !== undefined) {
    if (typeof raw[key] !== "string" || raw[key]!.length > (key === "customField" ? 1000 : 200)) throw new Error(`Keep ${key} within ${key === "customField" ? 1000 : 200} characters.`);
    if (raw[key]!.trim()) result[key] = raw[key]!.trim();
  }
  if (raw.imageUrl) result.imageUrl = cleanDocumentImage(raw.imageUrl);
  if (raw.taxMode !== undefined) { if (!["inclusive", "exclusive"].includes(raw.taxMode)) throw new Error("Choose tax-inclusive or tax-exclusive rates."); result.taxMode = raw.taxMode; }
  if (raw.rateOverridden !== undefined) { if (typeof raw.rateOverridden !== "boolean") throw new Error("Choose a valid rate override."); result.rateOverridden = raw.rateOverridden; }
  if (raw.serialNumbers !== undefined) {
    if (!Array.isArray(raw.serialNumbers) || raw.serialNumbers.length > 100 || raw.serialNumbers.some((serial) => typeof serial !== "string" || serial.length > 100)) throw new Error("Store at most 100 serial numbers of up to 100 characters.");
    result.serialNumbers = [...new Set(raw.serialNumbers.map((serial) => serial.trim()).filter(Boolean))];
  }
  return result;
}

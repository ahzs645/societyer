import { cleanInvoiceBrand, type InvoiceBrand } from "./invoiceBranding";
import { cleanDocumentDesign, type DocumentDesign } from "./documentDesign";
export * from "./documentDesign";
/** Invoice presentation and catalog pricing shared by all runtimes. Amounts are integer cents. */
export const INVOICE_CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "CHF", "HKD", "SGD"] as const;

export function invoiceCurrency(value: unknown, fallback = "CAD"): string {
  const currency = String(value ?? fallback).trim().toUpperCase();
  if (!(INVOICE_CURRENCIES as readonly string[]).includes(currency)) throw new Error("Choose a supported invoice currency.");
  return currency;
}

export type InvoiceTemplate = {
  design?: DocumentDesign;
  brand?: InvoiceBrand;
  logoVariant?: "primary" | "black" | "reverse";
  name: string;
  layout: "classic" | "modern" | "compact";
  accentColor: string;
  title: string;
  footer: string;
  showLogo: boolean;
  showDescription: boolean;
  showPaymentInstructions: boolean;
  paperSize: "letter" | "a4";
};

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = {
  logoVariant: "primary", name: "Classic", layout: "classic", accentColor: "#245c46", title: "Invoice", footer: "",
  showLogo: true, showDescription: true, showPaymentInstructions: true, paperSize: "letter",
};

export function cleanInvoiceTemplate(input?: Partial<InvoiceTemplate> | null): InvoiceTemplate {
  if (input && (typeof input !== "object" || Array.isArray(input))) throw new Error("Choose a valid document template.");
  const keys = [...Object.keys(DEFAULT_INVOICE_TEMPLATE), "brand", "design"];
  for (const key of Object.keys(input ?? {})) if (!keys.includes(key)) throw new Error(`Unknown template setting: ${key}.`);
  const value = { ...DEFAULT_INVOICE_TEMPLATE, ...input };
  for (const key of ["showLogo", "showDescription", "showPaymentInstructions"] as const) {
    if (typeof value[key] !== "boolean") throw new Error(`${key} must be true or false.`);
  }
  for (const [key, max] of [["name", 100], ["title", 80], ["footer", 2000]] as const) {
    if (typeof value[key] !== "string" || value[key].length > max) throw new Error(`${key} must be text of at most ${max} characters.`);
  }
  if (value.logoVariant !== undefined && !["primary", "black", "reverse"].includes(value.logoVariant)) throw new Error("Choose a supported logo color.");
  if (!["classic", "modern", "compact"].includes(value.layout)) throw new Error("Choose an invoice layout.");
  if (!/^#[0-9a-f]{6}$/i.test(value.accentColor)) throw new Error("Choose a six-digit accent color.");
  if (!["letter", "a4"].includes(value.paperSize)) throw new Error("Choose Letter or A4 paper.");
  const result: InvoiceTemplate = {
    ...(value.design !== undefined ? { design: cleanDocumentDesign(value.design, value) } : {}),
    logoVariant: value.logoVariant === "black" || value.logoVariant === "reverse" ? value.logoVariant : "primary",
    ...(value.brand ? { brand: cleanInvoiceBrand(value.brand) } : {}),
    name: String(value.name).trim().slice(0, 100) || "Untitled template", layout: value.layout,
    accentColor: value.accentColor, title: String(value.title).trim().slice(0, 80) || "Invoice",
    footer: String(value.footer).trim().slice(0, 2000), showLogo: value.showLogo,
    showDescription: Boolean(value.showDescription), showPaymentInstructions: Boolean(value.showPaymentInstructions), paperSize: value.paperSize,
  };
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>750000)throw new Error("The template exceeds 750 KB. Reduce background artwork or logo data.");
  return result;
}

export type CatalogPriceSource = {
  _id: string; unitPriceCents: number; currency?: string;
};
export type InvoicePriceList = {
  _id: string; name: string; currency: string; active: boolean;
  entries: Array<{ catalogItemId: string; unitPriceCents: number }>;
};

/** A price list supplies explicit rates, never an implicit currency conversion. */
export function catalogRate(item: CatalogPriceSource, currency: string, priceList?: InvoicePriceList | null, baseCurrency = "CAD"): number | null {
  if (priceList?.active && priceList.currency === currency) {
    const entry = priceList.entries.find((row) => row.catalogItemId === item._id);
    if (entry) return entry.unitPriceCents;
  }
  return (item.currency ?? baseCurrency) === currency ? item.unitPriceCents : null;
}

export const REPAIR_STATUSES = ["received", "diagnosing", "awaiting_approval", "in_progress", "ready", "completed", "cancelled"] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];
export const REPAIR_STATUS_LABEL: Record<RepairStatus, string> = {
  received: "Received", diagnosing: "Diagnosing", awaiting_approval: "Awaiting approval",
  in_progress: "In progress", ready: "Ready for pickup", completed: "Completed", cancelled: "Cancelled",
};
export const REPAIR_TRANSITIONS: Record<RepairStatus, readonly RepairStatus[]> = {
  received: ["diagnosing", "cancelled"], diagnosing: ["awaiting_approval", "in_progress", "cancelled"],
  awaiting_approval: ["diagnosing", "in_progress", "cancelled"], in_progress: ["awaiting_approval", "ready", "cancelled"],
  ready: ["in_progress", "completed"], completed: [], cancelled: ["received"],
};

import { cleanDocumentAdvanced, DEFAULT_ADVANCED_DOCUMENT_DESIGN, DOCUMENT_FONT_CHOICES, type AdvancedDocumentDesign } from "./documentAdvancedDesign";
export * from "./documentAdvancedDesign";
/** Versioned, renderer-independent layout settings. Distances are PDF points. */
export const DOCUMENT_KINDS = ["invoice", "receipt", "work_order", "report", "quote", "statement"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_COLUMN_KEYS = ["number", "sku", "item", "description", "quantity", "unit", "rate", "tax", "amount", "image", "manufacturer", "partNumber", "upc", "ean", "isbn", "customField"] as const;
export type DocumentColumnKey = (typeof DOCUMENT_COLUMN_KEYS)[number];
export const DOCUMENT_SECTION_KEYS = ["header", "customer", "items", "totals", "notes", "paymentInstructions", "signature"] as const;
export type DocumentSectionKey = (typeof DOCUMENT_SECTION_KEYS)[number];
export const DOCUMENT_TYPOGRAPHY_KEYS = ["body", "header", "customer", "table", "totals", "footer"] as const;
export type DocumentTypographyKey = (typeof DOCUMENT_TYPOGRAPHY_KEYS)[number];
export const DOCUMENT_LABEL_KEYS = ["number", "sku", "billTo", "shipTo", "issued", "due", "terms", "reference", "item", "description", "quantity", "unit", "rate", "tax", "amount", "subtotal", "discount", "total", "paid", "balance", "notes", "paymentInstructions"] as const;
export type DocumentLabelKey = (typeof DOCUMENT_LABEL_KEYS)[number];
export type DocumentTypography = { fontFamily: (typeof DOCUMENT_FONT_CHOICES)[number]; fontSize: number; color: string };
export type DocumentColumn = { key: DocumentColumnKey; label: string; width: number; visible: boolean };
export type DocumentDesign = {
  version: 1;
  advanced?: AdvancedDocumentDesign;
  page: { orientation: "portrait" | "landscape"; margins: { top: number; right: number; bottom: number; left: number } };
  logo: { width: number; alignment: "left" | "center" | "right" };
  typography: Record<DocumentTypographyKey, DocumentTypography>;
  labels: Record<DocumentLabelKey, string>;
  fields: { organization: boolean; customerEmail: boolean; issueDate: boolean; dueDate: boolean; terms: boolean; reference: boolean; shipTo: boolean; notes: boolean; taxRegistration: boolean };
  table: { columns: DocumentColumn[]; striped: boolean; rowPadding: number };
  header: { text: string; continuationText: string; repeat: boolean };
  footer: { text: string; continuationText: string; repeat: boolean; pageNumbers: boolean; pageNumberFormat: "number" | "page_of_total" };
  titles: Record<DocumentKind, string>;
  sections: DocumentSectionKey[];
  signature: { enabled: boolean; label: string; name: string };
  totals: { showSubtotal: boolean; showDiscount: boolean; showTax: boolean; showPaid: boolean; showBalance: boolean };
};

type LegacyTemplate = { title?: string; footer?: string; accentColor?: string; showDescription?: boolean; layout?: string; design?: DocumentDesign };
const typography = (fontSize: number): DocumentTypography => ({ fontFamily: "brand", fontSize, color: "#18181b" });
export const DEFAULT_DOCUMENT_DESIGN: DocumentDesign = {
  version: 1,
  advanced: DEFAULT_ADVANCED_DOCUMENT_DESIGN,
  page: { orientation: "portrait", margins: { top: 42, right: 42, bottom: 52, left: 42 } },
  logo: { width: 200, alignment: "left" },
  typography: { body: typography(10), header: typography(22), customer: typography(10), table: typography(9), totals: typography(10), footer: typography(8) },
  labels: { number: "#", sku: "SKU", billTo: "Bill to", shipTo: "Ship to", issued: "Issued", due: "Due", terms: "Terms", reference: "Reference", item: "Item / service", description: "Description", quantity: "Quantity", unit: "Unit", rate: "Rate", tax: "Tax", amount: "Amount", subtotal: "Subtotal", discount: "Discount", total: "Total", paid: "Paid", balance: "Balance due", notes: "Notes", paymentInstructions: "Payment instructions" },
  fields: { organization: true, customerEmail: true, issueDate: true, dueDate: true, terms: true, reference: true, shipTo: false, notes: true, taxRegistration: true },
  table: { columns: [
    { key: "number", label: "#", width: 5, visible: false },
    { key: "sku", label: "SKU", width: 10, visible: false },
    { key: "item", label: "Item / service", width: 32, visible: true },
    { key: "description", label: "Description", width: 22, visible: true },
    { key: "quantity", label: "Quantity", width: 10, visible: true },
    { key: "unit", label: "Unit", width: 7, visible: false },
    { key: "rate", label: "Rate", width: 13, visible: true },
    { key: "tax", label: "Tax", width: 9, visible: true },
    { key: "amount", label: "Amount", width: 14, visible: true },
    { key: "image", label: "Image", width: 12, visible: false },
    { key: "manufacturer", label: "Manufacturer", width: 14, visible: false },
    { key: "partNumber", label: "Part number", width: 12, visible: false },
    { key: "upc", label: "UPC", width: 12, visible: false },
    { key: "ean", label: "EAN", width: 12, visible: false },
    { key: "isbn", label: "ISBN", width: 14, visible: false },
    { key: "customField", label: "Custom field", width: 14, visible: false },
  ], striped: false, rowPadding: 8 },
  header: { text: "", continuationText: "", repeat: false },
  footer: { text: "", continuationText: "", repeat: true, pageNumbers: false, pageNumberFormat: "page_of_total" },
  titles: { invoice: "Invoice", receipt: "Payment receipt", work_order: "Work order", report: "Financial report", quote: "Quote", statement: "Customer statement" },
  sections: [...DOCUMENT_SECTION_KEYS],
  signature: { enabled: false, label: "Authorized signature", name: "" },
  totals: { showSubtotal: true, showDiscount: true, showTax: true, showPaid: true, showBalance: true },
};

function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new Error(`Unknown ${label} setting: ${key}.`);
  return record;
}
function text(value: unknown, fallback: string, label: string, max: number): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} must be text of at most ${max} characters.`);
  return value.trim();
}
function number(value: unknown, fallback: number, label: string, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
function boolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be true or false.`);
  return value;
}
function choice<T extends string>(value: unknown, fallback: T, label: string, choices: readonly T[]): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`Choose a supported ${label}.`);
  return value as T;
}
function color(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${label} must be a six-digit color.`);
  return value;
}
function booleans<T extends Record<string, boolean>>(value: unknown, defaults: T, label: string): T {
  const record = object(value, label, Object.keys(defaults));
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, boolean(record[key], fallback, `${label} ${key}`)])) as T;
}

/** Deep defaults allow older snapshots to render without modifying their stored design. */
export function cleanDocumentDesign(input?: unknown, legacy: LegacyTemplate = {}): DocumentDesign {
  const base = DEFAULT_DOCUMENT_DESIGN;
  const value = object(input, "document design", Object.keys(base));
  if (value.version !== undefined && value.version !== 1) throw new Error("This document design version is not supported.");
  const page = object(value.page, "page", ["orientation", "margins"]);
  const margins = object(page.margins, "margins", ["top", "right", "bottom", "left"]);
  const logo = object(value.logo, "logo", ["width", "alignment"]);
  const fonts = object(value.typography, "typography", DOCUMENT_TYPOGRAPHY_KEYS);
  const labels = object(value.labels, "labels", DOCUMENT_LABEL_KEYS);
  const table = object(value.table, "table", ["columns", "striped", "rowPadding"]);
  const header = object(value.header, "header", ["text", "continuationText", "repeat"]);
  const footer = object(value.footer, "footer", ["text", "continuationText", "repeat", "pageNumbers", "pageNumberFormat"]);
  const titles = object(value.titles, "titles", DOCUMENT_KINDS);
  const signature = object(value.signature, "signature", ["enabled", "label", "name"]);
  const typographyConfig = Object.fromEntries(DOCUMENT_TYPOGRAPHY_KEYS.map((key) => {
    const settings = object(fonts[key], `${key} typography`, ["fontFamily", "fontSize", "color"]);
    return [key, {
      fontFamily: choice(settings.fontFamily, base.typography[key].fontFamily, "font family", DOCUMENT_FONT_CHOICES),
      fontSize: number(settings.fontSize, base.typography[key].fontSize, "Font size", 6, 36),
      color: color(settings.color, key === "header" ? legacy.accentColor ?? base.typography[key].color : base.typography[key].color, "Font color"),
    }];
  })) as DocumentDesign["typography"];
  let columns = base.table.columns.map((column) => ({ ...column, ...(column.key === "description" ? { visible: legacy.showDescription ?? column.visible } : {}) }));
  if (table.columns !== undefined) {
    if (!Array.isArray(table.columns) || table.columns.length < 9 || table.columns.length > DOCUMENT_COLUMN_KEYS.length) throw new Error("Include each document column once; hide unused columns with visibility.");
    const seen = new Set<string>();
    columns = table.columns.map((entry) => {
      const column = object(entry, "column", ["key", "label", "width", "visible"]);
      const key = choice(column.key, "item", "column", DOCUMENT_COLUMN_KEYS);
      if (column.key === undefined || seen.has(key)) throw new Error("Include each document column once.");
      seen.add(key);
      const fallback = base.table.columns.find((candidate) => candidate.key === key)!;
      return { key, label: text(column.label, String(labels[key] ?? fallback.label), "Column label", 80), width: number(column.width, fallback.width, "Column width", 1, 1000), visible: boolean(column.visible, fallback.visible, "Column visibility") };
    });
    if (DOCUMENT_COLUMN_KEYS.slice(0, 9).some((key) => !seen.has(key))) throw new Error("Include each original document column once.");
    columns.push(...base.table.columns.filter((column) => !seen.has(column.key)).map((column) => ({ ...column })));
  } else columns = columns.map((column) => ({ ...column, label: String(labels[column.key] ?? column.label) }));
  if (!columns.some((column) => column.visible)) throw new Error("Show at least one item column.");
  let sections = [...base.sections];
  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections) || value.sections.length !== DOCUMENT_SECTION_KEYS.length || new Set(value.sections).size !== DOCUMENT_SECTION_KEYS.length || value.sections.some((key) => !DOCUMENT_SECTION_KEYS.includes(key))) throw new Error("Include each document section once; use its visibility controls to hide it.");
    sections = [...value.sections] as DocumentSectionKey[];
  }
  return {
    version: 1,
    advanced: cleanDocumentAdvanced(value.advanced, { typography: typographyConfig, accentColor: legacy.accentColor }),
    page: { orientation: choice(page.orientation, base.page.orientation, "orientation", ["portrait", "landscape"]), margins: Object.fromEntries(Object.entries(base.page.margins).map(([key, fallback]) => [key, number(margins[key], fallback, "Page margin", 12, 144)])) as DocumentDesign["page"]["margins"] },
    logo: { width: number(logo.width, base.logo.width, "Logo width", 24, 280), alignment: choice(logo.alignment, base.logo.alignment, "logo alignment", ["left", "center", "right"]) },
    typography: typographyConfig,
    labels: Object.fromEntries(DOCUMENT_LABEL_KEYS.map((key) => [key, text(labels[key], base.labels[key], "Label", 80)])) as DocumentDesign["labels"],
    fields: booleans(value.fields, base.fields, "field visibility"),
    table: { columns, striped: boolean(table.striped, base.table.striped, "Striped rows"), rowPadding: number(table.rowPadding, legacy.layout === "compact" ? 5 : base.table.rowPadding, "Row padding", 2, 20) },
    header: { text: text(header.text, base.header.text, "Header", 2000), continuationText: text(header.continuationText, base.header.continuationText, "Continuation header", 2000), repeat: boolean(header.repeat, base.header.repeat, "Repeat header") },
    footer: { text: text(footer.text, legacy.footer ?? base.footer.text, "Footer", 2000), continuationText: text(footer.continuationText, base.footer.continuationText, "Continuation footer", 2000), repeat: boolean(footer.repeat, base.footer.repeat, "Repeat footer"), pageNumbers: boolean(footer.pageNumbers, base.footer.pageNumbers, "Page numbers"), pageNumberFormat: choice(footer.pageNumberFormat, base.footer.pageNumberFormat, "page-number format", ["number", "page_of_total"]) },
    titles: Object.fromEntries(DOCUMENT_KINDS.map((key) => [key, text(titles[key], key === "invoice" ? legacy.title ?? base.titles.invoice : base.titles[key], "Document title", 80)])) as DocumentDesign["titles"],
    sections,
    signature: { enabled: boolean(signature.enabled, base.signature.enabled, "Signature"), label: text(signature.label, base.signature.label, "Signature label", 80), name: text(signature.name, base.signature.name, "Signature name", 200) },
    totals: booleans(value.totals, base.totals, "total visibility"),
  };
}

export function resolveDocumentDesign(config?: LegacyTemplate | null): DocumentDesign {
  return cleanDocumentDesign(config?.design, config ?? {});
}

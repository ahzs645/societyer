import ddcnorthKit from "./brandKits/ddcnorth.json";
import { importInvoiceBrand } from "./invoiceBranding";
import {
  cleanInvoiceTemplate, cleanDocumentAdvanced, DEFAULT_INVOICE_TEMPLATE, resolveDocumentDesign,
  type DocumentColumnKey, type DocumentDesign, type DocumentKind, type DocumentTypography,
  type InvoiceTemplate,
} from "./invoiceCommerce";

export type DocumentTemplatePreset = {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  recommendedDocumentKind: DocumentKind;
  config: InvoiceTemplate;
};

const ddcnorth = importInvoiceBrand(ddcnorthKit, "https://projects.ahmadjalil.com/brandkit/?brand=ddcnorth");

function columns(design: DocumentDesign, visible: DocumentColumnKey[], widths: Partial<Record<DocumentColumnKey, number>> = {}, order: DocumentColumnKey[] = []) {
  const keys = [...order, ...design.table.columns.map((column) => column.key).filter((key) => !order.includes(key))];
  design.table.columns = keys.map((key) => {
    const column = design.table.columns.find((candidate) => candidate.key === key)!;
    return { ...column, visible: visible.includes(key), width: widths[key] ?? column.width };
  });
}
function font(design: DocumentDesign, family: DocumentTypography["fontFamily"], color = "#18181b") {
  for (const section of Object.keys(design.typography) as Array<keyof DocumentDesign["typography"]>) design.typography[section] = { ...design.typography[section], fontFamily: family, color };
}
function label(design: DocumentDesign, key: keyof DocumentDesign["labels"], value: string) {
  design.labels[key] = value;
  const column = design.table.columns.find((candidate) => candidate.key === key);
  if (column) column.label = value;
}
function make(name: string, options: Partial<InvoiceTemplate>, customize: (design: DocumentDesign) => void): InvoiceTemplate {
  const config = { ...DEFAULT_INVOICE_TEMPLATE, name, ...options };
  const design = resolveDocumentDesign(config);
  customize(design);
  // Advanced element defaults inherit the final preset's existing section typography.
  design.advanced = cleanDocumentAdvanced(undefined, { typography: design.typography, accentColor: config.accentColor });
  // The legacy fields remain useful for old exports; the versioned design is authoritative.
  return cleanInvoiceTemplate({ ...config, title: design.titles.invoice, footer: design.footer.text, design });
}

const presets: DocumentTemplatePreset[] = [
  {
    id: "ddcnorth-signature", name: "ddcnorth · Signature", recommendedDocumentKind: "invoice",
    description: "Midnight brand color, generous spacing, and a prominent primary logo for project invoices.",
    tags: ["ddcnorth", "invoice", "portrait", "spacious"],
    config: make("ddcnorth · Signature", { brand: ddcnorth, accentColor: ddcnorth.primary, layout: "classic" }, (design) => {
      design.page.margins = { top: 42, right: 44, bottom: 52, left: 44 };
      design.logo.width = 210;
      design.typography.header.fontSize = 26;
      columns(design, ["item", "quantity", "rate", "tax", "amount"], { item: 45, quantity: 12, rate: 15, tax: 10, amount: 18 });
      design.footer.text = "Thank you for your business.";
      design.footer.pageNumbers = true;
    }),
  },
  {
    id: "ddcnorth-studio", name: "ddcnorth · Studio", recommendedDocumentKind: "quote",
    description: "Reversed white logo on midnight, a larger title, and striped service rows on A4 paper.",
    tags: ["ddcnorth", "invoice", "reverse logo", "a4"],
    config: make("ddcnorth · Studio", { brand: ddcnorth, logoVariant: "reverse", accentColor: ddcnorth.primary, layout: "modern", paperSize: "a4" }, (design) => {
      design.page.margins = { top: 36, right: 36, bottom: 48, left: 36 };
      design.logo = { width: 225, alignment: "center" };
      design.typography.header.fontSize = 30;
      design.typography.table.fontSize = 10;
      design.table.striped = true;
      design.table.rowPadding = 10;
      columns(design, ["number", "item", "description", "amount"], { number: 6, item: 30, description: 44, amount: 20 });
      label(design, "item", "Service");
      label(design, "amount", "Line total");
      design.footer.pageNumbers = true;
      design.footer.text = "Please include the invoice number with your payment.";
    }),
  },
  {
    id: "ddcnorth-compact-services", name: "ddcnorth · Compact services", recommendedDocumentKind: "invoice",
    description: "Small logo, tight rows, separate units, and a service code column for longer rate tables.",
    tags: ["ddcnorth", "invoice", "compact", "rates"],
    config: make("ddcnorth · Compact services", { brand: ddcnorth, accentColor: ddcnorth.primary, layout: "compact", showDescription: false }, (design) => {
      design.page.margins = { top: 28, right: 28, bottom: 38, left: 28 };
      design.logo.width = 145;
      design.typography.body.fontSize = 9;
      design.typography.header.fontSize = 19;
      design.typography.customer.fontSize = 8;
      design.typography.table = { fontFamily: "mono", fontSize: 8, color: ddcnorth.primary };
      design.typography.totals.fontSize = 9;
      design.table.rowPadding = 4;
      columns(design, ["sku", "item", "quantity", "unit", "rate", "amount"], { sku: 12, item: 34, quantity: 9, unit: 10, rate: 16, amount: 19 });
      label(design, "sku", "Code");
      design.header.repeat = true;
      design.header.continuationText = "Services and rates — continued";
      design.footer.pageNumbers = true;
    }),
  },
  {
    id: "ddcnorth-payment-receipt", name: "ddcnorth · Payment receipt", recommendedDocumentKind: "receipt",
    description: "A centered primary logo, reduced date details, and clear received-from and payment labels.",
    tags: ["ddcnorth", "receipt", "payment", "portrait"],
    config: make("ddcnorth · Payment receipt", { brand: ddcnorth, accentColor: ddcnorth.primary, layout: "classic", showPaymentInstructions: false, showDescription: false }, (design) => {
      design.page.margins = { top: 52, right: 54, bottom: 52, left: 54 };
      design.logo = { width: 165, alignment: "center" };
      design.typography.header.fontSize = 24;
      design.typography.totals.fontSize = 12;
      design.fields.dueDate = false;
      design.fields.terms = false;
      label(design, "billTo", "Received from");
      label(design, "issued", "Receipt date");
      label(design, "item", "Payment for");
      label(design, "amount", "Amount received");
      columns(design, ["item", "quantity", "amount"], { item: 56, quantity: 12, amount: 32 });
      design.table.rowPadding = 10;
      design.totals.showSubtotal = false;
      design.totals.showDiscount = false;
      design.totals.showTax = false;
      design.footer.text = "Thank you. Please keep this receipt for your records.";
    }),
  },
  {
    id: "ddcnorth-repair-order", name: "ddcnorth · Repair work order", recommendedDocumentKind: "work_order",
    description: "Black brand logo, numbered parts and labour, notes before charges, and an approval signature line.",
    tags: ["ddcnorth", "work_order", "repair", "signature"],
    config: make("ddcnorth · Repair work order", { brand: ddcnorth, logoVariant: "black", accentColor: "#20262d", layout: "compact", showPaymentInstructions: false }, (design) => {
      design.page.margins = { top: 32, right: 32, bottom: 44, left: 32 };
      design.logo.width = 175;
      design.typography.header = { fontFamily: "brand", fontSize: 22, color: "#20262d" };
      design.typography.table.fontSize = 9;
      design.table.striped = true;
      design.table.rowPadding = 6;
      columns(design, ["number", "sku", "item", "quantity", "unit", "rate", "amount"], { number: 5, sku: 12, item: 31, quantity: 9, unit: 9, rate: 16, amount: 18 });
      label(design, "billTo", "Customer");
      label(design, "item", "Part / labour");
      label(design, "notes", "Reported issue and work notes");
      design.sections = ["header", "customer", "notes", "items", "totals", "paymentInstructions", "signature"];
      design.signature = { enabled: true, label: "Customer approval", name: "" };
      design.header.repeat = true;
      design.header.continuationText = "Work order — continued";
      design.footer.pageNumbers = true;
    }),
  },
  {
    id: "ddcnorth-landscape-financials", name: "ddcnorth · Landscape financials", recommendedDocumentKind: "report",
    description: "Wide A4 pages, compact financial tables, muted section type, and continuation page numbers.",
    tags: ["ddcnorth", "report", "landscape", "a4"],
    config: make("ddcnorth · Landscape financials", { brand: ddcnorth, accentColor: ddcnorth.primary, layout: "modern", paperSize: "a4" }, (design) => {
      design.page.orientation = "landscape";
      design.page.margins = { top: 34, right: 34, bottom: 42, left: 34 };
      design.logo = { width: 170, alignment: "left" };
      design.typography.header.fontSize = 21;
      design.typography.body.fontSize = 9;
      design.typography.table.fontSize = 8;
      design.typography.customer.color = ddcnorth.muted;
      design.table.rowPadding = 5;
      design.table.striped = true;
      design.header.repeat = true;
      design.header.continuationText = "Financial report — continued";
      design.footer.text = "Report dates, currency and filters are stated in this document.";
      design.footer.pageNumbers = true;
      columns(design, ["number", "item", "description", "quantity", "rate", "amount"], { number: 5, item: 28, description: 30, quantity: 9, rate: 13, amount: 15 });
    }),
  },
  {
    id: "classic-serif", name: "Classic serif", recommendedDocumentKind: "invoice",
    description: "Traditional serif typography, wide margins, and a quiet slate accent using your organization's identity.",
    tags: ["organization", "invoice", "serif", "classic"],
    config: make("Classic serif", { accentColor: "#384452", layout: "classic" }, (design) => {
      font(design, "serif", "#282d34");
      design.typography.header.fontSize = 27;
      design.page.margins = { top: 52, right: 50, bottom: 54, left: 50 };
      design.logo.width = 150;
      design.table.rowPadding = 9;
      columns(design, ["item", "description", "quantity", "rate", "amount"], { item: 29, description: 29, quantity: 10, rate: 15, amount: 17 });
      design.footer.text = "Thank you for your business.";
      design.footer.pageNumbers = true;
    }),
  },
  {
    id: "minimal-sans", name: "Minimal sans", recommendedDocumentKind: "invoice",
    description: "A larger sans-serif title, open spacing, and just service, quantity, rate and amount columns.",
    tags: ["organization", "invoice", "sans", "minimal"],
    config: make("Minimal sans", { accentColor: "#26384a", layout: "modern", showDescription: false }, (design) => {
      font(design, "sans", "#18222d");
      design.typography.header.fontSize = 32;
      design.page.margins = { top: 48, right: 48, bottom: 48, left: 48 };
      design.logo = { width: 135, alignment: "right" };
      design.table.rowPadding = 12;
      columns(design, ["item", "quantity", "rate", "amount"], { item: 48, quantity: 12, rate: 19, amount: 21 });
      design.fields.customerEmail = false;
      design.fields.terms = false;
      label(design, "item", "Service");
      design.footer.text = "";
    }),
  },
  {
    id: "monochrome-grid", name: "Monochrome", recommendedDocumentKind: "statement",
    description: "Black and white tables, monospaced line details, numbered rows, and dense striping for clear printing.",
    tags: ["organization", "invoice", "monochrome", "compact"],
    config: make("Monochrome", { accentColor: "#171717", logoVariant: "black", layout: "compact", showDescription: false }, (design) => {
      font(design, "sans", "#171717");
      design.typography.table = { fontFamily: "mono", fontSize: 8, color: "#171717" };
      design.typography.header.fontSize = 24;
      design.page.margins = { top: 32, right: 34, bottom: 40, left: 34 };
      design.logo.width = 140;
      columns(design, ["number", "sku", "item", "quantity", "rate", "tax", "amount"], { number: 5, sku: 12, item: 29, quantity: 9, rate: 15, tax: 10, amount: 20 });
      design.table.striped = true;
      design.table.rowPadding = 5;
      design.footer.pageNumbers = true;
      design.footer.pageNumberFormat = "number";
    }),
  },
  {
    id: "detailed-services-shipping", name: "Detailed services & shipping", recommendedDocumentKind: "invoice",
    description: "Separate billing and delivery blocks, full descriptions, SKU and unit columns, and roomy landscape pages.",
    tags: ["organization", "invoice", "shipping", "landscape"],
    config: make("Detailed services & shipping", { accentColor: "#315568", layout: "classic", paperSize: "a4" }, (design) => {
      font(design, "sans", "#213846");
      design.page.orientation = "landscape";
      design.page.margins = { top: 24, right: 28, bottom: 36, left: 28 };
      design.logo.width = 165;
      design.typography.body.fontSize = 9;
      design.typography.customer.fontSize = 8;
      design.typography.header.fontSize = 21;
      design.typography.table.fontSize = 8;
      design.typography.totals.fontSize = 9;
      design.fields.shipTo = true;
      columns(design, ["number", "sku", "item", "description", "quantity", "unit", "rate", "tax", "amount"], { number: 4, sku: 10, item: 21, description: 27, quantity: 7, unit: 7, rate: 10, tax: 6, amount: 12 });
      design.table.striped = true;
      design.table.rowPadding = 4;
      design.header.repeat = true;
      design.header.continuationText = "Itemized services — continued";
      design.footer.pageNumbers = true;
    }),
  },
  {
    id: "friendly-green", name: "Friendly green", recommendedDocumentKind: "receipt",
    description: "Warm green accents, generous readable type, and a simple receipt layout with a friendly closing note.",
    tags: ["organization", "receipt", "green", "spacious"],
    config: make("Friendly green", { accentColor: "#276653", layout: "modern", showPaymentInstructions: false }, (design) => {
      font(design, "sans", "#244139");
      design.typography.header = { fontFamily: "sans", fontSize: 28, color: "#276653" };
      design.typography.customer.fontSize = 11;
      design.typography.table.fontSize = 11;
      design.typography.totals.fontSize = 12;
      design.page.margins = { top: 46, right: 44, bottom: 52, left: 44 };
      design.logo = { width: 160, alignment: "center" };
      design.fields.dueDate = false;
      design.fields.terms = false;
      design.table.rowPadding = 11;
      columns(design, ["item", "description", "amount"], { item: 34, description: 43, amount: 23 });
      label(design, "billTo", "Received from");
      label(design, "item", "Details");
      design.totals.showSubtotal = false;
      design.footer.text = "Thank you — we appreciate your support.";
      design.footer.pageNumbers = true;
    }),
  },
  {
    id: "formal-financial-report", name: "Formal financial report", recommendedDocumentKind: "report",
    description: "Portrait A4 with serif headings, compact sans-serif tables, restrained blue, and numbered continuation pages.",
    tags: ["organization", "report", "a4", "formal"],
    config: make("Formal financial report", { accentColor: "#34495e", layout: "classic", paperSize: "a4" }, (design) => {
      font(design, "serif", "#263442");
      design.typography.header.fontSize = 25;
      design.typography.table = { fontFamily: "sans", fontSize: 8, color: "#263442" };
      design.typography.footer = { fontFamily: "sans", fontSize: 8, color: "#4b5563" };
      design.page.margins = { top: 46, right: 42, bottom: 50, left: 42 };
      design.logo = { width: 145, alignment: "right" };
      design.table.rowPadding = 5;
      design.table.striped = false;
      design.header.repeat = true;
      design.header.continuationText = "Financial report — continued";
      design.footer.pageNumbers = true;
      design.footer.text = "Prepared for review. Refer to the dates, basis and filters stated in the report.";
      columns(design, ["item", "description", "quantity", "rate", "amount"], { item: 32, description: 28, quantity: 10, rate: 14, amount: 16 });
    }),
  },
];

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Built-ins are immutable starting points; saving always creates a workspace-owned template. */
export const DOCUMENT_TEMPLATE_PRESETS: readonly DocumentTemplatePreset[] = freeze(presets);

/** Each use receives independent page, type, column and brand settings. */
export function freshDocumentTemplatePreset(id: string): InvoiceTemplate {
  const preset = DOCUMENT_TEMPLATE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error("Choose an available document template.");
  return cleanInvoiceTemplate(JSON.parse(JSON.stringify(preset.config)) as InvoiceTemplate);
}

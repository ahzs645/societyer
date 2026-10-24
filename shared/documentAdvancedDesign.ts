import type { DocumentDesign, DocumentTypography } from "./documentDesign";
import { cleanDocumentImage, cleanDocumentLink, sanitizeDocumentHtml } from "./documentRichContent";

export const DOCUMENT_FONT_CHOICES = ["brand", "sans", "serif", "mono", "inter", "inter_display", "space_mono", "noto_serif", "open_sans", "liberation_serif"] as const;
export const DOCUMENT_ELEMENT_TYPOGRAPHY_KEYS = ["organizationName", "organizationAddress", "customerName", "customerAddress", "labels", "title", "documentNumber", "itemDescription", "columnHeader", "balance", "notes", "terms", "signature", "payment"] as const;
export const DOCUMENT_ADVANCED_LABEL_KEYS = ["documentNumber", "terms", "bank", "onlinePayment", "paymentStub", "amountWords", "baseCurrency", "taxSummary", "taxableAmount", "taxAmount", "shipping", "credit", "writeOff", "withholding"] as const;
export const DOCUMENT_BLOCK_PLACEMENTS = ["before_items", "after_items", "after_totals", "end"] as const;
export type DocumentBlockPlacement = (typeof DOCUMENT_BLOCK_PLACEMENTS)[number];
export type DocumentElementTypographyKey = (typeof DOCUMENT_ELEMENT_TYPOGRAPHY_KEYS)[number];
export type DocumentBackground = { color: string; image: string; opacity: number; position: "top_left" | "top_center" | "top_right" | "center" | "bottom_left" | "bottom_center" | "bottom_right"; fit: "contain" | "cover" | "stretch" };
export type DocumentAddressBlock = { format: string; placement: "flow" | "absolute"; x: number; y: number; width: number };
export type DocumentSignaturePlacement = { image: string; placement: "flow" | "absolute"; x: number; y: number; width: number; height: number };
export type AdvancedDocumentDesign = {
  page: { customSize: boolean; width: number; height: number; firstHeaderHeight: number; pageNumber: { position: "footer" | "custom"; alignment: "left" | "center" | "right"; x: number; y: number } };
  logo: { height: number; preserveAspectRatio: boolean };
  addresses: Record<"organization" | "billing" | "shipping", DocumentAddressBlock>;
  backgrounds: Record<"body" | "header" | "footer", DocumentBackground>;
  colors: { border: string; sectionBackground: string; tableHeaderBackground: string; rowBackground: string; alternateRowBackground: string; totalsBackground: string; balanceBackground: string };
  typography: Record<DocumentElementTypographyKey, DocumentTypography>;
  visibility: { organizationName: boolean; organizationAddress: boolean; title: boolean; documentNumber: boolean; billTo: boolean; finalTotal: boolean; headerBalance: boolean; statusStamp: boolean };
  labels: Record<(typeof DOCUMENT_ADVANCED_LABEL_KEYS)[number], string>;
  stamp: { text: string; color: string; rotation: number; placement: "header" | "customer" | "totals" };
  rich: { headerHtml: string; continuationHeaderHtml: string; footerHtml: string; continuationFooterHtml: string };
  terms: { enabled: boolean; html: string; placement: DocumentBlockPlacement };
  bank: { enabled: boolean; fields: Array<{ label: string; value: string }>; placement: DocumentBlockPlacement };
  onlinePayment: { enabled: boolean; url: string; label: string; showQr: boolean; placement: DocumentBlockPlacement };
  paymentStub: { enabled: boolean; firstPageOnly: boolean; instructions: string; placement: DocumentBlockPlacement };
  taxSummary: { enabled: boolean; showTaxableBase: boolean; showTaxAmount: boolean; placement: DocumentBlockPlacement };
  amountWords: { enabled: boolean; placement: DocumentBlockPlacement };
  baseCurrency: { enabled: boolean; showRate: boolean };
  adjustments: { showShipping: boolean; showCredits: boolean; showWriteOff: boolean; showWithholding: boolean };
  signature: DocumentSignaturePlacement;
  receiverSignature: DocumentSignaturePlacement & { enabled: boolean; label: string; name: string };
  annexures: { enabled: boolean; title: string; showAttachments: boolean; showBatches: boolean; showSerials: boolean };
  appendices: Array<{ title: string; html: string; image: string }>;
};

const font = (fontSize = 10): DocumentTypography => ({ fontFamily: "brand", fontSize, color: "#18181b" });
const address = (): DocumentAddressBlock => ({ format: "", placement: "flow", x: 0, y: 0, width: 180 });
const background = (): DocumentBackground => ({ color: "#ffffff", image: "", opacity: 1, position: "center", fit: "contain" });
const signature = (): DocumentSignaturePlacement => ({ image: "", placement: "flow", x: 0, y: 0, width: 160, height: 60 });
export const DEFAULT_ADVANCED_DOCUMENT_DESIGN: AdvancedDocumentDesign = {
  page: { customSize: false, width: 612, height: 792, firstHeaderHeight: 0, pageNumber: { position: "footer", alignment: "right", x: 42, y: 24 } },
  logo: { height: 0, preserveAspectRatio: true },
  addresses: { organization: address(), billing: address(), shipping: address() },
  backgrounds: { body: background(), header: background(), footer: background() },
  colors: { border: "#d4d4d8", sectionBackground: "#ffffff", tableHeaderBackground: "#245c46", rowBackground: "#ffffff", alternateRowBackground: "#f4f4f5", totalsBackground: "#ffffff", balanceBackground: "#ffffff" },
  typography: { organizationName: font(), organizationAddress: font(), customerName: font(), customerAddress: font(), labels: font(), title: font(22), documentNumber: font(), itemDescription: font(9), columnHeader: { ...font(9), color: "#ffffff" }, balance: font(), notes: font(), terms: font(), signature: font(), payment: font() },
  visibility: { organizationName: true, organizationAddress: true, title: true, documentNumber: true, billTo: true, finalTotal: true, headerBalance: false, statusStamp: true },
  labels: { documentNumber: "Number", terms: "Terms & conditions", bank: "Bank details", onlinePayment: "Online payment", paymentStub: "Payment stub", amountWords: "Amount in words", baseCurrency: "Base currency", taxSummary: "Tax summary", taxableAmount: "Taxable amount", taxAmount: "Tax amount", shipping: "Shipping", credit: "Credits applied", writeOff: "Write-off", withholding: "Withholding" },
  stamp: { text: "", color: "#6b7280", rotation: -12, placement: "customer" },
  rich: { headerHtml: "", continuationHeaderHtml: "", footerHtml: "", continuationFooterHtml: "" },
  terms: { enabled: false, html: "", placement: "end" },
  bank: { enabled: false, fields: [], placement: "after_totals" },
  onlinePayment: { enabled: false, url: "", label: "Pay online", showQr: false, placement: "after_totals" },
  paymentStub: { enabled: false, firstPageOnly: true, instructions: "", placement: "end" },
  taxSummary: { enabled: false, showTaxableBase: true, showTaxAmount: true, placement: "after_totals" },
  amountWords: { enabled: false, placement: "after_totals" },
  baseCurrency: { enabled: false, showRate: true },
  adjustments: { showShipping: true, showCredits: true, showWriteOff: true, showWithholding: true },
  signature: signature(),
  receiverSignature: { ...signature(), enabled: false, label: "Received by", name: "" },
  annexures: { enabled: false, title: "Attachments & inventory details", showAttachments: true, showBatches: true, showSerials: true }, appendices: [],
};

const obj = (value: unknown, label: string, keys: readonly string[]): Record<string, unknown> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown ${label} setting: ${key}.`);
  return value as Record<string, unknown>;
};
const str = (value: unknown, fallback: string, max = 2000): string => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > max) throw new Error(`Document text must be at most ${max} characters.`);
  return value.trim();
};
const num = (value: unknown, fallback: number, min = 0, max = 2000): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Document measurement must be between ${min} and ${max}.`);
  return value;
};
const bool = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("Document visibility must be true or false.");
  return value;
};
const choice = <T extends string>(value: unknown, fallback: T, choices: readonly T[]): T => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error("Choose a supported document option.");
  return value as T;
};
const hex = (value: unknown, fallback: string): string => {
  const text = str(value, fallback, 7);
  if (!/^#[0-9a-f]{6}$/i.test(text)) throw new Error("Choose a six-digit document color.");
  return text;
};
const flags = <T extends Record<string, boolean>>(input: unknown, base: T): T => {
  const raw = obj(input, "visibility", Object.keys(base));
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, bool(raw[key], value)])) as T;
};
const placement = (value: unknown, fallback: DocumentBlockPlacement) => choice(value, fallback, DOCUMENT_BLOCK_PLACEMENTS);
const image = (value: unknown) => cleanDocumentImage(value ?? "");
const rich = (value: unknown) => sanitizeDocumentHtml(value ?? "");
const signatureConfig = (value: unknown, base: DocumentSignaturePlacement): DocumentSignaturePlacement => {
  const raw = obj(value, "signature placement", Object.keys(base));
  return { image: image(raw.image), placement: choice(raw.placement, base.placement, ["flow", "absolute"]), x: num(raw.x, base.x), y: num(raw.y, base.y), width: num(raw.width, base.width, 16, 500), height: num(raw.height, base.height, 8, 250) };
};

/** Additive v1 defaults preserve old snapshots; all external content is passive and bounded. */
export function cleanDocumentAdvanced(input?: unknown, context?: { typography?: DocumentDesign["typography"]; accentColor?: string }): AdvancedDocumentDesign {
  const base = DEFAULT_ADVANCED_DOCUMENT_DESIGN;
  const raw = obj(input, "advanced document", Object.keys(base));
  const page = obj(raw.page, "advanced page", Object.keys(base.page));
  const pageNumber = obj(page.pageNumber, "page number position", Object.keys(base.page.pageNumber));
  const logo = obj(raw.logo, "logo geometry", Object.keys(base.logo));
  const addresses = obj(raw.addresses, "address blocks", Object.keys(base.addresses));
  const backgrounds = obj(raw.backgrounds, "backgrounds", Object.keys(base.backgrounds));
  const colors = obj(raw.colors, "document colors", Object.keys(base.colors));
  const type = obj(raw.typography, "element typography", DOCUMENT_ELEMENT_TYPOGRAPHY_KEYS);
  const labels = obj(raw.labels, "advanced labels", DOCUMENT_ADVANCED_LABEL_KEYS);
  const stamp = obj(raw.stamp, "status stamp", Object.keys(base.stamp));
  const content = obj(raw.rich, "rich content", Object.keys(base.rich));
  const terms = obj(raw.terms, "terms block", Object.keys(base.terms));
  const bank = obj(raw.bank, "bank block", Object.keys(base.bank));
  const online = obj(raw.onlinePayment, "online payment", Object.keys(base.onlinePayment));
  const stub = obj(raw.paymentStub, "payment stub", Object.keys(base.paymentStub));
  const tax = obj(raw.taxSummary, "tax summary", Object.keys(base.taxSummary));
  const words = obj(raw.amountWords, "amount in words", Object.keys(base.amountWords));
  const receiver = obj(raw.receiverSignature, "receiver signature", Object.keys(base.receiverSignature));
  const annex = obj(raw.annexures, "annexures", Object.keys(base.annexures));
  const sourceFonts = context?.typography;
  const typography = Object.fromEntries(DOCUMENT_ELEMENT_TYPOGRAPHY_KEYS.map((key) => {
    const element = obj(type[key], "element font", ["fontFamily", "fontSize", "color"]);
    const group = key === "title" ? sourceFonts?.header : ["itemDescription", "columnHeader"].includes(key) ? sourceFonts?.table : key === "balance" ? sourceFonts?.totals : ["organizationName", "organizationAddress", "customerName", "customerAddress"].includes(key) ? sourceFonts?.customer : sourceFonts?.body;
    const fallback = { ...base.typography[key], ...(group ?? {}), ...(key === "columnHeader" ? { color: "#ffffff" } : {}) };
    return [key, { fontFamily: choice(element.fontFamily, fallback.fontFamily, DOCUMENT_FONT_CHOICES), fontSize: num(element.fontSize, fallback.fontSize, 6, 60), color: hex(element.color, fallback.color) }];
  })) as AdvancedDocumentDesign["typography"];
  const parsedAddresses = Object.fromEntries(Object.entries(base.addresses).map(([key, fallback]) => {
    const value = obj(addresses[key], "address layout", Object.keys(fallback));
    const format = str(value.format, "", 2000);
    for (const match of format.matchAll(/\{\{([^}]+)\}\}/g)) if (!["name", "address", "email", "registrationNumber", "taxNumber"].includes(match[1])) throw new Error(`Unknown address token: ${match[1]}.`);
    return [key, { format, placement: choice(value.placement, fallback.placement, ["flow", "absolute"]), x: num(value.x, 0), y: num(value.y, 0), width: num(value.width, fallback.width, 24, 1000) }];
  })) as AdvancedDocumentDesign["addresses"];
  const parsedBackgrounds = Object.fromEntries(Object.entries(base.backgrounds).map(([key, fallback]) => {
    const value = obj(backgrounds[key], "background artwork", Object.keys(fallback));
    return [key, { color: hex(value.color, fallback.color), image: image(value.image), opacity: num(value.opacity, 1, 0, 1), position: choice(value.position, fallback.position, ["top_left", "top_center", "top_right", "center", "bottom_left", "bottom_center", "bottom_right"]), fit: choice(value.fit, fallback.fit, ["contain", "cover", "stretch"]) }];
  })) as AdvancedDocumentDesign["backgrounds"];
  const paymentUrl = str(online.url, "", 2000);
  if (paymentUrl && !/^https:\/\/[a-z0-9][^\s<>"']*$/i.test(paymentUrl)) throw new Error("Use an https payment link.");
  cleanDocumentLink(paymentUrl);
  if (bank.fields !== undefined && (!Array.isArray(bank.fields) || bank.fields.length > 20)) throw new Error("Add up to 20 bank fields.");
  const fields = ((bank.fields ?? []) as unknown[]).map((field) => { const value = obj(field, "bank field", ["label", "value"]); return { label: str(value.label, "", 80), value: str(value.value, "", 500) }; });
  if (raw.appendices !== undefined && (!Array.isArray(raw.appendices) || raw.appendices.length > 12)) throw new Error("Add up to 12 document appendices.");
  const appendices = ((raw.appendices ?? []) as unknown[]).map((appendix) => { const value = obj(appendix, "appendix", ["title", "html", "image"]); return { title: str(value.title, "", 100), html: rich(value.html), image: image(value.image) }; });
  const result: AdvancedDocumentDesign = {
    page: { customSize: bool(page.customSize, false), width: num(page.width, base.page.width, 144, 2000), height: num(page.height, base.page.height, 144, 2000), firstHeaderHeight: num(page.firstHeaderHeight, 0, 0, 500), pageNumber: { position: choice(pageNumber.position, "footer", ["footer", "custom"]), alignment: choice(pageNumber.alignment, "right", ["left", "center", "right"]), x: num(pageNumber.x, 42), y: num(pageNumber.y, 24) } },
    logo: { height: num(logo.height, 0, 0, 500), preserveAspectRatio: bool(logo.preserveAspectRatio, true) },
    addresses: parsedAddresses, backgrounds: parsedBackgrounds,
    colors: Object.fromEntries(Object.entries(base.colors).map(([key, value]) => [key, hex(colors[key], key === "tableHeaderBackground" ? context?.accentColor ?? value : value)])) as AdvancedDocumentDesign["colors"],
    typography, visibility: flags(raw.visibility, base.visibility),
    labels: Object.fromEntries(DOCUMENT_ADVANCED_LABEL_KEYS.map((key) => [key, str(labels[key], base.labels[key], 80)])) as AdvancedDocumentDesign["labels"],
    stamp: { text: str(stamp.text, "", 80), color: hex(stamp.color, base.stamp.color), rotation: num(stamp.rotation, -12, -90, 90), placement: choice(stamp.placement, "customer", ["header", "customer", "totals"]) },
    rich: { headerHtml: rich(content.headerHtml), continuationHeaderHtml: rich(content.continuationHeaderHtml), footerHtml: rich(content.footerHtml), continuationFooterHtml: rich(content.continuationFooterHtml) },
    terms: { enabled: bool(terms.enabled, false), html: rich(terms.html), placement: placement(terms.placement, "end") },
    bank: { enabled: bool(bank.enabled, false), fields, placement: placement(bank.placement, "after_totals") },
    onlinePayment: { enabled: bool(online.enabled, false), url: paymentUrl, label: str(online.label, "Pay online", 80), showQr: bool(online.showQr, false), placement: placement(online.placement, "after_totals") },
    paymentStub: { enabled: bool(stub.enabled, false), firstPageOnly: bool(stub.firstPageOnly, true), instructions: str(stub.instructions, "", 2000), placement: placement(stub.placement, "end") },
    taxSummary: { enabled: bool(tax.enabled, false), showTaxableBase: bool(tax.showTaxableBase, true), showTaxAmount: bool(tax.showTaxAmount, true), placement: placement(tax.placement, "after_totals") },
    amountWords: { enabled: bool(words.enabled, false), placement: placement(words.placement, "after_totals") },
    baseCurrency: flags(raw.baseCurrency, base.baseCurrency), adjustments: flags(raw.adjustments, base.adjustments),
    signature: signatureConfig(raw.signature, base.signature),
    receiverSignature: { ...signatureConfig(Object.fromEntries(Object.entries(receiver).filter(([key]) => Object.keys(base.signature).includes(key))), base.signature), enabled: bool(receiver.enabled, false), label: str(receiver.label, base.receiverSignature.label, 80), name: str(receiver.name, "", 200) },
    annexures: { enabled: bool(annex.enabled, false), title: str(annex.title, base.annexures.title, 100), showAttachments: bool(annex.showAttachments, true), showBatches: bool(annex.showBatches, true), showSerials: bool(annex.showSerials, true) }, appendices,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 650_000) throw new Error("Combined document artwork and content must be smaller than 650 KB.");
  return result;
}

export function resolveDocumentAdvanced(design?: Pick<DocumentDesign, "advanced" | "typography"> | null): AdvancedDocumentDesign {
  return cleanDocumentAdvanced(design?.advanced, { typography: design?.typography });
}

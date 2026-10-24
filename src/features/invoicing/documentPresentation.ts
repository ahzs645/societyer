import type { FontRegistration } from "@formepdf/react";
import { cleanInvoiceTemplate, DEFAULT_DOCUMENT_DESIGN, resolveDocumentAdvanced, resolveDocumentDesign, type DocumentColumnKey, type DocumentDesign, type DocumentBackground, type DocumentAddressBlock } from "../../../shared/invoiceCommerce";
import { computeInvoiceTotals, lineAmountCents, INVOICE_TERMS_LABEL, settlementTotals, convertInvoiceCents, type InvoiceTerms } from "../../../shared/invoicing";
import { cleanDocumentExtras, documentAmountInWords } from "../../../shared/documentExtras";
import type { InvoiceDocumentData } from "./InvoiceDocument";

export const DOCUMENT_CSS_FONTS = { sans: '"Invoice Inter", Arial, sans-serif', serif: '"Noto Serif", Georgia, serif', mono: '"Invoice Mono", monospace', inter: '"Invoice Inter", Arial, sans-serif', inter_display: '"Invoice Display", Arial, sans-serif', space_mono: '"Invoice Mono", monospace', noto_serif: '"Noto Serif", Georgia, serif', open_sans: '"Invoice Open Sans", Arial, sans-serif', liberation_serif: '"Invoice Liberation Serif", Georgia, serif' };
export function documentPdfFontFamily(family: DocumentDesign["typography"]["body"]["fontFamily"], fonts?: FontRegistration[]): string {
  const requested = ({ brand: "Invoice", sans: "InvoiceSans", serif: "InvoiceSerif", mono: "InvoiceMono", inter: "InvoiceSans", inter_display: "InvoiceDisplay", space_mono: "InvoiceMono", noto_serif: "InvoiceSerif", open_sans: "InvoiceOpenSans", liberation_serif: "InvoiceLiberationSerif" })[family];
  return fonts?.some((font) => font.family === requested) ? requested : ["serif", "noto_serif", "liberation_serif"].includes(family) ? "Times-Roman" : ["mono", "space_mono"].includes(family) ? "Courier" : fonts?.some((font) => font.family === "Invoice") ? "Invoice" : "Helvetica";
}
export function documentCssFont(family: DocumentDesign["typography"]["body"]["fontFamily"], brandFont?: string) { return family === "brand" ? !brandFont || brandFont === "serif" ? DOCUMENT_CSS_FONTS.serif : DOCUMENT_CSS_FONTS.sans : DOCUMENT_CSS_FONTS[family]; }
export function documentBackgroundCss(background: DocumentBackground) {
  return { backgroundColor: background.color, ...(background.image ? { backgroundImage: `url("${background.image}")`, backgroundRepeat: "no-repeat", backgroundPosition: background.position.replace(/_/g, " "), backgroundSize: background.fit === "stretch" ? "100% 100%" : background.fit } : {}) };
}
export function documentAddressLines(block: DocumentAddressBlock, data: { name?: string; address?: string; email?: string; registrationNumber?: string; taxNumber?: string }): string {
  const format = block.format || "{{name}}\n{{address}}\n{{email}}\n{{registrationNumber}}";
  return format.replace(/\{\{(name|address|email|registrationNumber|taxNumber)\}\}/g, (_match, token: keyof typeof data) => data[token] || "").split("\n").filter((line) => line.trim()).join("\n");
}
export function documentPresentation(invoice: InvoiceDocumentData) {
  const config = cleanInvoiceTemplate(invoice.documentTemplate), design = resolveDocumentDesign(config), advanced = resolveDocumentAdvanced(design);
  const extras = cleanDocumentExtras(invoice.documentExtras);
  const kind = invoice.documentKind ?? "invoice";
  const title = kind === "quote" ? (design.titles as Record<string, string>).quote || "Quote" : kind === "statement" ? (design.titles as Record<string, string>).statement || "Account statement" : design.titles[kind];
  const totals = computeInvoiceTotals(invoice.lines, invoice.discount, invoice.money), settlements = settlementTotals(invoice.payments), paid = settlements.settledCents;
  const statementTotal = invoice.documentFinancials?.totalCents, statementBalance = invoice.documentFinancials?.balanceCents ?? statementTotal;
  if (invoice.documentFinancials && (!Number.isSafeInteger(statementTotal) || statementBalance !== undefined && !Number.isSafeInteger(statementBalance))) throw new Error("Use integer document amounts in cents.");
  const documentTotalCents = kind === "statement" ? statementTotal : totals.totalCents;
  const balance = kind === "invoice" ? totals.totalCents - paid : kind === "statement" ? statementBalance ?? 0 : 0;
  const customTotalLabel = design.labels.total !== DEFAULT_DOCUMENT_DESIGN.labels.total, customBalanceLabel = design.labels.balance !== DEFAULT_DOCUMENT_DESIGN.labels.balance;
  const totalLabel = customTotalLabel ? design.labels.total : kind === "receipt" ? "Amount received" : kind === "quote" ? "Quote total" : kind === "work_order" ? "Estimated total" : kind === "statement" ? balance < 0 ? "Credit balance" : "Closing balance" : design.labels.total;
  const balanceLabel = customBalanceLabel ? design.labels.balance : balance < 0 ? "Credit balance" : kind === "statement" ? customTotalLabel ? design.labels.total : "Closing balance" : design.labels.balance;
  const money = (cents: number, currency = invoice.currency || "CAD") => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
  const baseMoney = invoice.money?.fx ? (cents: number) => money(convertInvoiceCents(cents, invoice.money!.fx!.rateMicros), invoice.money!.fx!.baseCurrency) : undefined;
  const taxModes = new Set(invoice.lines.map((line) => line.taxMode || invoice.money?.taxMode || "exclusive"));
  const taxModeLabel = taxModes.has("inclusive") ? taxModes.size === 1 ? "Rates include tax" : "Tax treatment varies by line" : "";
  const columns = design.table.columns.filter((column) => column.visible);
  const cellValue = (key: DocumentColumnKey, line: InvoiceDocumentData["lines"][number], index: number): string => {
    switch (key) {
      case "number": return String(index + 1);
      case "sku": return line.sku || "—";
      case "item": return line.item || "Untitled item";
      case "description": return line.description || "";
      case "quantity": return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 3 }).format(line.quantity)}${line.unit && !columns.some((c) => c.key === "unit") ? ` ${line.unit}` : ""}`;
      case "unit": return line.unit || "—";
      case "rate": return money(line.unitPriceCents);
      case "tax": return line.taxRatePercent ? `${line.taxLabel || design.labels.tax} ${line.taxRatePercent}%${taxModes.size > 1 && (line.taxMode || invoice.money?.taxMode) === "inclusive" ? " incl." : ""}` : "—";
      case "amount": return money(lineAmountCents(line));
      case "image": return line.imageUrl || "";
      case "manufacturer": case "partNumber": case "upc": case "ean": case "isbn": case "customField": return line[key] || "—";
    }
  };
  type Summary = { label: string; value: string; strong?: boolean; balance?: boolean; cents?: number; base?: string };
  let summary: Summary[] = [
    ...(design.totals.showSubtotal ? [{ label: design.labels.subtotal, value: money(totals.subtotalCents), cents: totals.subtotalCents }] : []),
    ...(design.totals.showDiscount && totals.discountCents ? [{ label: design.labels.discount, value: money(-totals.discountCents), cents: -totals.discountCents }] : []),
    ...(advanced.adjustments.showShipping && totals.shippingCents ? [{ label: advanced.labels.shipping, value: money(totals.shippingCents), cents: totals.shippingCents }] : []),
    ...(design.totals.showTax ? totals.taxes.map((tax) => ({ label: `${design.labels.tax}: ${tax.label} ${tax.ratePercent}%`, value: money(tax.cents), cents: tax.cents })) : []),
    ...(advanced.adjustments.showWithholding && totals.withholdingCents ? [{ label: advanced.labels.withholding, value: money(-totals.withholdingCents), cents: -totals.withholdingCents }] : []),
    ...(advanced.visibility.finalTotal && documentTotalCents !== undefined ? [{ label: `${totalLabel} ${invoice.currency}`, value: money(documentTotalCents), cents: documentTotalCents, strong: true }] : []),
    ...(kind === "invoice" && design.totals.showPaid && settlements.cashPaidCents > 0 ? [{ label: design.labels.paid, value: money(-settlements.cashPaidCents), cents: -settlements.cashPaidCents }] : []),
    ...(kind === "invoice" && advanced.adjustments.showCredits && settlements.creditCents ? [{ label: advanced.labels.credit, value: money(-settlements.creditCents), cents: -settlements.creditCents }] : []),
    ...(kind === "invoice" && advanced.adjustments.showWriteOff && settlements.writeOffCents ? [{ label: advanced.labels.writeOff, value: money(-settlements.writeOffCents), cents: -settlements.writeOffCents }] : []),
    ...(kind === "invoice" && settlements.refundCents ? [{ label: "Refunded", value: money(settlements.refundCents), cents: settlements.refundCents }] : []),
    ...(kind === "invoice" && design.totals.showBalance && (paid !== 0 || settlements.refundCents > 0) ? [{ label: balanceLabel, value: money(balance), cents: balance, strong: true, balance: true }] : []),
  ];
  if (advanced.baseCurrency.enabled && baseMoney) summary = summary.map((row) => ({ ...row, base: row.cents === undefined ? undefined : baseMoney(row.cents) }));
  if (invoice.documentSummary) summary = invoice.documentSummary;
  const metadata = [
    ...(advanced.visibility.documentNumber ? [{ label: advanced.labels.documentNumber, value: invoice.number, number: true }] : []),
    ...(design.fields.issueDate ? [{ label: design.labels.issued, value: invoice.issueDate }] : []),
    ...(kind === "invoice" && design.fields.dueDate ? [{ label: design.labels.due, value: invoice.dueDate }] : []),
    ...(kind === "invoice" && design.fields.terms ? [{ label: design.labels.terms, value: INVOICE_TERMS_LABEL[invoice.terms as InvoiceTerms] ?? invoice.terms }] : []),
    ...(design.fields.reference && invoice.reference ? [{ label: design.labels.reference, value: invoice.reference }] : []),
    ...(advanced.visibility.headerBalance && documentTotalCents !== undefined ? [{ label: kind === "invoice" || kind === "statement" ? balanceLabel : totalLabel, value: money(kind === "invoice" || kind === "statement" ? balance : documentTotalCents), balance: true }] : []),
  ];
  const page = advanced.page.customSize ? { width: advanced.page.width, height: advanced.page.height } : config.paperSize === "a4" ? { width: 595.276, height: 841.89 } : { width: 612, height: 792 };
  if (design.page.orientation === "landscape") [page.width, page.height] = [page.height, page.width];
  const paymentUrl = extras.paymentUrl || advanced.onlinePayment.url;
  const amountWords = documentTotalCents === undefined ? "" : documentAmountInWords(documentTotalCents, invoice.currency);
  const paymentStubDetails = advanced.paymentStub.enabled && (kind === "invoice" || kind === "statement" && statementTotal !== undefined) ? { number: invoice.number, customer: invoice.billToName, total: money(documentTotalCents!), balance: money(balance), totalLabel, balanceLabel, showBalance: kind === "invoice" } : undefined;
  const inventoryRows = invoice.lines.flatMap((line) => (advanced.annexures.showBatches && line.batchNumber || advanced.annexures.showSerials && line.serialNumbers?.length) ? [{ item: line.item, sku: line.sku || "", batch: advanced.annexures.showBatches ? line.batchNumber || "" : "", serials: advanced.annexures.showSerials ? (line.serialNumbers || []).join(", ") : "" }] : []);
  return { config, design, advanced, extras, kind, title, totals, settlements, paid, balance, documentTotalCents, totalLabel, balanceLabel, paymentStubDetails, money, baseMoney, columns, cellValue, summary, metadata, page, paymentUrl, amountWords, inventoryRows, taxModeLabel };
}
export const numericDocumentColumn = (key: DocumentColumnKey) => ["number", "quantity", "rate", "tax", "amount"].includes(key);

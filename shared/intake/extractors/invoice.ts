/** Invoice / receipt extractor (restricted class): vendor, bill-to, number,
 * date, subtotal, GST, total, due date and line items → transactionCandidates.
 * Card and account numbers are never extracted. */
import { findDates } from "../parse";
import { inferred, notStated, type ExtractionEnvelope, type FieldValue, type Reference, type UnsupportedDetail } from "../schemas/common";
import type { ClassExtractorInput } from "./agenda";
import { at, clean, dateValue, fileLoc, fromFile, labelled, linesOf, loc, parseAmount, titleLine, type Line } from "./toolkit";

export const DETERMINISTIC_INVOICE_ENGINE = "deterministic-invoice/1";

/** "08/01/2022" (mm/dd) and "6May2024" in addition to the usual formats. */
function invoiceDate(text: string) {
  const compact = /\b(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(\d{4})\b/i.exec(text);
  if (compact) {
    const found = findDates(`${compact[1]} ${compact[2]} ${compact[3]}`)[0];
    if (found) return { iso: found.iso, precision: found.precision, text: compact[0] };
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})\b/.exec(text);
  if (slash) {
    const a = Number(slash[1]), b = Number(slash[2]);
    const [month, day] = a > 12 ? [b, a] : [a, b];
    const iso = `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { iso, precision: "day" as const, text: slash[0] };
  }
  const found = findDates(text)[0];
  return found ? { iso: found.iso, precision: found.precision, text: found.text } : undefined;
}

function amountAfter(line: Line, label: RegExp): { cents: number; text: string } | undefined {
  const index = line.text.search(label);
  if (index < 0) return undefined;
  const rest = line.text.slice(index).replace(label, "");
  const match = /\$?\s?\(?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|\$\s?\d[\d,]*/.exec(rest);
  return match ? parseAmount(match[0].includes("$") ? match[0] : `$${match[0]}`) : undefined;
}

export function extractInvoice(input: ClassExtractorInput): ExtractionEnvelope {
  const { extract, fileName } = input;
  const lines = linesOf(extract);
  const unsupported: UnsupportedDetail[] = [];
  const references: Reference[] = [];
  const warnings: string[] = [];
  const isReceipt = /\breceipt\b/i.test(`${fileName} ${lines.slice(0, 5).map((line) => line.text).join(" ")}`);
  const numberLine = lines.find((line) => /\binvoice\s*(?:#|no\.?|number)\s*:?\s*[A-Z0-9-]{3,}|payment invoice number\s*:/i.test(line.text));
  const numberMatch = numberLine ? /\binvoice\s*(?:#|no\.?|number)\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(numberLine.text) : undefined;
  const dateLabel = labelled(lines.slice(0, 40), /(?:invoice\s+)?date|date of (?:issue|invoice)|filing date and time/i);
  const dateFound = dateLabel ? invoiceDate(dateLabel.value) : undefined;
  const dateFallback = !dateFound ? lines.slice(0, 15).map((line) => ({ line, date: invoiceDate(line.text) })).find((hit) => hit.date && !/due|term/i.test(hit.line.text)) : undefined;
  const date: FieldValue<any> = dateFound && dateLabel ? at(dateFound, dateLabel.line, dateFound.text, 0.85) : dateFallback ? at(dateFallback.date!, dateFallback.line, dateFallback.date!.text, 0.7) : notStated("No invoice date.");
  // Amounts: TOTAL / BALANCE DUE / Amount Due / Fee.
  const totalLine = [...lines].reverse().find((line) => /\b(?:balance due|amount due|total due|grand total|total)\b/i.test(line.text) && amountAfter(line, /\b(?:balance due|amount due|total due|grand total|total)\b\s*:?\s*/i)) ?? lines.find((line) => /^\s*fee\s*:/i.test(line.text));
  let total = totalLine ? amountAfter(totalLine, /\b(?:balance due|amount due|total due|grand total|total|fee)\b\s*:?\s*/i) : undefined;
  let totalAt = totalLine;
  if (!total) {
    // Table rows: "Total | $12,000".
    const label = [...lines].reverse().find((line) => line.cell && /^\s*(?:total|balance due|amount due|grand total)\b/i.test(line.text));
    const amountCell = label ? lines.find((line) => line.blockIndex === label.blockIndex && line.row === label.row && line !== label && parseAmount(line.text, { bare: true })) : undefined;
    const parsed = amountCell ? parseAmount(amountCell.text, { bare: true }) : undefined;
    if (parsed && amountCell) {
      total = parsed;
      totalAt = amountCell;
    }
  }
  const subtotalLine = lines.find((line) => /\bsub-?total\b/i.test(line.text));
  const subtotal = subtotalLine ? amountAfter(subtotalLine, /\bsub-?total\b\s*:?\s*/i) : undefined;
  const GST_LABEL = /\b(?:gst|hst)\b(?:\s*@\s*\d+%)?\s*:?\s*/i;
  // The tax line carries an amount ("GST @ 5% 12.00"); a description mentioning GST does not.
  const gstLine = lines.find((line) => /\b(?:gst|hst)\b(?!\/hst registration| registration)[^\n]*?\d/i.test(line.text) && !/registration/i.test(line.text) && amountAfter(line, GST_LABEL));
  const gst = gstLine ? amountAfter(gstLine, GST_LABEL) : undefined;
  // Parties: letterhead (vendor) and "Bill To".
  const billTo = labelled(lines.slice(0, 40), /bill to|billed to|sold to|invoice to/i);
  let billToValue = billTo && !/invoice|#|\bdate\b/i.test(billTo.value.split(/\t/)[0]) ? clean(billTo.value.split(/\t/)[0]) : undefined;
  let billToLine = billTo?.line;
  if (!billToValue) {
    // Letter-style invoices: the addressee block above "ATTN:".
    const attn = lines.slice(0, 20).findIndex((line) => /^\s*(?:attn|attention)\s*:/i.test(line.text));
    const addressee = attn > 0 ? lines.slice(Math.max(0, attn - 3), attn).reverse().find((line) => !/^\s*(?:by (?:mail|hand|e-?mail|courier)|invoice|re\s*:)/i.test(line.text) && !findDates(line.text)[0] && line.text.trim().length >= 2 && line.text.length < 100) : undefined;
    if (addressee) {
      billToValue = clean(addressee.text);
      billToLine = addressee;
    }
  }
  const letterhead = titleLine(lines.filter((line) => !/^\s*(?:invoice|receipt|statement)\s*$/i.test(line.text) && !/invoice\s*#|\binvoice\b.*:|^\s*(?:by mail|attn)/i.test(line.text) && !findDates(line.text)[0]), 6);
  const payeeLine = lines.find((line) => /(?:cheques?|payments?)\s+(?:payable\s+)?(?:to|payable to)\s*:?\s*[“"]?[A-Z]|select .+? as the payee/i.test(line.text));
  const payee = payeeLine ? /(?:payable to|payments? to)\s*:?\s*(?:the\s+)?[“"]?([A-Z][^”",\n]{3,80}?)[”"]?(?:,|\s+and\b|\.?\s*$)|select\s+(.+?)\s+as the payee/i.exec(payeeLine.text) : undefined;
  const vendorLabel = labelled(lines.slice(0, 20), /from|vendor|supplier|payee|remit to/i);
  const fromName = /invoice[_ -]\d*[_ -]*from[_ -](.+?)\.(?:pdf|docx?|xlsx?)$/i.exec(fileName);
  const vendor: FieldValue<string> = payee && payeeLine ? at(clean(payee[1] ?? payee[2]), payeeLine, (payee[1] ?? payee[2]).trim(), 0.7, "Payee named on the invoice.")
    : vendorLabel ? at(clean(vendorLabel.value), vendorLabel.line, vendorLabel.value, 0.75)
    : letterhead && !/^\d/.test(letterhead.text) ? at(clean(letterhead.text.split(/\t/)[0]), letterhead, letterhead.text.split(/\t/)[0].trim(), 0.6)
      : fromName ? fromFile(fromName[1].replace(/_/g, " "), fileName, 0.6) : notStated("Vendor not named.");
  const org = input.organizationName?.toLowerCase().slice(0, 25);
  const payableTo = lines.find((line) => /payable to|make payments? to|remit to/i.test(line.text));
  const direction: FieldValue<"payable" | "receivable" | "receipt" | "unknown"> = isReceipt ? inferred("receipt", [fileLoc(fileName)], 0.7)
    : payableTo && org && payableTo.text.toLowerCase().includes(org) ? at("receivable", payableTo, undefined, 0.75, "The organization asks to be paid: issued by it.")
      : org && vendor.value && vendor.value.toLowerCase().includes(org) ? inferred("receivable", vendor.locators, 0.65)
      : billToValue && org && billToLine && billToValue.toLowerCase().includes(org) ? at("payable", billToLine, undefined, 0.75)
        : /invoice[_ -]\d*[_ -]*from/i.test(fileName) ? fromFile("payable", fileName, 0.6) : inferred("unknown", [fileLoc(fileName)], 0.4);
  const dueLine = lines.find((line) => /\b(?:payment is due|due date|due on|due by)\b/i.test(line.text) && invoiceDate(line.text));
  const due = dueLine ? invoiceDate(dueLine.text.slice(dueLine.text.search(/due/i))) : undefined;
  const items: any[] = [];
  for (const block of extract.blocks) {
    if (block.kind !== "table") continue;
    const blockLines = lines.filter((line) => line.blockIndex === block.index);
    (block.rows ?? []).forEach((row, rowIndex) => {
      const cells = blockLines.filter((line) => line.row === rowIndex);
      const label = cells.find((line) => !parseAmount(line.text, { bare: true }) && /[a-z]{3}/i.test(line.text));
      const amountLine = [...cells].reverse().find((line) => parseAmount(line.text, { bare: true }));
      if (!label || !amountLine || /^\s*(?:total|sub-?total|gst|balance)/i.test(label.text)) return;
      const parsed = parseAmount(amountLine.text, { bare: true })!;
      items.push({ description: at(clean(label.text).slice(0, 200), label, undefined, 0.7), amount: at({ amountCents: parsed.cents, currency: "CAD", text: parsed.text }, amountLine, parsed.text.trim(), 0.75) });
    });
  }
  if (lines.some((line) => /card number|account #|transit #|institution #/i.test(line.text))) unsupported.push({ description: "Payment card / bank account details on the document (masked or restricted) are not extracted.", locators: [fileLoc(fileName)], suggestedTarget: "transactionCandidates.paymentInstrument", category: "no_ui_edit", infoType: "finance.payment_instrument_restricted" });
  const policy = lines.find((line) => /policy number\s*:\s*[A-Z0-9-]+/i.test(line.text));
  if (policy) references.push({ kind: "agreement", text: /policy number\s*:\s*[A-Z0-9-]+/i.exec(policy.text)![0], locators: [loc(policy, /policy number\s*:\s*[A-Z0-9-]+/i.exec(policy.text)![0])] });
  const record = {
    vendor,
    date,
    amount: total && totalAt ? at({ amountCents: total.cents, currency: "CAD", text: total.text }, totalAt, total.text, 0.8) : notStated("No total."),
    ...(gst && gstLine ? { gst: at({ amountCents: gst.cents, currency: "CAD", text: gst.text }, gstLine, undefined, 0.7) } : {}),
    ...(numberMatch && numberLine ? { invoiceNumber: at(numberMatch[1], numberLine, numberMatch[1], 0.85) } : {}),
    ...(billToValue && billToLine ? { billTo: at(billToValue, billToLine, billTo && billToLine === billTo.line ? billTo.value.split(/\t/)[0].trim() : undefined, billTo && billToLine === billTo.line ? 0.75 : 0.6) } : {}),
    direction,
    ...(subtotal && subtotalLine ? { subtotal: at({ amountCents: subtotal.cents, currency: "CAD", text: subtotal.text }, subtotalLine, undefined, 0.75) } : {}),
    ...(due && dueLine ? { dueDate: at(due, dueLine, due.text, 0.75) } : {}),
    ...(items.length ? { lineItems: items.slice(0, 50) } : {}),
  };
  if (!total) warnings.push("No total amount found.");
  void dateValue;
  return { fileId: input.fileId, docClass: input.docClass, schemaVersion: `${input.docClass}/1+intake/1`, engine: "deterministic", model: DETERMINISTIC_INVOICE_ENGINE, record, unsupported, references, warnings };
}

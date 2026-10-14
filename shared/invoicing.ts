/**
 * Pure invoicing helpers shared by the portable functions, the app and the
 * `test:invoices` gate: totals with per-line tax, status derivation (including
 * overdue against the organisation's local today), payment terms, invoice
 * numbering, recurring-series dates, bank-line payment suggestions and the
 * customers roll-up.
 *
 * Money is always integer cents. Dates are `YYYY-MM-DD` calendar dates.
 */

export const INVOICE_TERMS = ["due_on_receipt", "net_15", "net_30", "net_60", "custom"] as const;
export type InvoiceTerms = (typeof INVOICE_TERMS)[number];

export const INVOICE_TERMS_LABEL: Record<InvoiceTerms, string> = {
  due_on_receipt: "Due on receipt",
  net_15: "Net 15",
  net_30: "Net 30",
  net_60: "Net 60",
  custom: "Custom date",
};

const TERMS_DAYS: Record<Exclude<InvoiceTerms, "custom">, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_60: 60,
};

export const INVOICE_STATUSES = ["draft", "sent", "partially_paid", "paid", "overdue", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** What is stored; paid / partially paid / overdue are derived. */
export type InvoiceLifecycle = "draft" | "sent" | "void";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export const PAYMENT_METHODS = ["e_transfer", "cheque", "cash", "card", "direct_deposit", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  e_transfer: "E-transfer",
  cheque: "Cheque",
  cash: "Cash",
  card: "Card",
  direct_deposit: "Direct deposit",
  other: "Other",
};

export const SERIES_FREQUENCIES = ["monthly", "quarterly", "annually"] as const;
export type SeriesFrequency = (typeof SERIES_FREQUENCIES)[number];
export const SERIES_FREQUENCY_LABEL: Record<SeriesFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};
const FREQUENCY_MONTHS: Record<SeriesFrequency, number> = { monthly: 1, quarterly: 3, annually: 12 };

export type InvoiceLine = {
  key: string;
  catalogItemId?: string;
  item: string;
  description?: string;
  quantity: number;
  unitPriceCents: number;
  /** Optional sales tax on this line, as a percentage (5 = 5%). */
  taxRatePercent?: number;
  /** Shown on the invoice next to the tax, e.g. "GST" or "HST". */
  taxLabel?: string;
};

export type InvoiceDiscount = { kind: "percent" | "amount"; value: number };

export type InvoicePayment = {
  key: string;
  date: string;
  amountCents: number;
  method: string;
  reference?: string;
  financialTransactionId?: string;
  note?: string;
  recordedAtISO?: string;
};

export type InvoiceTotals = {
  /** Per line, before discount and tax. */
  lineAmounts: number[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxes: Array<{ label: string; ratePercent: number; baseCents: number; cents: number }>;
  totalCents: number;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Adds whole months, clamping to the last day of a shorter month (Jan 31 + 1 → Feb 28). */
export function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${pad2(month)}-${pad2(Math.min(d, daysInMonth(year, month)))}`;
}

export function dueDateForTerms(issueDate: string, terms: InvoiceTerms | string, customDueDate?: string): string {
  if (terms === "custom") return customDueDate && isCalendarDate(customDueDate) ? customDueDate : issueDate;
  const days = TERMS_DAYS[terms as Exclude<InvoiceTerms, "custom">];
  return addDays(issueDate, days ?? 0);
}

/** Round half away from zero, the usual rule for sales tax and receipts. */
export function roundCents(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function lineAmountCents(line: Pick<InvoiceLine, "quantity" | "unitPriceCents">): number {
  return roundCents(Number(line.quantity || 0) * Number(line.unitPriceCents || 0));
}

/**
 * Totals for an invoice. The discount comes off the subtotal before tax and is
 * spread over the lines in proportion to their amounts (largest remainder, so
 * the shares add up exactly). Tax is computed per rate on the discounted base
 * of the lines carrying that rate, and rounded once per rate.
 */
export function computeInvoiceTotals(lines: InvoiceLine[], discount?: InvoiceDiscount | null): InvoiceTotals {
  const lineAmounts = lines.map(lineAmountCents);
  const subtotalCents = lineAmounts.reduce((sum, n) => sum + n, 0);
  let discountCents = 0;
  if (discount && Number(discount.value) > 0 && subtotalCents > 0) {
    discountCents = discount.kind === "percent"
      ? roundCents((subtotalCents * Math.min(100, Number(discount.value))) / 100)
      : Math.min(subtotalCents, Math.round(Number(discount.value)));
  }
  const shares = allocateProportionally(discountCents, lineAmounts);
  const groups = new Map<string, { label: string; ratePercent: number; baseCents: number }>();
  lines.forEach((line, index) => {
    const rate = Number(line.taxRatePercent ?? 0);
    if (!(rate > 0)) return;
    const label = (line.taxLabel ?? "").trim() || "Tax";
    const key = `${label}|${rate}`;
    const group = groups.get(key) ?? { label, ratePercent: rate, baseCents: 0 };
    group.baseCents += lineAmounts[index] - shares[index];
    groups.set(key, group);
  });
  const taxes = [...groups.values()]
    .map((group) => ({ ...group, cents: roundCents((group.baseCents * group.ratePercent) / 100) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.ratePercent - b.ratePercent);
  const taxCents = taxes.reduce((sum, tax) => sum + tax.cents, 0);
  return { lineAmounts, subtotalCents, discountCents, taxCents, taxes, totalCents: subtotalCents - discountCents + taxCents };
}

/** Split `total` across `weights` so the parts sum exactly to `total`. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (!total || !sum) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) * total) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((acc, n) => acc + n, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index] += 1;
    remainder -= 1;
  }
  return floors;
}

export function paidCents(payments: Array<Pick<InvoicePayment, "amountCents">> | undefined): number {
  return (payments ?? []).reduce((sum, payment) => sum + Math.round(Number(payment.amountCents) || 0), 0);
}

export type StatusInput = {
  status: InvoiceLifecycle | string;
  dueDate: string;
  totalCents: number;
  payments?: Array<Pick<InvoicePayment, "amountCents">>;
};

/**
 * The status a person sees. `today` must be the organisation's local calendar
 * date (not the UTC date): an invoice due today is not overdue until tomorrow.
 */
export function deriveInvoiceStatus(invoice: StatusInput, today: string): InvoiceStatus {
  if (invoice.status === "void") return "void";
  if (invoice.status === "draft") return "draft";
  const paid = paidCents(invoice.payments);
  const balance = invoice.totalCents - paid;
  if (balance <= 0 && (invoice.totalCents > 0 || paid > 0)) return "paid";
  if (invoice.totalCents <= 0) return "paid";
  if (invoice.dueDate < today) return "overdue";
  if (paid > 0) return "partially_paid";
  return "sent";
}

export function daysOverdue(dueDate: string, today: string): number {
  return Math.max(0, daysBetween(dueDate, today));
}

/** True for sent invoices that still have something to collect. */
export function isOpenStatus(status: InvoiceStatus): boolean {
  return status === "sent" || status === "partially_paid" || status === "overdue";
}

export const DEFAULT_INVOICE_PREFIX = "INV-";
export const INVOICE_NUMBER_PADDING = 4;

export function normalizeInvoicePrefix(prefix: string | undefined | null): string {
  const cleaned = String(prefix ?? "").replace(/[^A-Za-z0-9\-_/.#]/g, "").slice(0, 12);
  return cleaned || DEFAULT_INVOICE_PREFIX;
}

export function formatInvoiceNumber(prefix: string, sequence: number, padding = INVOICE_NUMBER_PADDING): string {
  return `${normalizeInvoicePrefix(prefix)}${String(Math.max(1, Math.floor(sequence))).padStart(padding, "0")}`;
}

/**
 * The next sequence for a workspace: the configured next number, but never
 * one already used (so changing the prefix back, or importing, cannot reuse a
 * number).
 */
export function nextInvoiceSequence(existing: Array<Record<string, any>>, configuredNext?: number | null): number {
  const highest = existing.reduce((max, row) => Math.max(max, Number(row.sequence) || 0), 0);
  return Math.max(highest + 1, Math.floor(Number(configuredNext) || 1));
}

export type SeriesSchedule = {
  frequency: SeriesFrequency | string;
  startDate: string;
  endKind: "never" | "after_count" | "on_date" | string;
  endAfterCount?: number | null;
  endDate?: string | null;
};

/** Issue date of the n-th invoice in a series (0 = the first), anchored to the start date. */
export function seriesOccurrenceDate(schedule: Pick<SeriesSchedule, "frequency" | "startDate">, index: number): string {
  const months = FREQUENCY_MONTHS[schedule.frequency as SeriesFrequency] ?? 1;
  return addMonthsClamped(schedule.startDate, months * index);
}

/** The next issue date after `issuedCount` invoices, or null when the series has ended. */
export function seriesNextIssueDate(schedule: SeriesSchedule, issuedCount: number): string | null {
  if (schedule.endKind === "after_count" && issuedCount >= Math.max(1, Number(schedule.endAfterCount) || 1)) return null;
  const next = seriesOccurrenceDate(schedule, issuedCount);
  if (schedule.endKind === "on_date" && schedule.endDate && next > schedule.endDate) return null;
  return next;
}

export function seriesSummary(schedule: SeriesSchedule): string {
  const freq = SERIES_FREQUENCY_LABEL[schedule.frequency as SeriesFrequency] ?? schedule.frequency;
  if (schedule.endKind === "after_count") return `${freq}, ${schedule.endAfterCount} invoices`;
  if (schedule.endKind === "on_date" && schedule.endDate) return `${freq}, until ${schedule.endDate}`;
  return `${freq}, no end date`;
}

export type CandidateTransaction = {
  _id: string;
  date: string;
  amountCents: number;
  description?: string;
  counterparty?: string;
};

/**
 * Money-in bank lines that could be this invoice's payment: an exact match on
 * the balance (or the full total) scores highest, then a near amount, then
 * closeness to the issue/due dates and a name match. Lines already linked to
 * another payment are excluded by the caller.
 */
export function suggestPaymentTransactions(
  invoice: { issueDate: string; dueDate: string; totalCents: number; balanceCents: number; billToName?: string },
  transactions: CandidateTransaction[],
  limit = 4,
) {
  const name = (invoice.billToName ?? "").toLowerCase().split(/\s+/).filter((part) => part.length > 2);
  const scored = transactions
    .filter((txn) => txn.amountCents > 0 && txn.date >= addDays(invoice.issueDate, -7))
    .map((txn) => {
      let score = 0;
      if (txn.amountCents === invoice.balanceCents) score += 60;
      else if (txn.amountCents === invoice.totalCents) score += 45;
      else if (invoice.balanceCents > 0 && Math.abs(txn.amountCents - invoice.balanceCents) <= Math.max(100, invoice.balanceCents * 0.02)) score += 25;
      else if (txn.amountCents < invoice.balanceCents) score += 5;
      else return null;
      const distance = Math.abs(daysBetween(invoice.dueDate, txn.date));
      score += Math.max(0, 20 - Math.floor(distance / 3));
      const haystack = `${txn.description ?? ""} ${txn.counterparty ?? ""}`.toLowerCase();
      if (name.some((part) => haystack.includes(part))) score += 20;
      return { ...txn, score, exact: txn.amountCents === invoice.balanceCents };
    })
    .filter((row): row is CandidateTransaction & { score: number; exact: boolean } => Boolean(row) && (row as any).score >= 30);
  return scored.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, limit);
}

export type PartyLike = {
  partyKind?: string;
  memberId?: string;
  counterpartyId?: string;
  billToName: string;
  billToEmail?: string;
};

export function partyKey(party: PartyLike): string {
  if (party.partyKind === "member" && party.memberId) return `member:${party.memberId}`;
  if (party.partyKind === "organization" && party.counterpartyId) return `organization:${party.counterpartyId}`;
  return `name:${party.billToName.trim().toLowerCase()}`;
}

export type CustomerSummary = {
  key: string;
  name: string;
  email?: string;
  partyKind: string;
  memberId?: string;
  counterpartyId?: string;
  invoiceCount: number;
  billedCents: number;
  outstandingCents: number;
  overdueCents: number;
  lastIssueDate?: string;
};

/** Bill-to parties with what they have been billed and still owe (drafts and voids excluded). */
export function summarizeCustomers(
  invoices: Array<PartyLike & { status: InvoiceStatus; totalCents: number; balanceCents: number; issueDate: string }>,
): CustomerSummary[] {
  const map = new Map<string, CustomerSummary>();
  for (const invoice of invoices) {
    if (invoice.status === "draft" || invoice.status === "void") continue;
    const key = partyKey(invoice);
    const row = map.get(key) ?? {
      key,
      name: invoice.billToName,
      email: invoice.billToEmail,
      partyKind: invoice.partyKind ?? "custom",
      memberId: invoice.memberId,
      counterpartyId: invoice.counterpartyId,
      invoiceCount: 0,
      billedCents: 0,
      outstandingCents: 0,
      overdueCents: 0,
    };
    row.invoiceCount += 1;
    row.billedCents += invoice.totalCents;
    row.outstandingCents += Math.max(0, invoice.balanceCents);
    if (invoice.status === "overdue") row.overdueCents += Math.max(0, invoice.balanceCents);
    if (!row.lastIssueDate || invoice.issueDate > row.lastIssueDate) {
      row.lastIssueDate = invoice.issueDate;
      row.name = invoice.billToName;
      row.email = invoice.billToEmail ?? row.email;
    }
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.outstandingCents - a.outstandingCents || a.name.localeCompare(b.name));
}

/** First and last calendar day of the month containing `date`. */
export function monthBounds(date: string): { start: string; end: string } {
  const [y, m] = date.split("-").map(Number);
  return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}` };
}

/** Validate a line list from a client; returns the first problem or null. */
export function validateInvoiceLines(lines: InvoiceLine[]): string | null {
  if (!lines.length) return "Add at least one line item.";
  for (const [index, line] of lines.entries()) {
    const label = `Line ${index + 1}`;
    if (!String(line.item ?? "").trim()) return `${label} needs an item name.`;
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) return `${label} needs a quantity above zero.`;
    if (!Number.isFinite(Number(line.unitPriceCents)) || Number(line.unitPriceCents) < 0) return `${label} needs a price of zero or more.`;
    const rate = Number(line.taxRatePercent ?? 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 30) return `${label} has a tax rate outside 0–30%.`;
  }
  return null;
}

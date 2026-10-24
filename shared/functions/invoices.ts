import { cleanInvoiceMoney, convertInvoiceCents, settlementTotals, explicitFxQuote, type InvoiceMoneyOptions } from "../invoiceMoney";
import { cleanDocumentExtras, type DocumentExtras } from "../documentExtras";
import { cleanInvoiceLineDetails } from "../invoiceLineDetails";
import { assertRepairBillablePortable, assertRepairApprovalPortable } from "./repairOperationsGuard";
import { cleanInvoiceTemplate, invoiceCurrency, REPAIR_TRANSITIONS, REPAIR_STATUS_LABEL, type InvoiceTemplate, type RepairStatus } from "../invoiceCommerce";
/**
 * PORTABLE FUNCTIONS: invoicing (receivables).
 *
 * workspace / upsert / markSent / voidInvoices / restoreVoided / duplicate /
 * remove / recordPayment / removePayment / revertToUnpaid / sendReminders /
 * billMemberDues / generateDuesInvoices / undoDuesBatch /
 * upsertCatalogItem / setCatalogItemActive / removeCatalogItem /
 * upsertSeries / setSeriesStatus / issueFromSeries / saveSettings.
 *
 * Invoices store their lifecycle (draft | sent | void) and payments; paid,
 * partially paid and overdue are derived on read from the balance and the due
 * date against the organisation's local today (shared/invoicing.ts).
 * Reminders and "mark sent with an email" create Outbox drafts
 * (pendingEmails); nothing is sent from here.
 *
 * The books (shared/invoiceLedger.ts, shared/functions/invoiceLedger.ts):
 * marking an invoice sent posts its accrual (Dr Accounts receivable / Cr
 * revenue per the GL account mapping / Cr tax payable); each payment posts Dr
 * the deposit account / Cr receivable plus its cash-basis recognition; voiding
 * posts the reversal; removing a payment or reverting to unpaid voids the
 * payment's entries. A payment linked to a bank deposit marks it matched
 * (`matchedKind: "invoice"`) and categorised to Accounts receivable as a
 * single line. Invoices the books can't take (another currency, an unmapped
 * line, issued before the books start) are still sent and show "Needs
 * action"; "Post existing invoices" (postingPreview / postExisting) posts the
 * rest idempotently.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireOwnedRow, requireRolePortable, requireSocietyMembership } from "./access";
import { flagChangedPeriods } from "./reconciliation";
import { assertPeriodOpen, TRANSACTION_BACKFILL_SOURCE, BILL_BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE } from "./accounting";
import { journalBasisOf, type JournalBasis } from "../booksReports";
import { assertBooksOpen } from "./booksLock";
import {
  accrualBlockers,
  claimableDepositEntries,
  dateBlock,
  ensureLedgerAccount,
  findLedgerAccount,
  loadInvoiceLedgerContext,
  mappingOf,
  paymentBlock,
  postPayment,
  postedInvoiceEntries,
  restoreDepositEntry,
  reverseAccrual,
  syncAccrual,
  unmappedItems,
  unpostPayment,
  prepareSettlementReversal, reverseSettlementPosting, reverseOpenInvoiceRevaluations, postLedgerEntry, entryLines, postedEntry,
  withPosting,
  type InvoiceLedgerContext,
  type LedgerAccount,
  type StoredInvoice,
  type StoredInvoicePayment,
  type TransactionSnapshot,
} from "./invoiceLedger";
import { tagGroupLookup } from "../financeTags";
import { validateBalancedJournalLines } from "../accountingCore";
import {
  DUES_REVENUE_CATEGORY,
  accrualPostingLines,
  booksStartLabel,
  foreignCurrencySummary,
  invoiceNeedsAction,
  normalizeRevenueCategory,
  paymentPostingLines,
  type InvoiceLedgerLine,
  type NeedsActionFlag,
} from "../invoiceLedger";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import {
  INVOICE_TERMS,
  PAYMENT_METHODS,
  SERIES_FREQUENCIES,
  addDays,
  computeInvoiceTotals,
  daysOverdue,
  deriveInvoiceStatus,
  dueDateForTerms,
  formatInvoiceNumber,
  isCalendarDate,
  isOpenStatus,
  invoiceCashActivity,
  monthBounds,
  nextInvoiceSequence,
  normalizeInvoicePrefix,
  paidCents as sumPaid,
  seriesNextIssueDate,
  summarizeCustomers,
  validateInvoiceLines,
  type InvoiceDiscount,
  type InvoiceLine,
  type InvoiceStatus,
} from "../invoicing";

type Row = { _id: string; societyId: string; [key: string]: any };

const DEFAULT_TERMS = "net_30";

function nowISO() {
  return new Date().toISOString();
}

function randomKey(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function organizationToday(ctx: PortableQueryCtx, societyId: string) {
  const organization = await ctx.db.get(societyId, "societies");
  const iso = nowISO();
  return resolutionCalendarDate(iso, resolutionTimeZone(organization as any)) ?? iso.slice(0, 10);
}

async function actorName(ctx: PortableQueryCtx, societyId: string): Promise<string | undefined> {
  try {
    const user: any = await requireSocietyMembership(ctx, societyId);
    return user.displayName ?? user.name ?? undefined;
  } catch {
    return undefined;
  }
}

async function loadInvoices(ctx: PortableQueryCtx, societyId: string): Promise<Row[]> {
  return (await ctx.db.query("invoices").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()) as Row[];
}

async function loadSettings(ctx: PortableQueryCtx, societyId: string): Promise<Row | null> {
  return ((await ctx.db.query("invoiceSettings").withIndex("by_society", (q) => q.eq("societyId", societyId)).first()) as Row | null) ?? null;
}

function settingsView(row: Row | null, invoices: Row[]) {
  const prefix = normalizeInvoicePrefix(row?.prefix);
  const nextNumber = nextInvoiceSequence(invoices, row?.nextNumber);
  return {
    _id: row?._id,
    prefix,
    nextNumber,
    nextNumberPreview: formatInvoiceNumber(prefix, nextNumber),
    defaultTerms: row?.defaultTerms ?? DEFAULT_TERMS,
    paymentInstructions: row?.paymentInstructions,
    defaultMemo: row?.defaultMemo,
    replyToEmail: row?.replyToEmail,
    defaultTemplateId: row?.defaultTemplateId,
    ...mappingOf(row),
  };
}

/** Allocate the next number and remember it, creating the settings row on first use. */
async function allocateNumber(ctx: PortableMutationCtx, societyId: string) {
  const [settings, invoices] = await Promise.all([loadSettings(ctx, societyId), loadInvoices(ctx, societyId)]);
  const prefix = normalizeInvoicePrefix(settings?.prefix);
  const sequence = nextInvoiceSequence(invoices, settings?.nextNumber);
  if (settings) await ctx.db.patch(settings._id, { nextNumber: sequence + 1, updatedAtISO: nowISO() });
  else await ctx.db.insert("invoiceSettings", { societyId, prefix, nextNumber: sequence + 1, defaultTerms: DEFAULT_TERMS, updatedAtISO: nowISO() });
  return { sequence, number: formatInvoiceNumber(prefix, sequence) };
}

function cleanText(value: unknown, max = 2000): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : undefined;
}

function cleanLines(lines: any[]): InvoiceLine[] {
  return (lines ?? []).slice(0, 100).map((raw, index) => {
    const line: InvoiceLine = {
      ...cleanInvoiceLineDetails(raw ?? {}),
      key: cleanText(raw?.key, 60) ?? `line_${index + 1}`,
      item: String(raw?.item ?? "").trim().slice(0, 200),
      quantity: Math.round(Number(raw?.quantity) * 1000) / 1000,
      unitPriceCents: Math.round(Number(raw?.unitPriceCents)),
    };
    if (raw?.unit) line.unit = cleanText(raw.unit, 30);
    if (raw?.sku) line.sku = cleanText(raw.sku, 100);
    const description = cleanText(raw?.description, 1000);
    if (description) line.description = description;
    if (raw?.catalogItemId) line.catalogItemId = String(raw.catalogItemId);
    const rate = Number(raw?.taxRatePercent);
    if (Number.isFinite(rate) && rate > 0) {
      line.taxRatePercent = Math.round(rate * 1000) / 1000;
      line.taxLabel = cleanText(raw?.taxLabel, 20) ?? "Tax";
    }
    const tagIds: string[] = Array.isArray(raw?.tagIds) ? [...new Set<string>(raw.tagIds.map(String))].slice(0, 10) : [];
    if (tagIds.length) line.tagIds = tagIds;
    return line;
  });
}

/** Tags on lines must be this workspace's, not archived, at most one per tag group. */
async function assertTagRefs(ctx: PortableQueryCtx, societyId: string, lines: InvoiceLine[]) {
  if (!lines.some((line) => line.tagIds?.length)) return;
  const tags = await ctx.db.query("financeTags").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const byId = new Map(tags.map((tag) => [String(tag._id), tag]));
  const groupOf = tagGroupLookup(tags.map((tag) => ({ _id: String(tag._id), groupId: String(tag.groupId) })));
  for (const [index, line] of lines.entries()) {
    const groups = new Set<string>();
    for (const tagId of line.tagIds ?? []) {
      const tag = byId.get(tagId);
      if (!tag) throw new Error(`Line ${index + 1} has a tag that no longer exists.`);
      if (tag.archivedAtISO) throw new Error(`Line ${index + 1}: ${tag.name} is archived. Restore it on the Tags page to use it again.`);
      const group = groupOf(tagId)!;
      if (groups.has(group)) throw new Error(`Line ${index + 1} has two tags from the same group; choose one.`);
      groups.add(group);
    }
  }
}

function cleanDiscount(discount: any): InvoiceDiscount | undefined {
  if (!discount) return undefined;
  const value = Number(discount.value);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (discount.kind === "percent") {
    if (value > 100) throw new Error("A percentage discount cannot exceed 100%.");
    return { kind: "percent", value: Math.round(value * 100) / 100 };
  }
  return { kind: "amount", value: Math.round(value) };
}

type PartyArgs = {
  partyKind: string;
  memberId?: string;
  counterpartyId?: string;
  billToName: string;
  billToEmail?: string;
  billToAddress?: string;
};

async function cleanParty(ctx: PortableQueryCtx, societyId: string, args: PartyArgs) {
  const partyKind = ["member", "organization", "custom"].includes(args.partyKind) ? args.partyKind : "custom";
  const party: Record<string, any> = { partyKind, memberId: undefined, counterpartyId: undefined };
  if (partyKind === "member") {
    if (!args.memberId) throw new Error("Choose who to bill.");
    await getOwned(ctx, "members", args.memberId, societyId);
    party.memberId = args.memberId;
  } else if (partyKind === "organization") {
    if (!args.counterpartyId) throw new Error("Choose who to bill.");
    await getOwned(ctx, "accountingCounterparties", args.counterpartyId, societyId);
    party.counterpartyId = args.counterpartyId;
  }
  const billToName = cleanText(args.billToName, 200);
  if (!billToName) throw new Error("Add who the invoice is for.");
  const billToEmail = cleanText(args.billToEmail, 200);
  if (billToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billToEmail)) throw new Error("The email address doesn't look right.");
  return { partyKind, memberId: party.memberId as string | undefined, counterpartyId: party.counterpartyId as string | undefined, billToName, billToEmail, billToAddress: cleanText(args.billToAddress, 500) };
}

async function assertCatalogRefs(ctx: PortableQueryCtx, societyId: string, lines: InvoiceLine[]) {
  for (const id of new Set(lines.map((line) => line.catalogItemId).filter(Boolean) as string[])) {
    await getOwned(ctx, "invoiceCatalogItems", id, societyId);
  }
  await assertTagRefs(ctx, societyId, lines);
}

function event(kind: string, label: string, actor?: string, amountCents?: number) {
  const row: Record<string, any> = { atISO: nowISO(), kind, label };
  if (actor) row.actorName = actor;
  if (amountCents != null) row.amountCents = amountCents;
  return row;
}

type DecoratedInvoice = Row & { status: InvoiceStatus; totalCents: number; paidCents: number; balanceCents: number; issueDate: string; sequence: number; number: string; billToName: string };

function decorate(row: Row, today: string, seriesById: Map<string, Row>, txnById: Map<string, Row>): DecoratedInvoice {
  const totals = computeInvoiceTotals(row.lines ?? [], row.discount, row.money);
  const paid = sumPaid(row.payments);
  const status = deriveInvoiceStatus({ status: row.status, dueDate: row.dueDate, totalCents: totals.totalCents, payments: row.payments }, today);
  const balanceCents = row.status === "void" ? 0 : totals.totalCents - paid;
  return {
    ...(row as DecoratedInvoice),
    lifecycle: row.status,
    status,
    totals,
    ...settlementTotals(row.payments ?? []),
    totalCents: totals.totalCents,
    paidCents: paid,
    balanceCents,
    daysOverdue: status === "overdue" ? daysOverdue(row.dueDate, today) : 0,
    seriesName: row.seriesId ? seriesById.get(row.seriesId)?.name : undefined,
    payments: (row.payments ?? []).map((payment: any) => {
      const txn = payment.financialTransactionId ? txnById.get(payment.financialTransactionId) : undefined;
      return txn
        ? { ...payment, transaction: { _id: txn._id, date: txn.date, description: txn.description, amountCents: txn.amountCents } }
        : payment;
    }),
  };
}

const MATCHABLE_KINDS = new Set([undefined, "", "manual", "invoice"]);
const MONEY_ACCOUNT_TYPES = new Set(["Bank", "Credit"]);
const CASH_SUBTYPES = new Set(["cash", "restricted_cash", "undeposited_funds"]);

function accountLabel(account: Pick<LedgerAccount, "code" | "name"> | undefined) {
  return account ? `${account.code ? `${account.code} ` : ""}${account.name}` : undefined;
}

export type InvoiceLedgerState = {
  /** none: drafts, void and zero invoices; ready: something can be posted; blocked: the invoice can't go in. */
  state: "none" | "posted" | "ready" | "blocked";
  entryId?: string;
  reasons: string[];
  paymentsToPost: number;
};

function asStored(row: Row): StoredInvoice {
  return row as StoredInvoice;
}

/** Where the invoice stands in the books, from the posted invoice entries. */
function invoiceLedgerState(row: Row, lctx: InvoiceLedgerContext, postedIds: ReadonlySet<string>): InvoiceLedgerState {
  const invoice = asStored(row);
  const posted = (id: string | undefined) => Boolean(id && postedIds.has(id));
  const accrualPosted = posted(invoice.journalEntryId);
  if (invoice.status !== "sent" || computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money).totalCents <= 0) {
    return { state: accrualPosted && !invoice.reversalJournalEntryId ? "posted" : "none", entryId: accrualPosted ? invoice.journalEntryId : undefined, reasons: [], paymentsToPost: 0 };
  }
  const payments = (invoice.payments ?? []).filter(payment=>!payment.reversedDate);
  if (!accrualPosted) {
    const reasons = accrualBlockers(invoice, lctx);
    const block = dateBlock(lctx, invoice.issueDate);
    if (block) reasons.push(block);
    const paymentsToPost = reasons.length ? 0 : payments.filter((payment) => !paymentBlock(payment, lctx)).length;
    return { state: reasons.length ? "blocked" : "ready", reasons, paymentsToPost };
  }
  const pending = payments.filter((payment) => !posted(payment.journalEntryId));
  const reasons = pending.map((payment) => paymentBlock(payment, lctx)).filter((reason): reason is string => Boolean(reason));
  const paymentsToPost = pending.length - reasons.length;
  return { state: paymentsToPost ? "ready" : "posted", entryId: invoice.journalEntryId, reasons, paymentsToPost };
}

function needsActionFor(row: Row, lctx: InvoiceLedgerContext, txnById: Map<string, Row>, postedIds: ReadonlySet<string>): NeedsActionFlag[] {
  const invoice = asStored(row);
  const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount, invoice.money);
  return invoiceNeedsAction(
    {
      lifecycle: invoice.status,
      totalCents: totals.totalCents,
      paidCents: sumPaid(invoice.payments),
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      payments: (invoice.payments ?? []).filter((payment) => !payment.reversedDate && (!payment.kind || payment.kind === "payment")).map((payment) => ({
        key: payment.key,
        date: payment.date,
        amountCents: payment.amountCents,
        financialTransactionId: payment.financialTransactionId,
        transactionAmountCents: payment.financialTransactionId ? (txnById.has(payment.financialTransactionId) ? (payment.baseAmountCents != null && payment.amountCents ? Math.round(Number(txnById.get(payment.financialTransactionId)!.amountCents) * payment.amountCents / payment.baseAmountCents) : Number(txnById.get(payment.financialTransactionId)!.amountCents)) : null) : undefined,
      })),
      unmappedItems: unmappedItems(invoice, lctx),
      fxQuoteAvailable: Boolean(invoice.money?.fx),
      accrualPosted: Boolean(invoice.journalEntryId && postedIds.has(invoice.journalEntryId)),
    },
    { workspaceCurrency: lctx.workspaceCurrency, booksStart: lctx.booksStart },
  );
}

/** The GL account mapping drawer: the mapping, the accounts to choose from and what is used when unset. */
function ledgerView(lctx: InvoiceLedgerContext, catalog: Row[]) {
  const options = (filter: (account: LedgerAccount) => boolean) =>
    lctx.accounts.filter(filter).map((account) => ({ _id: account._id, label: accountLabel(account)!, accountType: account.accountType, currency: account.currency ?? lctx.workspaceCurrency })).sort((a, b) => a.label.localeCompare(b.label));
  const fallback = (account: LedgerAccount | undefined) => (account ? { _id: account._id, label: accountLabel(account)! } : null);
  const categories = [...new Map(
    [...catalog.map((item) => String(item.category ?? "").trim()).filter(Boolean), DUES_REVENUE_CATEGORY, ...(lctx.mapping.categoryAccounts ?? []).map((row) => row.category)]
      .map((category) => [normalizeRevenueCategory(category), category] as const),
  ).values()].sort((a, b) => a.localeCompare(b));
  return {
    workspaceCurrency: lctx.workspaceCurrency,
    booksStart: { ...lctx.booksStart, label: booksStartLabel(lctx.booksStart) },
    mapping: lctx.mapping,
    categories,
    accounts: {
      revenue: options((account) => account.accountType === "Income"),
      receivable: options((account) => account.accountType === "Asset" && !CASH_SUBTYPES.has(String(account.subtype))),
      taxPayable: options((account) => account.accountType === "Liability"),
      deposit: options((account) => MONEY_ACCOUNT_TYPES.has(account.accountType) || (account.accountType === "Asset" && CASH_SUBTYPES.has(String(account.subtype)))),
    },
    // What posting uses when a slot is unset ("created on first use" when null).
    defaults: {
      receivable: fallback(findLedgerAccount("receivable", lctx.accounts)),
      taxPayable: fallback(findLedgerAccount("taxPayable", lctx.accounts)),
      deposit: fallback(findLedgerAccount("undeposited", lctx.accounts)),
    },
  };
}

/** Branding and reusable designs only: report pages do not need billing/bank records. */
export async function documentTemplatesPortable(ctx: PortableQueryCtx, { societyId, templateId }: { societyId: string; templateId?: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [organization, templates, settings, identifiers, accounts] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    ctx.db.query("invoiceTemplates").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(4),
    loadSettings(ctx, societyId),
    ctx.db.query("organizationIdentifiers").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(100),
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(2000),
  ]);
  const requestedIds = [...new Set([templateId, settings?.defaultTemplateId].filter((id): id is string => Boolean(id)))];
  const selectedTemplates = await Promise.all(requestedIds.map((id) => getOwned(ctx, "invoiceTemplates", id, societyId)));
  const availableTemplates = [...new Map([...templates, ...selectedTemplates].filter((template) => template?.active).map((template) => [String(template!._id), template!])).values()];
  const selectedTemplate = selectedTemplates.find((template) => String(template?._id) === (templateId ?? settings?.defaultTemplateId)) ?? null;
  const gst = identifiers.find((row) => row.kind === "gst" && row.status !== "inactive");
  const logoUrl = organization?.logoStorageId
    ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(organization.logoStorageId) })).url ?? undefined
    : undefined;
  const receivable = accounts.find((account) => account._id === settings?.receivableAccountId)
    ?? findLedgerAccount("receivable", accounts as LedgerAccount[]);
  const bank = accounts.find((account) => account.accountType === "Bank");
  const currency = String(receivable?.currency ?? bank?.currency ?? organization?.currency ?? "CAD").toUpperCase();
  const currencies = [...new Set([currency, ...accounts.map((account) => String(account.currency ?? currency).toUpperCase())])].sort();
  return {
    organization: {
      name: organization?.name,
      entityType: organization?.entityType,
      address: organization?.mailingAddress ?? organization?.registeredOfficeAddress,
      registrationNumber: organization?.incorporationNumber,
      email: organization?.publicContactEmail ?? organization?.officialEmail ?? organization?.primaryContactEmail,
      gstNumber: gst?.number,
      logoUrl,
    },
    templates: availableTemplates,
    selectedTemplate: templateId || selectedTemplate?.active ? selectedTemplate : null,
    defaultTemplateId: settings?.defaultTemplateId ?? null,
    currency,
    currencies,
  };
}

/** Everything the Invoices page needs in one read. */
export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const [organization, invoices, settings, catalog, series, members, counterparties, transactions, subscriptions, plans, feePeriods, identifiers, lctx, postedEntries, templates, priceLists, repairJobs] = await Promise.all([
    ctx.db.get(societyId, "societies"),
    loadInvoices(ctx, societyId),
    loadSettings(ctx, societyId),
    ctx.db.query("invoiceCatalogItems").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("invoiceSeries").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("accountingCounterparties").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("memberSubscriptions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("subscriptionPlans").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("membershipFeePeriods").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("organizationIdentifiers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadInvoiceLedgerContext(ctx, societyId),
    postedInvoiceEntries(ctx, societyId),
    // The invoice page subscribes to every collectionPage before opening a builder.
    // Keep bootstrap artwork bounded as well as the subsequent collection reads.
    ctx.db.query("invoiceTemplates").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(4),
    ctx.db.query("invoicePriceLists").withIndex("by_society", (q) => q.eq("societyId", societyId)).take(4),
    ctx.db.query("repairJobs").withIndex("by_society", (q) => q.eq("societyId", societyId)).order("desc").take(4),
  ]);
  const seriesById = new Map((series as Row[]).map((row) => [row._id, row]));
  const txnById = new Map((transactions as Row[]).map((row) => [row._id, row]));
  const postedIds = new Set([...postedEntries.values()].map((entry) => entry._id));
  const decorated = invoices
    .map((row) => Object.assign(decorate(row, today, seriesById, txnById), {
      needsAction: needsActionFor(row, lctx, txnById, postedIds),
      ledger: invoiceLedgerState(row, lctx, postedIds),
    }))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.sequence - a.sequence);

  const linked = new Map<string, { invoiceId: string; number: string }>();
  for (const invoice of decorated) {
    for (const payment of invoice.payments ?? []) {
      if (!payment.reversedDate && payment.financialTransactionId) linked.set(payment.financialTransactionId, { invoiceId: invoice._id, number: invoice.number });
    }
  }
  const since = addDays(today, -400);
  const moneyIn = (transactions as Row[])
    .filter((txn) => Number(txn.amountCents) > 0 && String(txn.date) >= since)
    .map((txn) => ({
      _id: txn._id,
      date: txn.date,
      amountCents: txn.amountCents,
      description: txn.description,
      counterparty: txn.counterparty,
      category: txn.category,
      accountId: txn.accountId,
      accountLabel: accountLabel(lctx.accountsById.get(String(txn.accountId))),
      currency: txn.currency ?? lctx.accountsById.get(String(txn.accountId))?.currency ?? lctx.workspaceCurrency,
      releasedDate: [txn.billPaymentRelease?.date, txn.invoicePaymentRelease?.date].filter(Boolean).sort().at(-1),
      // Matched to something other than an invoice (a grant, a filing…): not offered.
      matchedElsewhere: !MATCHABLE_KINDS.has(txn.matchedKind),
      linkedInvoiceId: linked.get(txn._id)?.invoiceId,
      linkedInvoiceNumber: linked.get(txn._id)?.number,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const paidSince = addDays(today, -30);
  const summary = { outstandingCents: 0, outstandingCount: 0, overdueCents: 0, overdueCount: 0, paidLast30Cents: 0, paidLast30Count: 0, draftCents: 0, draftCount: 0, needsActionCount: 0 };
  for (const invoice of decorated) {
    if (invoice.needsAction.length) summary.needsActionCount += 1;
    if (isOpenStatus(invoice.status)) {
      summary.outstandingCents += invoice.balanceCents;
      summary.outstandingCount += 1;
    }
    if (invoice.status === "overdue") {
      summary.overdueCents += invoice.balanceCents;
      summary.overdueCount += 1;
    }
    if (invoice.status === "draft") {
      summary.draftCents += invoice.totalCents;
      summary.draftCount += 1;
    }
    const cash = invoiceCashActivity(invoice.payments, paidSince, today);
    if (cash.hasActivity) { summary.paidLast30Cents += cash.amountCents; summary.paidLast30Count += 1; }
  }
  const activePlans = (plans as Row[]).filter((plan) => plan.active !== false);
  const duesCandidates = buildDuesCandidates(today, subscriptions as Row[], activePlans, feePeriods as Row[], members as Row[], decorated);
  const gst = (identifiers as Row[]).find((row) => row.kind === "gst" && row.status !== "inactive")
    ?? (identifiers as Row[]).find((row) => row.kind === "business_number" && row.status !== "inactive" && /RT\d{4}/i.test(String(row.number)));

  return {
    today,
    settings: settingsView(settings, invoices),
    organization: {
      name: (organization as any)?.name,
      entityType: (organization as any)?.entityType,
      address: (organization as any)?.mailingAddress ?? (organization as any)?.registeredOfficeAddress,
      registrationNumber: (organization as any)?.incorporationNumber,
      email: (organization as any)?.publicContactEmail ?? (organization as any)?.officialEmail ?? (organization as any)?.primaryContactEmail,
      gstNumber: gst?.number,
    },
    templates,
    priceLists,
    repairJobs: repairJobs.map((job) => ({ ...job, totalCents: computeInvoiceTotals(job.lines ?? []).totalCents,
      invoice: decorated.find((invoice) => invoice.repairJobId === job._id && invoice.lifecycle !== "void") ?? null })),
    invoices: decorated,
    catalog: (catalog as Row[]).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    series: (series as Row[])
      .map((row): Row => {
        const issued = decorated.filter((invoice) => invoice.seriesId === row._id);
        return {
          ...row,
          totalCents: computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents,
          invoiceCount: issued.length,
          outstandingCents: issued.filter((invoice) => isOpenStatus(invoice.status)).reduce((sum, invoice) => sum + invoice.balanceCents, 0),
          lastInvoiceId: issued[0]?._id,
          due: Boolean(row.status === "active" && row.nextIssueDate && row.nextIssueDate <= today),
        };
      })
      .sort((a, b) => String(a.nextIssueDate ?? "9999").localeCompare(String(b.nextIssueDate ?? "9999"))),
    parties: {
      members: (members as Row[])
        .filter((member) => member.status !== "Removed")
        .map((member) => ({
          _id: member._id,
          name: member.memberKind === "organization" && member.organizationName ? member.organizationName : `${member.firstName} ${member.lastName}`.trim(),
          email: member.email,
          address: member.address,
          membershipClass: member.membershipClass,
          status: member.status,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      organizations: (counterparties as Row[])
        .map((row) => ({ _id: row._id, name: row.name, email: row.email, kind: row.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    customers: summarizeCustomers(decorated),
    transactions: moneyIn,
    plans: activePlans.map((plan) => ({ _id: plan._id, name: plan.name, priceCents: plan.priceCents, interval: plan.interval, membershipClass: plan.membershipClass, currency: plan.currency })),
    duesCandidates,
    summary,
    ledger: {
      ...ledgerView(lctx, catalog as Row[]),
      foreignCurrency: foreignCurrencySummary(decorated.map((invoice) => ({ lifecycle: invoice.lifecycle, currency: invoice.currency })), lctx.workspaceCurrency),
      readyCount: decorated.filter((invoice) => invoice.ledger.state === "ready").length,
      blockedCount: decorated.filter((invoice) => invoice.ledger.state === "blocked").length,
    },
  };
}

function feeForPlan(plan: Row, feePeriods: Row[], onDate: string): number {
  const period = feePeriods
    .filter((row) => row.planId === plan._id && row.status !== "retired" && String(row.effectiveFrom) <= onDate && (!row.effectiveTo || String(row.effectiveTo) >= onDate))
    .sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)))[0];
  return Number(period?.priceCents ?? plan.priceCents ?? 0);
}

function planLineItem(plan: Row, priceCents: number, renewalDate?: string): InvoiceLine {
  const period = plan.interval === "month" ? "Monthly" : plan.interval === "year" ? "Annual" : plan.interval === "semester" ? "Term" : "";
  return {
    key: randomKey("line"),
    item: `${period ? `${period} ` : ""}membership dues`.replace(/^m/, "M"),
    description: renewalDate ? `${plan.name} · renewal ${renewalDate}` : plan.name,
    quantity: 1,
    unitPriceCents: priceCents,
  };
}

/** Subscriptions renewing in today's month that have no dues invoice for that renewal yet. */
function buildDuesCandidates(today: string, subscriptions: Row[], plans: Row[], feePeriods: Row[], members: Row[], invoices: Array<Record<string, any>>) {
  const { start, end } = monthBounds(today);
  const planById = new Map(plans.map((plan) => [plan._id, plan]));
  const memberById = new Map(members.map((member) => [member._id, member]));
  return subscriptions
    .filter((sub) => ["active", "past_due"].includes(String(sub.status)) && sub.currentPeriodEndISO)
    .map((sub) => {
      const renewalDate = String(sub.currentPeriodEndISO).slice(0, 10);
      const plan = planById.get(sub.planId);
      if (!plan || renewalDate < start || renewalDate > end) return null;
      const member = sub.memberId ? memberById.get(sub.memberId) : undefined;
      const existing = invoices.find((invoice) => invoice.subscriptionId === sub._id && invoice.duesPeriodEnd === renewalDate && invoice.status !== "void");
      return {
        subscriptionId: sub._id,
        memberId: sub.memberId,
        name: sub.fullName || (member ? `${member.firstName} ${member.lastName}` : "Unknown"),
        email: sub.email || member?.email,
        planName: plan.name,
        priceCents: feeForPlan(plan, feePeriods, renewalDate),
        currency: plan.currency ?? "CAD",
        renewalDate,
        existingInvoiceId: existing?._id,
        existingInvoiceNumber: existing?.number,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.renewalDate.localeCompare(b.renewalDate) || a.name.localeCompare(b.name));
}

type InvoiceArgs = PartyArgs & {
  shipToName?: string;
  shipToAddress?: string;
  id?: string;
  societyId: string;
  issueDate: string;
  terms: string;
  dueDate?: string;
  reference?: string;
  currency?: string;
  documentTemplate?: InvoiceTemplate;
  money?: InvoiceMoneyOptions;
  documentExtras?: DocumentExtras;
  priceListId?: string | null;
  repairJobId?: string;
  lines: any[];
  discount?: any;
  memo?: string;
};

async function invoiceFields(ctx: PortableQueryCtx, args: InvoiceArgs) {
  if (!isCalendarDate(args.issueDate)) throw new Error("Choose an issue date.");
  const terms = (INVOICE_TERMS as readonly string[]).includes(args.terms) ? args.terms : DEFAULT_TERMS;
  if (terms === "custom" && !isCalendarDate(args.dueDate)) throw new Error("Choose a due date.");
  const dueDate = dueDateForTerms(args.issueDate, terms, args.dueDate);
  if (dueDate < args.issueDate) throw new Error("The due date can't be before the issue date.");
  const lines = cleanLines(args.lines);
  const problem = validateInvoiceLines(lines);
  if (problem) throw new Error(problem);
  await assertCatalogRefs(ctx, args.societyId, lines);
  const discount = cleanDiscount(args.discount);
  const totals = computeInvoiceTotals(lines, discount, args.money);
  if (JSON.stringify({ lines, documentExtras: args.documentExtras }).length > 850000) throw new Error("This invoice contains too much inline artwork or attachments. Keep it below 850 KB.");
  if (totals.totalCents < 0) throw new Error("The discount is larger than the invoice.");
  const party = await cleanParty(ctx, args.societyId, args);
  const organization: any = await ctx.db.get(args.societyId, "societies");
  const currency = invoiceCurrency(args.currency, organization?.currency ?? "CAD");
  if (args.priceListId) {
    const list = await getOwned<Row>(ctx, "invoicePriceLists", args.priceListId, args.societyId);
    if (list.currency !== currency) throw new Error("The price list currency must match the invoice.");
  }
  if (args.repairJobId) {
    await assertRepairBillablePortable(ctx, args.repairJobId);
    const job = await getOwned<Row>(ctx, "repairJobs", args.repairJobId, args.societyId);
    if (job.currency !== currency || job.billToName !== party.billToName || job.partyKind !== party.partyKind || job.memberId !== party.memberId || job.counterpartyId !== party.counterpartyId) throw new Error("The repair customer and currency must match the invoice.");
    if (job.status === "cancelled") throw new Error("A cancelled repair cannot be invoiced.");
    const siblings = await ctx.db.query("invoices").withIndex("by_repair_job", (q) => q.eq("repairJobId", args.repairJobId)).take(100);
    if (siblings.some((row) => row._id !== args.id && row.status !== "void")) throw new Error("This repair already has an invoice.");
  }
  const settings = await loadSettings(ctx, args.societyId);
  const defaultTemplate = settings?.defaultTemplateId ? await getOwned<Row>(ctx, "invoiceTemplates", settings.defaultTemplateId, args.societyId) : null;
  const fields = {
    ...party,
    issueDate: args.issueDate,
    terms,
    dueDate,
    reference: cleanText(args.reference, 100),
    shipToName: cleanText(args.shipToName, 200),
    shipToAddress: cleanText(args.shipToAddress, 1000),
    currency,
    money: cleanInvoiceMoney(args.money, currency, (await loadInvoiceLedgerContext(ctx, args.societyId)).workspaceCurrency),
    documentExtras: args.documentExtras ? cleanDocumentExtras(args.documentExtras) : undefined,
    documentTemplate: cleanInvoiceTemplate(args.documentTemplate ?? (defaultTemplate?.active ? defaultTemplate.config : undefined)),
    priceListId: args.priceListId || undefined,
    repairJobId: args.repairJobId,
    lines,
    discount,
    memo: cleanText(args.memo, 4000),
    totalCents: totals.totalCents,
  };
  if(new TextEncoder().encode(JSON.stringify(fields)).byteLength>900000)throw new Error("This invoice exceeds 900 KB. Reduce template artwork, item images or attachments before saving.");
  return fields;
}

/** Create a draft or save changes. Returns the invoice id. */
export async function upsertPortable(ctx: PortableMutationCtx, args: InvoiceArgs & { actingUserId?: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const original = args.id ? await getOwned<Row>(ctx, "invoices", args.id, args.societyId) : null;
  const fields = await invoiceFields(ctx, { ...args, currency: args.currency ?? original?.currency,
    shipToName: args.shipToName === undefined ? original?.shipToName : args.shipToName,
    shipToAddress: args.shipToAddress === undefined ? original?.shipToAddress : args.shipToAddress,
    documentTemplate: args.documentTemplate ?? original?.documentTemplate,
    money: args.money === undefined ? original?.money : args.money,
    documentExtras: args.documentExtras === undefined ? original?.documentExtras : args.documentExtras,
    repairJobId: args.repairJobId ?? original?.repairJobId, priceListId: args.priceListId === undefined ? original?.priceListId : args.priceListId });
  if (original && original.currency !== fields.currency && ((original.payments ?? []).length || original.journalEntryId)) throw new Error("Currency cannot change after payments or ledger posting.");
  if (original && (original.journalEntryId || original.status !== "draft") && JSON.stringify(original.money?.fx) !== JSON.stringify(fields.money?.fx)) throw new Error("The invoice FX quote is immutable after issue. Void and replace the invoice to change it.");
  if(new TextEncoder().encode(JSON.stringify({...original,...fields})).byteLength>900000)throw new Error("This invoice exceeds 900 KB. Reduce artwork or attachments before saving.");
  const actor = await actorName(ctx, args.societyId);
  const at = nowISO();
  if (args.id) {
    const existing = await getOwned<Row>(ctx, "invoices", args.id, args.societyId);
    if (existing.status === "void") throw new Error("A void invoice can't be edited. Restore it first.");
    const paid = sumPaid(existing.payments);
    if (fields.totalCents < paid) throw new Error("The new total is less than what has already been paid.");
    // A posted invoice keeps its accrual in step (refused in a closed period, or once payments are recognised).
    let timeline = existing.timeline ?? [];
    if (existing.status === "sent" && existing.journalEntryId) {
      const lctx = await loadInvoiceLedgerContext(ctx, args.societyId);
      const outcome = await syncAccrual(ctx, asStored({ ...existing, ...fields }), lctx, await actingUser(ctx, args.societyId));
      if (outcome.changed) timeline = [...timeline, event("posted", "Entry in the books updated after an edit", actor)];
    }
    await ctx.db.patch(args.id, { ...fields, paidCents: paid, timeline, updatedAtISO: at });
    return args.id;
  }
  const { sequence, number } = await allocateNumber(ctx, args.societyId);
  return ctx.db.insert("invoices", {
    societyId: args.societyId,
    sequence,
    number,
    status: "draft",
    ...fields,
    paidCents: 0,
    payments: [],
    timeline: [event("created", "Draft created", actor)],
    source: "manual",
    createdByUserId: await principalUserId(ctx, args.societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
}

async function ownedInvoices(ctx: PortableQueryCtx, societyId: string, ids: string[]) {
  await requireSocietyMembership(ctx, societyId);
  const unique = [...new Set(ids ?? [])].slice(0, 500);
  // Resolve every id first so a foreign or missing id stops the batch before any write.
  return Promise.all(unique.map((id) => getOwned<Row>(ctx, "invoices", id, societyId)));
}

function outboxBody(invoice: Row, organizationName: string, kind: "invoice" | "reminder", balanceCents: number, paymentInstructions?: string) {
  const amount = `${invoice.currency} ${(balanceCents / 100).toFixed(2)}`;
  const lines = [
    `Hello ${invoice.billToName},`,
    "",
    kind === "reminder"
      ? `This is a friendly reminder that invoice ${invoice.number} from ${organizationName} has ${amount} outstanding, due ${invoice.dueDate}.`
      : `Please find invoice ${invoice.number} from ${organizationName} for ${amount}, due ${invoice.dueDate}.`,
  ];
  if (paymentInstructions) lines.push("", "How to pay:", paymentInstructions);
  lines.push("", "Thank you,", organizationName);
  return lines.join("\n");
}

async function draftOutboxEmail(ctx: PortableMutationCtx, invoice: Row, kind: "invoice" | "reminder", balanceCents: number) {
  const [organization, settings] = await Promise.all([ctx.db.get(invoice.societyId, "societies"), loadSettings(ctx, invoice.societyId)]);
  const organizationName = String((organization as any)?.name ?? "our organization");
  await ctx.db.insert("pendingEmails", {
    societyId: invoice.societyId,
    fromName: organizationName,
    replyTo: settings?.replyToEmail,
    to: invoice.billToEmail,
    subject: kind === "reminder" ? `Reminder: invoice ${invoice.number} from ${organizationName}` : `Invoice ${invoice.number} from ${organizationName}`,
    body: outboxBody(invoice, organizationName, kind, balanceCents, settings?.paymentInstructions),
    attachments: [],
    status: "draft",
    createdAtISO: nowISO(),
    createdByUserId: await principalUserId(ctx, invoice.societyId).catch(() => undefined),
    notes: `Created from invoice ${invoice.number}. Attach a PDF from the invoice's Print / Save as PDF before sending.`,
  });
}

async function actingUser(ctx: PortableQueryCtx, societyId: string): Promise<string | undefined> {
  return principalUserId(ctx, societyId).catch(() => undefined);
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Refuse up front when a posting date is in closed books or a closed period (so nothing is half-written). */
async function assertPostableDates(ctx: PortableQueryCtx, societyId: string, dates: string[]) {
  await assertBooksOpen(ctx, societyId, dates, "posted");
  for (const date of dates) await assertPeriodOpen(ctx, { societyId, date });
}

async function receivableAccount(ctx: PortableMutationCtx, societyId: string, lctx: InvoiceLedgerContext): Promise<LedgerAccount> {
  const mapped = lctx.mapping.receivableAccountId ? lctx.accountsById.get(lctx.mapping.receivableAccountId) : undefined;
  return mapped ?? ensureLedgerAccount(ctx, societyId, "receivable");
}

const SNAPSHOT_FIELDS = ["category", "accountingAccountId", "categorizedBy", "ruleId", "reconciledAtISO", "reconciledByName", "matchedKind", "matchedId", "reconciliationNote"] as const;

function snapshotOf(txn: Row): TransactionSnapshot {
  const snapshot: TransactionSnapshot = {};
  for (const field of SNAPSHOT_FIELDS) {
    const value = txn[field];
    if (typeof value === "string" && value) snapshot[field] = value;
  }
  if (Array.isArray(txn.lines) && txn.lines.length) snapshot.lines = txn.lines;
  if (txn.ruleApplication && typeof txn.ruleApplication === "object") snapshot.ruleApplication = txn.ruleApplication;
  return snapshot;
}

/**
 * Mark a deposit matched to the invoice and categorised to Accounts
 * receivable as a single line (a split is folded; its lines and any rule
 * run it cleared are kept in the snapshot and come back on unlink). Tags
 * stay as they were.
 */
async function matchDeposit(ctx: PortableMutationCtx, invoice: Row, txn: Row, lctx: InvoiceLedgerContext, actor?: string): Promise<TransactionSnapshot> {
  const receivable = await receivableAccount(ctx, invoice.societyId, lctx);
  const snapshot = snapshotOf(txn);
  await ctx.db.patch(txn._id, {
    category: receivable.name,
    accountingAccountId: receivable._id,
    categorizedBy: "manual",
    ruleId: undefined,
    ruleApplication: undefined,
    lines: undefined,
    reconciledAtISO: txn.reconciledAtISO ?? nowISO(),
    reconciledByName: txn.reconciledByName ?? actor,
    matchedKind: "invoice",
    matchedId: invoice._id,
    reconciliationNote: `Payment for invoice ${invoice.number}`,
  });
  await flagChangedPeriods(ctx, txn.accountId, txn.date);
  return snapshot;
}

/** Put a linked deposit back as it was before the link, and its own backfill entry with it. */
async function releaseDeposit(ctx: PortableMutationCtx, invoice: Row, payment: StoredInvoicePayment) {
  if (payment.financialTransactionId) {
    const txn = (await ctx.db.get(payment.financialTransactionId, "financialTransactions")) as Row | null;
    if (txn && txn.societyId === invoice.societyId && txn.matchedKind === "invoice" && txn.matchedId === invoice._id) {
      const before = payment.transactionBefore ?? {};
      await ctx.db.patch(txn._id, {
        category: before.category,
        accountingAccountId: before.accountingAccountId,
        categorizedBy: before.categorizedBy,
        ruleId: before.ruleId,
        ruleApplication: before.ruleApplication,
        reconciledAtISO: before.reconciledAtISO,
        reconciledByName: before.reconciledByName,
        matchedKind: before.matchedKind,
        matchedId: before.matchedId,
        reconciliationNote: before.reconciliationNote,
        lines: before.lines,
        ...(payment.replacedTransactionEntryId && txn.invoicePaymentRelease ? { invoicePaymentRelease: { ...txn.invoicePaymentRelease, journalEntryIds: txn.invoicePaymentRelease.journalEntryIds.filter((id: string) => id !== payment.replacedTransactionEntryId) } } : {}),
      });
      await flagChangedPeriods(ctx, txn.accountId, txn.date);
    }
  }
  await restoreDepositEntry(ctx, invoice.societyId, payment.voidedTransactionEntryId);
}

type CorrectedDepositRelease = { transaction: Row | null; restoration?: { lines: InvoiceLedgerLine[]; basis: JournalBasis } };

/** A correction retains historical payment entries and restores bank accounting only on its effective date. */
async function prepareCorrectedDepositRelease(ctx: PortableQueryCtx, invoice: Row, payment: StoredInvoicePayment): Promise<CorrectedDepositRelease> {
  const transaction = payment.financialTransactionId ? await getOwned<Row>(ctx, "financialTransactions", payment.financialTransactionId, invoice.societyId) : null;
  if (transaction && (transaction.matchedKind !== "invoice" || transaction.matchedId !== invoice._id)) throw new Error("The linked bank match changed; review it before reversing this settlement.");
  const originalId = payment.replacedTransactionEntryId ?? payment.voidedTransactionEntryId;
  if (!originalId) return { transaction };
  const entry = await getOwned<Row>(ctx, "journalEntries", originalId, invoice.societyId);
  if (![TRANSACTION_BACKFILL_SOURCE, BILL_BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE].includes(entry.source)) throw new Error("The bank restoration reference is not a supported transaction entry.");
  if (entry.status !== (payment.replacedTransactionEntryId ? "posted" : "void")) throw new Error("The replaced bank journal changed; review it before reversing this settlement.");
  if (payment.replacedTransactionEntryId) {
    const transfer = payment.bankTransferJournalEntryId ? await getOwned<Row>(ctx, "journalEntries", payment.bankTransferJournalEntryId, invoice.societyId) : null;
    if (!transfer || transfer.status !== "posted" || transfer.source !== "invoice_bank_transfer" || transfer.sourceExternalId !== `invoice:${invoice._id}:payment:${payment.key}:bank-transfer`) throw new Error("The original bank transfer journal changed; review it before reversing this settlement.");
    validateBalancedJournalLines(await entryLines(ctx, transfer._id));
  }
  const lines = (await entryLines(ctx, entry._id)).map(line => ({ ...line, side: line.side as "debit" | "credit" }));
  if (!transaction || !lines.some(line => line.financialTransactionId === transaction._id)) throw new Error("The bank restoration journal does not belong to this linked bank transaction.");
  validateBalancedJournalLines(lines);
  return { transaction, restoration: { lines, basis: journalBasisOf({ basis: entry.basis, source: entry.source }) } };
}

async function releaseCorrectedDeposit(ctx: PortableMutationCtx, invoice: Row, payment: StoredInvoicePayment, date: string, prepared: CorrectedDepositRelease, userId?: string) {
  const restoredTransactionJournalEntryId = prepared.restoration ? await postLedgerEntry(ctx, { societyId: invoice.societyId, kind: "bankRestoration", key: `invoice:${invoice._id}:payment:${payment.key}:bank-restored`, date, memo: `Restore bank transaction after invoice settlement reversal: ${invoice.number}`, basis: prepared.restoration.basis, lines: prepared.restoration.lines, createdByUserId: userId }) : undefined;
  const txn = prepared.transaction;
  if (txn) {
    const before = payment.transactionBefore ?? {};
    const previous = txn.invoicePaymentRelease;
    const invoicePaymentRelease = { date: previous && previous.date > date ? previous.date : date, journalEntryIds: [...new Set([...(previous?.journalEntryIds ?? []), ...(payment.journalEntryId ? [payment.journalEntryId] : [])])] };
    await ctx.db.patch(txn._id, { category: before.category, accountingAccountId: before.accountingAccountId, categorizedBy: before.categorizedBy, ruleId: before.ruleId, ruleApplication: before.ruleApplication, reconciledAtISO: before.reconciledAtISO, reconciledByName: before.reconciledByName, matchedKind: before.matchedKind, matchedId: before.matchedId, reconciliationNote: before.reconciliationNote, lines: before.lines, invoicePaymentRelease });
    await flagChangedPeriods(ctx, txn.accountId, txn.date);
  }
  return restoredTransactionJournalEntryId;
}

/** Take a payment out of the books and unlink its deposit (refused in a closed period or closed books). */
async function unwindPayment(ctx: PortableMutationCtx, invoice: Row, payment: StoredInvoicePayment) {
  await unpostPayment(ctx, invoice.societyId, payment);
  await releaseDeposit(ctx, invoice, payment);
}

function postedLabel(totalCents: number) {
  return `Posted to the books: ${money(totalCents)} to Accounts receivable`;
}

/** Mark drafts as sent (optionally drafting an Outbox email for each); each posts its accrual when the books can take it. */
export async function markSentPortable(ctx: PortableMutationCtx, { societyId, ids, draftEmail }: { societyId: string; ids: string[]; draftEmail?: boolean }) {
  const rows = await ownedInvoices(ctx, societyId, ids);
  const actor = await actorName(ctx, societyId);
  const userId = await actingUser(ctx, societyId);
  const lctx = await loadInvoiceLedgerContext(ctx, societyId);
  let sent = 0;
  let emailed = 0;
  let skipped = 0;
  let posted = 0;
  for (const row of rows) {
    if (row.status !== "draft") { skipped += 1; continue; }
    // Post first: a closed period refuses the send before anything changes.
    const outcome = await syncAccrual(ctx, asStored({ ...row, status: "sent" }), lctx, userId);
    const at = nowISO();
    const events = [event("sent", draftEmail && row.billToEmail ? "Marked as sent · email drafted in Outbox" : "Marked as sent", actor)];
    if (outcome.entryId) events.push(event("posted", postedLabel(computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents), actor));
    await ctx.db.patch(row._id, { status: "sent", sentAtISO: at, updatedAtISO: at, ...(outcome.entryId ? { journalEntryId: outcome.entryId } : {}), timeline: [...(row.timeline ?? []), ...events] });
    sent += 1;
    if (outcome.entryId) posted += 1;
    if (draftEmail && row.billToEmail) {
      await draftOutboxEmail(ctx, row, "invoice", row.totalCents - sumPaid(row.payments));
      emailed += 1;
    }
  }
  return { sent, emailed, skipped, posted };
}

/** Void invoices without payments; a posted invoice gets a reversing entry (dated today, so closed books refuse it). */
export async function voidInvoicesPortable(ctx: PortableMutationCtx, { societyId, ids, reason }: { societyId: string; ids: string[]; reason?: string }) {
  const rows = await ownedInvoices(ctx, societyId, ids);
  const actor = await actorName(ctx, societyId);
  const userId = await actingUser(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  let voided = 0;
  let skippedPaid = 0;
  let skipped = 0;
  let reversed = 0;
  for (const row of rows) {
    if (row.status === "void") { skipped += 1; continue; }
    if (sumPaid(row.payments) > 0) { skippedPaid += 1; continue; }
    if((row.payments??[]).some((payment:StoredInvoicePayment)=>!payment.reversedDate)) { skippedPaid += 1; continue; }
    const revaluations=await reverseOpenInvoiceRevaluations(ctx,asStored(row),today,userId);
    if(revaluations.length)await ctx.db.patch(row._id,{fxRevaluations:revaluations});
    const at = nowISO();
    const why = cleanText(reason, 300);
    const events = [event("voided", why ? `Voided: ${why}` : "Voided", actor)];
    const reversalId = await reverseAccrual(ctx, asStored(row), today > row.issueDate ? today : row.issueDate, userId);
    if (reversalId) {
      events.push(event("reversed", "Reversing entry posted", actor, computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents));
      reversed += 1;
    }
    await ctx.db.patch(row._id, { status: "void", voidedAtISO: at, voidReason: why, ...(reversalId ? { reversalJournalEntryId: reversalId } : {}), updatedAtISO: at, timeline: [...(row.timeline ?? []), ...events] });
    voided += 1;
  }
  return { voided, skippedPaid, skipped, reversed };
}

/** Restore a void invoice; a sent one that had been reversed is posted again (a new round of keys). */
export async function restoreVoidedPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  if (row.status !== "void") return id;
  if (row.repairJobId) {
    const siblings = await ctx.db.query("invoices").withIndex("by_repair_job", (q) => q.eq("repairJobId", row.repairJobId)).take(100);
    if (siblings.some((other) => other._id !== id && other.status !== "void")) throw new Error("This repair already has an active invoice.");
  }
  const actor = await actorName(ctx, row.societyId);
  const status = row.sentAtISO ? "sent" : "draft";
  const reposting = Boolean(row.reversalJournalEntryId);
  const next: Row = reposting
    ? { ...row, status, journalEntryId: undefined, reversalJournalEntryId: undefined, ledgerRound: (Number(row.ledgerRound) || 1) + 1 }
    : { ...row, status };
  const events = [event("restored", "Restored from void", actor)];
  let journalEntryId = next.journalEntryId;
  if (status === "sent" && (reposting || !journalEntryId)) {
    const outcome = await syncAccrual(ctx, asStored(next), await loadInvoiceLedgerContext(ctx, row.societyId), await actingUser(ctx, row.societyId));
    if (outcome.entryId) {
      journalEntryId = outcome.entryId;
      events.push(event("posted", postedLabel(computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents), actor));
    }
  }
  await ctx.db.patch(id, {
    status,
    voidedAtISO: undefined,
    voidReason: undefined,
    journalEntryId,
    reversalJournalEntryId: next.reversalJournalEntryId,
    ...(reposting ? { ledgerRound: next.ledgerRound } : {}),
    updatedAtISO: nowISO(),
    timeline: [...(row.timeline ?? []), ...events],
  });
  return id;
}

export async function duplicatePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const today = await organizationToday(ctx, row.societyId);
  const actor = await actorName(ctx, row.societyId);
  const { sequence, number } = await allocateNumber(ctx, row.societyId);
  const at = nowISO();
  const terms = row.terms === "custom" ? DEFAULT_TERMS : row.terms;
  return ctx.db.insert("invoices", {
    societyId: row.societyId,
    sequence,
    number,
    status: "draft",
    partyKind: row.partyKind,
    memberId: row.memberId,
    counterpartyId: row.counterpartyId,
    billToName: row.billToName,
    billToEmail: row.billToEmail,
    billToAddress: row.billToAddress,
    shipToName: row.shipToName,
    shipToAddress: row.shipToAddress,
    issueDate: today,
    terms,
    dueDate: dueDateForTerms(today, terms),
    reference: row.reference,
    currency: row.currency,
    documentTemplate: row.documentTemplate,
    money: row.money, documentExtras: row.documentExtras,
    priceListId: row.priceListId,
    lines: (row.lines ?? []).map((line: any) => ({ ...line, key: randomKey("line") })),
    discount: row.discount,
    memo: row.memo,
    totalCents: computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents,
    paidCents: 0,
    payments: [],
    timeline: [event("duplicated", `Duplicated from ${row.number}`, actor)],
    source: "duplicate",
    createdByUserId: await principalUserId(ctx, row.societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  if (row.status !== "draft" || (row.payments ?? []).length) throw new Error("Only unpaid drafts can be deleted. Void a sent invoice instead.");
  await ctx.db.delete(id);
}

/** A money-in bank line this invoice may link: this workspace's, not linked to another payment, not matched elsewhere. */
async function linkableDeposit(ctx: PortableQueryCtx, invoice: Row, transactionId: string, paymentDate?: string): Promise<Row> {
  const txn = await getOwned<Row>(ctx, "financialTransactions", transactionId, invoice.societyId);
  if (!(Number(txn.amountCents) > 0)) throw new Error("Only money-in bank transactions can be linked to a payment.");
  const account = txn.accountId ? await getOwned<LedgerAccount>(ctx, "financialAccounts", txn.accountId, invoice.societyId) : null;
  const lctx = await loadInvoiceLedgerContext(ctx, invoice.societyId);
  if ((txn.currency ?? account?.currency ?? lctx.workspaceCurrency) !== invoice.currency) throw new Error("The bank deposit currency must match the invoice. Record currency exchange separately in the books.");
  const invoices = await loadInvoices(ctx, invoice.societyId);
  const alreadyLinked = invoices.some((other) => (other.payments ?? []).some((payment: StoredInvoicePayment) => !payment.reversedDate && payment.financialTransactionId === transactionId));
  if (alreadyLinked) throw new Error("That bank transaction is already linked to an invoice payment.");
  if (!MATCHABLE_KINDS.has(txn.matchedKind)) throw new Error(`That bank transaction is already matched to a ${txn.matchedKind} record.`);
  await assertDepositClaimable(ctx, invoice.societyId, transactionId, paymentDate);
  return txn;
}

function assertReleasedBankDate(transaction: Row, date: string) {
  const latest = [transaction.billPaymentRelease?.date, transaction.invoicePaymentRelease?.date].filter(Boolean).sort().at(-1);
  if (latest && date < latest) throw new Error(`Record a payment linked to this bank transaction on or after its previous reversal (${latest}).`);
}

/** A deposit another kind of entry already posted can't be taken over, nor one whose own entry is in closed books (read-only). */
async function assertDepositClaimable(ctx: PortableQueryCtx, societyId: string, transactionId: string, paymentDate?: string) {
  const entries = await claimableDepositEntries(ctx, transactionId);
  if (entries.length > 1) throw new Error("This bank transaction has multiple current journal entries. Review them before linking a receipt.");
  for (const entry of entries) {
    if (paymentDate && entry.date > paymentDate) throw new Error("The receipt date must be on or after the bank transaction's current posting date.");
    if (paymentDate && entry.date < paymentDate) {
      validateBalancedJournalLines(await entryLines(ctx, entry._id));
      await assertPostableDates(ctx, societyId, [paymentDate]);
      continue;
    }
    await assertBooksOpen(ctx, societyId, [entry.date], "voided");
    await assertPeriodOpen(ctx, { societyId, date: entry.date, fiscalPeriodId: entry.fiscalPeriodId });
  }
}

/**
 * Everything "Post existing invoices" would refuse for one invoice, checked
 * before it writes anything (closed books or periods, a deposit posted
 * another way, lines that don't balance), so a failure leaves no partial state.
 */
async function assertInvoicePostable(ctx: PortableQueryCtx, row: Row, lctx: InvoiceLedgerContext, postAccrual: boolean, payments: StoredInvoicePayment[]) {
  if (postAccrual && computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents > 0) {
    await assertPostableDates(ctx, row.societyId, [row.issueDate]);
    const placeholder = { receivableAccountId: "receivable", taxPayableAccountId: "tax" };
    validateBalancedJournalLines(accrualPostingLines(asStored(row), () => "revenue", placeholder));
  }
  for (const payment of payments) {
    await assertPostableDates(ctx, row.societyId, [payment.date]);
    validateBalancedJournalLines(paymentPostingLines(payment, { depositAccountId: "deposit", receivableAccountId: "receivable" }));
    if (!payment.financialTransactionId) continue;
    const txn = (await ctx.db.get(payment.financialTransactionId, "financialTransactions")) as Row | null;
    if (txn && txn.societyId === row.societyId) await assertDepositClaimable(ctx, row.societyId, txn._id, payment.date);
  }
}

async function assertDepositAccount(ctx: PortableQueryCtx, societyId: string, accountId: string, currency?: string) {
  const account = await getOwned<LedgerAccount>(ctx, "financialAccounts", accountId, societyId);
  if (!MONEY_ACCOUNT_TYPES.has(account.accountType) && !(account.accountType === "Asset" && CASH_SUBTYPES.has(String(account.subtype)))) {
    throw new Error(`${account.name} isn't a bank, cash or undeposited funds account.`);
  }
  if (currency && (account.currency ?? "CAD") !== currency) throw new Error("The deposit account currency must match the invoice.");
}

type SettlementArgs = { id: string; date: string; amountCents: number; method?: string; reference?: string; note?: string; financialTransactionId?: string; depositAccountId?: string; idempotencyKey?: string; fxRateMicros?: number; fxSource?: string; sourcePaymentKey?: string };
async function recordSettlement(ctx: PortableMutationCtx, args: SettlementArgs, kind: "payment" | "credit" | "write_off" | "refund") {
  const row = await requireOwnedRow<Row>(ctx, "invoices", args.id);
  if (row.status === "void") throw new Error("A void invoice cannot take settlements.");
  if (!isCalendarDate(args.date) || args.date > await organizationToday(ctx, row.societyId)) throw new Error("Choose a valid settlement date on or before today.");
  if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) throw new Error("Enter positive integer cents.");
  const amountCents = kind === "refund" ? -args.amountCents : args.amountCents;
  const idempotencyKey = args.idempotencyKey?.trim();
  if(args.idempotencyKey!==undefined&&(!idempotencyKey||args.idempotencyKey.length>100))throw new Error("Use an idempotency key of 1–100 characters.");
  const previous = row.payments ?? [];
  const method = kind === "credit" || kind === "write_off" ? "other" : (PAYMENT_METHODS as readonly string[]).includes(args.method ?? "") ? args.method! : "other";
  const retry = idempotencyKey && previous.find((payment: StoredInvoicePayment) => payment.idempotencyKey === idempotencyKey);
  if (retry) {
    if ((retry.kind ?? "payment") !== kind || retry.amountCents !== amountCents || retry.date !== args.date || retry.method !== method
      || retry.reference !== cleanText(args.reference, 100) || retry.note !== cleanText(args.note, 1000)
      || retry.sourcePaymentKey !== args.sourcePaymentKey || retry.financialTransactionId !== args.financialTransactionId
      || (args.depositAccountId !== undefined && retry.depositAccountId !== args.depositAccountId)
      || retry.fxRateMicros !== args.fxRateMicros || retry.fxSource !== cleanText(args.fxSource, 200)) throw new Error("That idempotency key already belongs to a different settlement.");
    return retry.key;
  }
  const active = previous.filter((payment: StoredInvoicePayment) => !payment.reversedDate);
  const total = computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents;
  const summary = settlementTotals(active), balance = total - summary.settledCents;
  if ((kind === "payment" || kind === "write_off") && args.amountCents > Math.max(0, balance)) throw new Error(`That's more than the ${(Math.max(0, balance) / 100).toFixed(2)} balance.`);
  if (kind === "payment" || kind === "write_off") {
    const dates = new Set<string>([args.date, ...previous.flatMap((payment: StoredInvoicePayment) => [payment.date, ...(payment.reversedDate ? [payment.reversedDate] : [])]).filter((date: string) => date >= args.date)]);
    if ([...dates].some(date => previous.filter((payment: StoredInvoicePayment) => payment.date <= date && (!payment.reversedDate || payment.reversedDate > date)).reduce((sum: number, payment: StoredInvoicePayment) => sum + payment.amountCents, 0) + args.amountCents > total)) throw new Error("That settlement date overlaps earlier settled amounts. Choose a date on or after the applicable reversal, or reduce the amount.");
  }
  if (kind === "credit" && summary.creditCents + args.amountCents > total) throw new Error("Credits cannot exceed the invoice's collectible total.");
  if (kind !== "payment" && !args.note?.trim()) throw new Error("Record the reason for this credit, write-off or refund.");
  if (kind === "refund") {
    const original = active.find((payment: StoredInvoicePayment) => payment.key === args.sourcePaymentKey && (payment.kind ?? "payment") === "payment");
    const refunded = -active.filter((payment: StoredInvoicePayment) => payment.kind === "refund" && payment.sourcePaymentKey === args.sourcePaymentKey).reduce((sum: number, payment: StoredInvoicePayment) => sum + payment.amountCents, 0);
    if (!original || args.amountCents + refunded > original.amountCents) throw new Error("Refunds cannot exceed the selected original cash payment.");
    if (args.date < original.date) throw new Error("Choose a refund date on or after the original cash payment.");
  }
  const lctx = await loadInvoiceLedgerContext(ctx, row.societyId);
  const foreign = row.currency !== lctx.workspaceCurrency, noncash = kind === "credit" || kind === "write_off";
  let fxRateMicros: number | undefined;
  if (foreign && !noncash) {
    if (!args.fxRateMicros || !args.fxSource?.trim()) throw new Error("Record an explicit foreign-currency settlement FX rate and source.");
    fxRateMicros = explicitFxQuote({ baseCurrency: lctx.workspaceCurrency, rateMicros: args.fxRateMicros, asOfDate: args.date, source: args.fxSource }, row.currency, lctx.workspaceCurrency)!.rateMicros;
  }
  const expectedBase = noncash ? undefined : convertInvoiceCents(amountCents, fxRateMicros ?? 1_000_000);
  let txn: Row | null = null;
  if (args.financialTransactionId) {
    if (noncash) throw new Error("A noncash credit or write-off cannot claim a bank transaction.");
    txn = await getOwned<Row>(ctx, "financialTransactions", args.financialTransactionId, row.societyId);
    assertReleasedBankDate(txn, args.date);
    const account = await getOwned<Row>(ctx, "financialAccounts", txn.accountId, row.societyId);
    if (active.some((payment: StoredInvoicePayment) => payment.financialTransactionId === txn!._id)) throw new Error("That bank transaction is already linked to a payment.");
    const invoices = await loadInvoices(ctx, row.societyId);
    if (invoices.some((invoice) => invoice._id !== row._id && (invoice.payments ?? []).some((payment: StoredInvoicePayment) => !payment.reversedDate && payment.financialTransactionId === txn!._id))) throw new Error("That bank transaction is already linked to another invoice.");
    if ((account.currency ?? lctx.workspaceCurrency) !== lctx.workspaceCurrency || ((foreign || kind === "refund") && Number(txn.amountCents) !== expectedBase) || (kind === "payment" && Number(txn.amountCents) <= 0)) throw new Error("The bank transaction must match the explicit settlement amount in the books currency.");
    await assertDepositClaimable(ctx, row.societyId, txn._id, args.date);
  } else if (!noncash) {
    const depositAccountId = args.depositAccountId || lctx.mapping.depositAccountId;
    if (depositAccountId) await assertDepositAccount(ctx, row.societyId, depositAccountId, lctx.workspaceCurrency);
  }
  const actor = await actorName(ctx, row.societyId), userId = await actingUser(ctx, row.societyId), at = nowISO();
  let payment: StoredInvoicePayment = { key: randomKey("settlement"), kind, date: args.date, amountCents, method, recordedAtISO: at, ...(idempotencyKey ? { idempotencyKey } : {}), ...(args.sourcePaymentKey ? { sourcePaymentKey: args.sourcePaymentKey } : {}), ...(fxRateMicros ? { fxRateMicros, fxSource: cleanText(args.fxSource, 200) } : {}), ...(args.reference ? { reference: cleanText(args.reference, 100) } : {}), ...(args.note ? { note: cleanText(args.note, 1000) } : {}), ...(actor ? { recordedByName: actor } : {}), ...(txn ? { financialTransactionId: txn._id } : args.depositAccountId && !noncash ? { depositAccountId: args.depositAccountId } : {}) };
  if(new TextEncoder().encode(JSON.stringify({...row,payments:[...previous,payment]})).byteLength>900000)throw new Error("This invoice is too large for another settlement record. Export the audit history and reduce inline attachments.");
  let next = { ...row, status: "sent", payments: [...previous, payment] } as Row;
  await assertPostableDates(ctx, row.societyId, row.status === "draft" ? [row.issueDate, args.date] : [args.date]);
  const blockers = accrualBlockers(asStored(next), lctx);
  if (noncash && blockers.length) throw new Error(`Post the invoice before recording a credit or write-off: ${blockers.join(" ")}`);
  if (row.status === "draft" || !row.journalEntryId) { const outcome = await syncAccrual(ctx, asStored(next), lctx, userId); if (outcome.entryId) next.journalEntryId = outcome.entryId; }
  const fxRevaluations = await reverseOpenInvoiceRevaluations(ctx, asStored(next), args.date, userId);
  next.fxRevaluations = fxRevaluations;
  if (txn) payment = { ...payment, transactionBefore: await matchDeposit(ctx, row, txn, lctx, actor) };
  payment = withPosting(payment, await postPayment(ctx, asStored(next), payment, lctx, userId));
  await ctx.db.patch(row._id, { status: "sent", sentAtISO: row.sentAtISO ?? at, ...(next.journalEntryId ? { journalEntryId: next.journalEntryId } : {}), fxRevaluations, payments: [...previous, payment], paidCents: sumPaid([...previous, payment]), totalCents: total, updatedAtISO: at, timeline: [...(row.timeline ?? []), event(kind, `${kind === "payment" ? "Payment" : kind === "write_off" ? "Write-off" : kind === "credit" ? "Credit" : "Refund"} recorded`, actor, amountCents)] });
  return payment.key;
}
export async function recordPaymentPortable(ctx: PortableMutationCtx, args: SettlementArgs) { return recordSettlement(ctx, args, "payment"); }
export async function recordAdjustmentPortable(ctx: PortableMutationCtx, args: SettlementArgs & { kind: "credit" | "write_off" | "refund" }) { return recordSettlement(ctx, args, args.kind); }

/** Corrections append reversals; the original settlement remains available to historical statements. */
export async function removePaymentPortable(ctx: PortableMutationCtx, args: { id: string; paymentKey: string; date?: string; reason?: string }) {
  const { id, paymentKey } = args;
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const payment = (row.payments ?? []).find((entry: StoredInvoicePayment) => entry.key === paymentKey) as StoredInvoicePayment | undefined;
  if (!payment) throw new Error("That settlement is no longer on this invoice.");
  const requestedReason = args.reason === undefined ? undefined : cleanText(args.reason, 1000);
  if (payment.reversedDate) {
    if (args.date && args.date !== payment.reversedDate || args.reason !== undefined && requestedReason !== payment.reversalReason) throw new Error("That settlement was already reversed with different details.");
    return id;
  }
  if ((row.payments ?? []).some((entry: StoredInvoicePayment) => !entry.reversedDate && entry.sourcePaymentKey === payment.key)) throw new Error("Reverse this payment's refunds first.");
  const today = await organizationToday(ctx, row.societyId), date = args.date ?? today, userId = await actingUser(ctx, row.societyId);
  const reason = args.reason === undefined ? "Recorded in error" : requestedReason;
  if (!isCalendarDate(date) || date < payment.date || date > today) throw new Error("Choose a reversal date between the original settlement and today.");
  if (!reason) throw new Error("Explain why the settlement is being reversed.");
  const depositRelease = await prepareCorrectedDepositRelease(ctx, row, payment);
  const prepared = await prepareSettlementReversal(ctx, asStored(row), payment, date);
  const fxRevaluations = await reverseOpenInvoiceRevaluations(ctx, asStored(row), date, userId);
  const reversals = await reverseSettlementPosting(ctx, asStored(row), payment, date, userId, prepared);
  const restoredTransactionJournalEntryId = await releaseCorrectedDeposit(ctx, row, payment, date, depositRelease, userId);
  const payments = row.payments.map((entry: StoredInvoicePayment) => entry.key === paymentKey ? { ...entry, ...reversals, ...(restoredTransactionJournalEntryId ? { restoredTransactionJournalEntryId } : {}), reversedDate: date, reversedAtISO: nowISO(), reversalReason: reason } : entry);
  await ctx.db.patch(id, { payments, fxRevaluations, paidCents: sumPaid(payments), updatedAtISO: nowISO(), timeline: [...(row.timeline ?? []), event("settlement_reversed", "Settlement reversed; original retained for audit", await actorName(ctx, row.societyId), payment.amountCents)] });
  return id;
}
export async function revertToUnpaidPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const active = (row.payments ?? []).filter((payment: StoredInvoicePayment) => !payment.reversedDate);
  for (const payment of [...active].sort((a: StoredInvoicePayment, b: StoredInvoicePayment) => Number(a.kind !== "refund") - Number(b.kind !== "refund"))) await removePaymentPortable(ctx, { id, paymentKey: payment.key });
  return id;
}
export const reverseAdjustmentPortable = removePaymentPortable;

/** Dated, explicit period-end mark. Subsequent settlements reverse unrealized marks before realizing FX. */
export async function revaluePortable(ctx: PortableMutationCtx, args: { id: string; date: string; rateMicros: number; source: string; idempotencyKey: string }) {
  if(!args.idempotencyKey?.trim()||args.idempotencyKey.length>100)throw new Error("Use an idempotency key of 1–100 characters.");
  const idempotencyKey = args.idempotencyKey.trim();
  const row = await requireOwnedRow<Row>(ctx, "invoices", args.id);
  const lctx = await loadInvoiceLedgerContext(ctx, row.societyId);
  if (row.status !== "sent" || !row.journalEntryId || !row.money?.fx || row.currency === lctx.workspaceCurrency) throw new Error("Revaluation requires a posted foreign-currency invoice.");
  const retry = (row.fxRevaluations ?? []).find((value: any) => value.key === idempotencyKey);
  if (retry) { if (retry.date !== args.date || retry.rateMicros !== args.rateMicros || retry.source !== args.source.trim()) throw new Error("That key belongs to another FX revaluation."); return retry.journalEntryId ?? null; }
  if (!isCalendarDate(args.date) || args.date < row.issueDate || args.date > await organizationToday(ctx, row.societyId)) throw new Error("Choose a revaluation date between issue and today.");
  if ((row.payments ?? []).some((payment: StoredInvoicePayment) => !payment.reversedDate && payment.date > args.date) || (row.fxRevaluations ?? []).some((value: any) => value.date > args.date)) throw new Error("Revaluation must follow the invoice's existing settlements and revaluations.");
  const source = explicitFxQuote({ baseCurrency: lctx.workspaceCurrency, rateMicros: args.rateMicros, asOfDate: args.date, source: args.source }, row.currency, lctx.workspaceCurrency)!.source;
  await assertPostableDates(ctx, row.societyId, [args.date]);
  const total = computeInvoiceTotals(row.lines, row.discount, row.money).totalCents, invoiceBalanceCents = total - sumPaid(row.payments);
  if (invoiceBalanceCents <= 0) throw new Error("Only a positive outstanding receivable can be revalued.");
  const accrual = await entryLines(ctx, row.journalEntryId);
  const carrying = accrual[0].amountCents - (row.payments ?? []).filter((payment: StoredInvoicePayment) => !payment.reversedDate).reduce((sum: number, payment: StoredInvoicePayment) => sum + (payment.bookValueCents ?? payment.amountCents), 0) + (row.fxRevaluations ?? []).filter((value: any) => !value.reversedDate).reduce((sum: number, value: any) => sum + value.adjustmentCents, 0);
  const baseBalanceCents = convertInvoiceCents(invoiceBalanceCents, args.rateMicros), adjustmentCents = baseBalanceCents - carrying;
  const mark = { key: idempotencyKey, date: args.date, rateMicros: args.rateMicros, source, invoiceBalanceCents, baseBalanceCents, adjustmentCents };
  if (new TextEncoder().encode(JSON.stringify({ ...row, fxRevaluations: [...(row.fxRevaluations ?? []), mark] })).byteLength > 900000) throw new Error("This invoice is too large for another revaluation record. Reduce inline artwork or attachments.");
  let journalEntryId: string | undefined;
  if (adjustmentCents) {
    const account = await ensureLedgerAccount(ctx, row.societyId, adjustmentCents > 0 ? "fxUnrealizedGain" : "fxUnrealizedLoss", lctx.workspaceCurrency);
    journalEntryId = await postLedgerEntry(ctx, { societyId: row.societyId, kind: "revaluation", key: `invoice:${row._id}:fx:${idempotencyKey}`, date: args.date, memo: `FX revaluation ${row.number}: ${source}`, lines: [{ accountId: accrual[0].accountId, side: adjustmentCents > 0 ? "debit" : "credit", amountCents: Math.abs(adjustmentCents) }, { accountId: account._id, side: adjustmentCents > 0 ? "credit" : "debit", amountCents: Math.abs(adjustmentCents) }], counterpartyId: row.counterpartyId, createdByUserId: await actingUser(ctx, row.societyId) });
  }
  await ctx.db.patch(row._id, { fxRevaluations: [...(row.fxRevaluations ?? []), { ...mark, ...(journalEntryId ? { journalEntryId } : {}) }], updatedAtISO: nowISO(), timeline: [...(row.timeline ?? []), event("fx_revaluation", `FX revaluation: ${source}`, await actorName(ctx, row.societyId), adjustmentCents)] });
  return journalEntryId ?? null;
}

export async function linkDepositPortable(
  ctx: PortableMutationCtx,
  { id, paymentKey, financialTransactionId, depositAccountId }: { id: string; paymentKey: string; financialTransactionId?: string; depositAccountId?: string },
) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const index = (row.payments ?? []).findIndex((entry: StoredInvoicePayment) => entry.key === paymentKey);
  if (index < 0) throw new Error("That payment is no longer on this invoice.");
  const current = row.payments[index] as StoredInvoicePayment;
  if(current.reversedDate||(current.kind&&current.kind!=="payment"))throw new Error("Only active cash payments can link a bank deposit.");
  if (financialTransactionId && current.financialTransactionId === financialTransactionId) return paymentKey;
  const txn = financialTransactionId ? await linkableDeposit(ctx, {...row,currency:row.money?.fx?.baseCurrency??row.currency}, financialTransactionId, current.date) : null;
  if (txn) assertReleasedBankDate(txn, current.date);
  if (depositAccountId && !txn) await assertDepositAccount(ctx, row.societyId, depositAccountId, row.money?.fx?.baseCurrency??row.currency);
  const lctx = await loadInvoiceLedgerContext(ctx, row.societyId);
  if (current.journalEntryId && !paymentBlock(current, lctx)) await assertPostableDates(ctx, row.societyId, [current.date]);
  if(txn&&row.money?.fx&&Number(txn.amountCents)!==current.baseAmountCents)throw new Error("The deposit must match the recorded base-currency settlement amount.");
  const actor = await actorName(ctx, row.societyId);
  await unwindPayment(ctx, row, current);
  const {
    financialTransactionId: _txn,
    transactionBefore: _before,
    voidedTransactionEntryId: _voided,
    replacedTransactionEntryId: _replaced,
    bankTransferJournalEntryId: _transfer,
    journalEntryId: _entry,
    cashBasisEntryId: _cash,
    depositAccountId: _deposit,
    ...base
  } = current;
  let payment: StoredInvoicePayment = { ...base, ...(txn ? { financialTransactionId: txn._id } : depositAccountId ? { depositAccountId } : {}) };
  if (txn) payment = { ...payment, transactionBefore: await matchDeposit(ctx, row, txn, lctx, actor) };
  const payments = [...row.payments];
  payments[index] = payment;
  payment = withPosting(payment, await postPayment(ctx, asStored({ ...row, payments }), payment, lctx, await actingUser(ctx, row.societyId)));
  payments[index] = payment;
  await ctx.db.patch(id, {
    payments,
    updatedAtISO: nowISO(),
    timeline: [...(row.timeline ?? []), event("deposit", txn ? `Payment linked to the bank deposit of ${txn.date}` : current.financialTransactionId ? "Bank deposit unlinked" : "Deposit account changed", actor, payment.amountCents)],
  });
  return paymentKey;
}

/** Draft a reminder email in the Outbox for each open invoice with an email address. */
export async function sendRemindersPortable(ctx: PortableMutationCtx, { societyId, ids }: { societyId: string; ids: string[] }) {
  const rows = await ownedInvoices(ctx, societyId, ids);
  const today = await organizationToday(ctx, societyId);
  const actor = await actorName(ctx, societyId);
  let created = 0;
  let skippedNoEmail = 0;
  let skippedNotOpen = 0;
  for (const row of rows) {
    const total = computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents;
    const status = deriveInvoiceStatus({ status: row.status, dueDate: row.dueDate, totalCents: total, payments: row.payments }, today);
    if (!isOpenStatus(status)) { skippedNotOpen += 1; continue; }
    if (!row.billToEmail) { skippedNoEmail += 1; continue; }
    const balance = total - sumPaid(row.payments);
    await draftOutboxEmail(ctx, row, "reminder", balance);
    const at = nowISO();
    await ctx.db.patch(row._id, { lastReminderAtISO: at, updatedAtISO: at, timeline: [...(row.timeline ?? []), event("reminder", "Reminder drafted in Outbox", actor)] });
    created += 1;
  }
  return { created, skippedNoEmail, skippedNotOpen };
}

async function membershipContext(ctx: PortableQueryCtx, societyId: string) {
  const [subscriptions, plans, feePeriods] = await Promise.all([
    ctx.db.query("memberSubscriptions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("subscriptionPlans").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("membershipFeePeriods").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return { subscriptions: subscriptions as Row[], plans: (plans as Row[]).filter((plan) => plan.active !== false), feePeriods: feePeriods as Row[] };
}

async function insertDuesDraft(
  ctx: PortableMutationCtx,
  societyId: string,
  input: { member?: Row; subscription?: Row; plan: Row; priceCents: number; issueDate: string; renewalDate?: string; batch?: string; actor?: string },
) {
  const settings = await loadSettings(ctx, societyId);
  const terms = settings?.defaultTerms ?? DEFAULT_TERMS;
  const lines = [planLineItem(input.plan, input.priceCents, input.renewalDate)];
  const { sequence, number } = await allocateNumber(ctx, societyId);
  const at = nowISO();
  const member = input.member;
  const name = member
    ? (member.memberKind === "organization" && member.organizationName ? member.organizationName : `${member.firstName} ${member.lastName}`.trim())
    : String(input.subscription?.fullName ?? "Member");
  return ctx.db.insert("invoices", {
    societyId,
    sequence,
    number,
    status: "draft",
    partyKind: member ? "member" : "custom",
    memberId: member?._id,
    billToName: name,
    billToEmail: member?.email ?? input.subscription?.email,
    billToAddress: member?.address,
    issueDate: input.issueDate,
    terms,
    dueDate: dueDateForTerms(input.issueDate, terms),
    currency: input.plan.currency ?? "CAD",
    lines,
    memo: settings?.defaultMemo,
    totalCents: computeInvoiceTotals(lines).totalCents,
    paidCents: 0,
    payments: [],
    timeline: [event("created", input.batch ? "Draft created from membership renewals" : "Draft created from fee tier", input.actor)],
    source: "dues",
    subscriptionId: input.subscription?._id,
    duesPeriodEnd: input.renewalDate,
    duesBatch: input.batch,
    createdByUserId: await principalUserId(ctx, societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
}

/** Create a draft dues invoice for one member from their fee tier. */
export async function billMemberDuesPortable(ctx: PortableMutationCtx, { societyId, memberId }: { societyId: string; memberId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const member = await getOwned<Row>(ctx, "members", memberId, societyId);
  const today = await organizationToday(ctx, societyId);
  const { subscriptions, plans, feePeriods } = await membershipContext(ctx, societyId);
  const subscription = subscriptions.find((sub) => sub.memberId === memberId && ["active", "past_due", "pending", "trialing"].includes(String(sub.status)));
  const byClass = (cls: string) => plans.filter((plan) => String(plan.membershipClass ?? "").toLowerCase() === cls.toLowerCase());
  const plan = (subscription && plans.find((row) => row._id === subscription.planId))
    ?? byClass(String(member.membershipClass ?? "")).find((row) => row.interval === "year")
    ?? byClass(String(member.membershipClass ?? ""))[0];
  if (!plan) throw new Error(`No active fee tier matches the ${member.membershipClass || "member's"} class. Add one on Membership & billing.`);
  return insertDuesDraft(ctx, societyId, { member, subscription, plan, priceCents: feeForPlan(plan, feePeriods, today), issueDate: today, actor: await actorName(ctx, societyId) });
}

/** Draft dues invoices for the chosen renewals; returns a batch key for Undo. */
export async function generateDuesInvoicesPortable(ctx: PortableMutationCtx, { societyId, subscriptionIds }: { societyId: string; subscriptionIds: string[] }) {
  await requireSocietyMembership(ctx, societyId);
  // Resolve against this workspace's subscriptions (scoped read) so an id from
  // anywhere else is simply not found, before anything is written.
  const { subscriptions, plans, feePeriods } = await membershipContext(ctx, societyId);
  const owned = new Map(subscriptions.map((sub) => [sub._id, sub]));
  const subs = [...new Set(subscriptionIds ?? [])].slice(0, 500).map((id) => {
    const sub = owned.get(id);
    if (!sub) throw new Error("memberSubscriptions not found.");
    return sub;
  });
  const today = await organizationToday(ctx, societyId);
  const invoices = await loadInvoices(ctx, societyId);
  const actor = await actorName(ctx, societyId);
  const batch = randomKey("dues");
  let created = 0;
  let skipped = 0;
  for (const sub of subs) {
    const plan = plans.find((row) => row._id === sub.planId);
    const renewalDate = String(sub.currentPeriodEndISO ?? "").slice(0, 10);
    const already = invoices.some((invoice) => invoice.subscriptionId === sub._id && invoice.duesPeriodEnd === renewalDate && invoice.status !== "void");
    if (!plan || !isCalendarDate(renewalDate) || already) { skipped += 1; continue; }
    const member = sub.memberId ? await ctx.db.get(sub.memberId, "members") : null;
    await insertDuesDraft(ctx, societyId, {
      member: member && (member as Row).societyId === societyId ? (member as Row) : undefined,
      subscription: sub,
      plan,
      priceCents: feeForPlan(plan, feePeriods, renewalDate),
      issueDate: today,
      renewalDate,
      batch,
      actor,
    });
    created += 1;
  }
  return { created, skipped, batch };
}

export async function undoDuesBatchPortable(ctx: PortableMutationCtx, { societyId, batch }: { societyId: string; batch: string }) {
  await requireSocietyMembership(ctx, societyId);
  if (!batch) throw new Error("Nothing to undo.");
  const invoices = await loadInvoices(ctx, societyId);
  const inBatch = invoices.filter((invoice) => invoice.duesBatch === batch);
  const removable = inBatch.filter((invoice) => invoice.status === "draft" && !(invoice.payments ?? []).length);
  for (const invoice of removable) await ctx.db.delete(invoice._id);
  // Give the numbers back when nothing was numbered after the batch.
  const removedSeq = removable.map((invoice) => invoice.sequence);
  const remaining = invoices.filter((invoice) => !removable.includes(invoice));
  const highestRemaining = remaining.reduce((max, invoice) => Math.max(max, invoice.sequence), 0);
  if (removedSeq.length && Math.min(...removedSeq) > highestRemaining) {
    const settings = await loadSettings(ctx, societyId);
    if (settings) await ctx.db.patch(settings._id, { nextNumber: Math.min(...removedSeq), updatedAtISO: nowISO() });
  }
  return { removed: removable.length, kept: inBatch.length - removable.length };
}

export async function upsertCatalogItemPortable(
  ctx: PortableMutationCtx,
  args: Partial<InvoiceLine> & { id?: string; societyId: string; name: string; description?: string; kind?: "item" | "service"; sku?: string; unit?: string; currency?: string; unitPriceCents: number; taxRatePercent?: number; taxLabel?: string; category?: string; accountingAccountId?: string; active?: boolean },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const name = cleanText(args.name, 200);
  if (!name) throw new Error("Give the item a name.");
  const unitPriceCents = Math.round(Number(args.unitPriceCents));
  if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) throw new Error("Enter a price of zero or more.");
  const rate = Number(args.taxRatePercent ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new Error("Tax rate must be between 0 and 30%.");
  if (args.accountingAccountId) await requireAccountOfKind(ctx, args.societyId, args.accountingAccountId, "revenue");
  const {rateOverridden:_override,...details}=cleanInvoiceLineDetails(args);
  const fields = {
    ...details,
    imageUrl:details.imageUrl,manufacturer:details.manufacturer,partNumber:details.partNumber,upc:details.upc,ean:details.ean,isbn:details.isbn,customField:details.customField,batchNumber:details.batchNumber,serialNumbers:details.serialNumbers,taxMode:details.taxMode,
    name,
    description: cleanText(args.description, 1000),
    kind: args.kind === "service" ? "service" : "item", sku: cleanText(args.sku, 80), unit: cleanText(args.unit, 30) ?? "each",
    currency: invoiceCurrency(args.currency),
    unitPriceCents,
    taxRatePercent: rate > 0 ? rate : undefined,
    taxLabel: rate > 0 ? cleanText(args.taxLabel, 20) ?? "Tax" : undefined,
    category: cleanText(args.category, 100),
    accountingAccountId: args.accountingAccountId || undefined,
    active: args.active ?? true,
    updatedAtISO: nowISO(),
  };
  if (args.id) {
    await getOwned(ctx, "invoiceCatalogItems", args.id, args.societyId);
    await ctx.db.patch(args.id, fields);
    return args.id;
  }
  return ctx.db.insert("invoiceCatalogItems", { societyId: args.societyId, ...fields, createdAtISO: nowISO() });
}

export async function setCatalogItemActivePortable(ctx: PortableMutationCtx, { id, active }: { id: string; active: boolean }) {
  await requireOwnedRow(ctx, "invoiceCatalogItems", id);
  await ctx.db.patch(id, { active, updatedAtISO: nowISO() });
}

export async function removeCatalogItemPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const item = await requireOwnedRow<Row>(ctx, "invoiceCatalogItems", id);
  const [invoices, series, lists, repairs] = await Promise.all([
    loadInvoices(ctx, item.societyId),
    ctx.db.query("invoiceSeries").withIndex("by_society", (q) => q.eq("societyId", item.societyId)).take(1000),
    ctx.db.query("invoicePriceLists").withIndex("by_society", (q) => q.eq("societyId", item.societyId)).take(200),
    ctx.db.query("repairJobs").withIndex("by_society", (q) => q.eq("societyId", item.societyId)).take(1000),
  ]);
  if ([...invoices, ...series, ...repairs].some((row) => (row.lines ?? []).some((line: InvoiceLine) => line.catalogItemId === id)) || lists.some((list) => list.entries.some((entry: any) => entry.catalogItemId === id))) throw new Error("This item is in use. Mark it inactive to preserve its billing history.");
  await ctx.db.delete(id);
}

type SeriesArgs = PartyArgs & {
  id?: string;
  societyId: string;
  name: string;
  frequency: string;
  startDate: string;
  endKind: string;
  endAfterCount?: number;
  endDate?: string;
  autoSend?: boolean;
  terms: string;
  reference?: string;
  currency?: string;
  lines: any[];
  discount?: any;
  memo?: string;
  fromInvoiceId?: string;
};

export async function upsertSeriesPortable(ctx: PortableMutationCtx, args: SeriesArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  const name = cleanText(args.name, 200);
  if (!name) throw new Error("Give the series a name.");
  if (!(SERIES_FREQUENCIES as readonly string[]).includes(args.frequency)) throw new Error("Choose how often to invoice.");
  if (!isCalendarDate(args.startDate)) throw new Error("Choose the first issue date.");
  const endKind = ["never", "after_count", "on_date"].includes(args.endKind) ? args.endKind : "never";
  const endAfterCount = endKind === "after_count" ? Math.max(1, Math.min(240, Math.round(Number(args.endAfterCount) || 0))) : undefined;
  if (endKind === "after_count" && !endAfterCount) throw new Error("Choose how many invoices to send.");
  if (endKind === "on_date" && (!isCalendarDate(args.endDate) || args.endDate! < args.startDate)) throw new Error("Choose an end date after the first issue date.");
  const lines = cleanLines(args.lines);
  const problem = validateInvoiceLines(lines);
  if (problem) throw new Error(problem);
  await assertCatalogRefs(ctx, args.societyId, lines);
  const party = await cleanParty(ctx, args.societyId, args);
  const terms = (INVOICE_TERMS as readonly string[]).includes(args.terms) && args.terms !== "custom" ? args.terms : DEFAULT_TERMS;
  const schedule = { frequency: args.frequency, startDate: args.startDate, endKind, endAfterCount, endDate: endKind === "on_date" ? args.endDate : undefined };
  let issuedCount = 0;
  let existing: Row | null = null;
  if (args.id) {
    existing = await getOwned<Row>(ctx, "invoiceSeries", args.id, args.societyId);
    issuedCount = Number(existing.issuedCount) || 0;
  }
  let source: Row | null = null;
  if (args.fromInvoiceId) {
    source = await getOwned<Row>(ctx, "invoices", args.fromInvoiceId, args.societyId);
    if (source.seriesId && source.seriesId !== args.id) throw new Error("This invoice already belongs to a series.");
    if (!existing) issuedCount = source.issueDate === args.startDate ? 1 : 0;
  }
  const nextIssueDate = seriesNextIssueDate(schedule, issuedCount);
  const status = existing?.status === "paused" ? "paused" : nextIssueDate ? "active" : "ended";
  const fields = {
    name,
    ...schedule,
    nextIssueDate: nextIssueDate ?? undefined,
    issuedCount,
    autoSend: Boolean(args.autoSend),
    status,
    ...party,
    terms,
    reference: cleanText(args.reference, 100),
    currency: invoiceCurrency(args.currency ?? existing?.currency ?? source?.currency),
    documentTemplate: source?.documentTemplate ?? existing?.documentTemplate,
    money: source?.money ?? existing?.money, documentExtras: source?.documentExtras ?? existing?.documentExtras,
    shipToName: source?.shipToName ?? existing?.shipToName,
    shipToAddress: source?.shipToAddress ?? existing?.shipToAddress,
    lines,
    discount: cleanDiscount(args.discount),
    memo: cleanText(args.memo, 4000),
    updatedAtISO: nowISO(),
  };
  let seriesId = args.id;
  if (args.id) await ctx.db.patch(args.id, fields);
  else seriesId = await ctx.db.insert("invoiceSeries", { societyId: args.societyId, ...fields, createdAtISO: nowISO() });
  if (source && seriesId) await ctx.db.patch(source._id, { seriesId, updatedAtISO: nowISO() });
  return seriesId;
}

export async function setSeriesStatusPortable(ctx: PortableMutationCtx, { id, status }: { id: string; status: string }) {
  const series = await requireOwnedRow<Row>(ctx, "invoiceSeries", id);
  if (!["active", "paused"].includes(status)) throw new Error("Unknown series status.");
  if (status === "active" && !series.nextIssueDate) throw new Error("This series has ended. Edit its end to continue it.");
  await ctx.db.patch(id, { status, updatedAtISO: nowISO() });
}

/** Issue the next invoice of a series as a draft dated its scheduled issue date. */
export async function issueFromSeriesPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const series = await requireOwnedRow<Row>(ctx, "invoiceSeries", id);
  if (!series.nextIssueDate || series.status === "ended") throw new Error("This series has no more invoices to issue.");
  const actor = await actorName(ctx, series.societyId);
  const issueDate = series.nextIssueDate;
  const { sequence, number } = await allocateNumber(ctx, series.societyId);
  const at = nowISO();
  const invoiceId = await ctx.db.insert("invoices", {
    societyId: series.societyId,
    sequence,
    number,
    status: "draft",
    partyKind: series.partyKind,
    memberId: series.memberId,
    counterpartyId: series.counterpartyId,
    billToName: series.billToName,
    billToEmail: series.billToEmail,
    billToAddress: series.billToAddress,
    shipToName: series.shipToName,
    shipToAddress: series.shipToAddress,
    issueDate,
    terms: series.terms,
    dueDate: dueDateForTerms(issueDate, series.terms),
    reference: series.reference,
    currency: series.currency,
    documentTemplate: series.documentTemplate,
    money: series.money, documentExtras: series.documentExtras,
    lines: (series.lines ?? []).map((line: any) => ({ ...line, key: randomKey("line") })),
    discount: series.discount,
    memo: series.memo,
    totalCents: computeInvoiceTotals(series.lines ?? [], series.discount, series.money).totalCents,
    paidCents: 0,
    payments: [],
    timeline: [event("issued_from_series", `Issued from ${series.name}`, actor)],
    seriesId: series._id,
    source: "series",
    createdByUserId: await principalUserId(ctx, series.societyId).catch(() => undefined),
    createdAtISO: at,
    updatedAtISO: at,
  });
  const issuedCount = (Number(series.issuedCount) || 0) + 1;
  const next = seriesNextIssueDate(series as any, issuedCount);
  await ctx.db.patch(series._id, { issuedCount, nextIssueDate: next ?? undefined, status: next ? series.status : "ended", lastIssuedAtISO: at, updatedAtISO: at });
  return invoiceId;
}

export async function saveSettingsPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; prefix: string; nextNumber: number; defaultTerms: string; paymentInstructions?: string; defaultMemo?: string; replyToEmail?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const [settings, invoices] = await Promise.all([loadSettings(ctx, args.societyId), loadInvoices(ctx, args.societyId)]);
  const highest = invoices.reduce((max, invoice) => Math.max(max, Number(invoice.sequence) || 0), 0);
  const nextNumber = Math.floor(Number(args.nextNumber));
  if (!Number.isFinite(nextNumber) || nextNumber < 1) throw new Error("The next number must be 1 or more.");
  if (nextNumber <= highest) throw new Error(`The next number must be above ${highest}, the highest number already used.`);
  const replyToEmail = cleanText(args.replyToEmail, 200);
  if (replyToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToEmail)) throw new Error("The reply-to email doesn't look right.");
  const fields = {
    prefix: normalizeInvoicePrefix(args.prefix),
    nextNumber,
    defaultTerms: (INVOICE_TERMS as readonly string[]).includes(args.defaultTerms) && args.defaultTerms !== "custom" ? args.defaultTerms : DEFAULT_TERMS,
    paymentInstructions: cleanText(args.paymentInstructions, 2000),
    defaultMemo: cleanText(args.defaultMemo, 2000),
    replyToEmail,
    updatedAtISO: nowISO(),
  };
  if (settings) {
    await ctx.db.patch(settings._id, fields);
    return settings._id;
  }
  return ctx.db.insert("invoiceSettings", { societyId: args.societyId, ...fields });
}

/* ------------------------------------------------------------ the books */

type MappingArgs = {
  societyId: string;
  receivableAccountId?: string;
  taxPayableAccountId?: string;
  defaultRevenueAccountId?: string;
  depositAccountId?: string;
  categoryAccounts: Array<{ category: string; accountId?: string }>;
  itemAccounts?: Array<{ catalogItemId: string; accountId?: string }>;
};

async function requireAccountOfKind(ctx: PortableQueryCtx, societyId: string, accountId: string, kind: "revenue" | "receivable" | "taxPayable" | "deposit") {
  const account = await getOwned<LedgerAccount>(ctx, "financialAccounts", accountId, societyId);
  const cash = MONEY_ACCOUNT_TYPES.has(account.accountType) || (account.accountType === "Asset" && CASH_SUBTYPES.has(String(account.subtype)));
  const ok = {
    revenue: account.accountType === "Income" || (account.accountType === "Liability" && account.subtype === "deferred_revenue"),
    receivable: account.accountType === "Asset" && !cash,
    taxPayable: account.accountType === "Liability",
    deposit: cash,
  }[kind];
  const expected = { revenue: "an income (or deferred revenue) account", receivable: "an asset account that isn't cash", taxPayable: "a liability account", deposit: "a bank, cash or undeposited funds account" }[kind];
  if (!ok) throw new Error(`${account.name} can't be used here; choose ${expected}.`);
}

/**
 * Save the GL account mapping: revenue per catalog item (stored on the item)
 * and per category, the default revenue account, and the receivable, tax
 * payable and deposit accounts. Unset receivable, tax and deposit accounts
 * fall back to the chart's Accounts receivable, GST/HST payable and
 * Undeposited funds (created on first use). Existing postings don't move.
 */
export async function saveAccountMappingPortable(ctx: PortableMutationCtx, args: MappingArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  const { societyId } = args;
  if (args.receivableAccountId) await requireAccountOfKind(ctx, societyId, args.receivableAccountId, "receivable");
  if (args.taxPayableAccountId) await requireAccountOfKind(ctx, societyId, args.taxPayableAccountId, "taxPayable");
  if (args.defaultRevenueAccountId) await requireAccountOfKind(ctx, societyId, args.defaultRevenueAccountId, "revenue");
  if (args.depositAccountId) await requireAccountOfKind(ctx, societyId, args.depositAccountId, "deposit");
  const categories = new Map<string, { category: string; accountId: string }>();
  for (const row of (args.categoryAccounts ?? []).slice(0, 200)) {
    const category = cleanText(row.category, 100);
    if (!category || !row.accountId) continue;
    await requireAccountOfKind(ctx, societyId, row.accountId, "revenue");
    categories.set(normalizeRevenueCategory(category), { category, accountId: row.accountId });
  }
  const items = (args.itemAccounts ?? []).slice(0, 500);
  for (const row of items) {
    await getOwned(ctx, "invoiceCatalogItems", row.catalogItemId, societyId);
    if (row.accountId) await requireAccountOfKind(ctx, societyId, row.accountId, "revenue");
  }
  for (const row of items) await ctx.db.patch(row.catalogItemId, { accountingAccountId: row.accountId || undefined, updatedAtISO: nowISO() });
  const fields = {
    receivableAccountId: args.receivableAccountId || undefined,
    taxPayableAccountId: args.taxPayableAccountId || undefined,
    defaultRevenueAccountId: args.defaultRevenueAccountId || undefined,
    depositAccountId: args.depositAccountId || undefined,
    categoryAccounts: [...categories.values()].sort((a, b) => a.category.localeCompare(b.category)),
    updatedAtISO: nowISO(),
  };
  const settings = await loadSettings(ctx, societyId);
  if (settings) {
    await ctx.db.patch(settings._id, fields);
    return settings._id;
  }
  const invoices = await loadInvoices(ctx, societyId);
  return ctx.db.insert("invoiceSettings", { societyId, prefix: normalizeInvoicePrefix(undefined), nextNumber: nextInvoiceSequence(invoices, undefined), defaultTerms: DEFAULT_TERMS, ...fields });
}

/** What "Post existing invoices" would post, and what keeps the rest out. Nothing is written. */
export async function postingPreviewPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [invoices, lctx, postedEntries] = await Promise.all([loadInvoices(ctx, societyId), loadInvoiceLedgerContext(ctx, societyId), postedInvoiceEntries(ctx, societyId)]);
  const postedIds = new Set([...postedEntries.values()].map((entry) => entry._id));
  const preview = { invoiceCount: 0, invoiceCents: 0, paymentCount: 0, paymentCents: 0, postedCount: 0, blocked: [] as Array<{ invoiceId: string; number: string; billToName: string; totalCents: number; reasons: string[] }> };
  for (const row of invoices.sort((a, b) => a.sequence - b.sequence)) {
    const state = invoiceLedgerState(row, lctx, postedIds);
    const totalCents = computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents;
    if (state.state === "posted" || (state.state === "ready" && state.entryId)) preview.postedCount += 1;
    if (state.state === "ready") {
      if (!state.entryId) {
        preview.invoiceCount += 1;
        preview.invoiceCents += totalCents;
      }
      const pending = (row.payments ?? []).filter((payment: StoredInvoicePayment) => !payment.reversedDate && !(payment.journalEntryId && postedIds.has(payment.journalEntryId)) && !paymentBlock(payment, lctx));
      preview.paymentCount += pending.length;
      preview.paymentCents += sumPaid(pending);
    }
    if (state.reasons.length) preview.blocked.push({ invoiceId: row._id, number: row.number, billToName: row.billToName, totalCents, reasons: state.reasons });
  }
  return { ...preview, workspaceCurrency: lctx.workspaceCurrency, booksStart: booksStartLabel(lctx.booksStart) };
}

/**
 * "Post existing invoices to the ledger": posts every sent invoice's accrual
 * and its payments that aren't in the books yet (or only `ids`). Idempotent:
 * anything already posted is left alone, so running it twice posts nothing
 * new. Invoices that can't go in are counted, never guessed at; one that
 * fails (a closed period, a deposit posted elsewhere) is reported and the
 * rest carry on.
 */
export async function postExistingPortable(ctx: PortableMutationCtx, { societyId, ids, actingUserId }: { societyId: string; ids?: string[]; actingUserId?: string }) {
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  const userId = await actingUser(ctx, societyId);
  const actor = await actorName(ctx, societyId);
  const only = ids?.length ? new Set(ids) : null;
  const lctx = await loadInvoiceLedgerContext(ctx, societyId);
  const postedIds = new Set([...(await postedInvoiceEntries(ctx, societyId)).values()].map((entry) => entry._id));
  const invoices = (await loadInvoices(ctx, societyId)).sort((a, b) => a.sequence - b.sequence);
  if (only) for (const id of only) if (!invoices.some((row) => row._id === id)) throw new Error("invoices not found.");
  const result = { postedInvoices: 0, postedCents: 0, postedPayments: 0, blocked: 0, failed: [] as Array<{ invoiceId: string; number: string; error: string }> };
  for (const row of invoices) {
    if (only && !only.has(row._id)) continue;
    const state = invoiceLedgerState(row, lctx, postedIds);
    if (state.state === "blocked") result.blocked += 1;
    if (state.state !== "ready") continue;
    try {
      const pending = ((row.payments ?? []) as StoredInvoicePayment[]).filter((payment) => !payment.reversedDate && !((payment.journalEntryId && postedIds.has(payment.journalEntryId)) || paymentBlock(payment, lctx)));
      await assertInvoicePostable(ctx, row, lctx, !state.entryId, pending);
      let current: Row = row;
      const events: Array<ReturnType<typeof event>> = [];
      if (!state.entryId) {
        const outcome = await syncAccrual(ctx, asStored(row), lctx, userId);
        if (!outcome.entryId) continue;
        current = { ...row, journalEntryId: outcome.entryId };
        await ctx.db.patch(row._id, { journalEntryId: outcome.entryId });
        const total = computeInvoiceTotals(row.lines ?? [], row.discount, row.money).totalCents;
        events.push(event("posted", postedLabel(total), actor));
        result.postedInvoices += 1;
        result.postedCents += total;
      }
      const payments = [...(current.payments ?? [])] as StoredInvoicePayment[];
      for (const [index, original] of payments.entries()) {
        if (original.reversedDate || (original.journalEntryId && postedIds.has(original.journalEntryId)) || paymentBlock(original, lctx)) continue;
        const txn = original.financialTransactionId ? ((await ctx.db.get(original.financialTransactionId, "financialTransactions")) as Row | null) : null;
        // Post first: the deposit is only matched (and its snapshot kept) once its payment is in the books.
        const posting = await postPayment(ctx, asStored({ ...current, payments }), original, lctx, userId);
        let payment = original;
        if (txn && txn.societyId === societyId && !(txn.matchedKind === "invoice" && txn.matchedId === row._id) && MATCHABLE_KINDS.has(txn.matchedKind)) {
          payment = { ...payment, transactionBefore: await matchDeposit(ctx, row, txn, lctx, actor) };
        }
        payments[index] = withPosting(payment, posting);
        await ctx.db.patch(row._id, { payments });
        if (posting.journalEntryId) result.postedPayments += 1;
      }
      if (events.length) await ctx.db.patch(row._id, { timeline: [...(row.timeline ?? []), ...events], updatedAtISO: nowISO() });
    } catch (error) {
      result.failed.push({ invoiceId: row._id, number: row.number, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}


/** Reusable presentation. Each invoice snapshots its config so later design edits are safe. */
export async function upsertTemplatePortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; config: InvoiceTemplate; active?: boolean; makeDefault?: boolean }) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.id) await getOwned(ctx, "invoiceTemplates", args.id, args.societyId);
  const fields = { config: cleanInvoiceTemplate(args.config), active: args.active ?? true, updatedAtISO: nowISO() };
  if (args.makeDefault && !fields.active) throw new Error("The default template must be active.");
  const id = args.id ?? await ctx.db.insert("invoiceTemplates", { societyId: args.societyId, ...fields, createdAtISO: nowISO() });
  if (args.id) await ctx.db.patch(id, fields);
  const settings = await loadSettings(ctx, args.societyId);
  if (args.makeDefault) {
    if (settings) await ctx.db.patch(settings._id, { defaultTemplateId: id, updatedAtISO: nowISO() });
    else await ctx.db.insert("invoiceSettings", { societyId: args.societyId, prefix: "INV-", nextNumber: 1, defaultTerms: DEFAULT_TERMS, defaultTemplateId: id, updatedAtISO: nowISO() });
  } else if (settings?.defaultTemplateId === id && (!fields.active || args.makeDefault === false)) await ctx.db.patch(settings._id, { defaultTemplateId: undefined });
  return id;
}

export async function upsertPriceListPortable(ctx: PortableMutationCtx, args: { societyId: string; id?: string; name: string; currency: string; active?: boolean; entries: Array<{ catalogItemId: string; unitPriceCents: number }> }) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.id) await getOwned(ctx, "invoicePriceLists", args.id, args.societyId);
  const name = cleanText(args.name, 100);
  if (!name) throw new Error("Give the price list a name.");
  if (args.entries.length > 500) throw new Error("A price list can hold up to 500 rates.");
  const seen = new Set<string>();
  for (const entry of args.entries) {
    await getOwned(ctx, "invoiceCatalogItems", entry.catalogItemId, args.societyId);
    if (seen.has(entry.catalogItemId)) throw new Error("An item can only appear once in a price list.");
    seen.add(entry.catalogItemId);
    if (!Number.isSafeInteger(entry.unitPriceCents) || entry.unitPriceCents < 0) throw new Error("Rates must be non-negative integer cents.");
  }
  const fields = { name, currency: invoiceCurrency(args.currency), active: args.active ?? true, entries: args.entries, updatedAtISO: nowISO() };
  if (args.id) { await ctx.db.patch(args.id, fields); return args.id; }
  return ctx.db.insert("invoicePriceLists", { societyId: args.societyId, ...fields, createdAtISO: nowISO() });
}

type RepairArgs = PartyArgs & { id?: string; societyId: string; asset: string; serialNumber?: string; problem: string; notes?: string; receivedDate: string; targetDate?: string; currency: string; lines: any[] };
export async function upsertRepairJobPortable(ctx: PortableMutationCtx, args: RepairArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  const existing = args.id ? await getOwned<Row>(ctx, "repairJobs", args.id, args.societyId) : null;
  const party = await cleanParty(ctx, args.societyId, args);
  const asset = cleanText(args.asset, 200), problem = cleanText(args.problem, 2000);
  if (!asset || !problem) throw new Error("Describe the item and the repair needed.");
  if (!isCalendarDate(args.receivedDate) || (args.targetDate && (!isCalendarDate(args.targetDate) || args.targetDate < args.receivedDate))) throw new Error("Choose valid received and target dates.");
  const lines = cleanLines(args.lines);
  if (lines.length) { const error = validateInvoiceLines(lines); if (error) throw new Error(error); }
  await assertCatalogRefs(ctx, args.societyId, lines);
  const currency = invoiceCurrency(args.currency);
  if (existing) {
    const invoice = await ctx.db.query("invoices").withIndex("by_repair_job", (q) => q.eq("repairJobId", args.id)).take(100);
    if (invoice.some((row) => row.status !== "void") && (JSON.stringify(existing.lines) !== JSON.stringify(lines) || existing.currency !== currency || existing.billToName !== party.billToName || existing.partyKind !== party.partyKind || existing.memberId !== party.memberId || existing.counterpartyId !== party.counterpartyId)) throw new Error("This repair is invoiced. Edit billing on the linked invoice.");
  }
  const fields = { ...party, asset, problem, serialNumber: cleanText(args.serialNumber, 100), notes: cleanText(args.notes, 4000), receivedDate: args.receivedDate, targetDate: args.targetDate || undefined, currency, lines, updatedAtISO: nowISO() };
  if (args.id) { await ctx.db.patch(args.id, fields); return args.id; }
  const id = await ctx.db.insert("repairJobs", { societyId: args.societyId, ...fields, number: "", status: "received", timeline: [event("created", "Repair received", await actorName(ctx, args.societyId))], createdAtISO: nowISO() });
  await ctx.db.patch(id, { number: `REP-${id.slice(-8).toUpperCase()}` });
  return id;
}

export async function setRepairStatusPortable(ctx: PortableMutationCtx, { id, status }: { id: string; status: RepairStatus }) {
  if (["in_progress", "ready", "completed"].includes(status)) await assertRepairApprovalPortable(ctx, id);
  const job = await requireOwnedRow<Row>(ctx, "repairJobs", id);
  if (job.status === status) return id;
  if (status === "cancelled") {
    const invoices = await ctx.db.query("invoices").withIndex("by_repair_job", (q) => q.eq("repairJobId", id)).take(100);
    if (invoices.some((row) => row.status !== "void")) throw new Error("Void the linked invoice before cancelling this repair.");
  }
  if (!REPAIR_TRANSITIONS[job.status as RepairStatus]?.includes(status)) throw new Error("That repair status transition is not available.");
  await ctx.db.patch(id, { status, updatedAtISO: nowISO(), timeline: [...job.timeline, event("status", REPAIR_STATUS_LABEL[status], await actorName(ctx, job.societyId))] });
  return id;
}

/** Transactional and idempotent: one active invoice per repair. */
export async function invoiceRepairJobPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await assertRepairBillablePortable(ctx, id);
  const job = await requireOwnedRow<Row>(ctx, "repairJobs", id);
  if (job.status === "cancelled") throw new Error("A cancelled repair cannot be invoiced.");
  const existing = await ctx.db.query("invoices").withIndex("by_repair_job", (q) => q.eq("repairJobId", id)).take(100);
  const active = existing.find((row) => row.status !== "void");
  if (active) return active._id;
  const settings = await loadSettings(ctx, job.societyId);
  const invoiceId = await upsertPortable(ctx, { societyId: job.societyId, partyKind: job.partyKind, memberId: job.memberId, counterpartyId: job.counterpartyId, billToName: job.billToName, billToEmail: job.billToEmail, billToAddress: job.billToAddress, issueDate: await organizationToday(ctx, job.societyId), terms: settings?.defaultTerms ?? DEFAULT_TERMS, reference: job.number, currency: job.currency, repairJobId: id, lines: job.lines, memo: `${job.asset}${job.serialNumber ? ` (${job.serialNumber})` : ""}\n${job.problem}` });
  await ctx.db.patch(id, { updatedAtISO: nowISO(), timeline: [...job.timeline, event("invoiced", "Invoice created", await actorName(ctx, job.societyId))] });
  return invoiceId;
}

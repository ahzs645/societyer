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
import { assertPeriodOpen } from "./accounting";
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
      key: cleanText(raw?.key, 60) ?? `line_${index + 1}`,
      item: String(raw?.item ?? "").trim().slice(0, 200),
      quantity: Math.round(Number(raw?.quantity) * 1000) / 1000,
      unitPriceCents: Math.round(Number(raw?.unitPriceCents)),
    };
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
  return { ...party, billToName, billToEmail, billToAddress: cleanText(args.billToAddress, 500) };
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
  const totals = computeInvoiceTotals(row.lines ?? [], row.discount);
  const paid = sumPaid(row.payments);
  const status = deriveInvoiceStatus({ status: row.status, dueDate: row.dueDate, totalCents: totals.totalCents, payments: row.payments }, today);
  const balanceCents = row.status === "void" ? 0 : totals.totalCents - paid;
  return {
    ...(row as DecoratedInvoice),
    lifecycle: row.status,
    status,
    totals,
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
  if (invoice.status !== "sent" || computeInvoiceTotals(invoice.lines ?? [], invoice.discount).totalCents <= 0) {
    return { state: accrualPosted && !invoice.reversalJournalEntryId ? "posted" : "none", entryId: accrualPosted ? invoice.journalEntryId : undefined, reasons: [], paymentsToPost: 0 };
  }
  const payments = invoice.payments ?? [];
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
  const totals = computeInvoiceTotals(invoice.lines ?? [], invoice.discount);
  return invoiceNeedsAction(
    {
      lifecycle: invoice.status,
      totalCents: totals.totalCents,
      paidCents: sumPaid(invoice.payments),
      currency: invoice.currency,
      issueDate: invoice.issueDate,
      payments: (invoice.payments ?? []).map((payment) => ({
        key: payment.key,
        date: payment.date,
        amountCents: payment.amountCents,
        financialTransactionId: payment.financialTransactionId,
        transactionAmountCents: payment.financialTransactionId ? (txnById.has(payment.financialTransactionId) ? Number(txnById.get(payment.financialTransactionId)!.amountCents) : null) : undefined,
      })),
      unmappedItems: unmappedItems(invoice, lctx),
      accrualPosted: Boolean(invoice.journalEntryId && postedIds.has(invoice.journalEntryId)),
    },
    { workspaceCurrency: lctx.workspaceCurrency, booksStart: lctx.booksStart },
  );
}

/** The GL account mapping drawer: the mapping, the accounts to choose from and what is used when unset. */
function ledgerView(lctx: InvoiceLedgerContext, catalog: Row[]) {
  const options = (filter: (account: LedgerAccount) => boolean) =>
    lctx.accounts.filter(filter).map((account) => ({ _id: account._id, label: accountLabel(account)!, accountType: account.accountType })).sort((a, b) => a.label.localeCompare(b.label));
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

/** Everything the Invoices page needs in one read. */
export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const [organization, invoices, settings, catalog, series, members, counterparties, transactions, subscriptions, plans, feePeriods, identifiers, lctx, postedEntries] = await Promise.all([
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
      if (payment.financialTransactionId) linked.set(payment.financialTransactionId, { invoiceId: invoice._id, number: invoice.number });
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
    if (invoice.status !== "void") {
      const recent = (invoice.payments ?? []).filter((payment: any) => payment.date >= paidSince && payment.date <= today);
      if (recent.length) {
        summary.paidLast30Cents += recent.reduce((sum: number, payment: any) => sum + payment.amountCents, 0);
        summary.paidLast30Count += 1;
      }
    }
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
    invoices: decorated,
    catalog: (catalog as Row[]).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    series: (series as Row[])
      .map((row): Row => {
        const issued = decorated.filter((invoice) => invoice.seriesId === row._id);
        return {
          ...row,
          totalCents: computeInvoiceTotals(row.lines ?? [], row.discount).totalCents,
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
  id?: string;
  societyId: string;
  issueDate: string;
  terms: string;
  dueDate?: string;
  reference?: string;
  currency?: string;
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
  const totals = computeInvoiceTotals(lines, discount);
  if (totals.totalCents < 0) throw new Error("The discount is larger than the invoice.");
  const party = await cleanParty(ctx, args.societyId, args);
  return {
    ...party,
    issueDate: args.issueDate,
    terms,
    dueDate,
    reference: cleanText(args.reference, 100),
    currency: (cleanText(args.currency, 3) ?? "CAD").toUpperCase(),
    lines,
    discount,
    memo: cleanText(args.memo, 4000),
    totalCents: totals.totalCents,
  };
}

/** Create a draft or save changes. Returns the invoice id. */
export async function upsertPortable(ctx: PortableMutationCtx, args: InvoiceArgs & { actingUserId?: string }) {
  await requireSocietyMembership(ctx, args.societyId);
  const fields = await invoiceFields(ctx, args);
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
  const amount = `$${(balanceCents / 100).toFixed(2)}`;
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
      });
      await flagChangedPeriods(ctx, txn.accountId, txn.date);
    }
  }
  await restoreDepositEntry(ctx, invoice.societyId, payment.voidedTransactionEntryId);
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
    if (outcome.entryId) events.push(event("posted", postedLabel(computeInvoiceTotals(row.lines ?? [], row.discount).totalCents), actor));
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
    const at = nowISO();
    const why = cleanText(reason, 300);
    const events = [event("voided", why ? `Voided: ${why}` : "Voided", actor)];
    const reversalId = await reverseAccrual(ctx, asStored(row), today > row.issueDate ? today : row.issueDate, userId);
    if (reversalId) {
      events.push(event("reversed", "Reversing entry posted", actor, computeInvoiceTotals(row.lines ?? [], row.discount).totalCents));
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
      events.push(event("posted", postedLabel(computeInvoiceTotals(row.lines ?? [], row.discount).totalCents), actor));
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
    issueDate: today,
    terms,
    dueDate: dueDateForTerms(today, terms),
    reference: row.reference,
    currency: row.currency,
    lines: (row.lines ?? []).map((line: any) => ({ ...line, key: randomKey("line") })),
    discount: row.discount,
    memo: row.memo,
    totalCents: computeInvoiceTotals(row.lines ?? [], row.discount).totalCents,
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
async function linkableDeposit(ctx: PortableQueryCtx, invoice: Row, transactionId: string): Promise<Row> {
  const txn = await getOwned<Row>(ctx, "financialTransactions", transactionId, invoice.societyId);
  if (!(Number(txn.amountCents) > 0)) throw new Error("Only money-in bank transactions can be linked to a payment.");
  const invoices = await loadInvoices(ctx, invoice.societyId);
  const alreadyLinked = invoices.some((other) => (other.payments ?? []).some((payment: StoredInvoicePayment) => payment.financialTransactionId === transactionId));
  if (alreadyLinked) throw new Error("That bank transaction is already linked to an invoice payment.");
  if (!MATCHABLE_KINDS.has(txn.matchedKind)) throw new Error(`That bank transaction is already matched to a ${txn.matchedKind} record.`);
  await assertDepositClaimable(ctx, invoice.societyId, transactionId);
  return txn;
}

/** A deposit another kind of entry already posted can't be taken over, nor one whose own entry is in closed books (read-only). */
async function assertDepositClaimable(ctx: PortableQueryCtx, societyId: string, transactionId: string) {
  for (const entry of await claimableDepositEntries(ctx, transactionId)) {
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
  if (postAccrual && computeInvoiceTotals(row.lines ?? [], row.discount).totalCents > 0) {
    await assertPostableDates(ctx, row.societyId, [row.issueDate]);
    const placeholder = { receivableAccountId: "receivable", taxPayableAccountId: "tax" };
    validateBalancedJournalLines(accrualPostingLines(asStored(row), () => "revenue", placeholder));
  }
  for (const payment of payments) {
    await assertPostableDates(ctx, row.societyId, [payment.date]);
    validateBalancedJournalLines(paymentPostingLines(payment, { depositAccountId: "deposit", receivableAccountId: "receivable" }));
    if (!payment.financialTransactionId) continue;
    const txn = (await ctx.db.get(payment.financialTransactionId, "financialTransactions")) as Row | null;
    if (txn && txn.societyId === row.societyId) await assertDepositClaimable(ctx, row.societyId, txn._id);
  }
}

async function assertDepositAccount(ctx: PortableQueryCtx, societyId: string, accountId: string) {
  const account = await getOwned<LedgerAccount>(ctx, "financialAccounts", accountId, societyId);
  if (!MONEY_ACCOUNT_TYPES.has(account.accountType) && !(account.accountType === "Asset" && CASH_SUBTYPES.has(String(account.subtype)))) {
    throw new Error(`${account.name} isn't a bank, cash or undeposited funds account.`);
  }
}

export async function recordPaymentPortable(
  ctx: PortableMutationCtx,
  args: { id: string; date: string; amountCents: number; method: string; reference?: string; note?: string; financialTransactionId?: string; depositAccountId?: string },
) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", args.id);
  if (row.status === "void") throw new Error("A void invoice can't take payments.");
  if (!isCalendarDate(args.date)) throw new Error("Choose the payment date.");
  const amountCents = Math.round(Number(args.amountCents));
  if (!(amountCents > 0)) throw new Error("Enter an amount above zero.");
  const total = computeInvoiceTotals(row.lines ?? [], row.discount).totalCents;
  const balance = total - sumPaid(row.payments);
  if (amountCents > balance) throw new Error(`That's more than the ${(balance / 100).toFixed(2)} balance.`);
  const txn = args.financialTransactionId ? await linkableDeposit(ctx, row, args.financialTransactionId) : null;
  if (args.depositAccountId && !txn) await assertDepositAccount(ctx, row.societyId, args.depositAccountId);
  const actor = await actorName(ctx, row.societyId);
  const userId = await actingUser(ctx, row.societyId);
  const method = (PAYMENT_METHODS as readonly string[]).includes(args.method) ? args.method : "other";
  let payment: StoredInvoicePayment = { key: randomKey("pay"), date: args.date, amountCents, method, recordedAtISO: nowISO() };
  const reference = cleanText(args.reference, 100);
  const note = cleanText(args.note, 500);
  if (reference) payment.reference = reference;
  if (note) payment.note = note;
  if (txn) payment.financialTransactionId = txn._id;
  else if (args.depositAccountId) payment.depositAccountId = args.depositAccountId;
  if (actor) payment.recordedByName = actor;
  const payments = [...(row.payments ?? []), payment];
  const remaining = total - sumPaid(payments);
  const at = nowISO();
  const timeline = [...(row.timeline ?? [])];
  if (row.status === "draft") timeline.push(event("sent", "Marked as sent", actor));
  timeline.push(event("payment", `${remaining <= 0 ? "Paid in full" : "Partial payment recorded"}${txn ? " · linked to the bank deposit" : ""}`, actor, amountCents));

  // The books: refuse a closed period before writing anything, then post the
  // accrual (a draft is sent by its first payment) and the payment.
  const lctx = await loadInvoiceLedgerContext(ctx, row.societyId);
  let next: Row = { ...row, status: "sent", payments };
  const postable = !accrualBlockers(asStored(next), lctx).length;
  if (postable && !paymentBlock(payment, lctx)) await assertPostableDates(ctx, row.societyId, row.status === "draft" ? [row.issueDate, args.date] : [args.date]);
  if (row.status === "draft") {
    const outcome = await syncAccrual(ctx, asStored(next), lctx, userId);
    if (outcome.entryId) {
      next = { ...next, journalEntryId: outcome.entryId };
      timeline.push(event("posted", postedLabel(total), actor));
    }
  }
  if (txn) payment = { ...payment, transactionBefore: await matchDeposit(ctx, row, txn, lctx, actor) };
  payment = withPosting(payment, await postPayment(ctx, asStored({ ...next, payments: [...(row.payments ?? []), payment] }), payment, lctx, userId));
  await ctx.db.patch(row._id, {
    status: "sent",
    sentAtISO: row.sentAtISO ?? at,
    ...(next.journalEntryId ? { journalEntryId: next.journalEntryId } : {}),
    payments: [...(row.payments ?? []), payment],
    paidCents: sumPaid(payments),
    totalCents: total,
    updatedAtISO: at,
    timeline,
  });
  return payment.key;
}

// The payment is addressed by its key inside the invoice (named `paymentKey`, not an id: it is not a row).
/** Remove a payment recorded in error: its entries are voided and a linked deposit goes back as it was. */
export async function removePaymentPortable(ctx: PortableMutationCtx, { id, paymentKey }: { id: string; paymentKey: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const payment = (row.payments ?? []).find((entry: StoredInvoicePayment) => entry.key === paymentKey) as StoredInvoicePayment | undefined;
  if (!payment) throw new Error("That payment is no longer on this invoice.");
  await unwindPayment(ctx, row, payment);
  const payments = (row.payments ?? []).filter((entry: StoredInvoicePayment) => entry.key !== paymentKey);
  const actor = await actorName(ctx, row.societyId);
  await ctx.db.patch(id, { payments, paidCents: sumPaid(payments), updatedAtISO: nowISO(), timeline: [...(row.timeline ?? []), event("payment_removed", payment.financialTransactionId ? "Payment removed and bank deposit unlinked" : "Payment removed", actor, payment.amountCents)] });
}

/** Remove every payment: their entries are voided and linked deposits go back as they were. */
export async function revertToUnpaidPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  if (!(row.payments ?? []).length) return id;
  for (const payment of row.payments as StoredInvoicePayment[]) await unwindPayment(ctx, row, payment);
  const actor = await actorName(ctx, row.societyId);
  await ctx.db.patch(id, { payments: [], paidCents: 0, updatedAtISO: nowISO(), timeline: [...(row.timeline ?? []), event("reverted", "Reverted to unpaid", actor, sumPaid(row.payments))] });
  return id;
}

/**
 * Link a recorded payment to its bank deposit, move it to another deposit,
 * or (no `financialTransactionId`) unlink it. The payment's entries are
 * posted again against the new deposit account.
 */
export async function linkDepositPortable(
  ctx: PortableMutationCtx,
  { id, paymentKey, financialTransactionId, depositAccountId }: { id: string; paymentKey: string; financialTransactionId?: string; depositAccountId?: string },
) {
  const row = await requireOwnedRow<Row>(ctx, "invoices", id);
  const index = (row.payments ?? []).findIndex((entry: StoredInvoicePayment) => entry.key === paymentKey);
  if (index < 0) throw new Error("That payment is no longer on this invoice.");
  const current = row.payments[index] as StoredInvoicePayment;
  if (financialTransactionId && current.financialTransactionId === financialTransactionId) return paymentKey;
  const txn = financialTransactionId ? await linkableDeposit(ctx, row, financialTransactionId) : null;
  if (depositAccountId && !txn) await assertDepositAccount(ctx, row.societyId, depositAccountId);
  const lctx = await loadInvoiceLedgerContext(ctx, row.societyId);
  if (current.journalEntryId && !paymentBlock(current, lctx)) await assertPostableDates(ctx, row.societyId, [current.date]);
  const actor = await actorName(ctx, row.societyId);
  await unwindPayment(ctx, row, current);
  const {
    financialTransactionId: _txn,
    transactionBefore: _before,
    voidedTransactionEntryId: _voided,
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
    const total = computeInvoiceTotals(row.lines ?? [], row.discount).totalCents;
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
  args: { id?: string; societyId: string; name: string; description?: string; unitPriceCents: number; taxRatePercent?: number; taxLabel?: string; category?: string; accountingAccountId?: string; active?: boolean },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const name = cleanText(args.name, 200);
  if (!name) throw new Error("Give the item a name.");
  const unitPriceCents = Math.round(Number(args.unitPriceCents));
  if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) throw new Error("Enter a price of zero or more.");
  const rate = Number(args.taxRatePercent ?? 0);
  if (!Number.isFinite(rate) || rate < 0 || rate > 30) throw new Error("Tax rate must be between 0 and 30%.");
  if (args.accountingAccountId) await requireAccountOfKind(ctx, args.societyId, args.accountingAccountId, "revenue");
  const fields = {
    name,
    description: cleanText(args.description, 1000),
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
  await requireOwnedRow(ctx, "invoiceCatalogItems", id);
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
    currency: (cleanText(args.currency, 3) ?? "CAD").toUpperCase(),
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
    issueDate,
    terms: series.terms,
    dueDate: dueDateForTerms(issueDate, series.terms),
    reference: series.reference,
    currency: series.currency,
    lines: (series.lines ?? []).map((line: any) => ({ ...line, key: randomKey("line") })),
    discount: series.discount,
    memo: series.memo,
    totalCents: computeInvoiceTotals(series.lines ?? [], series.discount).totalCents,
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
    const totalCents = computeInvoiceTotals(row.lines ?? [], row.discount).totalCents;
    if (state.state === "posted" || (state.state === "ready" && state.entryId)) preview.postedCount += 1;
    if (state.state === "ready") {
      if (!state.entryId) {
        preview.invoiceCount += 1;
        preview.invoiceCents += totalCents;
      }
      const pending = (row.payments ?? []).filter((payment: StoredInvoicePayment) => !(payment.journalEntryId && postedIds.has(payment.journalEntryId)) && !paymentBlock(payment, lctx));
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
      const pending = ((row.payments ?? []) as StoredInvoicePayment[]).filter((payment) => !((payment.journalEntryId && postedIds.has(payment.journalEntryId)) || paymentBlock(payment, lctx)));
      await assertInvoicePostable(ctx, row, lctx, !state.entryId, pending);
      let current: Row = row;
      const events: Array<ReturnType<typeof event>> = [];
      if (!state.entryId) {
        const outcome = await syncAccrual(ctx, asStored(row), lctx, userId);
        if (!outcome.entryId) continue;
        current = { ...row, journalEntryId: outcome.entryId };
        await ctx.db.patch(row._id, { journalEntryId: outcome.entryId });
        const total = computeInvoiceTotals(row.lines ?? [], row.discount).totalCents;
        events.push(event("posted", postedLabel(total), actor));
        result.postedInvoices += 1;
        result.postedCents += total;
      }
      const payments = [...(current.payments ?? [])] as StoredInvoicePayment[];
      for (const [index, original] of payments.entries()) {
        if ((original.journalEntryId && postedIds.has(original.journalEntryId)) || paymentBlock(original, lctx)) continue;
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

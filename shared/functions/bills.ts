/**
 * PORTABLE FUNCTIONS: bills (accounts payable).
 *
 * workspace / upsert / submit / recall / decide / bulkApprove / setSchedule /
 * recordPayment / removePayment / markPaid / cancel / remove /
 * attachDocument / upsertVendor.
 *
 * Bills store their lifecycle (draft | awaiting_approval | approved |
 * scheduled | canceled) and payments; open, partially paid, paid and overdue
 * are derived on read against the organisation's local today
 * (shared/bills.ts).
 *
 * Approval reuses the expense approval rules and approver-access setting
 * (shared/functions/expenseReports.ts): the rule for the bill total decides
 * how many approvals it needs and who may give them, and the person who
 * submitted it can't approve it when the rule blocks self-approval. When the
 * last approval lands the bill is posted (Dr each line's account / Cr
 * Accounts payable), as an accrual-only entry. Payments post Dr Accounts
 * payable / Cr the account paid from (both bases) and a cash-only entry that
 * recognises the paid share of the expense lines on the payment date
 * (docs/accounting-shape.md, "Accounting basis"). A payment linked to a
 * money-out bank line marks that line matched (`matchedKind: "bill"`) and
 * categorised to Accounts payable. An earlier bank posting stays in history
 * and receives a dated offset when the payment takes over; same-day bank
 * entries are voided and replaced. Reversing a payment
 * retains its original entries and posts dated mirrors, restores any replaced
 * bank accounting at the correction date and puts the bank match back as it
 * was; canceling an approved bill posts the
 * mirror of the approval entry (accrual-only too). Every posting and void
 * goes through the fiscal-period check and the books close date
 * (`assertBooksOpen`), so a closed period or locked date refuses it.
 *
 * Vendors are `accountingCounterparties` rows of kind "vendor".
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { assertPeriodOpen, BILL_BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE, postedJournalForTransaction, TRANSACTION_BACKFILL_SOURCE } from "./accounting";
import { cashLedgerAccountId } from "./bankAccounts";
import { assertBooksOpen } from "./booksLock";
import { documentAccessPredicate, requireDocumentAccess } from "./documents";
import { actorFor, approverAccessFor, loadApprovalPolicy, ruleFor } from "./expenseReports";
import { requireFunctionAction } from "./actionPolicy";
import { loadInvoiceLedgerContext } from "./invoiceLedger";
import { flagChangedPeriods } from "./reconciliation";
import { validateBalancedJournalLines } from "../accountingCore";
import type { JournalBasis } from "../booksReports";
import { approverEligibility, FINANCE_EDIT_REQUIRED_REASON, type ApprovalRule, type ApproverAccessContext } from "../expenseApprovals";
import { tagRulesFor } from "./financeTags";
import { resolutionCalendarDate, resolutionTimeZone } from "../writtenResolutionEvidence";
import {
  addDays,
  approvalPostingLines,
  billPaidCents,
  billPaidCentsAsOf,
  billSubmitProblem,
  billTotalCents,
  canPayStatus,
  cashBasisPostingLines,
  cashBasisShares,
  daysPastDue,
  deriveBillStatus,
  dueDateForTerms,
  findDuplicateBill,
  isBillPaymentMethod,
  isCalendarDate,
  isDueSoon,
  normalizeBillTerms,
  paymentPostingLines,
  recognizedCashShares,
  reversalLines,
  summarizeBills,
  validateBillLines,
  vendorTotals,
  type BillCashShare,
  type BillLifecycle,
  type BillLine,
  type BillStatus,
  type PostingLine,
} from "../bills";

/* ------------------------------------------------------------------ rows */

type RuleApplication = { ruleName: string; batchId: string; appliedAtISO: string; previous?: unknown };

type Snapshot = {
  category?: string;
  accountingAccountId?: string;
  categorizedBy?: string;
  ruleId?: string;
  ruleApplication?: RuleApplication;
  reconciledAtISO?: string;
  reconciledByName?: string;
  matchedKind?: string;
  matchedId?: string;
  reconciliationNote?: string;
};

type StoredPayment = {
  kind?: "payment" | "credit" | "write_off" | "refund";
  idempotencyKey?: string; sourcePaymentKey?: string; adjustmentAccountId?: string;
  reversedDate?: string; reversalJournalEntryId?: string; cashBasisReversalJournalEntryId?: string;
  reversedAtISO?: string; reversalReason?: string; restoredTransactionJournalEntryId?: string;
  key: string;
  date: string;
  amountCents: number;
  method: string;
  reference?: string;
  financialTransactionId?: string;
  transactionBefore?: Snapshot;
  cashAccountId?: string;
  journalEntryId?: string;
  cashBasisJournalEntryId?: string;
  cashBasisShares?: BillCashShare[];
  /** The bank line's own "Backfill imports" entry, voided while this payment holds the line (restored on removal). */
  voidedTransactionEntryId?: string;
  /** Earlier bank posting retained, then offset on this payment's date. */
  replacedTransactionEntryId?: string;
  bankTransferJournalEntryId?: string;
  note?: string;
  recordedAtISO: string;
  recordedByName?: string;
};

type Vote = { userId: string; name: string; role?: string; atISO: string };

type TimelineEvent = { atISO: string; kind: string; label: string; actorName?: string; actorUserId?: string; amountCents?: number };

type BillRow = {
  _id: string;
  societyId: string;
  billNumber?: string;
  vendorId?: string;
  vendorName?: string;
  billDate: string;
  terms: string;
  dueDate: string;
  currency: string;
  lines: BillLine[];
  notes?: string;
  documentId?: string;
  status: BillLifecycle;
  totalCents: number;
  paidCents: number;
  payments: StoredPayment[];
  approvals: Vote[];
  requiredApprovals?: number;
  timeline: TimelineEvent[];
  submittedByUserId?: string;
  submittedAtISO?: string;
  /** Everyone who changed the bill while it was waiting for approval (this round). */
  editedByUserIds?: string[];
  approvedAtISO?: string;
  declinedReason?: string;
  declinedAtISO?: string;
  declinedByName?: string;
  scheduledDate?: string;
  journalEntryId?: string;
  reversalJournalEntryId?: string;
  canceledAtISO?: string;
  cancelReason?: string;
  source?: string;
  createdByUserId?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

type VendorRow = {
  _id: string;
  societyId: string;
  name: string;
  kind: string;
  email?: string;
  taxIdentifier?: string;
  notes?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  defaultAccountId?: string;
  defaultTerms?: string;
  paymentMethod?: string;
  paymentDetails?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

type AccountRow = {
  _id: string;
  societyId: string;
  connectionId?: string;
  code?: string;
  name: string;
  currency?: string;
  accountType: string;
  subtype?: string;
  normalBalance?: string;
};

type TransactionRow = {
  _id: string;
  societyId: string;
  accountId: string;
  date: string;
  description: string;
  amountCents: number;
  counterparty?: string;
  category?: string;
  accountingAccountId?: string;
  categorizedBy?: string;
  ruleId?: string;
  ruleApplication?: RuleApplication;
  reconciledAtISO?: string;
  reconciledByName?: string;
  matchedKind?: string;
  matchedId?: string;
  reconciliationNote?: string;
  billPaymentRelease?: { date: string; journalEntryIds: string[] };
  invoicePaymentRelease?: { date: string; journalEntryIds: string[] };
};

type JournalEntryRow = { _id: string; societyId: string; source: string; sourceExternalId?: string; status: string; date: string; fiscalPeriodId?: string };
type JournalLineRow = { _id: string; societyId: string; journalEntryId: string; accountId: string; amountCents: number; side: string; description?: string; fundRestrictionId?: string; financialTransactionId?: string; counterpartyId?: string; tagIds?: string[]; programCode?: string; grantId?: string; documentIds?: string[]; lineOrder: number };
type FundRow = { _id: string; societyId: string; name: string; status: string };
type DocumentRow = { _id: string; societyId: string; title?: string; fileName?: string };

type Actor = Awaited<ReturnType<typeof actorFor>>;

const MONEY_ACCOUNT_TYPES = new Set(["Bank", "Credit"]);
const CASH_SUBTYPES = new Set(["cash", "restricted_cash"]);
const MATCHABLE_KINDS = new Set([undefined, "", "manual", "bill"]);
const BANK_RESTORATION_SOURCE = BILL_BANK_RESTORATION_SOURCE;

function nowISO() {
  return new Date().toISOString();
}

function randomKey(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value: unknown, max = 2000): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : undefined;
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function organizationToday(ctx: PortableQueryCtx, societyId: string) {
  const organization = await ctx.db.get(societyId, "societies");
  const iso = nowISO();
  return resolutionCalendarDate(iso, resolutionTimeZone(organization as Parameters<typeof resolutionTimeZone>[0])) ?? iso.slice(0, 10);
}

function event(kind: string, label: string, actor?: { id?: string; name: string }, amountCents?: number): TimelineEvent {
  const row: TimelineEvent = { atISO: nowISO(), kind, label };
  if (actor) {
    row.actorName = actor.name;
    if (actor.id) row.actorUserId = actor.id;
  }
  if (amountCents != null) row.amountCents = amountCents;
  return row;
}

const TIMELINE_LIMIT = 80;
function withEvents(bill: Pick<BillRow, "timeline">, ...events: TimelineEvent[]) {
  return [...(bill.timeline ?? []), ...events].slice(-TIMELINE_LIMIT);
}

/** Approver reasons are written for claims; say "bill" here. */
function billReason(reason: string) {
  return reason.replace(/\bclaims\b/g, "bills").replace(/\bclaim\b/g, "bill");
}

function billLabel(bill: Pick<BillRow, "vendorName" | "billNumber">) {
  return [bill.vendorName, bill.billNumber ? `bill ${bill.billNumber}` : null].filter(Boolean).join(" ") || "Bill";
}

async function loadBills(ctx: PortableQueryCtx, societyId: string): Promise<BillRow[]> {
  return ctx.db.query<BillRow>("bills").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

async function loadAccounts(ctx: PortableQueryCtx, societyId: string): Promise<AccountRow[]> {
  return ctx.db.query<AccountRow>("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

function accountLabel(account: Pick<AccountRow, "code" | "name"> | undefined) {
  return account ? `${account.code ? `${account.code} ` : ""}${account.name}` : undefined;
}

/** The workspace's Accounts payable account, if it has one. */
function findPayablesAccount(accounts: readonly AccountRow[]): AccountRow | undefined {
  const liabilities = accounts.filter((account) => account.accountType === "Liability");
  return (
    liabilities.find((account) => account.subtype === "payable" && account.code === "2000") ??
    liabilities.find((account) => account.subtype === "payable") ??
    liabilities.find((account) => /accounts payable/i.test(account.name))
  );
}

/**
 * Accounts payable for posting: the existing account, or "2000 Accounts
 * payable" created on first use (workspaces seeded before bills, or whose
 * imported chart has no payables account). Never renames or moves anything.
 */
async function ensurePayablesAccount(ctx: PortableMutationCtx, societyId: string, preferredCurrency?: string): Promise<AccountRow> {
  const accounts = await loadAccounts(ctx, societyId);
  const existing = findPayablesAccount(accounts);
  if (existing) return existing;
  const connections = await ctx.db.query("financialConnections").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const connectionId = String(
    connections.find((row) => row.provider === "societyer")?._id ??
    (await ctx.db.insert("financialConnections", {
      societyId,
      provider: "societyer",
      status: "connected",
      accountLabel: "Societyer internal ledger",
      syncMode: "internal",
      connectedAtISO: nowISO(),
      demo: false,
    })),
  );
  const usedCodes = new Set(accounts.map((account) => account.code).filter(Boolean));
  const code = ["2000", "2010", "2050"].find((candidate) => !usedCodes.has(candidate));
  const currency = preferredCurrency ?? accounts.find((account) => account.currency)?.currency ?? "CAD";
  const doc = {
    societyId,
    connectionId,
    externalId: "societyer:2000",
    ...(code ? { code } : {}),
    name: "Accounts payable",
    currency,
    accountType: "Liability",
    subtype: "payable",
    balanceCents: 0,
    isRestricted: false,
    sourceSystem: "societyer",
    normalBalance: "credit",
  };
  const id = await ctx.db.insert("financialAccounts", doc);
  return { _id: id, ...doc };
}

/**
 * Post one balanced entry, once: a posted entry with the same source and key
 * is returned instead of posting twice. The fiscal-period check refuses a
 * date inside a closed period and the books close date refuses one on or
 * before it. `basis` is set explicitly (docs/accounting-shape.md).
 */
async function postEntry(
  ctx: PortableMutationCtx,
  args: { societyId: string; date: string; memo: string; source: string; sourceExternalId: string; basis: JournalBasis; lines: PostingLine[]; counterpartyId?: string; documentId?: string; createdByUserId?: string },
): Promise<string> {
  const existing = await ctx.db
    .query<JournalEntryRow>("journalEntries")
    .withIndex("by_society_source_external", (q) => q.eq("societyId", args.societyId).eq("source", args.source).eq("sourceExternalId", args.sourceExternalId))
    .collect();
  const already = existing.find((entry) => entry.status === "posted");
  if (already) return already._id;
  validateBalancedJournalLines(args.lines);
  const period = (await assertPeriodOpen(ctx, { societyId: args.societyId, date: args.date })) as { _id: string; fiscalYear?: string } | null;
  await assertBooksOpen(ctx, args.societyId, [args.date], "posted");
  const at = nowISO();
  const documentIds = args.documentId ? [args.documentId] : undefined;
  const entryId = await ctx.db.insert("journalEntries", {
    societyId: args.societyId,
    ...(period ? { fiscalPeriodId: period._id, fiscalYear: period.fiscalYear } : {}),
    date: args.date,
    memo: args.memo,
    source: args.source,
    sourceExternalId: args.sourceExternalId,
    basis: args.basis,
    status: "posted",
    ...(args.createdByUserId ? { createdByUserId: args.createdByUserId } : {}),
    postedAtISO: at,
    ...(documentIds ? { sourceDocumentIds: documentIds } : {}),
    createdAtISO: at,
    updatedAtISO: at,
  });
  for (const [index, line] of args.lines.entries()) {
    await ctx.db.insert("journalLines", {
      societyId: args.societyId,
      journalEntryId: entryId,
      accountId: line.accountId,
      lineOrder: index,
      amountCents: line.amountCents,
      side: line.side,
      ...(line.description ? { description: line.description } : {}),
      ...(line.fundRestrictionId ? { fundRestrictionId: line.fundRestrictionId } : {}),
      ...(line.financialTransactionId ? { financialTransactionId: line.financialTransactionId } : {}),
      ...(line.tagIds?.length ? { tagIds: line.tagIds } : {}),
      ...(line.programCode ? { programCode: line.programCode } : {}),
      ...(line.grantId ? { grantId: line.grantId } : {}),
      ...(line.counterpartyId || args.counterpartyId ? { counterpartyId: line.counterpartyId ?? args.counterpartyId } : {}),
      ...(line.documentIds?.length || documentIds ? { documentIds: line.documentIds?.length ? line.documentIds : documentIds } : {}),
      createdAtISO: at,
      updatedAtISO: at,
    });
  }
  return entryId;
}

async function entryLines(ctx: PortableQueryCtx, entryId: string): Promise<JournalLineRow[]> {
  const lines = await ctx.db.query<JournalLineRow>("journalLines").withIndex("by_entry", (q) => q.eq("journalEntryId", entryId)).collect();
  return lines.sort((a, b) => a.lineOrder - b.lineOrder);
}

/* ------------------------------------------------------------- approvals */

type Policy = Awaited<ReturnType<typeof loadApprovalPolicy>>;

function approverOf(actor: Actor) {
  return { _id: String(actor.user._id), role: actor.role, status: actor.user.status as string | undefined };
}

function approvalSubject(bill: Pick<BillRow, "totalCents" | "submittedByUserId" | "approvals">) {
  return { amountCents: bill.totalCents, claimantUserId: bill.submittedByUserId ?? null, approvals: bill.approvals ?? [] };
}

/**
 * Whether this person may approve the bill. Under a rule that blocks
 * self-approval, whoever edited the bill while it waited for approval counts
 * as its author too (an edit clears the approvals, so the editor could
 * otherwise approve their own change alone).
 */
function eligibilityFor(rule: ApprovalRule, actor: Actor, bill: BillRow, access: ApproverAccessContext) {
  const result = approverEligibility(rule, approverOf(actor), approvalSubject(bill), access);
  if (!result.eligible) return { eligible: false as const, reason: billReason(result.reason) };
  if (rule.blockSelfApproval && actor.id && (bill.editedByUserIds ?? []).includes(String(actor.id))) {
    return { eligible: false as const, reason: "You edited this bill while it was waiting for approval, so someone else has to approve it." };
  }
  return result;
}

/* ------------------------------------------------------------ decorating */

function decorate(bill: BillRow, today: string, accountsById: Map<string, AccountRow>, txnById: Map<string, TransactionRow>, documentsById: Map<string, DocumentRow>) {
  const totalCents = billTotalCents(bill.lines);
  const paid = billPaidCents(bill.payments);
  const status = deriveBillStatus({ lifecycle: bill.status, dueDate: bill.dueDate, totalCents, payments: bill.payments }, today);
  const balanceCents = bill.status === "canceled" ? 0 : Math.max(0, totalCents - paid);
  const document = bill.documentId ? documentsById.get(bill.documentId) : undefined;
  return {
    ...bill,
    lifecycle: bill.status,
    status,
    totalCents,
    paidCents: paid,
    balanceCents,
    daysOverdue: status === "overdue" ? daysPastDue(bill.dueDate, today) : 0,
    dueSoon: isDueSoon({ status, dueDate: bill.dueDate }, today),
    document: document ? { _id: document._id, title: document.title ?? document.fileName ?? "Bill document" } : null,
    lines: bill.lines.map((line) => ({ ...line, accountLabel: line.accountId ? accountLabel(accountsById.get(line.accountId)) : undefined })),
    payments: (bill.payments ?? []).map((payment) => {
      const { transactionBefore: _before, ...rest } = payment;
      const txn = payment.financialTransactionId ? txnById.get(payment.financialTransactionId) : undefined;
      return {
        ...rest,
        cashAccountLabel: payment.cashAccountId ? accountLabel(accountsById.get(payment.cashAccountId)) : undefined,
        transaction: txn ? { _id: txn._id, date: txn.date, description: txn.description, amountCents: txn.amountCents } : undefined,
      };
    }),
  };
}

export type BillView = ReturnType<typeof decorate> & {
  approvalsRemaining: number;
  ruleLabel?: string;
  canApprove: boolean;
  cannotApproveReason?: string;
  /** May decline: anyone who could approve it, even after approving it themselves. */
  canDecline: boolean;
  isMine: boolean;
  possibleDuplicate: { _id: string; billNumber?: string } | null;
};

/** Everything the Bills, Vendors and approvals screens need in one read. */
export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const actor = await actorFor(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const [bills, accounts, counterparties, transactions, funds, policy] = await Promise.all([
    loadBills(ctx, societyId),
    loadAccounts(ctx, societyId),
    ctx.db.query<VendorRow>("accountingCounterparties").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<TransactionRow>("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<FundRow>("fundRestrictions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    loadApprovalPolicy(ctx, societyId),
  ]);
  const access = await approverAccessFor(ctx, societyId, policy.approverAccess);
  const opens = await documentAccessPredicate(ctx, societyId);
  const documentIds = [...new Set(bills.map((bill) => bill.documentId).filter((value): value is string => Boolean(value)))];
  const documents = await Promise.all(documentIds.map((id) => ctx.db.get<DocumentRow>(id, "documents")));
  // Only documents this person may open are named; the others stay unlinked in the view.
  const documentsById = new Map(documents.filter((doc): doc is DocumentRow => Boolean(doc && doc.societyId === societyId && opens(doc))).map((doc) => [doc._id, doc]));
  const accountsById = new Map(accounts.map((account) => [account._id, account]));
  const txnById = new Map(transactions.map((txn) => [txn._id, txn]));

  const rows: BillView[] = bills.map((bill) => {
    const view = decorate(bill, today, accountsById, txnById, documentsById);
    const rule = ruleFor(policy.rules, view.totalCents);
    const awaiting = bill.status === "awaiting_approval";
    const required = awaiting ? rule.requiredApprovals : bill.requiredApprovals ?? rule.requiredApprovals;
    const eligibility = awaiting ? eligibilityFor(rule, actor, bill, access) : { eligible: false as const, reason: "Only bills waiting for approval can be approved." };
    const canDecline = awaiting && eligibilityFor(rule, actor, { ...bill, approvals: [] }, access).eligible;
    const duplicate = findDuplicateBill({ _id: bill._id, vendorId: bill.vendorId, billNumber: bill.billNumber }, bills.map((other) => ({ ...other, lifecycle: other.status })));
    return {
      ...view,
      requiredApprovals: required,
      approvalsRemaining: Math.max(0, required - (bill.approvals ?? []).length),
      ruleLabel: rule.label,
      canApprove: eligibility.eligible,
      cannotApproveReason: eligibility.eligible ? undefined : eligibility.reason,
      canDecline,
      isMine: Boolean(actor.id && bill.submittedByUserId === actor.id),
      possibleDuplicate: duplicate ? { _id: duplicate._id, billNumber: duplicate.billNumber } : null,
    };
  });
  rows.sort((a, b) => b.billDate.localeCompare(a.billDate) || b.createdAtISO.localeCompare(a.createdAtISO));

  const linked = new Map<string, { billId: string; label: string }>();
  const released = new Map<string, string>();
  for (const bill of bills) {
    for (const payment of bill.payments ?? []) {
      if (!payment.reversedDate && payment.financialTransactionId) linked.set(payment.financialTransactionId, { billId: bill._id, label: billLabel(bill) });
      if (payment.reversedDate && payment.financialTransactionId && (released.get(payment.financialTransactionId) ?? "") < payment.reversedDate) released.set(payment.financialTransactionId, payment.reversedDate);
    }
  }
  const since = addDays(today, -400);
  const moneyOut = transactions
    .filter((txn) => Number(txn.amountCents) < 0 && String(txn.date) >= since)
    .map((txn) => ({
      _id: txn._id,
      date: txn.date,
      amountCents: txn.amountCents,
      description: txn.description,
      counterparty: txn.counterparty,
      accountId: txn.accountId,
      accountLabel: accountLabel(accountsById.get(txn.accountId)),
      category: txn.category,
      previousReversalDate: released.get(txn._id),
      // Matched to something other than a bill (a payroll run, a filing…): not offered.
      matchedElsewhere: !MATCHABLE_KINDS.has(txn.matchedKind),
      linkedBillId: linked.get(txn._id)?.billId,
      linkedBillLabel: linked.get(txn._id)?.label,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalsByVendor = vendorTotals(rows);
  const vendorIds = new Set(bills.map((bill) => bill.vendorId).filter(Boolean));
  const vendors = counterparties
    .filter((row) => row.kind === "vendor" || vendorIds.has(row._id))
    .map((row) => {
      const totals = totalsByVendor.get(row._id) ?? { billCount: 0, outstandingCents: 0, overdueCents: 0, paidCents: 0, lastBillDate: undefined };
      return {
        _id: row._id,
        name: row.name,
        kind: row.kind,
        email: row.email,
        contactName: row.contactName,
        phone: row.phone,
        address: row.address,
        taxIdentifier: row.taxIdentifier,
        notes: row.notes,
        defaultAccountId: row.defaultAccountId,
        defaultAccountLabel: row.defaultAccountId ? accountLabel(accountsById.get(row.defaultAccountId)) : undefined,
        defaultTerms: row.defaultTerms,
        paymentMethod: row.paymentMethod,
        paymentDetails: row.paymentDetails,
        ...totals,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const payables = findPayablesAccount(accounts);
  const summary = summarizeBills(rows, today);
  return {
    today,
    bills: rows,
    vendors,
    transactions: moneyOut,
    accounts: {
      expense: accounts
        .filter((account) => account.accountType === "Expense" || (account.accountType === "Asset" && !CASH_SUBTYPES.has(String(account.subtype)) && account.subtype !== "receivable"))
        .map((account) => ({ _id: account._id, label: accountLabel(account)!, accountType: account.accountType, currency: account.currency }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      adjustment: accounts
        .filter((account) => ["Expense", "Income", "Revenue", "Asset"].includes(account.accountType) && !CASH_SUBTYPES.has(String(account.subtype)) && account.subtype !== "receivable")
        .map((account) => ({ _id: account._id, label: accountLabel(account)!, accountType: account.accountType, currency: account.currency }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      payment: accounts
        .filter((account) => MONEY_ACCOUNT_TYPES.has(account.accountType) || (account.accountType === "Asset" && CASH_SUBTYPES.has(String(account.subtype))))
        .map((account) => ({ _id: account._id, label: accountLabel(account)!, accountType: account.accountType, currency: account.currency }))
        .sort((a, b) => Number(b.accountType === "Bank") - Number(a.accountType === "Bank") || a.label.localeCompare(b.label)),
      payables: payables ? { _id: payables._id, label: accountLabel(payables)! } : null,
    },
    funds: funds.filter((fund) => fund.status === "active").map((fund) => ({ _id: fund._id, name: fund.name })),
    summary: { ...summary, awaitingMeCount: rows.filter((row) => row.canApprove).length },
    approval: {
      rules: policy.rules.filter((rule) => rule.enabled).map((rule) => ({ minAmountCents: rule.minAmountCents, requiredApprovals: rule.requiredApprovals, label: rule.label })),
      approverAccess: policy.approverAccess,
      hasFinanceWrite: access.hasFinanceWrite,
    },
    currentUser: { _id: actor.id, name: actor.name, role: actor.role },
  };
}

/* ------------------------------------------------------------------ edits */

type ClientLine = { key?: string; accountId?: string; amountCents: number; memo?: string; fundRestrictionId?: string; tagIds?: string[] };

function cleanLines(lines: readonly ClientLine[] | undefined): BillLine[] {
  return (lines ?? []).slice(0, 100).map((raw, index) => {
    const line: BillLine = {
      key: cleanText(raw.key, 60) ?? `line_${index + 1}`,
      amountCents: Math.round(Number(raw.amountCents)),
    };
    if (raw.accountId) line.accountId = String(raw.accountId);
    const memo = cleanText(raw.memo, 500);
    if (memo) line.memo = memo;
    if (raw.fundRestrictionId) line.fundRestrictionId = String(raw.fundRestrictionId);
    const tagIds = [...new Set((raw.tagIds ?? []).map(String).filter(Boolean))];
    if (tagIds.length) line.tagIds = tagIds;
    return line;
  });
}

async function assertLineRefs(ctx: PortableQueryCtx, societyId: string, lines: readonly BillLine[]) {
  for (const id of new Set(lines.map((line) => line.accountId).filter((value): value is string => Boolean(value)))) {
    const account = await getOwned<AccountRow>(ctx, "financialAccounts", id, societyId);
    if (MONEY_ACCOUNT_TYPES.has(account.accountType) || CASH_SUBTYPES.has(String(account.subtype))) {
      throw new Error(`${account.name} is a bank or card account. Bill lines go to an expense or asset account; the bank account is used when you record the payment.`);
    }
    if (account.accountType === "Liability" && account.subtype === "payable") throw new Error("Bill lines can't go to Accounts payable; the bill credits it automatically.");
  }
  for (const id of new Set(lines.map((line) => line.fundRestrictionId).filter((value): value is string => Boolean(value)))) {
    await getOwned(ctx, "fundRestrictions", id, societyId);
  }
}

type UpsertArgs = {
  id?: string;
  societyId: string;
  billNumber?: string;
  vendorId?: string;
  billDate: string;
  terms?: string;
  dueDate?: string;
  currency?: string;
  lines: ClientLine[];
  notes?: string;
  documentId?: string;
  source?: string;
};

/**
 * Create a draft or save changes. Drafts may be incomplete (an uploaded bill
 * starts with only its document); submitting checks the rest. A bill waiting
 * for approval can be edited, which clears the approvals it had and records
 * the editor, who then can't approve this round where the rule blocks
 * self-approval (as the submitter can't). Approved
 * bills are posted and can't be edited; cancel and re-enter instead.
 * Returns the id and any other live bill with the same vendor and number.
 */
export async function upsertPortable(ctx: PortableMutationCtx, args: UpsertArgs) {
  const actor = await actorFor(ctx, args.societyId);
  if (!isCalendarDate(args.billDate)) throw new Error("Choose the bill date.");
  const vendor = args.vendorId ? await getOwned<VendorRow>(ctx, "accountingCounterparties", args.vendorId, args.societyId) : null;
  const terms = args.terms ? normalizeBillTerms(args.terms) : normalizeBillTerms(vendor?.defaultTerms);
  if (terms === "custom" && !isCalendarDate(args.dueDate)) throw new Error("Choose the due date.");
  const dueDate = dueDateForTerms(args.billDate, terms, args.dueDate);
  if (dueDate < args.billDate) throw new Error("The due date can't be before the bill date.");
  const lines = cleanLines(args.lines);
  const tagRules = lines.some((line) => line.tagIds?.length) ? await tagRulesFor(ctx, args.societyId) : undefined;
  const problem = validateBillLines(lines, { complete: false, groupOf: tagRules?.groupOf });
  if (problem) throw new Error(problem);
  if (tagRules) {
    // Tags already on the bill stay even if archived since; new ones must be usable.
    const kept = args.id ? (await getOwned<BillRow>(ctx, "bills", args.id, args.societyId)).lines.flatMap((line) => line.tagIds ?? []) : [];
    const tagProblem = tagRules.newTagProblem(lines.flatMap((line) => line.tagIds ?? []), kept);
    if (tagProblem) throw new Error(tagProblem);
  }
  await assertLineRefs(ctx, args.societyId, lines);
  if (args.documentId) await requireDocumentAccess(ctx, args.documentId);
  const fields = {
    billNumber: cleanText(args.billNumber, 60),
    vendorId: vendor?._id,
    vendorName: vendor?.name,
    billDate: args.billDate,
    terms,
    dueDate,
    currency: (cleanText(args.currency, 3) ?? "CAD").toUpperCase(),
    lines,
    notes: cleanText(args.notes, 4000),
    totalCents: billTotalCents(lines),
  };
  const at = nowISO();
  const bills = await loadBills(ctx, args.societyId);
  const duplicateOf = (id: string | undefined) => {
    const duplicate = findDuplicateBill({ _id: id, vendorId: fields.vendorId, billNumber: fields.billNumber }, bills.map((bill) => ({ ...bill, lifecycle: bill.status })));
    return duplicate ? { _id: duplicate._id, billNumber: duplicate.billNumber } : null;
  };
  if (args.id) {
    const existing = await getOwned<BillRow>(ctx, "bills", args.id, args.societyId);
    if (existing.status === "canceled") throw new Error("A canceled bill can't be edited.");
    if (existing.status === "approved" || existing.status === "scheduled") {
      throw new Error("Approved bills are already in the books and can't be edited. Cancel the bill and enter it again, or attach the document from the bill panel.");
    }
    const patch: Record<string, unknown> = { ...fields, updatedAtISO: at, ...(args.documentId ? { documentId: args.documentId } : {}) };
    const events = [event("edited", "Details edited", actor)];
    if (existing.status === "awaiting_approval") {
      if (actor.id && !(existing.editedByUserIds ?? []).includes(String(actor.id))) patch.editedByUserIds = [...(existing.editedByUserIds ?? []), String(actor.id)];
      if ((existing.approvals ?? []).length) {
        patch.approvals = [];
        events.push(event("reset", "Approvals cleared after an edit", actor));
      }
    }
    patch.timeline = withEvents(existing, ...events);
    await ctx.db.patch(args.id, patch);
    return { id: args.id, duplicateOf: duplicateOf(args.id) };
  }
  const source = args.source === "upload" ? "upload" : "manual";
  const id = await ctx.db.insert("bills", {
    societyId: args.societyId,
    status: "draft",
    ...fields,
    ...(args.documentId ? { documentId: args.documentId } : {}),
    paidCents: 0,
    payments: [],
    approvals: [],
    timeline: [event(source === "upload" ? "uploaded" : "created", source === "upload" ? "Draft created from an uploaded bill" : "Draft created", actor)],
    source,
    ...(actor.id ? { createdByUserId: actor.id } : {}),
    createdAtISO: at,
    updatedAtISO: at,
  });
  return { id, duplicateOf: duplicateOf(id) };
}

/** Send a complete draft for approval under the approval rules. */
export async function submitPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id);
  const actor = await actorFor(ctx, bill.societyId);
  if (bill.status !== "draft") throw new Error("Only drafts can be sent for approval.");
  const problem = billSubmitProblem(bill);
  if (problem) throw new Error(problem);
  const policy = await loadApprovalPolicy(ctx, bill.societyId);
  const rule = ruleFor(policy.rules, billTotalCents(bill.lines));
  const at = nowISO();
  await ctx.db.patch(id, {
    status: "awaiting_approval",
    approvals: [],
    editedByUserIds: undefined,
    requiredApprovals: rule.requiredApprovals,
    ...(actor.id ? { submittedByUserId: actor.id } : {}),
    submittedAtISO: at,
    declinedReason: undefined,
    declinedAtISO: undefined,
    declinedByName: undefined,
    updatedAtISO: at,
    timeline: withEvents(bill, event("submitted", `Sent for approval (${rule.requiredApprovals} needed)`, actor)),
  });
  return { status: "awaiting_approval", requiredApprovals: rule.requiredApprovals };
}

/** Take a bill back out of approval (it returns to draft, approvals cleared). */
export async function recallPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id);
  const actor = await actorFor(ctx, bill.societyId);
  if (bill.status !== "awaiting_approval") throw new Error("Only bills waiting for approval can be taken back.");
  await ctx.db.patch(id, { status: "draft", approvals: [], editedByUserIds: undefined, updatedAtISO: nowISO(), timeline: withEvents(bill, event("recalled", "Taken back to draft", actor)) });
  return id;
}

/** Records one approval; the last one posts the bill. Every approving path goes through here. */
async function approveOne(ctx: PortableMutationCtx, bill: BillRow, actor: Actor, policy: Policy, access: ApproverAccessContext) {
  if (bill.status !== "awaiting_approval") throw new Error("Only bills waiting for approval can be approved.");
  const total = billTotalCents(bill.lines);
  const rule = ruleFor(policy.rules, total);
  const eligibility = eligibilityFor(rule, actor, bill, access);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  const me = approverOf(actor);
  const at = nowISO();
  const approvals: Vote[] = [...(bill.approvals ?? []), { userId: me._id, name: actor.name, ...(actor.role ? { role: actor.role } : {}), atISO: at }];
  const complete = approvals.length >= rule.requiredApprovals;
  const events = [event("approved", `Approved (${approvals.length} of ${rule.requiredApprovals})`, actor)];
  const patch: Record<string, unknown> = { approvals, requiredApprovals: rule.requiredApprovals, updatedAtISO: at };
  if (complete) {
    const problem = billSubmitProblem(bill);
    if (problem) throw new Error(problem);
    const payables = await ensurePayablesAccount(ctx, bill.societyId);
    const entryId = await postEntry(ctx, {
      societyId: bill.societyId,
      date: bill.billDate,
      memo: `Bill: ${billLabel(bill)}`,
      source: "bill",
      sourceExternalId: `bill:${bill._id}`,
      basis: "accrual-only",
      lines: approvalPostingLines(bill, payables._id),
      counterpartyId: bill.vendorId,
      documentId: bill.documentId,
      createdByUserId: actor.id,
    });
    Object.assign(patch, { status: "approved", approvedAtISO: at, journalEntryId: entryId, totalCents: total });
    events.push(event("posted", `Posted to the books: ${money(total)} to Accounts payable`, actor, total));
  }
  patch.timeline = withEvents(bill, ...events);
  await ctx.db.patch(bill._id, patch);
  return { status: complete ? "approved" : "awaiting_approval", approvals: approvals.length, required: rule.requiredApprovals };
}

/** Approve, or decline with a reason (the bill goes back to draft with the reason). */
export async function decidePortable(ctx: PortableMutationCtx, { id, decision, reason }: { id: string; decision: string; reason?: string }) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id);
  const actor = await actorFor(ctx, bill.societyId);
  const policy = await loadApprovalPolicy(ctx, bill.societyId);
  const access = await approverAccessFor(ctx, bill.societyId, policy.approverAccess);
  if (decision === "approve") return approveOne(ctx, bill, actor, policy, access);
  if (decision !== "decline") throw new Error("Choose approve or decline.");
  if (bill.status !== "awaiting_approval") throw new Error("Only bills waiting for approval can be declined.");
  const rule = ruleFor(policy.rules, billTotalCents(bill.lines));
  // Anyone who could approve this bill may decline it.
  const eligibility = eligibilityFor(rule, actor, { ...bill, approvals: [] }, access);
  if (!eligibility.eligible) throw new Error(eligibility.reason.replace("approve", "decline").replace("Approving", "Declining"));
  const text = cleanText(reason, 500);
  if (!text || text.length < 3) throw new Error("Give a reason for declining.");
  const at = nowISO();
  await ctx.db.patch(id, {
    status: "draft",
    approvals: [],
    editedByUserIds: undefined,
    declinedReason: text,
    declinedAtISO: at,
    declinedByName: actor.name,
    updatedAtISO: at,
    timeline: withEvents(bill, event("declined", `Declined: ${text}`, actor)),
  });
  return { status: "draft" };
}

/** Approve several bills; bills the current person may not approve are skipped with a reason. */
export async function bulkApprovePortable(ctx: PortableMutationCtx, { societyId, ids }: { societyId: string; ids: string[] }) {
  const actor = await actorFor(ctx, societyId);
  const policy = await loadApprovalPolicy(ctx, societyId);
  const access = await approverAccessFor(ctx, societyId, policy.approverAccess);
  // Refuse before looking up any bill, so the outcome never depends on which ids exist.
  if (access.approverAccess === "finance_writers" && !access.hasFinanceWrite) throw new Error(FINANCE_EDIT_REQUIRED_REASON);
  const bills = await ownedBills(ctx, societyId, ids);
  const results: Array<{ id: string; status?: string; error?: string }> = [];
  for (const bill of bills) {
    try {
      const outcome = await approveOne(ctx, bill, actor, policy, access);
      results.push({ id: bill._id, status: outcome.status });
    } catch (error) {
      results.push({ id: bill._id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    approved: results.filter((row) => row.status === "approved").length,
    recorded: results.filter((row) => row.status === "awaiting_approval").length,
    skipped: results.filter((row) => row.error).map((row) => ({ id: row.id, error: row.error! })),
  };
}

async function ownedBills(ctx: PortableQueryCtx, societyId: string, ids: readonly string[]) {
  await requireSocietyMembership(ctx, societyId);
  const unique = [...new Set(ids ?? [])].slice(0, 200);
  // Resolve every id first so a foreign or missing id stops the batch before any write.
  return Promise.all(unique.map((id) => getOwned<BillRow>(ctx, "bills", id, societyId)));
}

/** Plan a payment date for an approved bill, or clear it (back to open). */
export async function setSchedulePortable(ctx: PortableMutationCtx, { id, scheduledDate }: { id: string; scheduledDate?: string }) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id);
  const actor = await actorFor(ctx, bill.societyId);
  if (bill.status !== "approved" && bill.status !== "scheduled") throw new Error("Only approved bills can be scheduled.");
  if (billPaidCents(bill.payments) >= billTotalCents(bill.lines)) throw new Error("This bill is already paid.");
  if (scheduledDate) {
    if (!isCalendarDate(scheduledDate)) throw new Error("Choose the payment date.");
    await ctx.db.patch(id, { status: "scheduled", scheduledDate, updatedAtISO: nowISO(), timeline: withEvents(bill, event("scheduled", `Payment planned for ${scheduledDate}`, actor)) });
  } else {
    await ctx.db.patch(id, { status: "approved", scheduledDate: undefined, updatedAtISO: nowISO(), timeline: withEvents(bill, event("unscheduled", "Planned payment cleared", actor)) });
  }
  return id;
}

/* -------------------------------------------------------------- payments */

type PaymentArgs = {
  id: string;
  date: string;
  amountCents: number;
  method: string;
  reference?: string;
  note?: string;
  financialTransactionId?: string;
  cashAccountId?: string;
};

async function payOne(ctx: PortableMutationCtx, bill: BillRow, actor: Actor, args: Omit<PaymentArgs, "id">, today: string) {
  const total = billTotalCents(bill.lines);
  const status = deriveBillStatus({ lifecycle: bill.status, dueDate: bill.dueDate, totalCents: total, payments: bill.payments }, today);
  if (!canPayStatus(status)) {
    throw new Error(bill.status === "draft" || bill.status === "awaiting_approval" ? "Approve the bill before recording a payment." : status === "paid" ? "This bill is already paid." : "A canceled bill can't take payments.");
  }
  if (!isCalendarDate(args.date)) throw new Error("Choose the payment date.");
  const amountCents = Math.round(Number(args.amountCents));
  if (!(amountCents > 0)) throw new Error("Enter an amount above zero.");
  const balance = total - billPaidCents(bill.payments);
  if (amountCents > balance) throw new Error(`That's more than the ${money(balance)} balance.`);

  let txn: TransactionRow | null = null;
  if (args.financialTransactionId) {
    txn = await getOwned<TransactionRow>(ctx, "financialTransactions", args.financialTransactionId, bill.societyId);
    if (!(txn.amountCents < 0)) throw new Error("Only money-out bank transactions can be linked to a bill payment.");
    if (-txn.amountCents !== amountCents) throw new Error(`The payment must match the bank transaction (${money(-txn.amountCents)}).`);
    const all = await loadBills(ctx, bill.societyId);
    if (all.some((other) => (other.payments ?? []).some((payment) => !payment.reversedDate && payment.financialTransactionId === txn!._id))) {
      throw new Error("That bank transaction is already linked to a bill payment.");
    }
    const previousReversal = [...all.flatMap((other) => other.payments ?? []).filter((payment) => payment.financialTransactionId === txn!._id && payment.reversedDate).map((payment) => payment.reversedDate!), txn.billPaymentRelease?.date, txn.invoicePaymentRelease?.date].filter((date): date is string => Boolean(date)).sort().at(-1);
    if (previousReversal && args.date < previousReversal) throw new Error(`Relinking this bank transaction requires a payment date on or after its previous reversal (${previousReversal}).`);
    if (!MATCHABLE_KINDS.has(txn.matchedKind)) throw new Error(`That bank transaction is already matched to a ${txn.matchedKind} record.`);
  }
  const settlementDates = new Set([args.date, ...(bill.payments ?? []).flatMap((payment) => [payment.date, ...(payment.reversedDate ? [payment.reversedDate] : [])]).filter((date) => date >= args.date)]);
  if ([...settlementDates].some((date) => billPaidCentsAsOf(bill.payments, date) + amountCents > total)) {
    throw new Error("That payment date overlaps earlier settled amounts. Choose a date on or after the applicable reversal, or reduce the payment.");
  }
  // A linked bank line pays from its account's ledger account (the account itself unless linked to another).
  const cashAccountId = txn ? await cashLedgerAccountId(ctx, bill.societyId, txn.accountId) : args.cashAccountId;
  if (!cashAccountId) throw new Error("Choose the account the bill was paid from.");
  const cashAccount = await getOwned<AccountRow>(ctx, "financialAccounts", cashAccountId, bill.societyId);
  if (!txn && !MONEY_ACCOUNT_TYPES.has(cashAccount.accountType) && !CASH_SUBTYPES.has(String(cashAccount.subtype))) {
    throw new Error(`${cashAccount.name} isn't a bank, cash or card account.`);
  }
  // Checked before anything is posted, so a refusal changes nothing.
  const claimed = txn ? await claimableBankEntries(ctx, bill.societyId, txn._id, args.date) : [];
  const bankTransfers: Array<{ entry: JournalEntryRow; lines: PostingLine[]; basis: JournalBasis }> = [];
  for (const entry of claimed) if (entry.date < args.date) {
    const original = await entryLines(ctx, entry._id);
    if (!original.some((line) => line.financialTransactionId === txn!._id)) throw new Error("The bank posting does not belong to this transaction.");
    const lines = reversalLines(original).map((line) => ({ ...line, financialTransactionId: undefined }));
    validateBalancedJournalLines(lines);
    bankTransfers.push({ entry, lines, basis: (entry as JournalEntryRow & { basis?: JournalBasis }).basis ?? "both" });
  }
  const method = isBillPaymentMethod(args.method) ? args.method : "other";
  const reference = cleanText(args.reference, 100);
  const payables = await ensurePayablesAccount(ctx, bill.societyId);
  const key = randomKey("pay");
  const journalEntryId = await postEntry(ctx, {
    societyId: bill.societyId,
    date: args.date,
    memo: `Bill payment: ${billLabel(bill)}`,
    source: "bill_payment",
    sourceExternalId: `bill:${bill._id}:payment:${key}`,
    basis: "both",
    lines: paymentPostingLines({ amountCents, financialTransactionId: txn?._id, reference }, payables._id, cashAccount._id, `Payment: ${billLabel(bill)}`),
    counterpartyId: bill.vendorId,
    createdByUserId: actor.id,
  });
  // Cash basis: the paid share of the expense lines lands on the payment date.
  const shares = cashBasisShares(bill.lines, recognizedCashShares(bill.lines, bill.payments ?? []), amountCents);
  const cashBasisJournalEntryId = await postEntry(ctx, {
    societyId: bill.societyId,
    date: args.date,
    memo: `Bill paid (cash basis): ${billLabel(bill)}`,
    source: "bill_cash_basis",
    sourceExternalId: `bill:${bill._id}:payment:${key}:cash`,
    basis: "cash-only",
    lines: cashBasisPostingLines(bill, shares, payables._id),
    counterpartyId: bill.vendorId,
    documentId: bill.documentId,
    createdByUserId: actor.id,
  });
  const payment: StoredPayment = { key, date: args.date, amountCents, method, cashAccountId: cashAccount._id, journalEntryId, cashBasisJournalEntryId, cashBasisShares: shares, recordedAtISO: nowISO(), recordedByName: actor.name };
  if (reference) payment.reference = reference;
  const note = cleanText(args.note, 500);
  if (note) payment.note = note;
  if (txn) {
    // Transfer an earlier bank posting on this payment's date. Its original
    // history remains posted, including periods now closed. Same-day entries
    // can still use the original void-and-replace path without changing cutoffs.
    for (const entry of claimed) {
      const transfer = bankTransfers.find((row) => row.entry._id === entry._id);
      if (transfer) {
        payment.replacedTransactionEntryId = entry._id;
        payment.bankTransferJournalEntryId = await postEntry(ctx, { societyId: bill.societyId, date: args.date, memo: `Transfer bank transaction to bill payment: ${billLabel(bill)}`, source: "bill_bank_transfer", sourceExternalId: `bill:${bill._id}:payment:${key}:bank-transfer`, basis: transfer.basis, lines: transfer.lines, createdByUserId: actor.id });
      } else {
        const at = nowISO();
        await ctx.db.patch(entry._id, { status: "void", voidedAtISO: at, updatedAtISO: at });
        payment.voidedTransactionEntryId = entry._id;
      }
    }
    payment.financialTransactionId = txn._id;
    payment.transactionBefore = snapshotOf(txn);
    await ctx.db.patch(txn._id, {
      category: payables.name,
      accountingAccountId: payables._id,
      categorizedBy: "manual",
      ruleId: undefined,
      ruleApplication: undefined,
      reconciledAtISO: txn.reconciledAtISO ?? nowISO(),
      reconciledByName: txn.reconciledByName ?? actor.name,
      matchedKind: "bill",
      matchedId: bill._id,
      reconciliationNote: `Paid ${billLabel(bill)}`,
      ...(bankTransfers.length ? { billPaymentRelease: { date: args.date, journalEntryIds: [...new Set([...(txn.billPaymentRelease?.journalEntryIds ?? []), ...bankTransfers.map((row) => row.entry._id)])] } } : {}),
    });
    await flagChangedPeriods(ctx, txn.accountId, txn.date);
  }
  const payments = [...(bill.payments ?? []), payment];
  const remaining = total - billPaidCents(payments);
  await ctx.db.patch(bill._id, {
    payments,
    paidCents: billPaidCents(payments),
    totalCents: total,
    ...(remaining <= 0 && bill.status === "scheduled" ? { status: "approved", scheduledDate: undefined } : {}),
    updatedAtISO: nowISO(),
    timeline: withEvents(bill, event("payment", `${remaining <= 0 ? "Paid in full" : "Partial payment recorded"}${txn ? " · linked to the bank transaction" : ""}`, actor, amountCents)),
  });
  return { key, remainingCents: remaining };
}

function snapshotOf(txn: TransactionRow): Snapshot {
  const snapshot: Snapshot = {};
  for (const field of ["category", "accountingAccountId", "categorizedBy", "ruleId", "reconciledAtISO", "reconciledByName", "matchedKind", "matchedId", "reconciliationNote"] as const) {
    const value = txn[field];
    if (typeof value === "string" && value) snapshot[field] = value;
  }
  // Rule history, so a categorisation by rule stays undoable after the link is removed.
  if (txn.ruleApplication) snapshot.ruleApplication = txn.ruleApplication;
  return snapshot;
}

const ENTRY_SOURCE_LABELS: Record<string, string> = { manual: "manual journal", wave: "Wave", opening_balance: "opening balance" };

/**
 * The bank line's own "Backfill imports" entries a linked payment takes over
 * (offset on a later payment date, or voided on a same-day link). Refuses
 * unsupported current postings, dates before the bank posting, and locked
 * dates that would actually be changed. Read-only.
 */
async function claimableBankEntries(ctx: PortableQueryCtx, societyId: string, transactionId: string, paymentDate: string): Promise<JournalEntryRow[]> {
  const { entries } = await postedJournalForTransaction(ctx, transactionId);
  if (entries.length > 1) throw new Error("This bank transaction has multiple current journal entries. Reconcile them before linking the bill payment.");
  const claimable: JournalEntryRow[] = [];
  for (const raw of entries) {
    const entry = raw as unknown as JournalEntryRow;
    if (![TRANSACTION_BACKFILL_SOURCE, BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE].includes(entry.source) || entry.status !== "posted") {
      const label = ENTRY_SOURCE_LABELS[entry.source] ?? `${entry.source} entry`;
      throw new Error(`That bank transaction is already in the books (a ${label} dated ${entry.date}). Void that entry, or record the payment without linking the bank transaction.`);
    }
    if (entry.date > paymentDate) throw new Error(`The bill payment date must be on or after the current bank posting (${entry.date}).`);
    if (entry.date < paymentDate) {
      await assertPeriodOpen(ctx, { societyId, date: paymentDate });
      await assertBooksOpen(ctx, societyId, [paymentDate], "posted");
      claimable.push(entry);
      continue;
    }
    try {
      await assertPeriodOpen(ctx, { societyId, date: entry.date, fiscalPeriodId: entry.fiscalPeriodId });
      await assertBooksOpen(ctx, societyId, [entry.date], "voided");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`That bank transaction was posted on ${entry.date}, and linking it would void that entry, which can't change: ${reason}`);
    }
    claimable.push(entry);
  }
  return claimable;
}

/** Record a full or partial payment, optionally linked to the money-out bank line. */
export async function recordPaymentPortable(ctx: PortableMutationCtx, args: PaymentArgs) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", args.id);
  const actor = await actorFor(ctx, bill.societyId);
  const today = await organizationToday(ctx, bill.societyId);
  const { id: _id, ...payment } = args;
  return payOne(ctx, bill, actor, payment, today);
}

// The payment is addressed by its key inside the bill, not by a row id.
/** Corrections append dated mirrors and retain the original payment for historical AP and cash reports. */
export async function removePaymentPortable(ctx: PortableMutationCtx, args: { id: string; paymentKey: string; date?: string; reason?: string }) {
  await requireFunctionAction(ctx, "bills:removePayment", "mutation", args);
  const { id, paymentKey } = args;
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id), actor = await actorFor(ctx, bill.societyId);
  const payment = (bill.payments ?? []).find((entry) => entry.key === paymentKey);
  if (!payment) throw new Error("That payment is no longer on this bill.");
  if (payment.kind && payment.kind !== "payment") throw new Error("Reverse the adjustment using a dated reversal.");
  const requestedReason = args.reason === undefined ? undefined : cleanText(args.reason, 1000);
  if (payment.reversedDate) {
    if (args.date && args.date !== payment.reversedDate || args.reason !== undefined && requestedReason !== payment.reversalReason) throw new Error("That payment was already reversed with different details.");
    return id;
  }
  if (!["approved", "scheduled"].includes(bill.status)) throw new Error("Reversing a payment requires an approved bill.");
  if ((bill.payments ?? []).some((row) => !row.reversedDate && row.sourcePaymentKey === payment.key)) throw new Error("Reverse the linked refund before removing its payment.");
  const today = await organizationToday(ctx, bill.societyId), date = args.date ?? today;
  const reason = args.reason === undefined ? "Recorded in error" : requestedReason;
  if (!isCalendarDate(date) || date < payment.date || date > today) throw new Error("Choose a reversal date between the original payment and today.");
  if (!reason) throw new Error("Explain why the payment is being reversed.");
  await assertPeriodOpen(ctx, { societyId: bill.societyId, date });
  await assertBooksOpen(ctx, bill.societyId, [date], "reversed");
  const prepared: Array<{ cash: boolean; lines: PostingLine[]; basis: JournalBasis }> = [];
  for (const [entryId, cash] of [[payment.journalEntryId, false], [payment.cashBasisJournalEntryId, true]] as const) {
    if (!entryId) continue;
    const entry = await getOwned<JournalEntryRow & { basis?: JournalBasis }>(ctx, "journalEntries", entryId, bill.societyId);
    if (entry.status !== "posted" || entry.source !== (cash ? "bill_cash_basis" : "bill_payment") || entry.sourceExternalId !== `bill:${bill._id}:payment:${payment.key}${cash ? ":cash" : ""}`) throw new Error("The original payment journal does not match this posted bill payment.");
    const lines = reversalLines(await entryLines(ctx, entryId)).map((line) => ({ ...line, financialTransactionId: undefined }));
    validateBalancedJournalLines(lines);
    prepared.push({ cash, lines, basis: cash ? "cash-only" : "both" });
  }
  let transaction: TransactionRow | null = null;
  if (payment.financialTransactionId) {
    transaction = await getOwned<TransactionRow>(ctx, "financialTransactions", payment.financialTransactionId, bill.societyId);
    if (transaction.matchedKind !== "bill" || transaction.matchedId !== bill._id) throw new Error("The linked bank match changed; review it before reversing this payment.");
  }
  let restore: { lines: PostingLine[]; basis: JournalBasis } | undefined;
  if (payment.voidedTransactionEntryId) {
    const entry = await getOwned<JournalEntryRow & { basis?: JournalBasis }>(ctx, "journalEntries", payment.voidedTransactionEntryId, bill.societyId);
    if (![TRANSACTION_BACKFILL_SOURCE, BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE].includes(entry.source)) throw new Error("The bank restoration reference does not belong to a supported transaction entry.");
    if (entry.status === "void") {
      const lines = (await entryLines(ctx, entry._id)).map((line): PostingLine => ({ ...line, side: line.side as "debit" | "credit" }));
      if (!transaction || !lines.some((line) => line.financialTransactionId === transaction!._id)) throw new Error("The bank restoration journal does not belong to this linked bank transaction.");
      validateBalancedJournalLines(lines);
      restore = { lines, basis: entry.basis ?? "both" };
    } else throw new Error("The replaced bank journal changed; review it before reversing this payment.");
  }
  if (payment.replacedTransactionEntryId || payment.bankTransferJournalEntryId) {
    if (!payment.replacedTransactionEntryId || !payment.bankTransferJournalEntryId || payment.voidedTransactionEntryId) throw new Error("The retained bank transfer references are incomplete.");
    const original = await getOwned<JournalEntryRow & { basis?: JournalBasis }>(ctx, "journalEntries", payment.replacedTransactionEntryId, bill.societyId);
    const transfer = await getOwned<JournalEntryRow & { basis?: JournalBasis }>(ctx, "journalEntries", payment.bankTransferJournalEntryId, bill.societyId);
    if (original.status !== "posted" || original.date >= payment.date || ![TRANSACTION_BACKFILL_SOURCE, BANK_RESTORATION_SOURCE, INVOICE_BANK_RESTORATION_SOURCE].includes(original.source) || transfer.status !== "posted" || transfer.source !== "bill_bank_transfer" || transfer.sourceExternalId !== `bill:${bill._id}:payment:${payment.key}:bank-transfer` || transfer.date !== payment.date || (transfer.basis ?? "both") !== (original.basis ?? "both")) throw new Error("The retained bank transfer journals changed; review them before reversing this payment.");
    const lines = (await entryLines(ctx, original._id)).map((line): PostingLine => ({ ...line, side: line.side as "debit" | "credit" }));
    if (!transaction || !lines.some((line) => line.financialTransactionId === transaction!._id)) throw new Error("The retained bank journal does not belong to this linked transaction.");
    validateBalancedJournalLines(lines);
    const actualTransfer = await entryLines(ctx, transfer._id);
    const signature = (rows: PostingLine[]) => JSON.stringify(rows.map((line) => [line.accountId, line.side, line.amountCents, line.fundRestrictionId, line.programCode, line.grantId, line.counterpartyId, [...(line.tagIds ?? [])].sort(), [...(line.documentIds ?? [])].sort()]));
    if (actualTransfer.some((line) => line.financialTransactionId) || signature(actualTransfer as PostingLine[]) !== signature(reversalLines(lines))) throw new Error("The retained bank transfer lines changed; review them before reversing this payment.");
    restore = { lines, basis: original.basis ?? "both" };
  }
  // All references and both journals are checked before any writes. Old postings remain immutable.
  let reversalJournalEntryId: string | undefined, cashBasisReversalJournalEntryId: string | undefined;
  for (const entry of prepared) {
    const reversal = await postEntry(ctx, { societyId: bill.societyId, date, memo: `Reverse bill payment: ${billLabel(bill)} · ${reason}`, source: "bill_payment_reversal", sourceExternalId: `bill:${bill._id}:payment:${payment.key}:reversal:${entry.cash ? "cash" : "main"}`, basis: entry.basis, lines: entry.lines, counterpartyId: bill.vendorId, createdByUserId: actor.id });
    if (entry.cash) cashBasisReversalJournalEntryId = reversal; else reversalJournalEntryId = reversal;
  }
  // Re-post the bank's previous accounting at the correction date rather than changing a closed historical entry.
  const restoredTransactionJournalEntryId = restore ? await postEntry(ctx, { societyId: bill.societyId, date, memo: `Restore bank transaction after payment reversal: ${billLabel(bill)}`, source: BANK_RESTORATION_SOURCE, sourceExternalId: `bill:${bill._id}:payment:${payment.key}:bank-restored`, basis: restore.basis, lines: restore.lines, createdByUserId: actor.id }) : undefined;
  if (transaction) {
    const before = payment.transactionBefore ?? {};
    const previousRelease = transaction.billPaymentRelease;
    const billPaymentRelease = { date: previousRelease && previousRelease.date > date ? previousRelease.date : date, journalEntryIds: [...new Set([...(previousRelease?.journalEntryIds ?? []), ...(payment.journalEntryId ? [payment.journalEntryId] : [])])] };
    await ctx.db.patch(transaction._id, { category: before.category, accountingAccountId: before.accountingAccountId, categorizedBy: before.categorizedBy, ruleId: before.ruleId, ruleApplication: before.ruleApplication, reconciledAtISO: before.reconciledAtISO, reconciledByName: before.reconciledByName, matchedKind: before.matchedKind, matchedId: before.matchedId, reconciliationNote: before.reconciliationNote, billPaymentRelease });
    await flagChangedPeriods(ctx, transaction.accountId, transaction.date);
  }
  const payments = bill.payments.map((row) => row.key === payment.key ? { ...row, reversedDate: date, reversedAtISO: nowISO(), reversalReason: reason, reversalJournalEntryId, cashBasisReversalJournalEntryId, restoredTransactionJournalEntryId } : row);
  await ctx.db.patch(id, { payments, paidCents: billPaidCents(payments), updatedAtISO: nowISO(), timeline: withEvents(bill, event("payment_reversed", `Payment reversed effective ${date}${transaction ? " and bank transaction unlinked" : ""} · ${reason}`, actor, -payment.amountCents)) });
  return id;
}

/** Pay the whole balance of several approved bills on one date from one account. */
export async function markPaidPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; ids: string[]; date: string; method: string; cashAccountId: string; reference?: string },
) {
  const bills = await ownedBills(ctx, args.societyId, args.ids);
  const actor = await actorFor(ctx, args.societyId);
  const today = await organizationToday(ctx, args.societyId);
  let paid = 0;
  let paidCents = 0;
  const skipped: Array<{ id: string; error: string }> = [];
  for (const bill of bills) {
    const balance = billTotalCents(bill.lines) - billPaidCents(bill.payments);
    try {
      await payOne(ctx, bill, actor, { date: args.date, amountCents: balance, method: args.method, reference: args.reference, cashAccountId: args.cashAccountId }, today);
      paid += 1;
      paidCents += balance;
    } catch (error) {
      // A closed period or the books close date refuses every bill alike: stop rather than skip silently.
      if (error instanceof Error && /Fiscal period|books are closed/.test(error.message)) throw error;
      skipped.push({ id: bill._id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { paid, paidCents, skipped };
}

/**
 * Cancel bills. Drafts and bills waiting for approval simply close; an
 * approved bill gets a reversing entry (dated today, so a closed period or a
 * close date on or after today refuses it), accrual-only like the entry it
 * mirrors; bills with active settlements are skipped until those settlements
 * have dated reversals. Retained payment history remains available on both bases.
 */
export async function cancelPortable(ctx: PortableMutationCtx, { societyId, ids, reason }: { societyId: string; ids: string[]; reason?: string }) {
  const bills = await ownedBills(ctx, societyId, ids);
  const actor = await actorFor(ctx, societyId);
  const today = await organizationToday(ctx, societyId);
  const why = cleanText(reason, 300);
  let canceled = 0;
  let reversed = 0;
  let skippedPaid = 0;
  let skipped = 0;
  for (const bill of bills) {
    if (bill.status === "canceled") { skipped += 1; continue; }
    if ((bill.payments ?? []).some((payment) => !payment.reversedDate)) { skippedPaid += 1; continue; }
    const at = nowISO();
    const patch: Record<string, unknown> = { status: "canceled", canceledAtISO: at, cancelReason: why, approvals: bill.status === "awaiting_approval" ? [] : bill.approvals, updatedAtISO: at };
    const events = [event("canceled", why ? `Canceled: ${why}` : "Canceled", actor)];
    if (bill.journalEntryId && !bill.reversalJournalEntryId) {
      const entry = await ctx.db.get<JournalEntryRow>(bill.journalEntryId, "journalEntries");
      if (entry && entry.societyId === societyId && entry.status === "posted") {
        const lines = await entryLines(ctx, entry._id);
        const reversalId = await postEntry(ctx, {
          societyId,
          date: today,
          memo: `Reversal: bill ${billLabel(bill)} canceled`,
          source: "bill_reversal",
          sourceExternalId: `bill:${bill._id}:reversal`,
          basis: "accrual-only",
          lines: reversalLines(lines).map((line) => ({
            accountId: line.accountId,
            side: line.side,
            amountCents: line.amountCents,
            description: `Reversal: ${line.description ?? billLabel(bill)}`,
            ...(line.fundRestrictionId ? { fundRestrictionId: line.fundRestrictionId } : {}),
            ...(line.tagIds?.length ? { tagIds: line.tagIds } : {}),
          })),
          counterpartyId: bill.vendorId,
          createdByUserId: actor.id,
        });
        patch.reversalJournalEntryId = reversalId;
        events.push(event("reversed", "Reversing entry posted", actor, billTotalCents(bill.lines)));
        reversed += 1;
      }
    }
    patch.timeline = withEvents(bill, ...events);
    await ctx.db.patch(bill._id, patch);
    canceled += 1;
  }
  return { canceled, reversed, skippedPaid, skipped };
}

/** Delete a draft (bills that were sent for approval are canceled instead, so the trail stays). */
export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id);
  if (bill.status !== "draft" || bill.submittedAtISO || (bill.payments ?? []).length) {
    throw new Error("Only drafts that were never sent for approval can be deleted. Cancel the bill instead.");
  }
  await ctx.db.delete(id);
}

/** Attach (or detach) the bill document without touching approvals or the books. */
export async function attachDocumentPortable(ctx: PortableMutationCtx, { id, documentId }: { id: string; documentId?: string }) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id);
  const actor = await actorFor(ctx, bill.societyId);
  let title = "";
  if (documentId) {
    const document = await requireDocumentAccess(ctx, documentId);
    if (document.societyId !== bill.societyId) throw new Error("documents not found.");
    title = String(document.title ?? document.fileName ?? "Bill document");
  }
  await ctx.db.patch(id, {
    documentId: documentId || undefined,
    updatedAtISO: nowISO(),
    timeline: withEvents(bill, event("document", documentId ? `Document attached: ${title}` : "Document removed", actor)),
  });
  return id;
}

/* ---------------------------------------------------------------- vendors */

type VendorArgs = {
  id?: string;
  societyId: string;
  name: string;
  email?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  taxIdentifier?: string;
  defaultAccountId?: string;
  defaultTerms?: string;
  paymentMethod?: string;
  paymentDetails?: string;
  notes?: string;
};

/** Add or edit a vendor (an accounting counterparty of kind "vendor"). Renames follow onto open bills. */
export async function upsertVendorPortable(ctx: PortableMutationCtx, args: VendorArgs) {
  await requireSocietyMembership(ctx, args.societyId);
  const name = cleanText(args.name, 200);
  if (!name) throw new Error("Add the vendor's name.");
  const email = cleanText(args.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("The email address doesn't look right.");
  if (args.defaultAccountId) {
    const account = await getOwned<AccountRow>(ctx, "financialAccounts", args.defaultAccountId, args.societyId);
    if (MONEY_ACCOUNT_TYPES.has(account.accountType)) throw new Error("A vendor's default account is where its costs go, not a bank account.");
  }
  const existing = await ctx.db.query<VendorRow>("accountingCounterparties").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const clash = existing.find((row) => row._id !== args.id && row.kind === "vendor" && row.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) throw new Error(`There's already a vendor called ${clash.name}.`);
  const fields = {
    name,
    email,
    contactName: cleanText(args.contactName, 200),
    phone: cleanText(args.phone, 60),
    address: cleanText(args.address, 500),
    taxIdentifier: cleanText(args.taxIdentifier, 60),
    defaultAccountId: args.defaultAccountId || undefined,
    defaultTerms: args.defaultTerms ? normalizeBillTerms(args.defaultTerms) : undefined,
    paymentMethod: isBillPaymentMethod(args.paymentMethod) ? args.paymentMethod : undefined,
    paymentDetails: cleanText(args.paymentDetails, 500),
    notes: cleanText(args.notes, 2000),
  };
  const at = nowISO();
  if (args.id) {
    const current = await getOwned<VendorRow>(ctx, "accountingCounterparties", args.id, args.societyId);
    await ctx.db.patch(args.id, { ...fields, updatedAtISO: at });
    if (current.name !== name) {
      for (const bill of await ctx.db.query<BillRow>("bills").withIndex("by_vendor", (q) => q.eq("vendorId", args.id)).collect()) {
        if (bill.societyId === args.societyId && bill.status !== "canceled") await ctx.db.patch(bill._id, { vendorName: name });
      }
    }
    return args.id;
  }
  return ctx.db.insert("accountingCounterparties", { societyId: args.societyId, kind: "vendor", provider: "societyer", ...fields, createdAtISO: at, updatedAtISO: at });
}

export type BillsWorkspace = Awaited<ReturnType<typeof workspacePortable>>;
export type BillStatusValue = BillStatus;

/** A vendor credit/write-off settles AP without pretending cash moved. Refunds reverse a named cash settlement. */
export async function recordAdjustmentPortable(ctx: PortableMutationCtx, args: {
  id: string; kind: "credit" | "write_off" | "refund"; date: string; amountCents: number; reason: string; idempotencyKey: string;
  adjustmentAccountId?: string; sourcePaymentKey?: string; cashAccountId?: string; reference?: string;
}) {
  await requireFunctionAction(ctx, "bills:recordAdjustment", "mutation", args);
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", args.id);
  const actor = await actorFor(ctx, bill.societyId);
  if (!["approved", "scheduled"].includes(bill.status)) throw new Error("Adjustments require an approved bill.");
  if (!["credit", "write_off", "refund"].includes(args.kind)) throw new Error("Choose a supported adjustment.");
  const reason = cleanText(args.reason, 1000), idempotencyKey = cleanText(args.idempotencyKey, 100), reference = cleanText(args.reference, 100);
  if (!reason || !idempotencyKey) throw new Error("Supply a reason and unique adjustment key.");
  if (typeof args.idempotencyKey !== "string" || args.idempotencyKey.trim().length > 100) throw new Error("Use a unique adjustment key of at most 100 characters.");
  const isRefund = args.kind === "refund";
  if (isRefund ? Boolean(args.adjustmentAccountId) : Boolean(args.sourcePaymentKey || args.cashAccountId)) throw new Error("Supply only the accounts and source payment appropriate to this adjustment.");
  const payments = bill.payments ?? [];
  const duplicate = payments.find((payment) => payment.idempotencyKey === idempotencyKey);
  if (duplicate) {
    if (duplicate.kind !== args.kind || duplicate.date !== args.date || Math.abs(duplicate.amountCents) !== args.amountCents || duplicate.note !== reason || duplicate.reference !== reference || duplicate.adjustmentAccountId !== args.adjustmentAccountId || duplicate.sourcePaymentKey !== args.sourcePaymentKey || (args.cashAccountId && duplicate.cashAccountId !== args.cashAccountId)) throw new Error("That adjustment key was already used for different details.");
    return duplicate.key;
  }
  if (!isCalendarDate(args.date) || args.date < bill.billDate) throw new Error("Choose an adjustment date on or after the bill date.");
  if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) throw new Error("Enter an adjustment above zero in integer cents.");
  const amount = args.amountCents;
  const sourceIndex = isRefund ? payments.findIndex((payment) => payment.key === args.sourcePaymentKey && !payment.reversedDate && (!payment.kind || payment.kind === "payment")) : -1;
  const source = sourceIndex >= 0 ? payments[sourceIndex] : undefined;
  let cashAccount: AccountRow | undefined, adjustmentAccount: AccountRow | undefined, refundShares: BillCashShare[] = [];
  if (isRefund) {
    if (!source || args.date < source.date) throw new Error("Choose an active payment on or before the refund date.");
    const refunds = payments.filter((payment) => payment.kind === "refund" && payment.sourcePaymentKey === source.key && !payment.reversedDate);
    const available = source.amountCents + refunds.reduce((sum, payment) => sum + payment.amountCents, 0);
    if (amount > available) throw new Error("The refund exceeds the remaining amount of that payment.");
    const cashId = args.cashAccountId ?? source.cashAccountId;
    if (!cashId) throw new Error("Choose the account receiving the vendor refund.");
    cashAccount = await getOwned<AccountRow>(ctx, "financialAccounts", cashId, bill.societyId);
    if (!MONEY_ACCOUNT_TYPES.has(cashAccount.accountType) && !CASH_SUBTYPES.has(String(cashAccount.subtype))) throw new Error("Refunds must go to a bank, cash or card account.");
    const refundedShares = new Map<string, number>();
    for (const refund of refunds) for (const share of refund.cashBasisShares ?? []) refundedShares.set(share.key, (refundedShares.get(share.key) ?? 0) - share.amountCents);
    // Legacy payments without stored shares use the allocation in effect when that payment was recorded.
    const sourceShares = source.cashBasisShares ?? cashBasisShares(bill.lines, recognizedCashShares(bill.lines, payments.slice(0, sourceIndex)), source.amountCents);
    refundShares = cashBasisShares(sourceShares, refundedShares, amount);
    if (refundShares.reduce((sum, share) => sum + share.amountCents, 0) !== amount) throw new Error("The source payment does not have enough cash-basis expense to refund.");
  } else {
    if (amount > billTotalCents(bill.lines) - billPaidCents(payments)) throw new Error("The adjustment exceeds the bill's open balance.");
    if (!args.adjustmentAccountId) throw new Error("Choose the expense or income account for this adjustment.");
    adjustmentAccount = await getOwned<AccountRow>(ctx, "financialAccounts", args.adjustmentAccountId, bill.societyId);
    if (!["Expense", "Income", "Revenue", "Asset"].includes(adjustmentAccount.accountType) || CASH_SUBTYPES.has(String(adjustmentAccount.subtype)) || adjustmentAccount.subtype === "receivable") throw new Error("Choose an expense, income or non-cash asset adjustment account.");
  }
  const ledger = await loadInvoiceLedgerContext(ctx, bill.societyId), currency = ledger.workspaceCurrency;
  const existingPayables = findPayablesAccount(ledger.accounts as AccountRow[]);
  if (bill.currency !== currency || cashAccount?.currency && cashAccount.currency !== currency || adjustmentAccount?.currency && adjustmentAccount.currency !== currency || existingPayables?.currency && existingPayables.currency !== currency) throw new Error("Record vendor adjustments in the workspace currency; foreign bills require a separately approved FX journal.");
  await assertPeriodOpen(ctx, { societyId: bill.societyId, date: args.date });
  await assertBooksOpen(ctx, bill.societyId, [args.date], "posted");
  // Prepare and validate both entries before the first write, including in portable test contexts.
  const payablesId = existingPayables?._id ?? "new-payables-account";
  const mainLines: PostingLine[] = isRefund
    ? [{ accountId: cashAccount!._id, side: "debit", amountCents: amount }, { accountId: payablesId, side: "credit", amountCents: amount }]
    : [{ accountId: payablesId, side: "debit", amountCents: amount }, { accountId: adjustmentAccount!._id, side: "credit", amountCents: amount }];
  const cashLines = isRefund ? reversalLines(cashBasisPostingLines(bill, refundShares, payablesId)) : undefined;
  validateBalancedJournalLines(mainLines);
  if (cashLines) validateBalancedJournalLines(cashLines);
  const payables = existingPayables ?? await ensurePayablesAccount(ctx, bill.societyId, currency), paymentKey = randomKey("adj");
  const actualLines = (lines: PostingLine[]) => lines.map((line) => line.accountId === payablesId ? { ...line, accountId: payables._id } : line);
  const journalEntryId = await postEntry(ctx, {
    societyId: bill.societyId, date: args.date, memo: `Vendor ${args.kind}: ${billLabel(bill)} · ${reason}`, source: "bill_adjustment", sourceExternalId: `bill:${bill._id}:adjustment:${idempotencyKey}`, basis: isRefund ? "both" : "accrual-only", counterpartyId: bill.vendorId, createdByUserId: actor.id, lines: actualLines(mainLines),
  });
  const cashBasisJournalEntryId = cashLines ? await postEntry(ctx, {
    societyId: bill.societyId, date: args.date, memo: `Vendor refund cash basis: ${billLabel(bill)}`, source: "bill_adjustment_cash", sourceExternalId: `bill:${bill._id}:adjustment:${idempotencyKey}:cash`, basis: "cash-only", counterpartyId: bill.vendorId, createdByUserId: actor.id, lines: actualLines(cashLines),
  }) : undefined;
  const payment: StoredPayment = {
    key: paymentKey, kind: args.kind, date: args.date, amountCents: isRefund ? -amount : amount, method: args.kind, reference, note: reason, idempotencyKey, journalEntryId, recordedAtISO: nowISO(), recordedByName: actor.name,
    ...(isRefund ? { sourcePaymentKey: source!.key, cashAccountId: cashAccount!._id, cashBasisJournalEntryId, cashBasisShares: refundShares.map((share) => ({ ...share, amountCents: -share.amountCents })) } : { adjustmentAccountId: adjustmentAccount!._id }),
  };
  const updated = [...payments, payment];
  await ctx.db.patch(bill._id, { payments: updated, paidCents: billPaidCents(updated), updatedAtISO: nowISO(), timeline: withEvents(bill, event(args.kind, `Vendor ${args.kind.replace("_", " ")} · ${reason}`, actor, payment.amountCents)) });
  return paymentKey;
}

/** Reverse an adjustment on a chosen date; original and reversal remain in the audit trail and as-of balances. */
export async function reverseAdjustmentPortable(ctx: PortableMutationCtx, args: { id: string; paymentKey: string; date: string; reason: string }) {
  await requireFunctionAction(ctx, "bills:reverseAdjustment", "mutation", args);
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", args.id), actor = await actorFor(ctx, bill.societyId);
  const payment = bill.payments.find((row) => row.key === args.paymentKey);
  if (!payment || !payment.kind || payment.kind === "payment") throw new Error("Choose a vendor adjustment.");
  if (payment.reversedDate) {
    if (payment.reversedDate !== args.date) throw new Error(`This adjustment was already reversed on ${payment.reversedDate}.`);
    return payment.key;
  }
  if (!["approved", "scheduled"].includes(bill.status)) throw new Error("Reversing adjustments requires an approved bill.");
  const reason = cleanText(args.reason, 1000);
  if (!reason || !isCalendarDate(args.date) || args.date < payment.date) throw new Error("Supply a reason and reversal date on or after the adjustment.");
  const remainingPaid = billPaidCents(bill.payments) - payment.amountCents;
  if (remainingPaid < 0 || remainingPaid > billTotalCents(bill.lines)) throw new Error("Reverse subsequent settlements before this adjustment.");
  if (!payment.journalEntryId) throw new Error("The adjustment's original journal entry is missing.");
  if (payment.kind === "refund" && !payment.cashBasisJournalEntryId) throw new Error("The refund's original cash-basis journal entry is missing.");
  await assertPeriodOpen(ctx, { societyId: bill.societyId, date: args.date });
  await assertBooksOpen(ctx, bill.societyId, [args.date], "posted");
  const original: Array<{ cash: boolean; basis: JournalBasis; lines: PostingLine[] }> = [];
  for (const [entryId, cash] of [[payment.journalEntryId, false], [payment.cashBasisJournalEntryId, true]] as const) {
    if (!entryId) continue;
    const entry = await getOwned<JournalEntryRow & { basis?: JournalBasis }>(ctx, "journalEntries", entryId, bill.societyId);
    const expectedSource = cash ? "bill_adjustment_cash" : "bill_adjustment";
    const expectedExternalId = `bill:${bill._id}:adjustment:${payment.idempotencyKey}${cash ? ":cash" : ""}`;
    if (entry.status !== "posted" || entry.source !== expectedSource || payment.idempotencyKey && entry.sourceExternalId !== expectedExternalId) throw new Error("The adjustment's original journal entry is not posted or does not match this bill.");
    const basis: JournalBasis = cash ? "cash-only" : payment.kind === "refund" ? "both" : "accrual-only";
    if (entry.basis && entry.basis !== basis) throw new Error("The adjustment journal uses an unexpected accounting basis.");
    const lines = reversalLines(await entryLines(ctx, entryId));
    validateBalancedJournalLines(lines);
    original.push({ cash, basis, lines });
  }
  let reversalJournalEntryId: string | undefined, cashBasisReversalJournalEntryId: string | undefined;
  for (const entry of original) {
    const id = await postEntry(ctx, { societyId: bill.societyId, date: args.date, memo: `Reverse vendor adjustment: ${billLabel(bill)} · ${reason}`, source: "bill_adjustment_reversal", sourceExternalId: `bill:${bill._id}:adjustment:${payment.key}:reverse:${entry.cash ? "cash" : "main"}`, basis: entry.basis, createdByUserId: actor.id, counterpartyId: bill.vendorId, lines: entry.lines });
    if (entry.cash) cashBasisReversalJournalEntryId = id; else reversalJournalEntryId = id;
  }
  const payments = bill.payments.map((row) => row.key === payment.key ? { ...row, reversedDate: args.date, reversalJournalEntryId, cashBasisReversalJournalEntryId } : row);
  await ctx.db.patch(bill._id, { payments, paidCents: billPaidCents(payments), updatedAtISO: nowISO(), timeline: withEvents(bill, event("adjustment_reversed", `Vendor adjustment reversed · ${reason}`, actor, -payment.amountCents)) });
  return payment.key;
}

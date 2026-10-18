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
 * categorised to Accounts payable; a line "Backfill imports" already posted
 * has that entry voided so it is never in the books twice (a line posted any
 * other way, or whose entry is locked, can't be linked). Removing a payment
 * voids both its entries, posts the bank line's own entry again and puts the
 * line back as it was; canceling an approved bill posts the
 * mirror of the approval entry (accrual-only too). Every posting and void
 * goes through the fiscal-period check and the books close date
 * (`assertBooksOpen`), so a closed period or locked date refuses it.
 *
 * Vendors are `accountingCounterparties` rows of kind "vendor".
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { assertPeriodOpen, postedJournalForTransaction, TRANSACTION_BACKFILL_SOURCE } from "./accounting";
import { cashLedgerAccountId } from "./bankAccounts";
import { assertBooksOpen } from "./booksLock";
import { documentAccessPredicate, requireDocumentAccess } from "./documents";
import { actorFor, approverAccessFor, loadApprovalPolicy, ruleFor } from "./expenseReports";
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
};

type JournalEntryRow = { _id: string; societyId: string; source: string; sourceExternalId?: string; status: string; date: string; fiscalPeriodId?: string };
type JournalLineRow = { _id: string; societyId: string; journalEntryId: string; accountId: string; amountCents: number; side: string; description?: string; fundRestrictionId?: string; financialTransactionId?: string; counterpartyId?: string; tagIds?: string[]; lineOrder: number };
type FundRow = { _id: string; societyId: string; name: string; status: string };
type DocumentRow = { _id: string; societyId: string; title?: string; fileName?: string };

type Actor = Awaited<ReturnType<typeof actorFor>>;

const MONEY_ACCOUNT_TYPES = new Set(["Bank", "Credit"]);
const CASH_SUBTYPES = new Set(["cash", "restricted_cash"]);
const MATCHABLE_KINDS = new Set([undefined, "", "manual", "bill"]);

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
async function ensurePayablesAccount(ctx: PortableMutationCtx, societyId: string): Promise<AccountRow> {
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
  const currency = accounts.find((account) => account.currency)?.currency ?? "CAD";
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
    .withIndex("by_society_source", (q) => q.eq("societyId", args.societyId).eq("source", args.source))
    .collect();
  const already = existing.find((entry) => entry.sourceExternalId === args.sourceExternalId && entry.status === "posted");
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
      ...(args.counterpartyId ? { counterpartyId: args.counterpartyId } : {}),
      ...(documentIds ? { documentIds } : {}),
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
  for (const bill of bills) {
    for (const payment of bill.payments ?? []) {
      if (payment.financialTransactionId) linked.set(payment.financialTransactionId, { billId: bill._id, label: billLabel(bill) });
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
        .map((account) => ({ _id: account._id, label: accountLabel(account)!, accountType: account.accountType }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      payment: accounts
        .filter((account) => MONEY_ACCOUNT_TYPES.has(account.accountType) || (account.accountType === "Asset" && CASH_SUBTYPES.has(String(account.subtype))))
        .map((account) => ({ _id: account._id, label: accountLabel(account)!, accountType: account.accountType }))
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
    if (all.some((other) => (other.payments ?? []).some((payment) => payment.financialTransactionId === txn!._id))) {
      throw new Error("That bank transaction is already linked to a bill payment.");
    }
    if (!MATCHABLE_KINDS.has(txn.matchedKind)) throw new Error(`That bank transaction is already matched to a ${txn.matchedKind} record.`);
  }
  // A linked bank line pays from its account's ledger account (the account itself unless linked to another).
  const cashAccountId = txn ? await cashLedgerAccountId(ctx, bill.societyId, txn.accountId) : args.cashAccountId;
  if (!cashAccountId) throw new Error("Choose the account the bill was paid from.");
  const cashAccount = await getOwned<AccountRow>(ctx, "financialAccounts", cashAccountId, bill.societyId);
  if (!txn && !MONEY_ACCOUNT_TYPES.has(cashAccount.accountType) && !CASH_SUBTYPES.has(String(cashAccount.subtype))) {
    throw new Error(`${cashAccount.name} isn't a bank, cash or card account.`);
  }
  // Checked before anything is posted, so a refusal changes nothing.
  const claimed = txn ? await claimableBankEntries(ctx, bill.societyId, txn._id) : [];
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
    // The payment entry now carries the bank line; its own backfill entry would count it twice.
    for (const entry of claimed) {
      const at = nowISO();
      await ctx.db.patch(entry._id, { status: "void", voidedAtISO: at, updatedAtISO: at });
      payment.voidedTransactionEntryId = entry._id;
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
 * (voided on link, restored when the payment is removed), all checked to be
 * voidable. Refuses the link when the line is in the books another way (a
 * manual journal, a Wave sync, an invoice) or its entry is in a closed period
 * or on or before the books close date. Read-only.
 */
async function claimableBankEntries(ctx: PortableQueryCtx, societyId: string, transactionId: string): Promise<JournalEntryRow[]> {
  const { entries } = await postedJournalForTransaction(ctx, transactionId);
  const claimable: JournalEntryRow[] = [];
  for (const raw of entries) {
    const entry = raw as unknown as JournalEntryRow;
    if (entry.source !== TRANSACTION_BACKFILL_SOURCE || entry.status !== "posted") {
      const label = ENTRY_SOURCE_LABELS[entry.source] ?? `${entry.source} entry`;
      throw new Error(`That bank transaction is already in the books (a ${label} dated ${entry.date}). Void that entry, or record the payment without linking the bank transaction.`);
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

// The payment is addressed by its key inside the bill (named `paymentKey`, not an id: it is not a row).
/**
 * Remove a payment recorded in error: its journal entry and its cash-only
 * entry are voided (refused when either date is in a closed period or on or
 * before the books close date), a linked bank line is put back as it was
 * before the link, and the bank line's own entry the link voided is posted
 * again.
 */
export async function removePaymentPortable(ctx: PortableMutationCtx, { id, paymentKey }: { id: string; paymentKey: string }) {
  const bill = await requireOwnedRow<BillRow>(ctx, "bills", id);
  const actor = await actorFor(ctx, bill.societyId);
  const payment = (bill.payments ?? []).find((entry) => entry.key === paymentKey);
  if (!payment) throw new Error("That payment is no longer on this bill.");
  const entries: JournalEntryRow[] = [];
  for (const entryId of [payment.journalEntryId, payment.cashBasisJournalEntryId]) {
    if (!entryId) continue;
    const entry = await ctx.db.get<JournalEntryRow>(entryId, "journalEntries");
    if (entry && entry.societyId === bill.societyId && entry.status === "posted") entries.push(entry);
  }
  // The bank line's own entry the payment voided comes back.
  const voided = payment.voidedTransactionEntryId ? await ctx.db.get<JournalEntryRow>(payment.voidedTransactionEntryId, "journalEntries") : null;
  const restore = voided && voided.societyId === bill.societyId && voided.status === "void" ? voided : null;
  // Check every entry before voiding any, so a refusal changes nothing.
  for (const entry of entries) {
    await assertPeriodOpen(ctx, { societyId: bill.societyId, date: entry.date, fiscalPeriodId: entry.fiscalPeriodId });
    await assertBooksOpen(ctx, bill.societyId, [entry.date], "voided");
  }
  if (restore) {
    await assertPeriodOpen(ctx, { societyId: bill.societyId, date: restore.date, fiscalPeriodId: restore.fiscalPeriodId });
    await assertBooksOpen(ctx, bill.societyId, [restore.date], "posted");
  }
  for (const entry of entries) {
    const at = nowISO();
    await ctx.db.patch(entry._id, { status: "void", voidedAtISO: at, updatedAtISO: at });
    // Free the bank line for other postings (the backfill skips lines already in an entry).
    for (const line of await entryLines(ctx, entry._id)) {
      if (line.financialTransactionId) await ctx.db.patch(line._id, { financialTransactionId: undefined, updatedAtISO: at });
    }
  }
  if (restore) await ctx.db.patch(restore._id, { status: "posted", voidedAtISO: undefined, updatedAtISO: nowISO() });
  if (payment.financialTransactionId) {
    const txn = await ctx.db.get<TransactionRow>(payment.financialTransactionId, "financialTransactions");
    if (txn && txn.societyId === bill.societyId && txn.matchedKind === "bill" && txn.matchedId === bill._id) {
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
      });
      await flagChangedPeriods(ctx, txn.accountId, txn.date);
    }
  }
  const payments = (bill.payments ?? []).filter((entry) => entry.key !== paymentKey);
  await ctx.db.patch(id, {
    payments,
    paidCents: billPaidCents(payments),
    updatedAtISO: nowISO(),
    timeline: withEvents(bill, event("payment_removed", payment.financialTransactionId ? "Payment removed and bank transaction unlinked" : "Payment removed", actor, payment.amountCents)),
  });
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
 * mirrors; bills with payments are skipped until the payments are removed
 * (removing a payment voids its cash-only entry, so a canceled bill never
 * keeps cash-basis expense).
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
    if ((bill.payments ?? []).length) { skippedPaid += 1; continue; }
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

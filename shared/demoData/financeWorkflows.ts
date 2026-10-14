/**
 * Demo data for the finance workflows: categorisation rules, statement
 * reconciliation periods (completed, auto-reconciled, out of balance and in
 * progress) and expense claims in every approval state.
 *
 * Shared by the in-browser demo (src/lib/staticFinanceWorkflowFixtures.ts,
 * fixed string ids) and the server seed (shared/functions/seed.ts, real
 * database ids). Callers choose ids through `refs.idFor`; every other value is
 * deterministic, so both demos tell the same story.
 *
 * Rules and statements are layered onto the generated bank feed
 * (shared/demoData/bankFeed.ts) rather than adding hand-written bank lines:
 * this module only changes categorisation provenance and reconciliation flags
 * on existing rows, so every account balance still equals its opening balance
 * plus the sum of its transactions and the FY statements stay calibrated.
 *
 * Statement balances are the feed's own balances at each statement date, and
 * fingerprints for closed periods are computed with the same shared code the
 * runtime uses (over the rows' real `_id`s), so the demo's "balances no longer
 * match" period is exactly the one whose lines changed after completion.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */
import {
  periodFingerprint,
  summarizePeriod,
  transactionsInPeriod,
  type PeriodTransaction,
} from "../reconciliationPeriods";
import { findMatchingRule, isUncategorized, type RuleTransaction, type TransactionRuleLike } from "../transactionRules";
import { isInternalTransfer } from "../transferCategories";

export type DemoFinancePerson = { id: string; name: string; role: string };

export type DemoFinanceIdKind = "rule" | "period" | "approvalRule" | "expense";

export type DemoFinanceRefs = {
  societyId: string;
  cashAccountId: string;
  grantAccountId: string;
  cardAccountId: string;
  /** Expense account the hydro rule posts to (omitted when the workspace has none). */
  facilitiesExpenseAccountId?: string;
  /** Fund restriction the (disabled) grant-spending rule tags. */
  fundRestrictionId?: string;
  owner: DemoFinancePerson;
  /** Prepares statements and pays claims. */
  treasurer: DemoFinancePerson;
  secretary: DemoFinancePerson;
  /** Receipt attached to the kitchen deposit claim. */
  receiptDocumentId?: string;
  /** The `_id` to give a generated row (a fixed id, or a placeholder resolved on insert). */
  idFor: (kind: DemoFinanceIdKind, key: string) => string;
};

type Txn = Record<string, any>;

export const DEMO_RULE_KEYS = {
  hydro: "coastal_hydro",
  donations: "donorloop_payouts",
  bankFee: "account_fee",
  brushstroke: "brushstroke",
  cloudnest: "cloudnest",
  greenwayCard: "greenway_card",
  grant: "grant_spending",
} as const;

/** Rules went live at the start of calendar 2026; feed rows imported since
 * then that a rule covers carry its provenance. */
const RULES_LIVE_FROM = "2026-01-01";
const RULES_CREATED_AT = "2025-12-18T18:00:00.000Z";

export function demoTransactionRules(refs: DemoFinanceRefs) {
  const id = (key: string) => refs.idFor("rule", key);
  const base = { societyId: refs.societyId, createdByUserId: refs.treasurer.id, createdAtISO: RULES_CREATED_AT, updatedAtISO: RULES_CREATED_AT };
  return [
    {
      _id: id(DEMO_RULE_KEYS.hydro),
      ...base,
      name: "Coastal Hydro to facilities",
      priority: 1,
      enabled: true,
      conditions: [
        { field: "payee", operator: "contains", value: "coastal hydro" },
        { field: "direction", value: "out" },
      ],
      actions: {
        category: "Facilities",
        ...(refs.facilitiesExpenseAccountId ? { accountingAccountId: refs.facilitiesExpenseAccountId } : {}),
        markReviewed: true,
      },
    },
    {
      _id: id(DEMO_RULE_KEYS.bankFee),
      ...base,
      name: "Monthly account fee",
      priority: 2,
      enabled: true,
      conditions: [
        { field: "payee", operator: "contains", value: "riverbank credit union" },
        { field: "direction", value: "out" },
        { field: "amount", operator: "lte", amountCents: 2500 },
      ],
      actions: { category: "Bank & processing fees", markReviewed: true },
    },
    {
      _id: id(DEMO_RULE_KEYS.donations),
      ...base,
      name: "DonorLoop payouts to donations",
      priority: 3,
      enabled: true,
      conditions: [
        { field: "payee", operator: "contains", value: "donorloop" },
        { field: "direction", value: "in" },
      ],
      actions: { category: "Donations" },
    },
    {
      _id: id(DEMO_RULE_KEYS.brushstroke),
      ...base,
      name: "Brushstroke Art Supply to program supplies",
      priority: 4,
      enabled: true,
      conditions: [
        { field: "payee", operator: "contains", value: "brushstroke" },
        { field: "direction", value: "out" },
      ],
      actions: { category: "Program supplies" },
    },
    {
      _id: id(DEMO_RULE_KEYS.greenwayCard),
      ...base,
      name: "Greenway Market on the Visa",
      priority: 5,
      enabled: true,
      conditions: [
        { field: "payee", operator: "contains", value: "greenway market" },
        { field: "account", accountId: refs.cardAccountId },
      ],
      actions: { category: "Program supplies" },
    },
    {
      _id: id(DEMO_RULE_KEYS.cloudnest),
      ...base,
      name: "Cloudnest Workspace subscription",
      priority: 6,
      enabled: true,
      conditions: [{ field: "payee", operator: "equals", value: "cloudnest workspace" }],
      actions: { category: "Office & technology", markReviewed: true },
    },
    {
      _id: id(DEMO_RULE_KEYS.grant),
      ...base,
      name: "Grant fund spending",
      priority: 7,
      enabled: false,
      conditions: [
        { field: "account", accountId: refs.grantAccountId },
        { field: "direction", value: "out" },
      ],
      actions: { category: "Program delivery", ...(refs.fundRestrictionId ? { fundRestrictionId: refs.fundRestrictionId } : {}) },
    },
  ];
}

export type DemoTransactionRule = ReturnType<typeof demoTransactionRules>[number];

/** Bank-feed rows carry `externalId: feed-<key>` in both demos. */
const FEED_PREFIX = "feed-";
const feedKeyOf = (txn: Txn) => {
  const externalId = String(txn.externalId ?? "");
  return externalId.startsWith(FEED_PREFIX) ? externalId.slice(FEED_PREFIX.length) : null;
};
/** Same-day tie-break: the key with separators collapsed (the static demo's id order). */
const feedSortKey = (txn: Txn) => (feedKeyOf(txn) ?? "").replace(/[^a-zA-Z0-9]+/g, "_");
const byDate = (a: Txn, b: Txn) => String(a.date).localeCompare(String(b.date)) || feedSortKey(a).localeCompare(feedSortKey(b));

/**
 * Recurring feed lines that arrived after the last rule run, so "Apply rules
 * to uncategorised" always has something to preview regardless of how far the
 * demo feed runs: the latest Coastal Hydro bill, the latest account fee and the
 * two latest DonorLoop payouts, plus the latest member e-transfer, which no
 * rule covers. (The feed's own recent card spend and
 * e-transfers are already partly uncategorised; some of those match a rule,
 * the member e-transfers and most one-off merchants match none.)
 */
function awaitingRuleRun(transactions: readonly Txn[], refs: DemoFinanceRefs): Txn[] {
  const cash = transactions.filter((t) => String(t.accountId) === String(refs.cashAccountId) && feedKeyOf(t) !== null).sort(byDate);
  const latest = (predicate: (t: Txn) => boolean, count = 1) => cash.filter(predicate).slice(-count);
  return [
    ...latest((t) => t.counterparty === "Coastal Hydro"),
    ...latest((t) => t.counterparty === "Riverbank Credit Union" && t.amountCents < 0 && t.method === "Account fee"),
    ...latest((t) => t.counterparty === "DonorLoop Payments" && t.amountCents > 0, 2),
    // A one-off e-transfer from a member: no rule covers it.
    ...latest((t) => t.method === "Interac e-Transfer" && t.amountCents > 0),
  ];
}

/** Reconciliation stamp for a line cleared on a statement. */
function cleared(atISO: string, note: string, byName: string) {
  return { reconciledAtISO: atISO, reconciledByName: byName, matchedKind: "manual", matchedId: "manual", reconciliationNote: note };
}

const UNMATCH_FIELDS = ["reconciledAtISO", "reconciledByName", "matchedKind", "matchedId", "reconciliationNote"] as const;

/** Statement period keys, plus the feed lines the demo story hinges on. */
export const DEMO_RECONCILIATION_KEYS = {
  janPeriod: "cash_2026_01",
  febPeriod: "cash_2026_02",
  marPeriod: "cash_2026_03",
  restrictedPeriod: "grant_2026_q1",
  /** Unmatched after February was completed, so February reads out of balance. */
  febUnmatchedKey: "telecom-2026-02",
  /** Still to tick off on the March statement; together they are the difference. */
  marUnclearedKeys: ["interest-2026-03", "registration-fees-2026-03"],
} as const;

/**
 * Layers the finance workflows onto the generated feed (mutating the rows in
 * place: categorisation provenance and reconciliation flags only, never
 * amounts, dates or accounts; rules get `lastAppliedAtISO`) and returns the
 * statement periods.
 *
 * Rows must carry the `_id` they are stored under: closed periods snapshot a
 * fingerprint over those ids. `accountBalances` are the accounts' current
 * balances; a statement balance at a date is that balance minus every later
 * transaction, i.e. the feed's own running balance.
 */
export function applyDemoFinanceWorkflows(
  refs: DemoFinanceRefs,
  transactions: Txn[],
  rules: readonly DemoTransactionRule[],
  accountBalances: Record<string, number>,
) {
  const treasurerName = refs.treasurer.name;

  // ---- Categorisation: rule provenance and lines still to review ----------
  const pending = new Set(awaitingRuleRun(transactions, refs));
  const lastApplied = new Map<string, string>();
  for (const txn of transactions) {
    if (pending.has(txn)) {
      delete txn.category;
      continue;
    }
    if (txn.date < RULES_LIVE_FROM || isUncategorized(txn) || isInternalTransfer(txn)) continue;
    const rule = findMatchingRule(rules as unknown as Array<TransactionRuleLike & { _id: string }>, txn as RuleTransaction) as DemoTransactionRule | null;
    if (!rule || rule.actions.category !== txn.category) continue;
    const appliedAtISO = `${txn.date}T18:00:00.000Z`;
    Object.assign(txn, {
      categorizedBy: "rule",
      ruleId: rule._id,
      ruleApplication: { ruleName: rule.name, batchId: `feed-import-${txn.date}`, appliedAtISO, previous: {} },
      ...("accountingAccountId" in rule.actions && rule.actions.accountingAccountId ? { accountingAccountId: rule.actions.accountingAccountId } : {}),
      ...("markReviewed" in rule.actions && rule.actions.markReviewed ? { reviewedAtISO: appliedAtISO } : {}),
    });
    if ((lastApplied.get(rule._id) ?? "") < appliedAtISO) lastApplied.set(rule._id, appliedAtISO);
  }
  for (const rule of rules as Array<DemoTransactionRule & { lastAppliedAtISO?: string }>) {
    const at = lastApplied.get(rule._id);
    if (at) rule.lastAppliedAtISO = at;
  }

  // ---- Reconciliation ------------------------------------------------------
  const lines = transactions as unknown as PeriodTransaction[];
  const sameAccount = (t: Txn, accountId: string) => String(t.accountId) === String(accountId);
  const balanceAtEndOf = (accountId: string, date: string) =>
    (accountBalances[accountId] ?? 0) - transactions.filter((t) => sameAccount(t, accountId) && t.date > date).reduce((sum, t) => sum + t.amountCents, 0);
  const inPeriod = (accountId: string, startDate: string, endDate: string) =>
    transactionsInPeriod(lines, { accountId, startDate, endDate }) as unknown as Txn[];
  const fingerprint = (accountId: string, startDate: string, endDate: string, beginning: number, ending: number) =>
    periodFingerprint(beginning, ending, transactionsInPeriod(lines, { accountId, startDate, endDate }));
  const clearAll = (rows: Txn[], atISO: string, note: string, exceptFeedKeys: ReadonlySet<string> = new Set()) => {
    for (const row of rows) if (!exceptFeedKeys.has(feedKeyOf(row) ?? "")) Object.assign(row, cleared(atISO, note, treasurerName));
  };
  const cash = refs.cashAccountId;
  const grant = refs.grantAccountId;
  const common = { societyId: refs.societyId, createdByUserId: refs.treasurer.id };
  const completedBy = { completedByUserId: refs.treasurer.id, completedByName: treasurerName };
  const K = DEMO_RECONCILIATION_KEYS;

  // January: every line cleared; the statement balances to $0.00.
  const janOpening = balanceAtEndOf(cash, "2025-12-31");
  const janEnding = balanceAtEndOf(cash, "2026-01-31");
  const janRows = inPeriod(cash, "2026-01-01", "2026-01-31");
  clearAll(janRows, "2026-02-04T17:00:00.000Z", "On the January 2026 statement");
  const jan = summarizePeriod(janOpening, janEnding, janRows as unknown as PeriodTransaction[]);

  // February: completed with every line cleared, then the telecom bill was
  // unmatched to attach a corrected invoice, so the snapshot no longer matches.
  const febEnding = balanceAtEndOf(cash, "2026-02-28");
  const febRows = inPeriod(cash, "2026-02-01", "2026-02-28");
  clearAll(febRows, "2026-03-04T17:00:00.000Z", "On the February 2026 statement");
  const febFingerprint = fingerprint(cash, "2026-02-01", "2026-02-28", janEnding, febEnding);
  const feb = summarizePeriod(janEnding, febEnding, febRows as unknown as PeriodTransaction[]);
  const febUnmatched = febRows.find((row) => feedKeyOf(row) === K.febUnmatchedKey);
  if (febUnmatched) for (const field of UNMATCH_FIELDS) delete febUnmatched[field];

  // March: in progress, everything ticked off except two lines.
  const marEnding = balanceAtEndOf(cash, "2026-03-31");
  clearAll(inPeriod(cash, "2026-03-01", "2026-03-31"), "2026-04-03T17:00:00.000Z", "On the March 2026 statement", new Set<string>(K.marUnclearedKeys));

  // Restricted fund: quarterly statement whose lines were all cleared by the
  // feed, so it closed itself as auto-reconciled.
  const grantOpening = balanceAtEndOf(grant, "2025-12-31");
  const grantEnding = balanceAtEndOf(grant, "2026-03-31");
  const grantRows = inPeriod(grant, "2026-01-01", "2026-03-31");
  clearAll(grantRows, "2026-04-02T17:05:00.000Z", "Matched to the bank feed");
  const grantSummary = summarizePeriod(grantOpening, grantEnding, grantRows as unknown as PeriodTransaction[]);

  return [
    {
      _id: refs.idFor("period", K.janPeriod),
      ...common,
      accountId: cash,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      openingBalanceCents: janOpening,
      endingBalanceCents: janEnding,
      status: "completed",
      completedAtISO: "2026-02-04T17:30:00.000Z",
      ...completedBy,
      clearedFingerprint: fingerprint(cash, "2026-01-01", "2026-01-31", janOpening, janEnding),
      clearedCount: jan.clearedCount,
      clearedBalanceCents: jan.clearedBalanceCents,
      createdAtISO: "2026-02-03T17:00:00.000Z",
      updatedAtISO: "2026-02-04T17:30:00.000Z",
    },
    {
      _id: refs.idFor("period", K.febPeriod),
      ...common,
      accountId: cash,
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      endingBalanceCents: febEnding,
      status: "out_of_balance",
      completedAtISO: "2026-03-04T17:30:00.000Z",
      ...completedBy,
      clearedFingerprint: febFingerprint,
      clearedCount: feb.clearedCount,
      clearedBalanceCents: feb.clearedBalanceCents,
      outOfBalanceAtISO: "2026-03-20T16:10:00.000Z",
      notes: "Harbourline Telecom line unmatched on March 20 to attach the corrected invoice; re-clear it to close February again.",
      createdAtISO: "2026-03-03T17:00:00.000Z",
      updatedAtISO: "2026-03-20T16:10:00.000Z",
    },
    {
      _id: refs.idFor("period", K.marPeriod),
      ...common,
      accountId: cash,
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      endingBalanceCents: marEnding,
      status: "in_progress",
      createdAtISO: "2026-04-03T17:00:00.000Z",
      updatedAtISO: "2026-04-03T17:00:00.000Z",
    },
    {
      _id: refs.idFor("period", K.restrictedPeriod),
      ...common,
      accountId: grant,
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      openingBalanceCents: grantOpening,
      endingBalanceCents: grantEnding,
      status: "auto_reconciled",
      completedAtISO: "2026-04-02T17:05:00.000Z",
      ...completedBy,
      clearedFingerprint: fingerprint(grant, "2026-01-01", "2026-03-31", grantOpening, grantEnding),
      clearedCount: grantSummary.clearedCount,
      clearedBalanceCents: grantSummary.clearedBalanceCents,
      notes: "Quarterly statement.",
      createdAtISO: "2026-04-02T17:05:00.000Z",
      updatedAtISO: "2026-04-02T17:05:00.000Z",
    },
  ];
}

export function demoExpenseApprovalRules(refs: DemoFinanceRefs) {
  const at = "2026-01-05T18:00:00.000Z";
  const roles = ["Owner", "Admin", "Director"];
  return [
    { _id: refs.idFor("approvalRule", "base"), societyId: refs.societyId, order: 0, minAmountCents: 0, requiredApprovals: 1, approverRoles: roles, approverUserIds: [], blockSelfApproval: true, enabled: true, label: "Everyday claims", createdAtISO: at, updatedAtISO: at },
    { _id: refs.idFor("approvalRule", "dual"), societyId: refs.societyId, order: 1, minAmountCents: 100_000, requiredApprovals: 2, approverRoles: roles, approverUserIds: [], blockSelfApproval: true, enabled: true, label: "Dual approval", createdAtISO: at, updatedAtISO: at },
  ];
}

export function demoExpenseReports(refs: DemoFinanceRefs) {
  const people = { owner: refs.owner, treasurer: refs.treasurer, secretary: refs.secretary };
  type Person = DemoFinancePerson;
  const vote = (p: Person, atISO: string) => ({ userId: p.id, name: p.name, role: p.role, atISO });
  const step = (p: Person, action: string, atISO: string, note?: string) => ({ atISO, action, actorName: p.name, actorUserId: p.id, ...(note ? { note } : {}) });
  const claim = (key: string, p: Person, fields: Record<string, any>) => ({
    _id: refs.idFor("expense", key),
    societyId: refs.societyId,
    claimantName: p.name,
    claimantUserId: p.id,
    currency: "CAD",
    createdAtISO: `${fields.incurredAtISO}T16:00:00.000Z`,
    updatedAtISO: `${fields.submittedAtISO ?? fields.incurredAtISO}T16:00:00.000Z`,
    ...fields,
  });
  return [
    claim("kitchen_deposit", people.treasurer, {
      title: "Community kitchen booking deposit",
      category: "Facility",
      amountCents: 145000,
      incurredAtISO: "2026-04-08",
      submittedAtISO: "2026-04-09",
      status: "Submitted",
      requiredApprovals: 2,
      approvals: [vote(people.secretary, "2026-04-10T15:20:00.000Z")],
      approvalTrail: [
        step(people.treasurer, "submitted", "2026-04-09T16:00:00.000Z"),
        step(people.secretary, "approved", "2026-04-10T15:20:00.000Z", "1 of 2 approvals"),
      ],
      notes: "Deposit for the summer meal program kitchen.",
      ...(refs.receiptDocumentId ? { receiptDocumentId: refs.receiptDocumentId } : {}),
    }),
    // Both dual-approval claims belong to the treasurer (a director with
    // read-only finance access), so under the default approver access the two
    // finance writers (owner and secretary/admin) can complete them without
    // approving their own claim.
    claim("appreciation_dinner", people.treasurer, {
      title: "Volunteer appreciation dinner",
      category: "Meals",
      amountCents: 128000,
      incurredAtISO: "2026-04-11",
      submittedAtISO: "2026-04-13",
      status: "Submitted",
      requiredApprovals: 2,
      approvals: [],
      approvalTrail: [step(people.treasurer, "submitted", "2026-04-13T18:00:00.000Z")],
    }),
    claim("printer_toner", people.owner, {
      title: "Printer toner",
      category: "Supplies",
      amountCents: 6499,
      incurredAtISO: "2026-04-14",
      submittedAtISO: "2026-04-15",
      status: "Submitted",
      requiredApprovals: 1,
      approvals: [],
      approvalTrail: [step(people.owner, "submitted", "2026-04-15T17:00:00.000Z")],
    }),
    claim("bus_rental", people.treasurer, {
      title: "Youth workshop bus rental",
      category: "Travel",
      amountCents: 62000,
      incurredAtISO: "2026-03-28",
      submittedAtISO: "2026-03-30",
      status: "Approved",
      requiredApprovals: 1,
      approvals: [vote(people.owner, "2026-03-31T16:45:00.000Z")],
      approverUserId: people.owner.id,
      approvedAtISO: "2026-03-31T16:45:00.000Z",
      approvalTrail: [
        step(people.treasurer, "submitted", "2026-03-30T16:00:00.000Z"),
        step(people.owner, "approved", "2026-03-31T16:45:00.000Z", "1 of 1 approval"),
      ],
    }),
    claim("zoom_plan", people.secretary, {
      title: "Video meeting annual plan",
      category: "Software",
      amountCents: 21900,
      incurredAtISO: "2026-02-02",
      submittedAtISO: "2026-02-03",
      status: "Paid",
      requiredApprovals: 1,
      approvals: [vote(people.owner, "2026-02-04T15:00:00.000Z")],
      approverUserId: people.owner.id,
      approvedAtISO: "2026-02-04T15:00:00.000Z",
      paidAtISO: "2026-02-06T19:00:00.000Z",
      paymentReference: "EFT 2291",
      approvalTrail: [
        step(people.secretary, "submitted", "2026-02-03T16:00:00.000Z"),
        step(people.owner, "approved", "2026-02-04T15:00:00.000Z", "1 of 1 approval"),
        step(people.treasurer, "paid", "2026-02-06T19:00:00.000Z", "EFT 2291"),
      ],
    }),
    claim("conference_travel", people.treasurer, {
      title: "Sector conference travel",
      category: "Travel",
      amountCents: 94000,
      incurredAtISO: "2026-03-10",
      submittedAtISO: "2026-03-11",
      status: "Rejected",
      requiredApprovals: 1,
      approvals: [],
      declinedReason: "Not in this year's budget. Resubmit with the board motion that approved it.",
      declinedByUserId: people.owner.id,
      declinedAtISO: "2026-03-12T17:00:00.000Z",
      approvalTrail: [
        step(people.treasurer, "submitted", "2026-03-11T16:00:00.000Z"),
        step(people.owner, "declined", "2026-03-12T17:00:00.000Z", "Not in this year's budget. Resubmit with the board motion that approved it."),
      ],
    }),
    claim("raffle_cards", people.secretary, {
      title: "Gift cards for raffle prizes",
      category: "Program",
      amountCents: 15000,
      incurredAtISO: "2026-03-20",
      submittedAtISO: "2026-03-21",
      status: "Recalled",
      approvals: [],
      approvalTrail: [
        step(people.secretary, "submitted", "2026-03-21T16:00:00.000Z"),
        step(people.secretary, "recalled", "2026-03-22T10:00:00.000Z", "Wrong receipt attached"),
      ],
    }),
    claim("office_chair", people.owner, {
      title: "Office chair for the front desk",
      category: "Supplies",
      amountCents: 18900,
      incurredAtISO: "2026-04-16",
      status: "Draft",
      approvals: [],
    }),
    claim("mileage_april", people.owner, {
      title: "Mileage, April program visits",
      category: "Travel",
      amountCents: 7240,
      incurredAtISO: "2026-04-18",
      status: "Draft",
      approvals: [],
    }),
  ];
}

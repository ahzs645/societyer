/**
 * Demo data for the finance workflows: categorisation rules, statement
 * reconciliation periods (completed, auto-reconciled, out of balance and in
 * progress) and expense claims in every approval state.
 *
 * Fingerprints for closed periods are computed from the same shared code the
 * runtime uses, so the demo's "balances no longer match" period is exactly the
 * one whose lines changed after completion.
 */
import { periodFingerprint, transactionsInPeriod, type PeriodTransaction } from "../../shared/reconciliationPeriods";

type Ids = {
  societyId: string;
  connectionId: string;
  cashAccountId: string;
  grantAccountId: string;
  facilitiesExpenseAccountId: string;
  fundRestrictionId: string;
  ownerId: string;
  treasurerId: string;
  secretaryId: string;
  receiptDocumentId: string;
};

const RULE_HYDRO = "static_rule_bc_hydro";
const RULE_SQUARE = "static_rule_square";
const RULE_FEES = "static_rule_bank_fees";
const RULE_GRANT = "static_rule_grant_spending";

const reconciled = (atISO: string, note: string, kind = "manual") => ({
  reconciledAtISO: atISO,
  reconciledByName: "Jordan Lee",
  matchedKind: kind,
  matchedId: kind,
  reconciliationNote: note,
});

const ruled = (ruleId: string, ruleName: string, appliedAtISO: string) => ({
  categorizedBy: "rule",
  ruleId,
  ruleApplication: { ruleName, batchId: `import-${appliedAtISO}`, appliedAtISO, previous: {} },
});

/** Existing ledger lines that the demo statements have already cleared. */
export const DEMO_RECONCILED_TRANSACTION_IDS: Record<string, ReturnType<typeof reconciled>> = {
  static_tx_org_utilities: reconciled("2026-02-03T17:00:00.000Z", "On January statement"),
  static_tx_org_interest: reconciled("2026-04-03T17:00:00.000Z", "Interest on March statement"),
  static_tx_org_restricted_delivery: reconciled("2026-03-02T17:00:00.000Z", "Grant program delivery cheque"),
};

export function financeWorkflowTransactions(ids: Ids): Array<Record<string, any>> {
  const base = (key: string, accountId: string, date: string, description: string, amountCents: number, extra: Record<string, any> = {}) => ({
    _id: `static_tx_${key}`,
    societyId: ids.societyId,
    connectionId: ids.connectionId,
    accountId,
    externalId: `csv-${key}`,
    date,
    description,
    amountCents,
    ...extra,
  });
  const cash = ids.cashAccountId;
  return [
    // January statement (completed)
    base("jan_hydro", cash, "2026-01-14", "BC HYDRO 0042 PAYMENT", -8421, {
      category: "Utilities",
      accountingAccountId: ids.facilitiesExpenseAccountId,
      reviewedAtISO: "2026-01-16T18:00:00.000Z",
      ...ruled(RULE_HYDRO, "BC Hydro to utilities", "2026-01-16T18:00:00.000Z"),
      ...reconciled("2026-02-03T17:00:00.000Z", "On January statement"),
    }),
    base("jan_donation", cash, "2026-01-20", "E-TRANSFER DEPOSIT M CHEN", 25000, {
      category: "Donations",
      counterparty: "M. Chen",
      categorizedBy: "manual",
      ...reconciled("2026-02-03T17:00:00.000Z", "Donation, receipt issued"),
    }),
    // February statement (completed, then a back-dated cheque was added)
    base("feb_hydro", cash, "2026-02-13", "BC HYDRO 0043 PAYMENT", -8730, {
      category: "Utilities",
      accountingAccountId: ids.facilitiesExpenseAccountId,
      reviewedAtISO: "2026-02-15T18:00:00.000Z",
      ...ruled(RULE_HYDRO, "BC Hydro to utilities", "2026-02-15T18:00:00.000Z"),
      ...reconciled("2026-03-04T17:00:00.000Z", "On February statement"),
    }),
    base("feb_square", cash, "2026-02-17", "SQUARE DEPOSIT 7781", 46500, {
      category: "Registration fees",
      ...ruled(RULE_SQUARE, "Square deposits to registration fees", "2026-02-18T18:00:00.000Z"),
      ...reconciled("2026-03-04T17:00:00.000Z", "Workshop registrations"),
    }),
    base("feb_fee", cash, "2026-02-27", "MONTHLY ACCOUNT FEE", -1500, {
      category: "Bank charges",
      reviewedAtISO: "2026-02-28T18:00:00.000Z",
      ...ruled(RULE_FEES, "Small bank fees", "2026-02-28T18:00:00.000Z"),
      ...reconciled("2026-03-04T17:00:00.000Z", "Bank fee"),
    }),
    base("feb_late_cheque", cash, "2026-02-21", "CHQ 1043 RIVERSIDE HALL DEPOSIT", -25000, {
      category: "Rent",
      categorizedBy: "manual",
    }),
    // March statement (in progress)
    base("mar_shaw", cash, "2026-03-05", "SHAW BUSINESS INTERNET 03/26", -11200, {
      ...reconciled("2026-04-03T17:00:00.000Z", "Internet service"),
    }),
    base("mar_hydro", cash, "2026-03-13", "BC HYDRO 0044 PAYMENT", -8105),
    base("mar_square", cash, "2026-03-18", "SQUARE DEPOSIT 7790", 38250),
    base("mar_fee", cash, "2026-03-31", "MONTHLY ACCOUNT FEE", -1500, {
      ...reconciled("2026-04-03T17:00:00.000Z", "Bank fee"),
    }),
    // April, not yet reconciled
    base("apr_shaw", cash, "2026-04-06", "SHAW BUSINESS INTERNET 04/26", -11200),
    base("apr_hydro", cash, "2026-04-14", "BC HYDRO 0045 PAYMENT", -7990),
    base("apr_square", cash, "2026-04-15", "SQUARE DEPOSIT 7802", 41000),
  ];
}

export function financeWorkflowRules(ids: Ids) {
  const at = "2026-01-10T18:00:00.000Z";
  return [
    {
      _id: RULE_HYDRO,
      societyId: ids.societyId,
      name: "BC Hydro to utilities",
      priority: 1,
      enabled: true,
      conditions: [
        { field: "payee", operator: "contains", value: "bc hydro" },
        { field: "direction", value: "out" },
      ],
      actions: { category: "Utilities", accountingAccountId: ids.facilitiesExpenseAccountId, markReviewed: true },
      createdByUserId: ids.treasurerId,
      lastAppliedAtISO: "2026-02-15T18:00:00.000Z",
      createdAtISO: at,
      updatedAtISO: at,
    },
    {
      _id: RULE_SQUARE,
      societyId: ids.societyId,
      name: "Square deposits to registration fees",
      priority: 2,
      enabled: true,
      conditions: [
        { field: "description", operator: "starts_with", value: "square deposit" },
        { field: "direction", value: "in" },
      ],
      actions: { category: "Registration fees" },
      createdByUserId: ids.treasurerId,
      lastAppliedAtISO: "2026-02-18T18:00:00.000Z",
      createdAtISO: at,
      updatedAtISO: at,
    },
    {
      _id: RULE_FEES,
      societyId: ids.societyId,
      name: "Small bank fees",
      priority: 3,
      enabled: true,
      conditions: [
        { field: "description", operator: "contains", value: "account fee" },
        { field: "amount", operator: "lte", amountCents: 2500 },
      ],
      actions: { category: "Bank charges", markReviewed: true },
      createdByUserId: ids.treasurerId,
      lastAppliedAtISO: "2026-02-28T18:00:00.000Z",
      createdAtISO: at,
      updatedAtISO: at,
    },
    {
      _id: RULE_GRANT,
      societyId: ids.societyId,
      name: "Grant fund spending",
      priority: 4,
      enabled: false,
      conditions: [
        { field: "account", accountId: ids.grantAccountId },
        { field: "direction", value: "out" },
      ],
      actions: { category: "Program delivery", fundRestrictionId: ids.fundRestrictionId },
      createdByUserId: ids.treasurerId,
      createdAtISO: at,
      updatedAtISO: at,
    },
  ];
}

export function financeWorkflowReconciliationPeriods(ids: Ids, transactions: readonly Record<string, any>[]) {
  const lines = transactions as unknown as PeriodTransaction[];
  const fingerprint = (accountId: string, startDate: string, endDate: string, beginning: number, ending: number, exclude: string[] = []) =>
    periodFingerprint(beginning, ending, transactionsInPeriod(lines.filter((t) => !exclude.includes(String(t._id))), { accountId, startDate, endDate }));
  const cash = ids.cashAccountId;
  const janOpening = 3_000_000;
  const janEnding = janOpening - 8421 + 25000 - 90000;
  const febEnding = janEnding - 8730 + 46500 - 1500;
  const marEnding = febEnding - 11200 - 8105 + 38250 + 12500 - 1500;
  const grantOpening = 2_500_000;
  const grantEnding = grantOpening - 380000;
  const common = { societyId: ids.societyId, createdByUserId: ids.treasurerId };
  return [
    {
      _id: "static_recon_cash_2026_01",
      ...common,
      accountId: cash,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      openingBalanceCents: janOpening,
      endingBalanceCents: janEnding,
      status: "completed",
      completedAtISO: "2026-02-03T17:30:00.000Z",
      completedByUserId: ids.treasurerId,
      completedByName: "Jordan Lee",
      clearedFingerprint: fingerprint(cash, "2026-01-01", "2026-01-31", janOpening, janEnding),
      clearedCount: 3,
      clearedBalanceCents: janEnding,
      createdAtISO: "2026-02-02T17:00:00.000Z",
      updatedAtISO: "2026-02-03T17:30:00.000Z",
    },
    {
      _id: "static_recon_cash_2026_02",
      ...common,
      accountId: cash,
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      endingBalanceCents: febEnding,
      // Completed before the back-dated hall cheque was entered.
      status: "out_of_balance",
      completedAtISO: "2026-03-04T17:30:00.000Z",
      completedByUserId: ids.treasurerId,
      completedByName: "Jordan Lee",
      clearedFingerprint: fingerprint(cash, "2026-02-01", "2026-02-28", janEnding, febEnding, ["static_tx_feb_late_cheque"]),
      clearedCount: 3,
      clearedBalanceCents: febEnding,
      outOfBalanceAtISO: "2026-03-20T16:10:00.000Z",
      notes: "Statement PDF filed with the February board packet.",
      createdAtISO: "2026-03-03T17:00:00.000Z",
      updatedAtISO: "2026-03-20T16:10:00.000Z",
    },
    {
      _id: "static_recon_cash_2026_03",
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
      _id: "static_recon_grant_2026_02",
      ...common,
      accountId: ids.grantAccountId,
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      openingBalanceCents: grantOpening,
      endingBalanceCents: grantEnding,
      status: "auto_reconciled",
      completedAtISO: "2026-03-02T17:05:00.000Z",
      completedByUserId: ids.treasurerId,
      completedByName: "Jordan Lee",
      clearedFingerprint: fingerprint(ids.grantAccountId, "2026-02-01", "2026-02-28", grantOpening, grantEnding),
      clearedCount: 1,
      clearedBalanceCents: grantEnding,
      createdAtISO: "2026-03-02T17:05:00.000Z",
      updatedAtISO: "2026-03-02T17:05:00.000Z",
    },
  ];
}

export function financeWorkflowApprovalRules(ids: Ids) {
  const at = "2026-01-05T18:00:00.000Z";
  const roles = ["Owner", "Admin", "Director"];
  return [
    { _id: "static_approval_rule_base", societyId: ids.societyId, order: 0, minAmountCents: 0, requiredApprovals: 1, approverRoles: roles, approverUserIds: [], blockSelfApproval: true, enabled: true, label: "Everyday claims", createdAtISO: at, updatedAtISO: at },
    { _id: "static_approval_rule_dual", societyId: ids.societyId, order: 1, minAmountCents: 100_000, requiredApprovals: 2, approverRoles: roles, approverUserIds: [], blockSelfApproval: true, enabled: true, label: "Dual approval", createdAtISO: at, updatedAtISO: at },
  ];
}

export function financeWorkflowExpenseReports(ids: Ids) {
  const people = {
    mina: { id: ids.ownerId, name: "Mina Patel", role: "Owner" },
    jordan: { id: ids.treasurerId, name: "Jordan Lee", role: "Director" },
    avery: { id: ids.secretaryId, name: "Avery Santos", role: "Admin" },
  };
  type Person = (typeof people)[keyof typeof people];
  const vote = (p: Person, atISO: string) => ({ userId: p.id, name: p.name, role: p.role, atISO });
  const step = (p: Person, action: string, atISO: string, note?: string) => ({ atISO, action, actorName: p.name, actorUserId: p.id, ...(note ? { note } : {}) });
  const claim = (key: string, p: Person, fields: Record<string, any>) => ({
    _id: `static_expense_${key}`,
    societyId: ids.societyId,
    claimantName: p.name,
    claimantUserId: p.id,
    currency: "CAD",
    createdAtISO: `${fields.incurredAtISO}T16:00:00.000Z`,
    updatedAtISO: `${fields.submittedAtISO ?? fields.incurredAtISO}T16:00:00.000Z`,
    ...fields,
  });
  return [
    claim("kitchen_deposit", people.jordan, {
      title: "Community kitchen booking deposit",
      category: "Facility",
      amountCents: 145000,
      incurredAtISO: "2026-04-08",
      submittedAtISO: "2026-04-09",
      status: "Submitted",
      requiredApprovals: 2,
      approvals: [vote(people.avery, "2026-04-10T15:20:00.000Z")],
      approvalTrail: [
        step(people.jordan, "submitted", "2026-04-09T16:00:00.000Z"),
        step(people.avery, "approved", "2026-04-10T15:20:00.000Z", "1 of 2 approvals"),
      ],
      notes: "Deposit for the summer meal program kitchen.",
      receiptDocumentId: ids.receiptDocumentId,
    }),
    claim("appreciation_dinner", people.avery, {
      title: "Volunteer appreciation dinner",
      category: "Meals",
      amountCents: 128000,
      incurredAtISO: "2026-04-11",
      submittedAtISO: "2026-04-13",
      status: "Submitted",
      requiredApprovals: 2,
      approvals: [],
      approvalTrail: [step(people.avery, "submitted", "2026-04-13T18:00:00.000Z")],
    }),
    claim("printer_toner", people.mina, {
      title: "Printer toner",
      category: "Supplies",
      amountCents: 6499,
      incurredAtISO: "2026-04-14",
      submittedAtISO: "2026-04-15",
      status: "Submitted",
      requiredApprovals: 1,
      approvals: [],
      approvalTrail: [step(people.mina, "submitted", "2026-04-15T17:00:00.000Z")],
    }),
    claim("bus_rental", people.jordan, {
      title: "Youth workshop bus rental",
      category: "Travel",
      amountCents: 62000,
      incurredAtISO: "2026-03-28",
      submittedAtISO: "2026-03-30",
      status: "Approved",
      requiredApprovals: 1,
      approvals: [vote(people.mina, "2026-03-31T16:45:00.000Z")],
      approverUserId: people.mina.id,
      approvedAtISO: "2026-03-31T16:45:00.000Z",
      approvalTrail: [
        step(people.jordan, "submitted", "2026-03-30T16:00:00.000Z"),
        step(people.mina, "approved", "2026-03-31T16:45:00.000Z", "1 of 1 approval"),
      ],
    }),
    claim("zoom_plan", people.avery, {
      title: "Video meeting annual plan",
      category: "Software",
      amountCents: 21900,
      incurredAtISO: "2026-02-02",
      submittedAtISO: "2026-02-03",
      status: "Paid",
      requiredApprovals: 1,
      approvals: [vote(people.mina, "2026-02-04T15:00:00.000Z")],
      approverUserId: people.mina.id,
      approvedAtISO: "2026-02-04T15:00:00.000Z",
      paidAtISO: "2026-02-06T19:00:00.000Z",
      paymentReference: "EFT 2291",
      approvalTrail: [
        step(people.avery, "submitted", "2026-02-03T16:00:00.000Z"),
        step(people.mina, "approved", "2026-02-04T15:00:00.000Z", "1 of 1 approval"),
        step(people.jordan, "paid", "2026-02-06T19:00:00.000Z", "EFT 2291"),
      ],
    }),
    claim("conference_travel", people.jordan, {
      title: "Sector conference travel",
      category: "Travel",
      amountCents: 94000,
      incurredAtISO: "2026-03-10",
      submittedAtISO: "2026-03-11",
      status: "Rejected",
      requiredApprovals: 1,
      approvals: [],
      declinedReason: "Not in this year's budget. Resubmit with the board motion that approved it.",
      declinedByUserId: people.mina.id,
      declinedAtISO: "2026-03-12T17:00:00.000Z",
      approvalTrail: [
        step(people.jordan, "submitted", "2026-03-11T16:00:00.000Z"),
        step(people.mina, "declined", "2026-03-12T17:00:00.000Z", "Not in this year's budget. Resubmit with the board motion that approved it."),
      ],
    }),
    claim("raffle_cards", people.avery, {
      title: "Gift cards for raffle prizes",
      category: "Program",
      amountCents: 15000,
      incurredAtISO: "2026-03-20",
      submittedAtISO: "2026-03-21",
      status: "Recalled",
      approvals: [],
      approvalTrail: [
        step(people.avery, "submitted", "2026-03-21T16:00:00.000Z"),
        step(people.avery, "recalled", "2026-03-22T10:00:00.000Z", "Wrong receipt attached"),
      ],
    }),
    claim("office_chair", people.mina, {
      title: "Office chair for the front desk",
      category: "Supplies",
      amountCents: 18900,
      incurredAtISO: "2026-04-16",
      status: "Draft",
      approvals: [],
    }),
    claim("mileage_april", people.mina, {
      title: "Mileage, April program visits",
      category: "Travel",
      amountCents: 7240,
      incurredAtISO: "2026-04-18",
      status: "Draft",
      approvals: [],
    }),
  ];
}

/**
 * The in-browser demo's finance workflows: categorisation rules, statement
 * reconciliation periods and expense claims in every approval state.
 *
 * The data itself comes from shared/demoData/financeWorkflows.ts, which the
 * server seed (shared/functions/seed.ts) also uses; this module only fixes the
 * static demo's ids and people.
 */
import {
  applyDemoFinanceWorkflows,
  DEMO_RECONCILIATION_KEYS,
  demoExpenseApprovalRules,
  demoExpenseClaimPolicy,
  demoExpenseReports,
  demoTransactionRules,
  type DemoFinanceIdKind,
  type DemoFinanceRefs,
  type DemoTransactionRule,
} from "../../shared/demoData/financeWorkflows";
import {
  applyDemoLinesAndTags,
  demoFinanceTagGroups,
  demoFinanceTags,
  type DemoBooksTagIdKind,
} from "../../shared/demoData/booksTags";
import {
  demoBankAccountProfiles,
  demoPettyCashAccount,
  demoReceiptInbox,
  demoSpendBudgetClaims,
  demoSpendBudgets,
  type DemoBankingRefs,
} from "../../shared/demoData/banking";
import { todayDateOnly } from "../../shared/dateOnly";

type Ids = {
  societyId: string;
  connectionId: string;
  cashAccountId: string;
  grantAccountId: string;
  cardAccountId: string;
  facilitiesExpenseAccountId: string;
  fundRestrictionId: string;
  ownerId: string;
  treasurerId: string;
  secretaryId: string;
  receiptDocumentId: string;
};

type Txn = Record<string, any>;

const STATIC_ID_PREFIX: Record<DemoFinanceIdKind, string> = {
  rule: "static_rule_",
  period: "static_recon_",
  approvalRule: "static_approval_rule_",
  expense: "static_expense_",
  claimPolicy: "static_claim_policy_",
  account: "static_financial_",
  accountProfile: "static_bank_profile_",
  receiptDocument: "static_receipt_document_",
  receiptInbox: "static_receipt_inbox_",
  spendBudget: "static_spend_budget_",
};

function staticRefs(ids: Ids): DemoFinanceRefs {
  return {
    societyId: ids.societyId,
    cashAccountId: ids.cashAccountId,
    grantAccountId: ids.grantAccountId,
    cardAccountId: ids.cardAccountId,
    facilitiesExpenseAccountId: ids.facilitiesExpenseAccountId,
    fundRestrictionId: ids.fundRestrictionId,
    owner: { id: ids.ownerId, name: "Mina Patel", role: "Owner" },
    treasurer: { id: ids.treasurerId, name: "Jordan Lee", role: "Director" },
    secretary: { id: ids.secretaryId, name: "Avery Santos", role: "Admin" },
    receiptDocumentId: ids.receiptDocumentId,
    idFor: (kind, key) => `${STATIC_ID_PREFIX[kind]}${key}`,
  };
}

export function financeWorkflowRules(ids: Ids) {
  return demoTransactionRules(staticRefs(ids));
}

/** Statement period ids, plus the feed lines the demo story hinges on. */
export const DEMO_RECONCILIATION = {
  janPeriodId: `static_recon_${DEMO_RECONCILIATION_KEYS.janPeriod}`,
  febPeriodId: `static_recon_${DEMO_RECONCILIATION_KEYS.febPeriod}`,
  marPeriodId: `static_recon_${DEMO_RECONCILIATION_KEYS.marPeriod}`,
  restrictedPeriodId: `static_recon_${DEMO_RECONCILIATION_KEYS.restrictedPeriod}`,
  /** Unmatched after February was completed, so February reads out of balance. */
  febUnmatchedKey: DEMO_RECONCILIATION_KEYS.febUnmatchedKey,
  /** Still to tick off on the March statement; together they are the difference. */
  marUnclearedKeys: DEMO_RECONCILIATION_KEYS.marUnclearedKeys,
} as const;

export const feedTransactionId = (key: string) => `static_tx_feed_${key.replace(/[^a-zA-Z0-9]+/g, "_")}`;

/**
 * Layers the finance workflows onto the generated feed (categorisation
 * provenance and reconciliation flags only) and returns the statement periods.
 */
export function applyFinanceWorkflowsToFeed(
  ids: Ids,
  transactions: Txn[],
  rules: readonly DemoTransactionRule[],
  accountBalances: Record<string, number>,
) {
  return applyDemoFinanceWorkflows(staticRefs(ids), transactions, rules, accountBalances);
}

export function financeWorkflowApprovalRules(ids: Ids) {
  return demoExpenseApprovalRules(staticRefs(ids));
}

export function financeWorkflowExpenseReports(ids: Ids) {
  return demoExpenseReports(staticRefs(ids));
}

export function financeWorkflowClaimPolicy(ids: Ids) {
  return [demoExpenseClaimPolicy(staticRefs(ids))];
}

const STATIC_TAG_ID_PREFIX: Record<DemoBooksTagIdKind, string> = {
  tagGroup: "static_tag_group_",
  tag: "static_tag_",
};

const staticTagRefs = (societyId: string) => ({
  societyId,
  idFor: (kind: DemoBooksTagIdKind, key: string) => `${STATIC_TAG_ID_PREFIX[kind]}${key}`,
});

/** Tag groups (Program, Grant, Event) and their tags. */
export function financeTagFixtures(societyId: string) {
  const refs = staticTagRefs(societyId);
  return { financeTagGroups: demoFinanceTagGroups(refs), financeTags: demoFinanceTags(refs) };
}

/** Layers the split lines, tags and review state onto the feed (after the finance workflows). */
export function applyLinesAndTagsToFeed(societyId: string, transactions: Txn[]) {
  const refs = staticTagRefs(societyId);
  applyDemoLinesAndTags(transactions, (key) => refs.idFor("tag", key));
}

type Row = Record<string, unknown>;

/**
 * Banking demo (shared/demoData/banking.ts): account details and a manual
 * petty cash account, a receipt inbox picked from the bank feed, spend budgets
 * and the claims charged to them. Appends to the fixture tables.
 */
export function mergeBankingDemo(tables: Record<string, Row[]>, ids: Ids & { financeCommitteeId: string }, today = todayDateOnly()) {
  const refs: DemoBankingRefs = { ...staticRefs(ids), connectionId: ids.connectionId, financeCommitteeId: ids.financeCommitteeId, today };
  const feed = (tables.financialTransactions ?? []).filter((row) => String(row._id).startsWith("static_tx_feed_")) as Array<Row & { _id: string; accountId: string; date: string; amountCents: number }>;
  const inbox = demoReceiptInbox(refs, feed);
  const append = (table: string, rows: readonly Row[]) => {
    tables[table] = [...(tables[table] ?? []), ...rows];
  };
  append("financialAccounts", [demoPettyCashAccount(refs)]);
  append("bankAccountProfiles", demoBankAccountProfiles(refs));
  append("documents", inbox.documents);
  append("receiptInboxItems", inbox.items);
  append("spendBudgets", demoSpendBudgets(refs));
  append("expenseReports", demoSpendBudgetClaims(refs));
}

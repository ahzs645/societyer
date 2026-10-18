/**
 * The server seed (shared/functions/seed.ts, `npm run convex:seed`) tells the
 * same finance story as the in-browser demo: transaction rules with provenance
 * on the feed, reconciliation periods, expense approval rules and claims, and
 * the invoicing and bills demos (invoices in the books included). It also seeds the three corporation personas of the demo
 * banner (shared/demoData/corporations.ts), which the in-browser demo creates
 * when a persona is chosen. Both come from shared/demoData generators; this gate
 * runs the real `seed:run` mutation on convex-test (schema-validated, no user
 * identity, like the maintenance endpoint) and compares the result with the
 * static fixtures through the same portable queries the app uses.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import * as recon from "../shared/functions/reconciliation";
import * as rules from "../shared/functions/transactionRules";
import * as exp from "../shared/functions/expenseReports";
import * as inv from "../shared/functions/invoices";
import * as billFns from "../shared/functions/bills";
import * as registers from "../shared/functions/businessRegisters";
import { demoExpenseReports } from "../shared/demoData/financeWorkflows";
import { DEMO_RECONCILIATION_KEYS } from "../shared/demoData/financeWorkflows";
import { tables as staticTables } from "../src/lib/staticConvexFixtures";
import { CORPORATION_DEMO_KEYS, CORPORATION_STORIES, buildCorporationDemo, corporationDemoLocalSeed } from "../shared/demoData/corporations";
import * as votingPowerFns from "../shared/functions/votingPower";
import * as dividendFns from "../shared/functions/dividends";
import * as resolutionFns from "../shared/functions/writtenResolutions";
import * as certificateFns from "../shared/functions/shareCertificates";
import * as settingsFns from "../shared/functions/corporationSettings";
import * as accountingFns from "../shared/functions/accounting";
import { todayDateOnly } from "../shared/dateOnly";
import { demoAsOfDate } from "../shared/demoData/prng";

const TOKEN = "seed-parity-token";
process.env.SOCIETYER_MAINTENANCE_TOKEN = TOKEN;

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./seed.js": () => import("../convex/seed"),
});
const seedApi = (api as any).seed;
const tableNames = Object.keys((schema as any).tables) as string[];
const dumpAll = () =>
  t.run(async (ctx: any) => {
    const out: Record<string, any[]> = {};
    for (const table of tableNames) {
      const rows = await ctx.db.query(table).collect();
      if (rows.length) out[table] = rows;
    }
    return out;
  });
const counts = (dump: Record<string, any[]>) => Object.fromEntries(Object.entries(dump).map(([table, rows]) => [table, rows.length]));

/* ------------------------------------------------- seed, re-seed and reset */

const { societyId: S } = await t.mutation(seedApi.run, { serviceToken: TOKEN });
const serverAll = await dumpAll();
// The finance story below is Riverside's; the corporation demos are checked separately.
const server = Object.fromEntries(Object.entries(serverAll).map(([table, rows]) => [table, table === "societies" ? rows.filter((row) => row._id === S) : rows.filter((row) => !("societyId" in row) || row.societyId === S)]));
await t.mutation(seedApi.run, { serviceToken: TOKEN });
const reseeded = await dumpAll();
assert.deepEqual(counts(reseeded), counts(serverAll), "re-running the seed replaces the demo instead of duplicating rows");
await t.mutation(seedApi.reset, { serviceToken: TOKEN });
assert.deepEqual(counts(await dumpAll()), {}, "seed:reset leaves no seeded rows behind");

assert.ok(
  !JSON.stringify(serverAll).includes("seed-ref:"),
  "every generated reference was swapped for a real id",
);

/* ------------------------------------------------- portable views of both */

function portableCtx(dump: Record<string, any[]>, ownerName: string) {
  const seed: Record<string, any[]> = JSON.parse(JSON.stringify(dump));
  seed.users = seed.users.map((u: any) => ({ ...u, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${u._id}` }));
  const owner = seed.users.find((u: any) => u.displayName === ownerName) ?? seed.users[0];
  const db = new MemoryDb({ seed });
  const ctx: any = {
    db,
    principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${owner._id}`, issuer: "https://issuer.test", userId: owner._id, societyId: owner.societyId },
    capabilities: makeCapabilities({}),
    runQuery: async () => { throw new Error("nested"); },
  };
  return { db, ctx, societyId: owner.societyId as string, seed };
}

const staticDump = staticTables as Record<string, any[]>;
const A = portableCtx(staticDump, "Mina Patel");
const B = portableCtx(server, "Elena Vasquez");
assert.equal(B.societyId, S);

/* ------------------------------------------------- table counts */

const claimKeys = new Set(
  demoExpenseReports({
    societyId: "", cashAccountId: "", grantAccountId: "", cardAccountId: "",
    owner: { id: "", name: "", role: "" }, treasurer: { id: "", name: "", role: "" }, secretary: { id: "", name: "", role: "" },
    idFor: (_kind, key) => `static_expense_${key}`,
  }).map((row) => row._id),
);
// The invoicing story's renewals fall on the 5th, 12th, 19th and 26th of this
// month; the register's own subscriptions renew on March 31.
const isRenewal = (row: any) => /-(05|12|19|26)T23:59:59\.000Z$/.test(String(row.currentPeriodEndISO ?? ""));
const subsets: Record<string, { static: (row: any) => boolean; server: (row: any) => boolean }> = {
  transactionRules: { static: () => true, server: () => true },
  reconciliationPeriods: { static: () => true, server: () => true },
  expenseApprovalRules: { static: () => true, server: () => true },
  expenseClaimPolicy: { static: () => true, server: () => true },
  expenseReports: { static: (row) => claimKeys.has(row._id), server: () => true },
  invoices: { static: () => true, server: () => true },
  invoiceCatalogItems: { static: () => true, server: () => true },
  invoiceSeries: { static: () => true, server: () => true },
  invoiceSettings: { static: () => true, server: () => true },
  accountingCounterparties: { static: (row) => row.kind === "customer", server: (row) => row.kind === "customer" },
  bills: { static: () => true, server: () => true },
  "accountingCounterparties (vendors)": { static: (row) => String(row._id).startsWith("static_vendor_"), server: (row) => row.kind === "vendor" },
  "financialTransactions (bill payments)": { static: (row) => String(row.externalId).startsWith("csv-bill-"), server: (row) => String(row.externalId).startsWith("csv-bill-") },
  "journalEntries (bills)": { static: (row) => String(row.source).startsWith("bill"), server: (row) => String(row.source).startsWith("bill") },
  // The invoicing demo in the books (shared/demoData/invoiceLedger.ts).
  "journalEntries (invoices)": { static: (row) => String(row.source).startsWith("invoice"), server: (row) => String(row.source).startsWith("invoice") },
  "financialTransactions (matched to invoices)": { static: (row) => row.matchedKind === "invoice", server: (row) => row.matchedKind === "invoice" },
  organizationIdentifiers: { static: (row) => row.kind === "gst", server: () => true },
  fundRestrictions: { static: () => true, server: () => true },
  // The demo books (shared/demoData/journals.ts).
  accountingFiscalPeriods: { static: () => true, server: () => true },
  booksSettings: { static: () => true, server: () => true },
  memberSubscriptions: { static: (row) => String(row._id).startsWith("static_member_subscription_renewal_"), server: isRenewal },
  "financialTransactions (invoice deposits)": { static: (row) => String(row.externalId).startsWith("csv-invoice-"), server: (row) => String(row.externalId).startsWith("csv-invoice-") },
  "financialTransactions (rule provenance)": { static: (row) => row.categorizedBy === "rule", server: (row) => row.categorizedBy === "rule" },
  // Line items and tags (shared/demoData/booksTags.ts).
  financeTagGroups: { static: () => true, server: () => true },
  financeTags: { static: () => true, server: () => true },
  "financialTransactions (split lines)": { static: (row) => Array.isArray(row.lines) && row.lines.length > 1, server: (row) => Array.isArray(row.lines) && row.lines.length > 1 },
  "financialTransactions (tagged)": { static: (row) => Boolean(row.tagIds?.length), server: (row) => Boolean(row.tagIds?.length) },
  "financialTransactions (reviewed)": { static: (row) => Boolean(row.reviewedAtISO), server: (row) => Boolean(row.reviewedAtISO) },
  // Business registers (shared/demoData/businessRegisters.ts).
  payrollSettings: { static: () => true, server: () => true },
  payRuns: { static: () => true, server: () => true },
  payrollRemittances: { static: () => true, server: () => true },
  corporateCards: { static: () => true, server: () => true },
  cardStatements: { static: () => true, server: () => true },
  investmentHoldings: { static: () => true, server: () => true },
  "deadlines (from the registers)": { static: (row) => /^(payroll|investments):/.test(String(row.sourceKey ?? "")), server: (row) => /^(payroll|investments):/.test(String(row.sourceKey ?? "")) },
};
const tableOf = (label: string) => label.split(" ")[0];
const countRows: Array<{ table: string; static: number; server: number }> = [];
for (const [label, filter] of Object.entries(subsets)) {
  const table = tableOf(label);
  const staticCount = (staticDump[table] ?? []).filter(filter.static).length;
  const serverCount = (server[table] ?? []).filter(filter.server).length;
  countRows.push({ table: label, static: staticCount, server: serverCount });
  assert.ok(staticCount > 0, `${label}: the static demo has rows`);
  assert.equal(serverCount, staticCount, `${label}: the server seed has as many rows as the static demo`);
}
countRows.push({ table: "financialTransactions (all)", static: staticDump.financialTransactions.length, server: server.financialTransactions.length });

/* ------------------------------------------------- every reference resolves */

const refFields: Record<string, Array<[string, string]>> = {
  transactionRules: [["createdByUserId", "users"], ["conditions[].accountId", "financialAccounts"], ["actions.accountingAccountId", "financialAccounts"], ["actions.fundRestrictionId", "fundRestrictions"]],
  financialTransactions: [["accountId", "financialAccounts"], ["connectionId", "financialConnections"], ["ruleId", "transactionRules"], ["accountingAccountId", "financialAccounts"], ["fundRestrictionId", "fundRestrictions"], ["tagIds[]", "financeTags"], ["lines[].tagIds[]", "financeTags"], ["lines[].fundRestrictionId", "fundRestrictions"], ["lines[].accountingAccountId", "financialAccounts"]],
  financeTags: [["groupId", "financeTagGroups"]],
  reconciliationPeriods: [["accountId", "financialAccounts"], ["createdByUserId", "users"], ["completedByUserId", "users"]],
  expenseApprovalRules: [["approverUserIds[]", "users"]],
  expenseClaimPolicy: [["updatedByUserId", "users"]],
  expenseReports: [["claimantUserId", "users"], ["approverUserId", "users"], ["declinedByUserId", "users"], ["receiptDocumentId", "documents"], ["approvals[].userId", "users"], ["approvalTrail[].actorUserId", "users"], ["policyException.byUserId", "users"]],
  invoices: [["memberId", "members"], ["counterpartyId", "accountingCounterparties"], ["seriesId", "invoiceSeries"], ["lines[].catalogItemId", "invoiceCatalogItems"], ["payments[].financialTransactionId", "financialTransactions"], ["journalEntryId", "journalEntries"], ["payments[].journalEntryId", "journalEntries"], ["payments[].cashBasisEntryId", "journalEntries"], ["payments[].depositAccountId", "financialAccounts"], ["payments[].transactionBefore.accountingAccountId", "financialAccounts"]],
  invoiceSettings: [["receivableAccountId", "financialAccounts"], ["taxPayableAccountId", "financialAccounts"], ["defaultRevenueAccountId", "financialAccounts"], ["depositAccountId", "financialAccounts"], ["categoryAccounts[].accountId", "financialAccounts"]],
  invoiceSeries: [["memberId", "members"], ["counterpartyId", "accountingCounterparties"], ["lines[].catalogItemId", "invoiceCatalogItems"]],
  bills: [["vendorId", "accountingCounterparties"], ["lines[].accountId", "financialAccounts"], ["lines[].fundRestrictionId", "fundRestrictions"], ["payments[].financialTransactionId", "financialTransactions"], ["payments[].cashAccountId", "financialAccounts"], ["payments[].journalEntryId", "journalEntries"], ["journalEntryId", "journalEntries"], ["submittedByUserId", "users"], ["createdByUserId", "users"], ["approvals[].userId", "users"]],
  journalLines: [["journalEntryId", "journalEntries"], ["accountId", "financialAccounts"], ["counterpartyId", "accountingCounterparties"], ["financialTransactionId", "financialTransactions"], ["fundRestrictionId", "fundRestrictions"]],
  memberSubscriptions: [["planId", "subscriptionPlans"], ["memberId", "members"]],
  fundRestrictions: [["linkedFinancialAccountId", "financialAccounts"]],
  financialAccounts: [["parentAccountId", "financialAccounts"]],
  journalEntries: [["fiscalPeriodId", "accountingFiscalPeriods"], ["createdByUserId", "users"]],
  journalLines: [["journalEntryId", "journalEntries"], ["accountId", "financialAccounts"], ["financialTransactionId", "financialTransactions"], ["fundRestrictionId", "fundRestrictions"]],
  payRuns: [["transactionId", "financialTransactions"], ["lines[].employeeId", "employees"]],
  payrollRemittances: [["transactionId", "financialTransactions"]],
  payrollSlips: [["employeeId", "employees"]],
  corporateCards: [["employeeId", "employees"], ["financialAccountId", "financialAccounts"], ["agreementDocumentId", "documents"]],
  cardStatements: [["cardId", "corporateCards"]],
  investmentHoldings: [["fundRestrictionId", "fundRestrictions"]],
};
function valuesAt(row: any, path: string): unknown[] {
  let values: unknown[] = [row];
  for (const part of path.split(".")) {
    const many = part.endsWith("[]");
    const key = many ? part.slice(0, -2) : part;
    values = values.flatMap((value: any) => {
      const next = value?.[key];
      if (next === undefined || next === null) return [];
      return many ? (Array.isArray(next) ? next : []) : [next];
    });
  }
  return values;
}
let checkedRefs = 0;
for (const [table, fields] of Object.entries(refFields)) {
  for (const row of server[table] ?? []) {
    assert.equal(row.societyId, S, `${table} ${row._id} belongs to the seeded society`);
    for (const [path, target] of fields) {
      for (const id of valuesAt(row, path)) {
        const ref = await B.db.get(String(id), target);
        assert.ok(ref, `${table}.${path} → ${target} ${String(id)} resolves`);
        if ("societyId" in ref) assert.equal(ref.societyId, S, `${table}.${path} stays in the seeded society`);
        checkedRefs += 1;
      }
    }
  }
}
assert.ok(checkedRefs > 200, "references were actually checked");

/* ------------------------------------------------- account balances */

const SEED_OPENING: Record<string, number> = { "operating-chequing": 3490000, "restricted-fund": 1200000, "organization-visa": 0, facilities: 0, "facilities-venue": 0, "facilities-utilities": 0, "accounts-payable": 0, "program-supplies": 0 };
for (const account of server.financialAccounts) {
  // Chart accounts the demo ledger posts to carry no bank transactions.
  if (String(account.externalId).startsWith("societyer:")) {
    assert.equal(account.balanceCents, 0, `${account.name}: a chart account has no bank balance`);
    continue;
  }
  const sum = server.financialTransactions.filter((row: any) => row.accountId === account._id).reduce((total: number, row: any) => total + row.amountCents, 0);
  assert.ok(account.externalId in SEED_OPENING, `known seed account ${account.externalId}`);
  assert.equal(account.balanceCents, SEED_OPENING[account.externalId] + sum, `${account.name}: balance = opening balance + sum of its transactions`);
}

/* ------------------------------------------------- reconciliation periods */

const [periodsA, periodsB] = await Promise.all([recon.periodsPortable(A.ctx, { societyId: A.societyId }), recon.periodsPortable(B.ctx, { societyId: B.societyId })]);
const periodKey = (period: any, dump: Record<string, any[]>) => {
  const account = dump.financialAccounts.find((row: any) => row._id === period.accountId);
  return `${account?.isRestricted ? "restricted" : "operating"} ${period.startDate}..${period.endDate}`;
};
const summarise = (periods: any[], dump: Record<string, any[]>) =>
  Object.fromEntries(periods.map((period: any) => [periodKey(period, dump), { status: period.effectiveStatus, differenceCents: period.differenceCents, unclearedCount: period.unclearedCount }]));
const reconA = summarise(periodsA.periods, staticDump);
const reconB = summarise(periodsB.periods, server);
assert.deepEqual(reconB, reconA, "statement periods summarise to the same status, difference and open lines");
const brief = (key: string) => `${(reconB as any)[key]?.status} ${(reconB as any)[key]?.differenceCents}`;
assert.equal(brief("operating 2026-01-01..2026-01-31"), "completed 0");
assert.equal(brief("operating 2026-02-01..2026-02-28"), "out_of_balance -8960");
assert.match(brief("operating 2026-03-01..2026-03-31"), /^in_progress -\d+$/);
assert.equal(brief("restricted 2026-01-01..2026-03-31"), "auto_reconciled 0");
// The out-of-balance period is the one whose telecom line was unmatched after completion.
const telecom = server.financialTransactions.find((row: any) => row.externalId === `feed-${DEMO_RECONCILIATION_KEYS.febUnmatchedKey}`);
assert.ok(telecom && !telecom.reconciledAtISO, "February's telecom line is unmatched");

/* ------------------------------------------------- rules */

const [rulesA, rulesB] = await Promise.all([rules.workspacePortable(A.ctx, { societyId: A.societyId }), rules.workspacePortable(B.ctx, { societyId: B.societyId })]);
const ruleSummary = (ws: any, dump: Record<string, any[]>) =>
  ws.rules.map((rule: any) => ({
    name: rule.name,
    enabled: rule.enabled,
    matchCount: rule.matchCount,
    lastAppliedAtISO: rule.lastAppliedAtISO,
    provenance: dump.financialTransactions.filter((row: any) => row.ruleId === rule._id).length,
  }));
assert.deepEqual(ruleSummary(rulesB, server), ruleSummary(rulesA, staticDump), "rules match the same feed lines and carry the same provenance");
assert.equal(rulesB.pendingMatches, rulesA.pendingMatches, "Apply rules to uncategorised previews the same lines");

/* ------------------------------------------------- approvals */

const statuses = (rows: any[]) => rows.map((row) => `${row.status}:${row.amountCents}:${row.approvals?.length ?? 0}/${row.requiredApprovals ?? "-"}`).sort();
assert.deepEqual(statuses(server.expenseReports), statuses(staticDump.expenseReports.filter((row: any) => claimKeys.has(row._id))), "claims in every approval state");
const queueB = await exp.approvalQueuePortable(B.ctx, { societyId: B.societyId });
assert.equal(queueB.policy.source, "configured", "the seeded approval rules are the policy");
assert.deepEqual(
  server.expenseApprovalRules.map((row: any) => [row.order, row.minAmountCents, row.requiredApprovals]),
  staticDump.expenseApprovalRules.map((row: any) => [row.order, row.minAmountCents, row.requiredApprovals]),
);
// The claim policy story: a policy, one claim with an exception, one likely duplicate.
const queueA = await exp.approvalQueuePortable(A.ctx, { societyId: A.societyId });
const claimStory = (queue: any) => ({
  policy: [queue.claimPolicy.receiptOverCents, queue.claimPolicy.noteOverCents, queue.claimPolicy.maxAgeDays, queue.claimPolicy.enforcement],
  exceptions: queue.rows.filter((row: any) => row.policyException).map((row: any) => row.title).sort(),
  duplicates: queue.rows.filter((row: any) => row.possibleDuplicate).map((row: any) => `${row.title} ~ ${row.possibleDuplicate.title}`).sort(),
  flagged: queue.rows.filter((row: any) => row.policyIssues.length).map((row: any) => `${row.title}: ${row.policyIssues.map((issue: any) => issue.code).join("+")}`).sort(),
});
assert.deepEqual(claimStory(queueB), claimStory(queueA), "claim policy, exceptions and duplicate hints match");
assert.equal(claimStory(queueB).exceptions.length, 1, "one claim carries a policy exception");
assert.deepEqual(claimStory(queueB).duplicates, ["Bus rental for the youth workshop ~ Youth workshop bus rental"], "the repeated bus rental points at the approved one");

/* ------------------------------------------------- invoicing */

const [invA, invB] = await Promise.all([inv.workspacePortable(A.ctx, { societyId: A.societyId }), inv.workspacePortable(B.ctx, { societyId: B.societyId })]);
const invoiceSummary = (ws: any) =>
  ws.invoices
    .map((row: any) => ({ number: row.number, status: row.status, issueDate: row.issueDate, dueDate: row.dueDate, totalCents: row.totalCents, paidCents: row.paidCents, partyKind: row.partyKind, payments: row.payments.length, linked: row.payments.filter((p: any) => p.financialTransactionId).length }))
    .sort((a: any, b: any) => a.number.localeCompare(b.number));
assert.deepEqual(invoiceSummary(invB), invoiceSummary(invA), "invoice numbers, totals, payments and derived statuses match");
assert.deepEqual(invB.summary, invA.summary, "receivables summary matches");
assert.equal(invB.series.length, invA.series.length);
assert.equal(invB.catalog.length, invA.catalog.length);
assert.equal(invB.settings.nextNumberPreview, invA.settings.nextNumberPreview);
assert.equal(invB.duesCandidates.length, invA.duesCandidates.length, "Generate dues invoices has the same renewals");
assert.equal(invB.organization.gstNumber, invA.organization.gstNumber);
for (const invoice of server.invoices) {
  for (const payment of invoice.payments.filter((p: any) => p.financialTransactionId)) {
    const txn = server.financialTransactions.find((row: any) => row._id === payment.financialTransactionId);
    assert.equal(txn.amountCents, payment.amountCents, `${invoice.number}: the linked deposit is the payment amount`);
    assert.deepEqual([txn.matchedKind, txn.matchedId], ["invoice", invoice._id], `${invoice.number}: the linked deposit points back at the invoice`);
  }
}
// The books side: each invoice posted (or held back) the same way, with the same flags and the same accounts.
type ChartRow = { _id: string; code?: string };
const ledgerSummary = (ws: Awaited<ReturnType<typeof inv.workspacePortable>>, chart: ReadonlyArray<ChartRow>) => {
  const codeOf = (id: string | null | undefined) => chart.find((row) => row._id === id)?.code;
  const mapping = [ws.settings.receivableAccountId, ws.settings.taxPayableAccountId, ws.settings.defaultRevenueAccountId, ws.settings.depositAccountId].map(codeOf).join(",");
  return ws.invoices
    .map((row) => `${row.number}:${row.ledger.state}:${row.needsAction.map((flag) => flag.code).join("+")}`)
    .concat([`mapping:${mapping}`])
    .sort();
};
assert.deepEqual(ledgerSummary(invB, server.financialAccounts as ChartRow[]), ledgerSummary(invA, staticDump.financialAccounts as ChartRow[]), "invoice postings, needs-action flags and the GL account mapping match");
for (const entry of (server.journalEntries as Array<{ source?: string; sourceExternalId?: string }>).filter((row) => String(row.source).startsWith("invoice"))) {
  assert.ok(String(entry.sourceExternalId).startsWith("invoice:") && !String(entry.sourceExternalId).includes("seed-ref"), "invoice entry keys carry real invoice ids");
}

/* ------------------------------------------------- bills */

const [billsA, billsB] = await Promise.all([billFns.workspacePortable(A.ctx, { societyId: A.societyId }), billFns.workspacePortable(B.ctx, { societyId: B.societyId })]);
const billSummary = (ws: Awaited<ReturnType<typeof billFns.workspacePortable>>) =>
  ws.bills
    .map((row) => `${row.vendorName}:${row.billNumber ?? "-"}:${row.status}:${row.billDate}:${row.dueDate}:${row.totalCents}:${row.paidCents}:${row.payments.length}:${row.approvals.length}/${row.requiredApprovals}`)
    .sort();
assert.deepEqual(billSummary(billsB), billSummary(billsA), "bills, derived statuses, payments and approvals match");
assert.deepEqual(billsB.summary, billsA.summary, "payables summary matches");
assert.equal(new Set(billsB.bills.map((row) => row.status)).size, 8, "the seeded bills cover every status");
for (const bill of server.bills) {
  for (const payment of bill.payments.filter((p) => p.financialTransactionId)) {
    const txn = server.financialTransactions.find((row) => row._id === payment.financialTransactionId);
    assert.equal(-txn.amountCents, payment.amountCents, `${bill.billNumber}: the linked bank line is the payment amount`);
    assert.equal(txn.matchedId, bill._id, `${bill.billNumber}: the linked bank line points back at the bill`);
  }
}
for (const entry of server.journalEntries.filter((row) => String(row.source).startsWith("bill"))) {
  assert.ok(!String(entry.sourceExternalId).includes("seed-ref"), "bill entry keys carry real bill ids");
}

/* ------------------------------------------------- business registers */

const [payA, payB] = await Promise.all([registers.payrollWorkspacePortable(A.ctx, { societyId: A.societyId }), registers.payrollWorkspacePortable(B.ctx, { societyId: B.societyId })]);
const payrollSummary = (ws: any) => ({
  runs: ws.runs.map((row: any) => `${row.payDate}:${row.grossCents}:${row.netCents}:${row.remittableCents}:${row.differenceCents}`),
  remittances: ws.remittances.map((row: any) => `${row.periodStart}:${row.dueDate}:${row.amountDueCents}:${row.paidCents ?? 0}:${row.status}`),
  slipTotals: ws.slips.reduce((sum: number, row: any) => sum + row.employmentIncomeCents, 0),
  deadlineChanges: ws.deadlineChanges,
});
assert.deepEqual(payrollSummary(payB), payrollSummary(payA), "pay runs, remittances, T4 totals and deadline state match");
assert.equal(payB.deadlineChanges, 0, "the seeded register deadlines are in step with the registers");
const [cardsA, cardsB] = await Promise.all([registers.cardsWorkspacePortable(A.ctx, { societyId: A.societyId }), registers.cardsWorkspacePortable(B.ctx, { societyId: B.societyId })]);
const cardSummary = (ws: any) => ws.statements.map((row: any) => `${row.periodStart}:${row.statementBalanceCents}:${row.differenceCents}:${row.receiptsMissing}:${row.status}`);
assert.deepEqual(cardSummary(cardsB), cardSummary(cardsA), "card statements reconcile the same way against the same feed");
assert.deepEqual(cardsB.summary, cardsA.summary, "card summary matches");
const [holdingsA, holdingsB] = await Promise.all([registers.investmentsWorkspacePortable(A.ctx, { societyId: A.societyId }), registers.investmentsWorkspacePortable(B.ctx, { societyId: B.societyId })]);
assert.deepEqual(holdingsB.reserves, holdingsA.reserves, "invested reserves match");

/* ------------------------------------------------- books */

// Both demos post the same story to the journal: opening balances on
// 2026-01-01, then every categorised bank line, so the books reports have
// monthly activity, the balance sheet balances and cash flow adds up.
const booksAsOf = demoAsOfDate("2026-04-21", todayDateOnly());
const booksSummary: Array<{ demo: string; entries: number; months: number; programs: string }> = [];
for (const [demo, side, dump] of [["in-browser demo", A, staticDump], ["server seed", B, server]] as const) {
  const range = { societyId: side.societyId, from: "2026-01-01", to: booksAsOf, frequency: "month", asOf: booksAsOf };
  const [operations, balanceSheet, cashFlow] = await Promise.all(["operations", "balance_sheet", "cash_flow"].map((report) => accountingFns.booksReportPortable(side.ctx, { ...range, report })));
  assert.deepEqual(balanceSheet.warnings, [], `${demo}: the balance sheet balances`);
  assert.deepEqual(cashFlow.warnings, [], `${demo}: cash flow activities add up to the change in cash`);
  const completed = operations.summary.filter((point) => point.end < booksAsOf.slice(0, 7) + "-01");
  assert.ok(completed.length >= 3 && completed.every((point) => point.values.revenue > 0 && point.values.expenses > 0), `${demo}: every completed month since the opening balances has posted revenue and expenses`);
  assert.equal(dump.journalEntries.filter((entry: { source?: string }) => entry.source === "opening_balance").length, 1, `${demo}: one opening-balance entry`);
  booksSummary.push({ demo, entries: dump.journalEntries.length, months: operations.periods.length, programs: operations.dimensionValues.programCode.join(", ") });
}
assert.equal(booksSummary[0].programs, booksSummary[1].programs, "the same program codes tag both ledgers");
/* ------------------------------------------------- corporation demos */

const corporationRows: Array<{ workspace: string; tables: number; rows: number }> = [];
for (const key of CORPORATION_DEMO_KEYS) {
  const local = buildCorporationDemo(key);
  const serverSociety = serverAll.societies.find((row: any) => row.name === local.society.name);
  assert.ok(serverSociety, `${key}: the server seed creates ${local.society.name}`);
  const corpId = serverSociety._id;
  let rows = 0;
  for (const [table, localRows] of Object.entries(local.tables)) {
    const serverRows = (serverAll[table] ?? []).filter((row: any) => row.societyId === corpId);
    assert.equal(serverRows.length, localRows.length, `${key}: ${table} has as many rows on the server as in the in-browser demo`);
    rows += serverRows.length;
  }
  corporationRows.push({ workspace: local.society.name, tables: Object.keys(local.tables).length, rows });
  const ownerName = CORPORATION_STORIES[key].people.find((person) => person.user === "Owner")!;
  const owner = `${ownerName.firstName} ${ownerName.lastName}`;
  const L = portableCtx(corporationDemoLocalSeed(local), owner);
  const R = portableCtx(serverAll, owner);
  assert.equal(R.societyId, corpId, `${key}: the owner signs in to the seeded corporation`);
  const asOf = local.asOf;
  const holders = (power: any) => [...power.voting, ...power.nonVoting].map((row: any) => `${row.holderName}:${row.totalShares}:${row.totalVotes}`).sort();
  assert.deepEqual(holders(await votingPowerFns.votingPowerPortable(R.ctx, { societyId: R.societyId, asOf })), holders(await votingPowerFns.votingPowerPortable(L.ctx, { societyId: L.societyId, asOf })), `${key}: share register holdings match`);
  const dividendSummary = (rows: any[]) => rows.map((row) => `${row.declaredOn}:${row.shareClass}:${row.totalCents}:${row.status}`).sort();
  assert.deepEqual(dividendSummary(await dividendFns.listPortable(R.ctx, { societyId: R.societyId })), dividendSummary(await dividendFns.listPortable(L.ctx, { societyId: L.societyId })), `${key}: dividends match`);
  const resolutionSummary = (rows: any[]) => rows.map((row) => `${row.title}:${row.status}`).sort();
  const serverResolutions = await resolutionFns.listPortable(R.ctx, { societyId: R.societyId });
  assert.ok(serverResolutions.every((row: any) => row.status === "Carried"), `${key}: every seeded resolution is a verified Carried record`);
  assert.deepEqual(resolutionSummary(serverResolutions), resolutionSummary(await resolutionFns.listPortable(L.ctx, { societyId: L.societyId })), `${key}: resolutions match`);
  assert.equal((await certificateFns.reconcilePortable(R.ctx, { societyId: R.societyId, asOf }) as any).balanced, true, `${key}: certificates reconcile with the ledger`);
  const deadlineSummary = (rows: any[]) => rows.map((row) => `${String(row.key).replace(/:.*/, "")}:${row.dueDate}:${row.status}`).sort();
  assert.deepEqual(deadlineSummary(await settingsFns.complianceDeadlinesPortable(R.ctx, { societyId: R.societyId, fromISO: asOf })), deadlineSummary(await settingsFns.complianceDeadlinesPortable(L.ctx, { societyId: L.societyId, fromISO: asOf })), `${key}: derived obligations match`);
}

/* ------------------------------------------------- report */

console.table(countRows);
console.table(Object.entries(reconB).map(([period, row]: [string, any]) => ({ period, status: row.status, difference: (row.differenceCents / 100).toFixed(2), static: (reconA[period].differenceCents / 100).toFixed(2), open: row.unclearedCount })));
console.table(corporationRows);
console.table(booksSummary);
console.log(`Seed parity checks passed: ${checkedRefs} references resolve; rules, periods, claims, ${server.invoices.length} invoices and ${server.bills.length} bills match the in-browser demo, and the ${CORPORATION_DEMO_KEYS.length} corporation demos match their in-browser workspaces.`);

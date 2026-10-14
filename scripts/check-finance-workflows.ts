// Finance workflows end-to-end on the portable engine, seeded with the demo
// workspace: statement periods (complete, out of balance, reopen), rule
// application + undo, and server-side approval-rule and approver-access enforcement.
import assert from "node:assert/strict";
import { tables } from "../src/lib/staticConvexFixtures";
import { DEMO_RECONCILIATION, feedTransactionId } from "../src/lib/staticFinanceWorkflowFixtures";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import * as recon from "../shared/functions/reconciliation";
import * as rules from "../shared/functions/transactionRules";
import * as exp from "../shared/functions/expenseReports";
import { requireFunctionAction } from "../shared/functions/actionPolicy";
import { FINANCE_EDIT_REQUIRED_REASON } from "../shared/expenseApprovals";

const seed: Record<string, any[]> = {};
for (const [k, v] of Object.entries(tables as Record<string, any[]>)) seed[k] = JSON.parse(JSON.stringify(v));
seed.users = seed.users.map((u: any) => ({ ...u, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${u._id}` }));
const db = new MemoryDb({ seed });
const S = seed.users[0].societyId;
const ctxFor = (userId: string): any => ({
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${userId}`, issuer: "https://issuer.test", userId, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
});
const mina = ctxFor(seed.users[0]._id);
const jordan = ctxFor("static_user_treasurer");
const avery = ctxFor("static_user_secretary");

// ---- the demo feed still balances: the workflows only add flags to feed rows
const cashId = "static_financial_cash";
const grantId = "static_financial_grant";
const accountsById = Object.fromEntries(seed.financialAccounts.map((a: any) => [a._id, a]));
const balanceAtEndOf = (accountId: string, date: string) =>
  accountsById[accountId].balanceCents -
  seed.financialTransactions.filter((t: any) => t.accountId === accountId && t.date > date).reduce((sum: number, t: any) => sum + t.amountCents, 0);
// Calibrated to the 2026-01-01 opening-balance journal entry.
assert.equal(balanceAtEndOf(cashId, "2025-12-31"), 3490000, "operating chequing opens 2026 at the journal's balance");
assert.equal(balanceAtEndOf(grantId, "2025-12-31"), 2750000, "restricted fund opens 2026 at the journal's balance");
// Besides the generated feed, the only bank lines are the three journal-linked
// ones and the invoicing demo's payment deposits, which must post after every
// statement period so they never disturb a reconciliation.
const isInvoiceDeposit = (t: any) => String(t.externalId ?? "").startsWith("csv-invoice-");
assert.equal(
  seed.financialTransactions.filter((t: any) => !String(t._id).startsWith("static_tx_feed_") && !isInvoiceDeposit(t)).length,
  3,
  "no hand-written bank lines beyond the three journal-linked ones and invoice deposits",
);
const lastStatementEnd = seed.reconciliationPeriods.map((period: any) => period.endDate).sort().at(-1);
assert.ok(
  seed.financialTransactions.filter(isInvoiceDeposit).every((t: any) => t.date > lastStatementEnd),
  "invoice deposits post after the last statement period",
);

// ---- periods (statement balances are the feed's running balances)
let p = await recon.periodsPortable(mina, { societyId: S });
const byId = Object.fromEntries(p.periods.map((x: any) => [x._id, x]));
const R = DEMO_RECONCILIATION;
const jan = byId[R.janPeriodId];
const feb = byId[R.febPeriodId];
const mar = byId[R.marPeriodId];
const q1 = byId[R.restrictedPeriodId];
assert.equal(jan.effectiveStatus, "completed");
assert.equal(feb.effectiveStatus, "out_of_balance");
assert.equal(mar.effectiveStatus, "in_progress");
assert.equal(q1.effectiveStatus, "auto_reconciled");
// A completed statement balances to $0.00 with every line cleared.
assert.equal(jan.differenceCents, 0);
assert.equal(jan.unclearedCount, 0);
assert.equal(jan.beginningBalanceCents, 3490000);
assert.equal(jan.endingBalanceCents, balanceAtEndOf(cashId, "2026-01-31"));
assert.equal(q1.differenceCents, 0);
assert.equal(q1.unclearedCount, 0);
// February: the one line unmatched after completion is the whole difference.
const febUnmatched = await db.get(feedTransactionId(R.febUnmatchedKey));
assert.ok(febUnmatched && !febUnmatched.reconciledAtISO);
assert.equal(feb.unclearedCount, 1);
assert.equal(feb.differenceCents, febUnmatched.amountCents);
assert.equal(feb.beginningBalanceCents, jan.endingBalanceCents);
assert.equal(feb.endingBalanceCents, balanceAtEndOf(cashId, "2026-02-28"));
// March: two uncleared lines explain the difference.
const marUncleared = await Promise.all(R.marUnclearedKeys.map((key) => db.get(feedTransactionId(key))));
assert.equal(mar.unclearedCount, 2);
assert.notEqual(mar.differenceCents, 0);
assert.equal(mar.differenceCents, marUncleared.reduce((sum: number, t: any) => sum + t.amountCents, 0));
assert.equal(mar.endingBalanceCents, balanceAtEndOf(cashId, "2026-03-31"));
await assert.rejects(() => recon.completePeriodPortable(mina, { id: R.marPeriodId }), /difference/);
await assert.rejects(() => recon.startPeriodPortable(mina, { societyId: S, accountId: cashId, endDate: "2026-04-30", endingBalanceCents: 1 }), /open reconciliation/);
// Re-clearing February's line restores the completion snapshot.
await recon.markManualPortable(mina, { txnId: febUnmatched._id, note: "Corrected invoice attached" });
p = await recon.periodsPortable(mina, { societyId: S });
assert.equal(p.periods.find((x: any) => x._id === R.febPeriodId).effectiveStatus, "completed", "February balances again");
for (const txn of marUncleared) await recon.markManualPortable(mina, { txnId: txn._id, note: "On statement" });
p = await recon.periodsPortable(mina, { societyId: S });
assert.equal(p.periods.find((x: any) => x._id === R.marPeriodId).differenceCents, 0);
await recon.completePeriodPortable(mina, { id: R.marPeriodId });
// unmatching a line inside a completed period flags it
await recon.unmatchPortable(mina, { txnId: marUncleared[0]._id });
p = await recon.periodsPortable(mina, { societyId: S });
assert.equal(p.periods.find((x: any) => x._id === R.marPeriodId).effectiveStatus, "out_of_balance");
assert.equal((await db.get(R.marPeriodId)).status, "out_of_balance", "persisted flag");
await recon.markManualPortable(mina, { txnId: marUncleared[0]._id, note: "On statement again" });
p = await recon.periodsPortable(mina, { societyId: S });
assert.equal(p.periods.find((x: any) => x._id === R.marPeriodId).effectiveStatus, "completed", "restored lines match again");
// start April
const aprilId = await recon.startPeriodPortable(mina, { societyId: S, accountId: cashId, endDate: "2026-04-30", endingBalanceCents: 123 });
p = await recon.periodsPortable(mina, { societyId: S });
const april = p.periods.find((x: any) => x._id === aprilId);
assert.equal(april.startDate, "2026-04-01");
assert.equal(april.beginningBalanceCents, mar.endingBalanceCents);
await recon.removePeriodPortable(mina, { id: aprilId });

// ---- rules (they target real feed payees; the latest recurring lines await a rule run)
let ws = await rules.workspacePortable(mina, { societyId: S });
assert.equal(ws.rules.filter((r: any) => !r.enabled).length, 1, "one disabled rule");
for (const rule of ws.rules) assert.ok(rule.matchCount >= 5, `${rule.name} matches real feed lines`);
assert.ok(ws.pendingMatches >= 4, "Apply rules to uncategorised has a preview");
assert.ok(ws.uncategorizedCount > ws.pendingMatches, "some uncategorised lines match no rule");
const ruledEarlier = seed.financialTransactions.filter((t: any) => t.categorizedBy === "rule");
assert.ok(ruledEarlier.length >= 20, "earlier feed lines carry rule provenance");
assert.ok(ruledEarlier.every((t: any) => t.ruleId && t.ruleApplication?.ruleName));
const latestHydro = seed.financialTransactions
  .filter((t: any) => t.counterparty === "Coastal Hydro")
  .sort((a: any, b: any) => a.date.localeCompare(b.date))
  .at(-1);
assert.equal(latestHydro.category, undefined);
const applied = await rules.applyToUncategorizedPortable(mina, { societyId: S });
assert.ok(applied.applied >= 4);
const hydro = await db.get(latestHydro._id);
assert.equal(hydro.category, "Facilities");
assert.equal(hydro.categorizedBy, "rule");
await rules.undoBatchPortable(mina, { societyId: S, batch: applied.batchId });
assert.equal((await db.get(latestHydro._id)).category, undefined);
assert.equal((await db.get(latestHydro._id)).categorizedBy, undefined);
const newRule = await rules.upsertPortable(mina, { societyId: S, name: "Harbourline telecom", conditions: [{ field: "payee", operator: "contains", value: "harbourline" }], actions: { category: "Office & technology" } });
ws = await rules.workspacePortable(mina, { societyId: S });
assert.equal(ws.rules[ws.rules.length - 1]._id, newRule);
await rules.reorderPortable(mina, { societyId: S, orderedIds: [newRule, ...ws.rules.filter((r: any) => r._id !== newRule).map((r: any) => r._id)] });
ws = await rules.workspacePortable(mina, { societyId: S });
assert.equal(ws.rules[0]._id, newRule);
await assert.rejects(() => rules.upsertPortable(mina, { societyId: S, name: "", conditions: [], actions: {} }), /name/);

// ---- approvals (default approver access: finance edit access required)
// Mina = Owner, Avery = Admin (both finance writers); Jordan = Director with
// read-only finance access; a Viewer is added below.
let q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.deepEqual(q.counts, { awaiting: 4, awaitingMe: 3, approved: 1, paid: 1, closed: 2, drafts: 2 });
assert.equal(q.policy.source, "configured");
assert.deepEqual(
  { value: q.approverAccess.value, isDefault: q.approverAccess.isDefault, canChange: q.approverAccess.canChange },
  { value: "finance_writers", isDefault: true, canChange: true },
  "no stored setting means the default: finance writers approve",
);
const toner = q.rows.find((r: any) => r._id === "static_expense_printer_toner");
assert.equal(toner.canApprove, false);
assert.match(toner.cannotApproveReason, /own claim/);
await assert.rejects(() => exp.decidePortable(mina, { id: "static_expense_printer_toner", decision: "approve" }), /own claim/);
// The default blocks a read-only director everywhere a vote can be recorded, and says why.
let jq = await exp.approvalQueuePortable(jordan, { societyId: S });
assert.equal(jq.counts.awaitingMe, 0, "a read-only director has nothing to approve by default");
assert.equal(jq.approverAccess.canChange, false);
const jordanSupplies = jq.rows.find((r: any) => r._id === "static_expense_workshop_supplies");
assert.equal(jordanSupplies.canApprove, false);
assert.equal(jordanSupplies.cannotApproveReason, FINANCE_EDIT_REQUIRED_REASON);
await assert.rejects(() => exp.decidePortable(jordan, { id: "static_expense_workshop_supplies", decision: "approve" }), /finance edit access/);
await assert.rejects(() => exp.decidePortable(jordan, { id: "static_expense_workshop_supplies", decision: "decline", reason: "Not budgeted" }), /Declining requires finance edit access/);
await assert.rejects(() => exp.setStatusPortable(jordan, { id: "static_expense_workshop_supplies", status: "Approved" }), /finance edit access/);
await assert.rejects(() => exp.bulkApprovePortable(jordan, { societyId: S, ids: ["static_expense_workshop_supplies"] }), /finance edit access/);
assert.equal((await db.get("static_expense_workshop_supplies")).approvals.length, 0, "no vote was recorded");
// dual approval by two finance writers: Mina approves dinner (0->1 of 2), then Avery completes
let r = await exp.decidePortable(mina, { id: "static_expense_appreciation_dinner", decision: "approve" });
assert.deepEqual(r, { status: "Submitted", approvals: 1, required: 2 });
await assert.rejects(() => exp.decidePortable(mina, { id: "static_expense_appreciation_dinner", decision: "approve" }), /already/);
await assert.rejects(() => exp.decidePortable(jordan, { id: "static_expense_appreciation_dinner", decision: "approve" }), /finance edit access/);
r = await exp.decidePortable(avery, { id: "static_expense_appreciation_dinner", decision: "approve" });
assert.equal(r.status, "Approved");
// legacy setStatus Approved is a vote (and obeys the rules: Avery can't approve her own claim)
await assert.rejects(() => exp.setStatusPortable(avery, { id: "static_expense_workshop_supplies", status: "Approved" }), /own claim/);
await exp.setStatusPortable(mina, { id: "static_expense_workshop_supplies", status: "Approved" });
assert.equal((await db.get("static_expense_workshop_supplies")).status, "Approved");
await assert.rejects(() => exp.setStatusPortable(mina, { id: "static_expense_kitchen_deposit", status: "Paid" }), /approved/);
await assert.rejects(() => exp.decidePortable(mina, { id: "static_expense_kitchen_deposit", decision: "decline" }), /reason/);
await assert.rejects(() => exp.upsertPortable(mina, { id: "static_expense_office_chair", societyId: S, claimantName: "Mina Patel", title: "Chair", category: "Supplies", amountCents: 18900, currency: "CAD", incurredAtISO: "2026-04-16", status: "Approved" }), /approvals queue/);
const bulk = await exp.bulkApprovePortable(mina, { societyId: S, ids: ["static_expense_kitchen_deposit", "static_expense_printer_toner"] });
assert.equal(bulk.approved, 1);
assert.equal(bulk.skipped.length, 1);

// A Viewer and a claim in another workspace, for the checks below.
const viewerId = await db.insert("users", { societyId: S, displayName: "Vic Viewer", email: "vic@riverside.example", role: "Viewer", status: "Active" });
const viewer = ctxFor(viewerId);
const otherSociety = await db.insert("societies", { name: "Elsewhere Society" });
const foreignClaim = await db.insert("expenseReports", { societyId: otherSociety, claimantName: "Someone Else", title: "Foreign claim", category: "Travel", amountCents: 5000, currency: "CAD", incurredAtISO: "2026-04-01", status: "Submitted", approvals: [] });
const newClaim = (title: string) => exp.upsertPortable(avery, { societyId: S, claimantName: "Avery Santos", claimantUserId: "static_user_secretary", title, category: "Supplies", amountCents: 4200, currency: "CAD", incurredAtISO: "2026-04-20", status: "Submitted" });
const pens = await newClaim("Pens");
const chairs = await newClaim("Folding chairs");
// Viewers never approve, under either setting.
await assert.rejects(() => exp.decidePortable(viewer, { id: pens, decision: "approve" }), /owners, admins and directors/);

// ---- saving the setting needs finance edit access and is audited
await assert.rejects(() => exp.saveApproverAccessPortable(jordan, { societyId: S, approverAccess: "rule_roles" }), /financials:write/);
await assert.rejects(() => exp.saveApproverAccessPortable(viewer, { societyId: S, approverAccess: "rule_roles" }), /financials:write/);
await assert.rejects(() => requireFunctionAction(jordan, "expenseReports:saveApproverAccess", "mutation", { societyId: S, approverAccess: "rule_roles" }), /financials:write/);
await assert.rejects(() => exp.saveApproverAccessPortable(mina, { societyId: S, approverAccess: "everyone" }), /who can approve/);
const auditCount = async () => (await db.query("activity").withIndex("by_society", (x: any) => x.eq("societyId", S)).collect()).filter((a: any) => a.action === "approver-access-changed").length;
assert.equal(await auditCount(), 0);
await requireFunctionAction(mina, "expenseReports:saveApproverAccess", "mutation", { societyId: S, approverAccess: "rule_roles" });
assert.deepEqual(await exp.saveApproverAccessPortable(mina, { societyId: S, approverAccess: "rule_roles" }), { approverAccess: "rule_roles", changed: true });
assert.equal(await auditCount(), 1, "the change is in the activity log");
await exp.saveApproverAccessPortable(mina, { societyId: S, approverAccess: "rule_roles" });
assert.equal(await auditCount(), 1, "saving the same value records nothing new");
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(q.approverAccess.value, "rule_roles");
assert.equal(q.approverAccess.isDefault, false);
assert.equal(q.approverAccess.updatedByName, "Mina Patel");

// ---- rule_roles: a read-only director named by the rule may approve; Viewers still never
jq = await exp.approvalQueuePortable(jordan, { societyId: S });
assert.equal(jq.rows.find((row: any) => row._id === pens).canApprove, true);
await requireFunctionAction(jordan, "expenseReports:decide", "mutation", { id: pens, decision: "approve" });
r = await exp.decidePortable(jordan, { id: pens, decision: "approve" });
assert.equal(r.status, "Approved");
await assert.rejects(() => exp.decidePortable(viewer, { id: chairs, decision: "approve" }), /owners, admins and directors/);
const viewerBulk = await exp.bulkApprovePortable(viewer, { societyId: S, ids: [chairs] });
assert.equal(viewerBulk.approved + viewerBulk.recorded, 0, "a Viewer's bulk approve records nothing");
// bulk approve obeys the setting and never echoes another workspace's ids
const jordanBulk = await exp.bulkApprovePortable(jordan, { societyId: S, ids: [chairs, foreignClaim] });
assert.equal(jordanBulk.approved, 1);
assert.equal(jordanBulk.notFound, 1);
assert.equal(jordanBulk.skipped.length, 0);
assert.ok(!JSON.stringify(jordanBulk).includes(String(foreignClaim)), "foreign ids are counted, never echoed");
assert.equal((await db.get(foreignClaim)).approvals.length, 0);
// The rules still apply on top: a rule naming only owners blocks the director.
await exp.saveApprovalRulesPortable(mina, { societyId: S, rules: [{ minAmountCents: 0, requiredApprovals: 1, approverRoles: ["Owner"] }] });
const ownersOnly = await newClaim("Stamps");
await assert.rejects(() => exp.decidePortable(jordan, { id: ownersOnly, decision: "approve" }), /aren't an approver/);

// ---- back to the default: the director is blocked again, foreign ids still not echoed
await exp.saveApproverAccessPortable(mina, { societyId: S, approverAccess: "finance_writers" });
assert.equal(await auditCount(), 2);
await assert.rejects(() => exp.decidePortable(jordan, { id: ownersOnly, decision: "approve" }), /finance edit access/);
await assert.rejects(
  () => exp.bulkApprovePortable(jordan, { societyId: S, ids: [ownersOnly, foreignClaim] }),
  (error: any) => /finance edit access/.test(error.message) && !error.message.includes(String(foreignClaim)),
);
const minaBulk = await exp.bulkApprovePortable(mina, { societyId: S, ids: [ownersOnly, foreignClaim] });
assert.equal(minaBulk.approved, 1);
assert.equal(minaBulk.notFound, 1);
assert.ok(!JSON.stringify(minaBulk).includes(String(foreignClaim)));

// action policy: decide/bulkApprove need finance read (the handler applies the setting); setStatus needs financials:write
await requireFunctionAction(jordan, "expenseReports:decide", "mutation", { id: "static_expense_bus_rental", decision: "approve" });
await requireFunctionAction(viewer, "expenseReports:bulkApprove", "mutation", { societyId: S, ids: [] });
await assert.rejects(() => requireFunctionAction(jordan, "expenseReports:setStatus", "mutation", { id: "static_expense_bus_rental", status: "Paid" }), /financials:write/);
await assert.rejects(() => exp.saveApprovalRulesPortable(mina, { societyId: S, rules: [{ minAmountCents: 1000, requiredApprovals: 1 }] }), /\$0/);
await exp.saveApprovalRulesPortable(mina, { societyId: S, rules: [] });
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(q.policy.source, "signing_authority");
console.log("Finance workflow checks passed: periods, rules, approvals and approver access.");

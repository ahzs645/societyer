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
import { DEFAULT_APPROVAL_RULES, FINANCE_EDIT_REQUIRED_REASON, approvalRuleWarnings, diffApprovalRules, financeControlFindings } from "../shared/expenseApprovals";
import { EMPTY_CLAIM_POLICY, claimSubmissionDecision, evaluateClaimPolicy, findLikelyDuplicate, nextReminderAt, validateClaimPolicy } from "../shared/expensePolicy";
import * as dashboard from "../shared/functions/dashboard";
import { todayDateOnly } from "../shared/dateOnly";

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
await assert.rejects(() => rules.upsertPortable(mina, { societyId: S, name: "", conditions: [], actions: {} }), /condition/);

// The workspace reports overlap for every rule; the demo rules don't shadow each other.
for (const rule of ws.rules) {
  assert.ok(rule.coverage && rule.coverage.matches === rule.matchCount, `${rule.name} has coverage`);
  assert.deepEqual(rule.problems, [], `${rule.name} needs no attention`);
}
// A blank name is generated, stays "auto", and follows edits.
const autoId = await rules.upsertPortable(mina, { societyId: S, conditions: [{ field: "payee", operator: "contains", value: "coastal hydro" }, { field: "direction", value: "out" }], actions: { category: "Utilities" } });
let autoRow = await db.get(autoId);
assert.equal(autoRow.name, "Coastal Hydro → Utilities");
assert.equal(autoRow.autoNamed, true);
ws = await rules.workspacePortable(mina, { societyId: S });
const autoWs = ws.rules.find((r: any) => r._id === autoId);
assert.equal(autoWs.autoNamed, true);
// It sits last, under "Coastal Hydro to facilities", which takes every match.
const hydroRule = ws.rules.find((r: any) => r.name === "Coastal Hydro to facilities");
assert.equal(autoWs.coverage.wins, 0);
assert.deepEqual(autoWs.coverage.shadowedBy, [{ ruleId: hydroRule._id, count: autoWs.matchCount }]);
assert.equal(autoWs.pendingCount, 0, "a shadowed rule has nothing to apply");
await rules.upsertPortable(mina, { id: autoId, societyId: S, name: " ", conditions: [{ field: "payee", operator: "in", values: ["Coastal Hydro", "coastal hydro", "Harbourline Telecom"] }], actions: { category: "Utilities" } });
autoRow = await db.get(autoId);
assert.equal(autoRow.name, "Coastal Hydro and 1 more → Utilities", "the generated name follows the conditions");
assert.deepEqual(autoRow.conditions, [{ field: "payee", operator: "in", value: "", values: ["Coastal Hydro", "Harbourline Telecom"] }], "is-any-of values are stored de-duplicated");
await rules.upsertPortable(mina, { id: autoId, societyId: S, name: "Utilities by payee", conditions: autoRow.conditions, actions: { category: "Utilities" } });
assert.equal((await db.get(autoId)).autoNamed, false);
await assert.rejects(
  () => rules.upsertPortable(mina, { societyId: S, conditions: [{ field: "payee", operator: "in", values: Array.from({ length: 26 }, (_, i) => `P${i}`) }], actions: { category: "X" } }),
  /at most 25/,
);
await rules.removePortable(mina, { id: autoId });

// A rule whose account was removed needs attention and is skipped when applying.
const scratchAccount = await db.insert("financialAccounts", { societyId: S, connectionId: seed.financialAccounts[0].connectionId, externalId: "scratch-6100", code: "6100", name: "Scratch fees", currency: "CAD", accountType: "Expense", balanceCents: 0, isRestricted: false });
const brokenId = await rules.upsertPortable(mina, { societyId: S, conditions: [{ field: "payee", operator: "contains", value: "coastal hydro" }], actions: { category: "Facilities", accountingAccountId: scratchAccount } });
assert.equal((await db.get(brokenId)).name, "Coastal Hydro → Facilities");
await rules.reorderPortable(mina, { societyId: S, orderedIds: [brokenId, ...ws.rules.filter((r: any) => r._id !== autoId).map((r: any) => r._id)] });
await db.delete(scratchAccount);
ws = await rules.workspacePortable(mina, { societyId: S });
const broken = ws.rules.find((r: any) => r._id === brokenId);
assert.deepEqual(broken.problems, ["the account was removed"]);
assert.equal(ws.invalidRuleCount, 1);
assert.equal(broken.pendingCount, 0, "an invalid rule has nothing to apply");
assert.equal(ws.rules.find((r: any) => r._id === hydroRule._id).coverage.wins, hydroRule.coverage.wins, "an invalid rule above takes nothing");
await assert.rejects(() => rules.applyToUncategorizedPortable(mina, { societyId: S, ruleId: brokenId }), /needs attention: the account was removed/);
const skippedRun = await rules.applyToUncategorizedPortable(mina, { societyId: S });
assert.deepEqual(skippedRun.skippedRules, [{ name: "Coastal Hydro → Facilities", problem: "the account was removed" }]);
assert.equal((await db.get(latestHydro._id)).ruleId, hydroRule._id, "the valid rule below categorised the line");
await rules.undoBatchPortable(mina, { societyId: S, batch: skippedRun.batchId });
await rules.removePortable(mina, { id: brokenId });

// A "category is" rule re-codes lines a rule categorised, but never hand edits.
const recodeId = await rules.upsertPortable(mina, { societyId: S, conditions: [{ field: "category", value: "Donations" }], actions: { markReviewed: true } });
ws = await rules.workspacePortable(mina, { societyId: S });
const recodeRow = ws.rules.find((r: any) => r._id === recodeId);
assert.equal(recodeRow.name, "Donations → Reviewed");
assert.ok(recodeRow.pendingCount > 0, "re-code rules preview categorised lines");
const someDonation = seed.financialTransactions.find((t: any) => t.category === "Donations");
await db.patch(someDonation._id, { categorizedBy: "manual" });
const recodeRun = await rules.applyToUncategorizedPortable(mina, { societyId: S, ruleId: recodeId });
assert.equal(recodeRun.applied, recodeRow.pendingCount - 1, "the hand-categorised line is left alone");
assert.equal((await db.get(someDonation._id)).ruleId, undefined);
const again = await rules.applyToUncategorizedPortable(mina, { societyId: S, ruleId: recodeId });
assert.equal(again.applied, 0, "a re-code rule applies once");
await rules.undoBatchPortable(mina, { societyId: S, batch: recodeRun.batchId });
await rules.removePortable(mina, { id: recodeId });

// ---- approvals (default approver access: finance edit access required)
// Mina = Owner, Avery = Admin (both finance writers); Jordan = Director with
// read-only finance access; a Viewer is added below.
let q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.deepEqual(q.counts, { awaiting: 5, awaitingMe: 4, approved: 1, paid: 1, closed: 2, drafts: 2 });
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

// ---- expense-claim policy: pure helpers
const policy75 = { receiptOverCents: 7500, noteOverCents: 50000, maxAgeDays: 60, enforcement: "warn" as const };
assert.deepEqual(evaluateClaimPolicy(policy75, { amountCents: 7500, incurredAtISO: "2026-04-01" }, "2026-04-02"), [], "the thresholds are 'over', so exactly $75 needs no receipt");
assert.deepEqual(evaluateClaimPolicy(policy75, { amountCents: 60000, incurredAtISO: "2026-01-01" }, "2026-04-01").map((i) => i.code), ["receipt", "note", "age"]);
assert.deepEqual(evaluateClaimPolicy(policy75, { amountCents: 60000, receiptDocumentId: "d", notes: "  Bus  ", incurredAtISO: "2026-03-01" }, "2026-04-30").map((i) => i.code), [], "60 days is still on time");
assert.deepEqual(evaluateClaimPolicy(EMPTY_CLAIM_POLICY, { amountCents: 9_999_999 }, "2026-04-01"), [], "no stored policy checks nothing");
const late = evaluateClaimPolicy(policy75, { amountCents: 100, incurredAtISO: "2026-01-01" }, "2026-03-03");
assert.equal(claimSubmissionDecision(policy75, late).allowed, true, "warn mode never blocks");
assert.equal(claimSubmissionDecision({ ...policy75, enforcement: "block" }, late).allowed, false, "block mode needs an exception");
assert.equal(claimSubmissionDecision({ ...policy75, enforcement: "block" }, late, "ok").allowed, false, "a token reason is not an exception");
assert.equal(claimSubmissionDecision({ ...policy75, enforcement: "block" }, late, "Receipt lost in transit").allowed, true);
assert.deepEqual(validateClaimPolicy({ ...policy75, maxAgeDays: 0 }), ["Enter a submission window between 1 and 730 days."]);
// duplicates: same party and amount within ±14 days; soft hint, closest wins
const dupes = [
  { _id: "a", partyKey: "user:1", amountCents: 5000, date: "2026-04-01", title: "Taxi" },
  { _id: "b", partyKey: "user:1", amountCents: 5000, date: "2026-04-10", title: "Taxi again" },
  { _id: "c", partyKey: "user:2", amountCents: 5000, date: "2026-04-12", title: "Someone else" },
];
assert.equal(findLikelyDuplicate({ partyKey: "user:1", amountCents: 5000, date: "2026-04-12" }, dupes)?._id, "b");
assert.equal(findLikelyDuplicate({ partyKey: "user:1", amountCents: 5000, date: "2026-04-30" }, dupes), null, "outside the 14-day window");
assert.equal(findLikelyDuplicate({ partyKey: "user:1", amountCents: 5001, date: "2026-04-10" }, dupes), null, "a different amount is not a duplicate");
assert.equal(findLikelyDuplicate({ _id: "b", partyKey: "user:1", amountCents: 5000, date: "2026-04-10" }, dupes)?._id, "a", "a record is never its own duplicate");
assert.equal(nextReminderAt(new Date(Date.now() - 23 * 3600_000).toISOString()) !== null, true, "reminded 23h ago: wait");
assert.equal(nextReminderAt(new Date(Date.now() - 25 * 3600_000).toISOString()), null, "reminded 25h ago: allowed");

// ---- the demo tells the policy story
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.deepEqual([q.claimPolicy.receiptOverCents, q.claimPolicy.noteOverCents, q.claimPolicy.maxAgeDays, q.claimPolicy.enforcement], [7500, 50000, 60, "warn"]);
const dinner = q.rows.find((row: any) => row._id === "static_expense_appreciation_dinner");
assert.match(dinner.policyException.reason, /re-sending the itemized receipt/);
assert.deepEqual(evaluateClaimPolicy(policy75, dinner, "2026-04-13").map((issue) => issue.code), ["receipt", "note"], "the exception covers a missing receipt and note");
const repeat = q.rows.find((row: any) => row._id === "static_expense_bus_rental_repeat");
assert.equal(repeat.possibleDuplicate._id, "static_expense_bus_rental", "the repeated bus rental points at the approved one");

// ---- saving the policy needs finance edit access and is audited
const policyAudit = async () => (await db.query("activity").withIndex("by_society", (x: any) => x.eq("societyId", S)).collect()).filter((a: any) => a.action === "claim-policy-changed").length;
await assert.rejects(() => exp.saveClaimPolicyPortable(jordan, { societyId: S, receiptOverCents: 7500, enforcement: "block" }), /financials:write/);
await assert.rejects(() => requireFunctionAction(viewer, "expenseReports:saveClaimPolicy", "mutation", { societyId: S, enforcement: "block" }), /financials:write/);
await assert.rejects(() => exp.saveClaimPolicyPortable(mina, { societyId: S, maxAgeDays: 0, enforcement: "block" }), /submission window/);
assert.equal(await policyAudit(), 0);
await exp.saveClaimPolicyPortable(mina, { societyId: S, receiptOverCents: 7500, noteOverCents: 50000, maxAgeDays: 60, enforcement: "block" });
assert.equal(await policyAudit(), 1, "the policy change is in the activity log");
await exp.saveClaimPolicyPortable(mina, { societyId: S, receiptOverCents: 7500, noteOverCents: 50000, maxAgeDays: 60, enforcement: "block" });
assert.equal(await policyAudit(), 1, "saving the same policy records nothing new");

// ---- block: submitting without a receipt fails until an exception is requested (upsert and setStatus)
const today = todayDateOnly();
const taxi = (extra: Record<string, unknown> = {}) => exp.upsertPortable(avery, { societyId: S, claimantName: "Avery Santos", claimantUserId: "static_user_secretary", title: "Airport taxi", category: "Travel", amountCents: 9600, currency: "CAD", incurredAtISO: today, status: "Submitted", ...extra });
await assert.rejects(() => taxi(), /need a receipt/);
await assert.rejects(() => taxi({ policyExceptionReason: "Lost" }), /request an exception/);
const taxiId = await taxi({ policyExceptionReason: "Driver had no card reader; paid cash" });
const taxiRow = await db.get(taxiId);
assert.equal(taxiRow.status, "Submitted");
assert.equal(taxiRow.policyException.reason, "Driver had no card reader; paid cash");
assert.equal(taxiRow.policyException.by, "Avery Santos");
assert.match(taxiRow.approvalTrail.at(-1).note, /Policy exception/);
await assert.rejects(() => exp.setStatusPortable(mina, { id: "static_expense_office_chair", status: "Submitted" }), /need a receipt/);
await exp.setStatusPortable(mina, { id: "static_expense_office_chair", status: "Submitted", policyExceptionReason: "Bought at a market stall, no receipt" });
assert.equal((await db.get("static_expense_office_chair")).policyException.reason, "Bought at a market stall, no receipt");
// A drafted claim within the policy saves without any exception.
const drafted = await exp.upsertPortable(avery, { societyId: S, claimantName: "Avery Santos", claimantUserId: "static_user_secretary", title: "Stamps", category: "Supplies", amountCents: 1200, currency: "CAD", incurredAtISO: today, status: "Submitted" });
assert.equal((await db.get(drafted)).policyException, undefined);
// warn: submission goes ahead, approvers see the flag
await exp.saveClaimPolicyPortable(mina, { societyId: S, receiptOverCents: 7500, enforcement: "warn" });
const flaggedId = await exp.upsertPortable(avery, { societyId: S, claimantName: "Avery Santos", claimantUserId: "static_user_secretary", title: "Courier", category: "Supplies", amountCents: 8800, currency: "CAD", incurredAtISO: today, status: "Submitted" });
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.deepEqual(q.rows.find((row: any) => row._id === flaggedId).policyIssues.map((issue: any) => issue.code), ["receipt"]);

// ---- receipts attach without resetting approvals
const receiptDoc = await db.insert("documents", { societyId: S, title: "Courier receipt.pdf", category: "Receipt", tags: ["receipt"] });
await exp.attachReceiptPortable(avery, { id: flaggedId, receiptDocumentId: receiptDoc });
assert.equal((await db.get(flaggedId)).receiptDocumentId, receiptDoc);
assert.equal((await db.get(flaggedId)).status, "Submitted");
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.deepEqual(q.rows.find((row: any) => row._id === flaggedId).policyIssues, [], "the receipt clears the flag");
const foreignDoc = await db.insert("documents", { societyId: otherSociety, title: "Elsewhere", category: "Receipt", tags: [] });
await assert.rejects(() => exp.attachReceiptPortable(avery, { id: flaggedId, receiptDocumentId: foreignDoc }));

// ---- duplicate hints on new claims
const dupId = await exp.upsertPortable(avery, { societyId: S, claimantName: "Avery Santos", claimantUserId: "static_user_secretary", title: "Courier (again)", category: "Supplies", amountCents: 8800, currency: "CAD", incurredAtISO: today, status: "Draft" });
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(q.rows.find((row: any) => row._id === dupId).possibleDuplicate._id, flaggedId);

// ---- reminders: requester or finance writer, notification + Outbox draft, once per 24h
const notificationsFor = async (userId: string) => (await db.query("notifications").withIndex("by_society", (x: any) => x.eq("societyId", S)).collect()).filter((n: any) => n.userId === userId && n.kind === "approval");
const outboxBefore = (await db.query("pendingEmails").withIndex("by_society", (x: any) => x.eq("societyId", S)).collect()).length;
await assert.rejects(() => exp.remindApproversPortable(viewer, { id: "static_expense_bus_rental_repeat" }), /requester or someone with finance edit access/);
await requireFunctionAction(jordan, "expenseReports:remindApprovers", "mutation", { id: "static_expense_bus_rental_repeat" });
const reminded = await exp.remindApproversPortable(jordan, { id: "static_expense_bus_rental_repeat" });
assert.equal(reminded.notified, 2, "the requester reminds both finance writers who can approve");
assert.equal((await notificationsFor("static_user_secretary")).length, 1);
assert.match((await notificationsFor("static_user_secretary"))[0].linkHref, /\/app\/approvals\?claim=static_expense_bus_rental_repeat$/);
assert.equal((await notificationsFor("static_user_treasurer")).length, 0, "the requester is never reminded about their own claim");
const outboxAfter = await db.query("pendingEmails").withIndex("by_society", (x: any) => x.eq("societyId", S)).collect();
assert.equal(outboxAfter.length, outboxBefore + (reminded.emailDrafted ? 1 : 0));
await assert.rejects(() => exp.remindApproversPortable(mina, { id: "static_expense_bus_rental_repeat" }), /last 24 hours/, "rate-limited per claim, whoever asks");
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(q.rows.find((row: any) => row._id === "static_expense_bus_rental_repeat").canRemind, false);
await db.patch("static_expense_bus_rental_repeat", { lastReminderAtISO: new Date(Date.now() - 25 * 3600_000).toISOString() });
assert.equal((await exp.remindApproversPortable(mina, { id: "static_expense_bus_rental_repeat" })).notified, 1, "after 24h; the sender is not reminded");
await assert.rejects(() => exp.remindApproversPortable(mina, { id: "static_expense_zoom_plan" }), /awaiting approval/);
await assert.rejects(() => exp.remindApproversPortable(mina, { id: foreignClaim }));

// ---- approval-rule change control: a second approver, never the proposer
const pendingRules = [{ minAmountCents: 0, requiredApprovals: 1 }, { minAmountCents: 200000, requiredApprovals: 2 }];
await assert.rejects(() => exp.setRulesChangeControlPortable(jordan, { societyId: S, enabled: true }), /financials:write/);
await exp.setRulesChangeControlPortable(mina, { societyId: S, enabled: true });
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(q.changeControl.enabled, true);
const proposal = await exp.saveApprovalRulesPortable(mina, { societyId: S, rules: pendingRules });
assert.equal(proposal.pending, true);
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(q.policy.source, "signing_authority", "nothing changes until a second approver accepts");
assert.equal(q.changeControl.pending.isMine, true);
assert.equal(q.changeControl.pending.canDecide, false);
assert.ok(q.changeControl.pending.diff.some((line: any) => line.kind === "added" && line.thresholdCents === 200000), "the diff shows the new threshold");
await assert.rejects(() => exp.saveApprovalRulesPortable(avery, { societyId: S, rules: [] }), /pending change/, "rules can't be edited while a change is pending");
await assert.rejects(() => exp.setRulesChangeControlPortable(mina, { societyId: S, enabled: false }), /pending change/);
await assert.rejects(() => exp.decidePolicyChangePortable(mina, { id: proposal.changeId, decision: "approve" }), /You proposed this change/);
await assert.rejects(() => exp.decidePolicyChangePortable(viewer, { id: proposal.changeId, decision: "approve" }), /owners, admins and directors/);
await assert.rejects(() => exp.decidePolicyChangePortable(avery, { id: proposal.changeId, decision: "withdraw" }), /proposed this change can withdraw/);
await requireFunctionAction(jordan, "expenseReports:decidePolicyChange", "mutation", { id: proposal.changeId, decision: "approve" });
assert.equal((await exp.decidePolicyChangePortable(jordan, { id: proposal.changeId, decision: "approve" })).status, "approved", "a read-only director may be the second approver");
q = await exp.approvalQueuePortable(mina, { societyId: S });
assert.equal(q.policy.source, "configured");
assert.deepEqual(q.policy.rules.map((rule: any) => [rule.minAmountCents, rule.requiredApprovals]), [[0, 1], [200000, 2]]);
assert.equal(q.changeControl.pending, null);
await assert.rejects(() => exp.decidePolicyChangePortable(avery, { id: proposal.changeId, decision: "decline" }), /already been decided/);
// Turning change control off is itself a change: declined, withdrawn, then approved.
const off1 = await exp.setRulesChangeControlPortable(mina, { societyId: S, enabled: false });
assert.equal(off1.pending, true);
await exp.decidePolicyChangePortable(avery, { id: off1.changeId, decision: "decline", reason: "Keep dual control for the audit" });
assert.equal((await exp.approvalQueuePortable(mina, { societyId: S })).changeControl.enabled, true);
const off2 = await exp.setRulesChangeControlPortable(mina, { societyId: S, enabled: false });
await exp.decidePolicyChangePortable(mina, { id: off2.changeId, decision: "withdraw" });
const off3 = await exp.setRulesChangeControlPortable(mina, { societyId: S, enabled: false });
await exp.decidePolicyChangePortable(avery, { id: off3.changeId, decision: "approve" });
assert.equal((await exp.approvalQueuePortable(mina, { societyId: S })).changeControl.enabled, false);
const changeAudit = (await db.query("activity").withIndex("by_society", (x: any) => x.eq("societyId", S)).collect()).filter((a: any) => a.entityType === "approvalPolicyChanges").map((a: any) => a.action);
assert.deepEqual(changeAudit, ["approval-change-control-on", "approval-change-proposed", "approval-change-approved", "approval-change-proposed", "approval-change-declined", "approval-change-proposed", "approval-change-withdrawn", "approval-change-proposed", "approval-change-approved"]);
// another workspace's change is never decidable from here
const foreignChange = await db.insert("approvalPolicyChanges", { societyId: otherSociety, kind: "rules", status: "pending", proposedRules: [], previousRules: [], proposedByName: "Someone Else", createdAtISO: "2026-04-01T00:00:00.000Z", updatedAtISO: "2026-04-01T00:00:00.000Z" });
await assert.rejects(() => exp.decidePolicyChangePortable(avery, { id: foreignChange, decision: "approve" }));
assert.equal((await db.get(foreignChange)).status, "pending");

// ---- rule overlap warnings and the diff
const warn = (rules: any[]) => approvalRuleWarnings(rules.map((rule) => ({ approverRoles: [], approverUserIds: [], blockSelfApproval: true, enabled: true, ...rule })));
assert.deepEqual(warn([{ minAmountCents: 0, requiredApprovals: 1 }, { minAmountCents: 100000, requiredApprovals: 2 }]), []);
assert.match(warn([{ minAmountCents: 0, requiredApprovals: 2 }, { minAmountCents: 100000, requiredApprovals: 1 }])[0].message, /overlaps/);
assert.match(warn([{ minAmountCents: 0, requiredApprovals: 1 }, { minAmountCents: 0, requiredApprovals: 2 }])[0].message, /already starts at \$0/);
assert.match(warn([{ minAmountCents: 0, requiredApprovals: 1 }, { minAmountCents: 50000, requiredApprovals: 1 }])[0].message, /changes nothing/);
assert.match(warn([{ minAmountCents: 0, requiredApprovals: 1 }, { minAmountCents: 50000, requiredApprovals: 1, blockSelfApproval: false }])[0].message, /approve their own/);
assert.deepEqual(
  diffApprovalRules([{ minAmountCents: 0, requiredApprovals: 1, approverRoles: [], approverUserIds: [], blockSelfApproval: true, enabled: true }], [{ minAmountCents: 0, requiredApprovals: 2, approverRoles: ["Director"], approverUserIds: [], blockSelfApproval: true, enabled: true }]).map((line) => line.kind),
  ["changed"],
);

// ---- finance-control findings reach the compliance checks with a Fix link
const ids = (findings: { id: string }[]) => findings.map((finding) => finding.id).sort();
const base = { approverRoles: [], approverUserIds: [], enabled: true };
assert.deepEqual(ids(financeControlFindings([{ ...base, minAmountCents: 0, requiredApprovals: 1, blockSelfApproval: true }], { asOf: today, rulesAreConfigured: true })), ["FINANCE-CONTROL-SINGLE-APPROVAL"]);
assert.deepEqual(ids(financeControlFindings([{ ...base, minAmountCents: 0, requiredApprovals: 1, blockSelfApproval: true }, { ...base, minAmountCents: 100000, requiredApprovals: 2, blockSelfApproval: false }], { asOf: today, rulesAreConfigured: true })), ["FINANCE-CONTROL-SELF-APPROVAL"]);
const tiers = [{ status: "Active", authorityType: "signing", tiers: [{ maxCents: 500000, signaturesRequired: 1 }, { minCents: 500001, signaturesRequired: 2 }] }];
assert.deepEqual(ids(financeControlFindings([{ ...base, minAmountCents: 0, requiredApprovals: 1, blockSelfApproval: true }, { ...base, minAmountCents: 1000000, requiredApprovals: 2, blockSelfApproval: true }], { signingAuthorities: tiers, asOf: today, rulesAreConfigured: true })), ["FINANCE-CONTROL-SIGNING-AUTHORITY"], "a $10,000 dual threshold leaves $5,000.01-$9,999.99 short of the signing authority");
assert.deepEqual(ids(financeControlFindings(DEFAULT_APPROVAL_RULES, { signingAuthorities: tiers, asOf: today, rulesAreConfigured: false })), [], "derived rules never fall behind");
let dash = await dashboard.summaryPortable(mina, { societyId: S });
assert.ok(!dash.complianceFlags.some((flag: any) => flag.ruleId.startsWith("FINANCE-CONTROL")), "the configured $2,000 dual threshold is within the signing authority");
await exp.saveApprovalRulesPortable(mina, { societyId: S, rules: [{ minAmountCents: 0, requiredApprovals: 1, blockSelfApproval: false }] });
dash = await dashboard.summaryPortable(mina, { societyId: S });
const financeFlags = dash.complianceFlags.filter((flag: any) => flag.ruleId.startsWith("FINANCE-CONTROL"));
assert.deepEqual(financeFlags.map((flag: any) => flag.ruleId).sort(), ["FINANCE-CONTROL-SELF-APPROVAL", "FINANCE-CONTROL-SIGNING-AUTHORITY", "FINANCE-CONTROL-SINGLE-APPROVAL"]);
assert.ok(financeFlags.every((flag: any) => flag.remediationActions[0].to === "/app/approvals?tab=rules"), "each finding links to the approval rules");
assert.ok(!dash.complianceFlags.some((flag: any) => flag.ruleId === "DASHBOARD-COMPLIANCE-OK"));
for (const flag of financeFlags) assert.doesNotMatch(flag.text, /\bsociet(y|ies)\b|\bcorporation\b/i, "entity-neutral copy");
const viewerDash = await dashboard.summaryPortable(viewer, { societyId: S });
assert.ok(viewerDash.complianceFlags.some((flag: any) => flag.ruleId === "FINANCE-CONTROL-SELF-APPROVAL"), "finance readers see the findings");
console.log("Finance workflow checks passed: periods, rules, approvals, approver access, claim policy, exceptions, duplicates, reminders, change control and finance controls.");

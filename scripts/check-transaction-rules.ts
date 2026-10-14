import assert from "node:assert/strict";
import {
  conditionMatches,
  findMatchingRule,
  isUncategorized,
  payeeKey,
  restoreRuleFieldsPatch,
  ruleActionPatch,
  ruleMatches,
  snapshotRuleFields,
  suggestStarterRules,
  validateRule,
  describeCondition,
  type TransactionRuleLike,
} from "../shared/transactionRules";
import {
  DEFAULT_APPROVAL_RULES,
  approvalProgress,
  approverEligibility,
  normalizeApproverAccess,
  ruleForAmount,
  rulesFromSigningAuthorities,
  validateApprovalRules,
} from "../shared/expenseApprovals";

const hydro = { _id: "t1", description: "BC HYDRO 0042 PAYMENT", amountCents: -8421, accountId: "bank" };
const donation = { _id: "t2", description: "E-TRANSFER Riverside Donor", counterparty: "Avery Santos", amountCents: 5000, accountId: "bank" };
const big = { _id: "t3", description: "Hall rent", amountCents: -400000, accountId: "card" };

// --- text conditions are case-insensitive and whitespace-tolerant ---
assert.ok(conditionMatches({ field: "description", operator: "contains", value: "bc hydro" }, hydro));
assert.ok(conditionMatches({ field: "description", operator: "contains", value: "  BC   Hydro " }, hydro), "extra whitespace ignored");
assert.ok(conditionMatches({ field: "description", operator: "starts_with", value: "Bc Hy" }, hydro));
assert.ok(!conditionMatches({ field: "description", operator: "starts_with", value: "hydro" }, hydro));
assert.ok(conditionMatches({ field: "description", operator: "equals", value: "bc hydro 0042 payment" }, hydro));
assert.ok(!conditionMatches({ field: "description", operator: "equals", value: "bc hydro" }, hydro));
assert.ok(!conditionMatches({ field: "description", operator: "contains", value: "   " }, hydro), "blank text never matches");

// --- payee uses counterparty, falling back to description ---
assert.ok(conditionMatches({ field: "payee", operator: "equals", value: "avery santos" }, donation));
assert.ok(!conditionMatches({ field: "payee", operator: "contains", value: "riverside" }, donation), "counterparty wins over description");
assert.ok(conditionMatches({ field: "payee", operator: "contains", value: "hydro" }, hydro), "no counterparty -> description");

// --- amount bounds compare magnitude in cents ---
assert.ok(conditionMatches({ field: "amount", operator: "lt", amountCents: 8422 }, hydro));
assert.ok(!conditionMatches({ field: "amount", operator: "lt", amountCents: 8421 }, hydro), "lt is strict");
assert.ok(conditionMatches({ field: "amount", operator: "lte", amountCents: 8421 }, hydro), "lte includes the bound");
assert.ok(conditionMatches({ field: "amount", operator: "eq", amountCents: 8421 }, hydro));
assert.ok(conditionMatches({ field: "amount", operator: "gte", amountCents: 8421 }, hydro), "gte includes the bound");
assert.ok(!conditionMatches({ field: "amount", operator: "gt", amountCents: 8421 }, hydro), "gt is strict");
assert.ok(conditionMatches({ field: "amount", operator: "between", amountCents: 8421, amountMaxCents: 9000 }, hydro), "between includes lower bound");
assert.ok(conditionMatches({ field: "amount", operator: "between", amountCents: 1000, amountMaxCents: 8421 }, hydro), "between includes upper bound");
assert.ok(conditionMatches({ field: "amount", operator: "between", amountCents: 9000, amountMaxCents: 8000 }, { ...hydro, amountCents: -8500 }), "reversed bounds are normalised");
assert.ok(!conditionMatches({ field: "amount", operator: "between", amountCents: 1, amountMaxCents: 8420 }, hydro));

// --- direction and account ---
assert.ok(conditionMatches({ field: "direction", value: "out" }, hydro));
assert.ok(!conditionMatches({ field: "direction", value: "in" }, hydro));
assert.ok(conditionMatches({ field: "direction", value: "in" }, donation));
assert.ok(conditionMatches({ field: "account", accountId: "card" }, big));
assert.ok(!conditionMatches({ field: "account", accountId: "card" }, hydro));

// --- conditions are ANDed; an empty rule never matches ---
assert.ok(ruleMatches({ conditions: [{ field: "payee", operator: "contains", value: "hydro" }, { field: "direction", value: "out" }] }, hydro));
assert.ok(!ruleMatches({ conditions: [{ field: "payee", operator: "contains", value: "hydro" }, { field: "direction", value: "in" }] }, hydro));
assert.ok(!ruleMatches({ conditions: [] }, hydro));

// --- precedence: lowest priority number first; disabled or action-less rules skipped ---
const rule = (id: string, priority: number, extra: Partial<TransactionRuleLike> = {}): TransactionRuleLike & { _id: string } => ({
  _id: id,
  name: id,
  priority,
  enabled: true,
  conditions: [{ field: "direction", value: "out" }],
  actions: { category: id },
  ...extra,
});
const broad = rule("broad", 2);
const specific = rule("specific", 1, { conditions: [{ field: "description", operator: "contains", value: "hydro" }] });
assert.equal(findMatchingRule([broad, specific], hydro)?._id, "specific", "higher-priority specific rule wins");
assert.equal(findMatchingRule([broad, specific], big)?._id, "broad", "falls through to the broad rule");
assert.equal(findMatchingRule([{ ...specific, enabled: false }, broad], hydro)?._id, "broad", "disabled rules are skipped");
assert.equal(findMatchingRule([{ ...specific, actions: {} }, broad], hydro)?._id, "broad", "rules without actions are skipped");
assert.equal(findMatchingRule([rule("b", 1), rule("a", 1)], hydro)?._id, "a", "ties break on id, deterministically");
assert.equal(findMatchingRule([broad], donation), null);

// --- action patch, provenance and exact undo ---
const patch = ruleActionPatch({ ...specific, actions: { category: " Utilities ", accountingAccountId: "acct_5200", markReviewed: true } }, "2026-10-14T00:00:00.000Z");
assert.deepEqual(patch, { categorizedBy: "rule", ruleId: "specific", category: "Utilities", accountingAccountId: "acct_5200", reviewedAtISO: "2026-10-14T00:00:00.000Z" });
const before = snapshotRuleFields({ category: "Misc", categorizedBy: "manual", description: "x" });
assert.deepEqual(before, { category: "Misc", categorizedBy: "manual" });
const restore = restoreRuleFieldsPatch(before);
assert.equal(restore.category, "Misc");
assert.equal(restore.categorizedBy, "manual");
assert.equal(restore.ruleId, undefined);
assert.equal(restore.accountingAccountId, undefined);
assert.ok("ruleApplication" in restore && restore.ruleApplication === undefined);

// --- uncategorised detection ---
assert.ok(isUncategorized({ category: undefined }));
assert.ok(isUncategorized({ category: "  " }));
assert.ok(isUncategorized({ category: "Uncategorized" }));
assert.ok(isUncategorized({ category: "uncategorised" }));
assert.ok(!isUncategorized({ category: "Utilities" }));

// --- validation ---
assert.deepEqual(validateRule({ name: "Hydro", conditions: specific.conditions, actions: { category: "Utilities" } }), []);
assert.ok(validateRule({ name: "", conditions: [], actions: {} }).length >= 3);
assert.ok(validateRule({ name: "x", conditions: [{ field: "amount", operator: "between", amountCents: 500, amountMaxCents: 100 }], actions: { markReviewed: true } }).some((e) => /upper amount/.test(e)));
assert.ok(validateRule({ name: "x", conditions: [{ field: "amount", operator: "gte", amountCents: -1 }], actions: { markReviewed: true } }).some((e) => /positive/.test(e)));

// --- starter suggestions from frequent payees ---
assert.equal(payeeKey("BC HYDRO 0042 PAYMENT #881"), "bc hydro payment");
const history = [
  { _id: "h1", description: "BC HYDRO 0042 PAYMENT", amountCents: -8000, category: "Utilities" },
  { _id: "h2", description: "BC Hydro 0043 payment", amountCents: -8100 },
  { _id: "h3", description: "BC HYDRO 0044 PAYMENT", amountCents: -7900, category: "Utilities" },
  { _id: "h4", description: "Square deposit 1", counterparty: "Square", amountCents: 1000 },
  { _id: "h5", description: "Square deposit 2", counterparty: "Square", amountCents: 1200 },
  { _id: "h6", description: "One-off vendor", amountCents: -500 },
];
const suggestions = suggestStarterRules(history, []);
assert.equal(suggestions[0].key, "bc hydro payment");
assert.deepEqual(suggestions[0].condition, { field: "payee", operator: "contains", value: "bc hydro" }, "condition is the shared leading words");
assert.equal(suggestions[0].count, 3);
assert.equal(suggestions[0].label, "BC Hydro Payment", "initialisms keep their capitals");
assert.equal(suggestions[0].suggestedCategory, "Utilities");
assert.deepEqual(suggestions[0].transactionIds, ["h1", "h2", "h3"]);
assert.equal(suggestions[1].key, "square");
assert.equal(suggestions.length, 2, "single transactions are not suggested");
const covered = suggestStarterRules(history, [rule("hydro", 1, { conditions: [{ field: "payee", operator: "contains", value: "hydro" }] })]);
assert.ok(!covered.some((s) => s.key === "bc hydro payment"), "payees an existing rule covers are not suggested again");

assert.equal(describeCondition({ field: "amount", operator: "between", amountCents: 1000, amountMaxCents: 2500 }), "amount is between $10.00 and $25.00");
assert.equal(describeCondition({ field: "payee", operator: "starts_with", value: "BC" }), 'payee starts with "BC"');

// --- expense approval thresholds ---
assert.equal(ruleForAmount(DEFAULT_APPROVAL_RULES, 4999_99)?.requiredApprovals, 1);
assert.equal(ruleForAmount(DEFAULT_APPROVAL_RULES, 5000_00)?.requiredApprovals, 2, "threshold is inclusive");
assert.deepEqual(validateApprovalRules(DEFAULT_APPROVAL_RULES), []);
assert.ok(validateApprovalRules([{ ...DEFAULT_APPROVAL_RULES[1] }]).some((e) => /\$0/.test(e)), "a $0 rule is required");
const fromSigning = rulesFromSigningAuthorities([
  { status: "Active", authorityType: "signing", tiers: [{ maxCents: 500000, signaturesRequired: 1 }, { minCents: 500001, maxCents: 1000000, signaturesRequired: 2 }, { minCents: 1000001, signaturesRequired: 2 }] },
  { status: "Superseded", authorityType: "signing", tiers: [{ minCents: 0, signaturesRequired: 3 }] },
], "2026-10-14");
assert.deepEqual(fromSigning?.map((r) => [r.minAmountCents, r.requiredApprovals]), [[0, 1], [500001, 2]], "signing tiers become threshold rules; inactive rows ignored");
assert.equal(rulesFromSigningAuthorities([], "2026-10-14"), null);

const dual = { minAmountCents: 0, requiredApprovals: 2, approverRoles: [], approverUserIds: [], blockSelfApproval: true, enabled: true };
const claim = { amountCents: 600000, claimantUserId: "avery", approvals: [] as any[] };
assert.equal(approverEligibility(dual, { _id: "avery", role: "Admin" }, claim).eligible, false, "requester cannot approve own claim");
assert.equal(approverEligibility({ ...dual, blockSelfApproval: false }, { _id: "avery", role: "Admin" }, claim).eligible, true);
assert.equal(approverEligibility(dual, { _id: "viewer", role: "Viewer" }, claim).eligible, false, "viewers never approve");
assert.equal(approverEligibility({ ...dual, approverRoles: ["Owner"] }, { _id: "jordan", role: "Director" }, claim).eligible, false, "role restriction");
assert.equal(approverEligibility({ ...dual, approverRoles: ["Owner"], approverUserIds: ["jordan"] }, { _id: "jordan", role: "Director" }, claim).eligible, true, "named person allowed");
const voted = { ...claim, approvals: [{ userId: "mina", name: "Mina", atISO: "x" }] };
assert.equal(approverEligibility(dual, { _id: "mina", role: "Owner" }, voted).eligible, false, "one vote per person");
assert.deepEqual(approvalProgress(dual, voted), { required: 2, count: 1, remaining: 1, complete: false });
// approver access: by default finance edit access is required on top of the rule; "rule_roles" relaxes only that
const readOnly = { approverAccess: "finance_writers" as const, hasFinanceWrite: false };
assert.match((approverEligibility(dual, { _id: "jordan", role: "Director" }, claim, readOnly) as any).reason, /finance edit access/, "default blocks read-only directors");
assert.equal(approverEligibility(dual, { _id: "mina", role: "Owner" }, claim, { approverAccess: "finance_writers", hasFinanceWrite: true }).eligible, true);
assert.equal(approverEligibility(dual, { _id: "jordan", role: "Director" }, claim, { approverAccess: "rule_roles", hasFinanceWrite: false }).eligible, true, "rule_roles lets a named director approve");
assert.equal(approverEligibility({ ...dual, approverRoles: ["Owner"] }, { _id: "jordan", role: "Director" }, claim, { approverAccess: "rule_roles", hasFinanceWrite: false }).eligible, false, "rules still apply");
assert.equal(approverEligibility(dual, { _id: "viewer", role: "Viewer" }, claim, { approverAccess: "rule_roles", hasFinanceWrite: false }).eligible, false, "viewers never approve");
assert.equal(approverEligibility(dual, { _id: "avery", role: "Admin" }, claim, { approverAccess: "finance_writers", hasFinanceWrite: true }).eligible, false, "self-approval still blocked");
assert.equal(normalizeApproverAccess(undefined), "finance_writers");
assert.equal(normalizeApproverAccess("anything"), "finance_writers", "unknown values fall back to the stricter default");
assert.equal(normalizeApproverAccess("rule_roles"), "rule_roles");

console.log("Transaction rule and approval policy checks passed.");

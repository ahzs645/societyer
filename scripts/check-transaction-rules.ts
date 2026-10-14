import assert from "node:assert/strict";
import {
  MAX_IN_VALUES,
  addPayeesToConditions,
  autoRuleName,
  conditionMatches,
  conditionsKey,
  coverageMessage,
  describeRule,
  findApplicableRule,
  findDuplicateRule,
  findMatchingRule,
  rulePatchForTransaction,
  ruleCoverage,
  ruleDisplayName,
  ruleProblems,
  ruleToExtendForSuggestion,
  shadowingFor,
  isUncategorized,
  payeeKey,
  restoreRuleFieldsPatch,
  ruleActionPatch,
  ruleMatches,
  snapshotRuleFields,
  suggestStarterRules,
  validateRule,
  describeCondition,
  type RuleCondition,
  type TransactionRuleLike,
} from "../shared/transactionRules";
import { draftFromTransaction } from "../src/features/financials/rules/draftFromTransaction";
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
assert.deepEqual(validateRule({ name: "", conditions: [], actions: {} }), ["Add at least one condition.", "Choose at least one action."], "a blank name is not an error");
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

// --- "is any of": exact, case-insensitive, against any listed value ---
const anyOf = (field: "payee" | "description", values: string[]): RuleCondition => ({ field, operator: "in", value: "", values });
assert.ok(conditionMatches(anyOf("payee", ["Square", "AVERY SANTOS"]), donation), "any listed payee matches, ignoring capitals");
assert.ok(!conditionMatches(anyOf("payee", ["avery"]), donation), "is any of is exact, not contains");
assert.ok(conditionMatches(anyOf("payee", ["  bc   hydro 0042 payment "]), hydro), "payee falls back to the description; spacing ignored");
assert.ok(conditionMatches(anyOf("description", ["hall rent", "x"]), big));
assert.ok(!conditionMatches(anyOf("payee", []), donation), "an empty list never matches");
assert.ok(!conditionMatches({ field: "payee", operator: "in", value: "avery santos" }, donation), "in reads values, not value");

// --- "category is": re-codes categorised lines, never hand edits, never twice ---
const bankFee = { _id: "t4", description: "Monthly fee", amountCents: -1500, category: "Bank fees", categorizedBy: "rule", ruleId: "fee" };
assert.ok(conditionMatches({ field: "category", value: "bank FEES" }, bankFee));
assert.ok(!conditionMatches({ field: "category", value: "Bank fees" }, { ...bankFee, category: undefined }), "uncategorised lines have no category");
const recode = rule("recode", 5, { conditions: [{ field: "category", value: "Bank fees" }], actions: { accountingAccountId: "acct_6100" } });
assert.equal(findApplicableRule([broad, recode], bankFee)?._id, "recode", "categorised lines only take re-code rules");
assert.equal(findApplicableRule([broad, recode], { ...bankFee, categorizedBy: "manual" }), null, "a hand-set category is never re-coded");
assert.equal(findApplicableRule([broad, recode], { ...bankFee, ruleId: "recode" }), null, "a re-code rule applies once");
assert.equal(findApplicableRule([broad, specific], hydro)?._id, "specific", "uncategorised lines take the first matching rule");
assert.equal(findApplicableRule([broad, specific], hydro, new Set(["specific"]))?._id, "broad", "skipped (invalid) rules are passed over");
assert.equal(rulePatchForTransaction([broad, recode], { ...bankFee }, "2026-10-14T00:00:00.000Z", "b1")?.patch.accountingAccountId, "acct_6100");
assert.equal(rulePatchForTransaction([specific], { ...hydro }, "2026-10-14T00:00:00.000Z", "b1", new Set(["specific"])), null);

// --- validation: the name is optional; list and category conditions ---
assert.deepEqual(validateRule({ conditions: specific.conditions, actions: { category: "Utilities" } }), [], "no name needed");
assert.ok(validateRule({ conditions: [anyOf("payee", [])], actions: { markReviewed: true } }).some((e) => /at least one payee/.test(e)));
const tooMany = Array.from({ length: MAX_IN_VALUES + 1 }, (_, i) => `Payee ${i}`);
assert.ok(validateRule({ conditions: [anyOf("payee", tooMany)], actions: { markReviewed: true } }).some((e) => /at most 25 values \(there are 26\)/.test(e)));
assert.deepEqual(validateRule({ conditions: [anyOf("payee", tooMany.slice(0, MAX_IN_VALUES))], actions: { markReviewed: true } }), [], "25 values are allowed");
assert.ok(validateRule({ conditions: [{ field: "category", value: " " }], actions: { markReviewed: true } }).some((e) => /choose a category/.test(e)));
assert.ok(validateRule({ conditions: [{ field: "category", value: "Uncategorized" }], actions: { markReviewed: true } }).some((e) => /choose a category/.test(e)));
assert.ok(validateRule({ name: "x".repeat(121), conditions: specific.conditions, actions: { category: "U" } }).some((e) => /120/.test(e)));

// --- automatic names and the rule as a sentence ---
assert.equal(autoRuleName([{ field: "payee", operator: "contains", value: "coastal hydro" }, { field: "direction", value: "out" }], { category: "Facilities" }), "Coastal Hydro → Facilities");
assert.equal(autoRuleName([anyOf("payee", ["Square", "Stripe", "PayPal"])], { category: "Program fees" }), "Square and 2 more → Program fees");
assert.equal(autoRuleName([{ field: "payee", operator: "equals", value: "BC HYDRO" }], { category: "Utilities" }), "BC Hydro → Utilities", "all-caps payees are title-cased, initialisms kept");
assert.equal(autoRuleName([{ field: "payee", operator: "equals", value: "McKinley's Café" }], { category: "Meals" }), "McKinley's Café → Meals", "mixed case is kept as typed");
assert.equal(autoRuleName([{ field: "description", operator: "contains", value: "account fee" }], { markReviewed: true }), "“account fee” → Reviewed");
assert.equal(autoRuleName([{ field: "category", value: "Bank fees" }], { accountingAccountId: "a6100" }, { accountName: () => "Bank charges" }), "Bank fees → Bank charges");
assert.equal(autoRuleName([{ field: "amount", operator: "gt", amountCents: 50000 }, { field: "direction", value: "out" }], { category: "Capital" }), "Amounts over $500.00 → Capital");
assert.equal(autoRuleName([{ field: "account", accountId: "card" }], { fundRestrictionId: "f1" }, { accountName: () => "Visa", fundName: () => "Youth grant" }), "Visa → Youth grant");
assert.equal(autoRuleName([{ field: "direction", value: "in" }], {}), "Money in");
assert.ok(autoRuleName([{ field: "payee", operator: "contains", value: "a".repeat(120) }], { category: "X" }).length <= 80, "names are capped at 80 characters");
assert.equal(ruleDisplayName({ name: "  ", conditions: [{ field: "payee", operator: "contains", value: "donorloop" }], actions: { category: "Donations" } }), "Donorloop → Donations");
assert.equal(ruleDisplayName({ name: "Mine", conditions: [], actions: {} }), "Mine");
assert.equal(
  describeRule([{ field: "payee", operator: "contains", value: "coastal hydro" }, { field: "direction", value: "out" }], { category: "Facilities", markReviewed: true }),
  'If payee contains "coastal hydro" and money goes out → category Facilities, mark reviewed',
);
assert.equal(describeCondition(anyOf("payee", ["A", "B", "C", "D", "E"])), 'payee is any of "A", "B", "C" and 2 more');
assert.equal(describeCondition({ field: "category", value: "Bank fees" }), 'category is "Bank fees"');
const named = rulePatchForTransaction([{ ...specific, name: "" }], { ...hydro }, "2026-10-14T00:00:00.000Z", "b2");
assert.equal((named?.patch.ruleApplication as any).ruleName, "“hydro” → specific", "provenance gets the generated name when a rule has none");

// --- coverage: which rule decides each line, and who shadows whom ---
const feed = [
  ...Array.from({ length: 18 }, (_, i) => ({ _id: `f${i}`, description: `RIVERBANK FEE ${i}`, amountCents: -1500 })),
  ...Array.from({ length: 7 }, (_, i) => ({ _id: `g${i}`, description: "RIVERBANK TRANSFER", amountCents: -90000 })),
];
const feeRule = rule("fee", 1, { conditions: [{ field: "description", operator: "contains", value: "riverbank fee" }] });
const riverbank = rule("riverbank", 2, { conditions: [{ field: "description", operator: "contains", value: "riverbank" }] });
const shadowed = rule("shadowed", 3, { conditions: [{ field: "description", operator: "contains", value: "riverbank fee" }, { field: "direction", value: "out" }] });
const partial = rule("partial", 4, { conditions: [{ field: "direction", value: "out" }] });
const offRule = rule("off", 0, { enabled: false, conditions: [{ field: "description", operator: "contains", value: "riverbank" }] });
const coverage = ruleCoverage([partial, shadowed, riverbank, feeRule, offRule], feed);
assert.deepEqual(coverage.fee, { ruleId: "fee", matches: 18, wins: 18, shadowedBy: [] }, "an off rule above takes nothing");
assert.deepEqual(coverage.riverbank, { ruleId: "riverbank", matches: 25, wins: 7, shadowedBy: [{ ruleId: "fee", count: 18 }] });
assert.deepEqual(coverage.shadowed, { ruleId: "shadowed", matches: 18, wins: 0, shadowedBy: [{ ruleId: "fee", count: 18 }] });
assert.deepEqual(coverage.partial.shadowedBy, [{ ruleId: "fee", count: 18 }, { ruleId: "riverbank", count: 7 }]);
assert.equal(coverage.off.wins, 25, "an off rule is scored as if it were on");
const position = (id: string) => ({ off: 1, fee: 2, riverbank: 3, shadowed: 4, partial: 5 } as Record<string, number>)[id];
assert.deepEqual(coverageMessage(coverage.shadowed, position), { neverApplies: true, topRuleId: "fee", text: "Never applies: rule 2 catches all 18 matches" });
assert.equal(coverageMessage(coverage.riverbank, position)?.text, "Rule 2 takes 18 of 25 matches");
assert.equal(coverageMessage(coverage.partial, position)?.text, "Never applies: rules 2 and 3 catch all 25 matches");
assert.equal(coverageMessage(coverage.fee, position), null, "no note when nothing above overlaps");
const withInvalid = ruleCoverage([feeRule, riverbank], feed, new Set(["fee"]));
assert.equal(withInvalid.riverbank.wins, 25, "invalid rules take nothing");
const tenOfThree = ruleCoverage(
  [rule("top", 1, { conditions: [{ field: "amount", operator: "lt", amountCents: 2000 }] }), rule("low", 2)],
  [...feed.slice(0, 3), ...feed.slice(18, 25)],
);
assert.equal(coverageMessage(tenOfThree.low, () => 1)?.text, "Rule 1 takes 3 of 10 matches");

// --- the editor's shadowing warning for a draft rule ---
const draftShadow = shadowingFor([{ field: "description", operator: "contains", value: "riverbank" }], [feeRule, offRule], feed);
assert.equal(draftShadow.matches, 25);
assert.equal(draftShadow.taken, 18);
assert.deepEqual(draftShadow.byRule.map((entry) => [entry.rule._id, entry.count]), [["fee", 18]]);
assert.equal(shadowingFor([{ field: "description", operator: "contains", value: "riverbank" }], [], feed).taken, 0, "placed first: nothing above");

// --- duplicates: same conditions in any order; "is exactly X" is "is any of [X]" ---
const dupA = rule("dupA", 1, { conditions: [{ field: "payee", operator: "contains", value: "Coastal Hydro" }, { field: "direction", value: "out" }] });
const dupB = rule("dupB", 2, { conditions: [anyOf("payee", ["Square", "stripe"])] });
assert.equal(findDuplicateRule([dupA, dupB], [{ field: "direction", value: "out" }, { field: "payee", operator: "contains", value: " coastal  hydro" }])?._id, "dupA");
assert.equal(findDuplicateRule([dupA, dupB], [anyOf("payee", ["STRIPE", "square", "Square"])])?._id, "dupB", "list order, case and repeats don't matter");
assert.equal(findDuplicateRule([dupA, dupB], dupA.conditions, "dupA"), null, "a rule is not its own duplicate");
assert.equal(findDuplicateRule([dupA], [{ field: "payee", operator: "starts_with", value: "coastal hydro" }, { field: "direction", value: "out" }]), null);
assert.equal(conditionsKey([{ field: "payee", operator: "equals", value: "Square" }]), conditionsKey([anyOf("payee", ["square"])]));
assert.equal(
  conditionsKey([{ field: "amount", operator: "between", amountCents: 500, amountMaxCents: 100 }]),
  conditionsKey([{ field: "amount", operator: "between", amountCents: 100, amountMaxCents: 500 }]),
);

// --- invalid rules: removed accounts, archived or removed funds ---
const refs = { accountIds: new Set(["bank", "acct_5200"]), activeFundIds: new Set(["fund_a"]), archivedFundIds: new Set(["fund_old"]) };
assert.deepEqual(ruleProblems({ conditions: [], actions: { accountingAccountId: "acct_gone" } }, refs), ["the account was removed"]);
assert.deepEqual(ruleProblems({ conditions: [], actions: { fundRestrictionId: "fund_old" } }, refs), ["the fund was archived"]);
assert.deepEqual(ruleProblems({ conditions: [], actions: { fundRestrictionId: "fund_gone" } }, refs), ["the fund was removed"]);
assert.deepEqual(ruleProblems({ conditions: [{ field: "account", accountId: "card_gone" }], actions: { accountingAccountId: "acct_5200" } }, refs), ["the bank account was removed"]);
assert.deepEqual(ruleProblems({ conditions: [{ field: "account", accountId: "bank" }], actions: { fundRestrictionId: "fund_a" } }, refs), []);

// --- suggestions carry their exact payees and can extend a matching rule ---
assert.deepEqual(suggestions[1].payees, ["Square"]);
assert.deepEqual(suggestions[0].payees, ["BC HYDRO 0042 PAYMENT", "BC Hydro 0043 payment", "BC HYDRO 0044 PAYMENT"]);
const squareRule = rule("square", 1, { conditions: [{ field: "payee", operator: "equals", value: "Stripe" }, { field: "direction", value: "in" }], actions: { category: "Program fees" } });
assert.equal(ruleToExtendForSuggestion([squareRule], { suggestedCategory: "program FEES", payees: ["Square"] })?._id, "square");
assert.equal(ruleToExtendForSuggestion([squareRule], { suggestedCategory: "Donations", payees: ["Square"] }), null, "the category must match");
assert.equal(ruleToExtendForSuggestion([{ ...squareRule, conditions: [{ field: "payee", operator: "contains", value: "stripe" }] }], { suggestedCategory: "Program fees", payees: ["Square"] }), null, "only exact payee lists are extended");
assert.equal(ruleToExtendForSuggestion([squareRule], { suggestedCategory: "Program fees", payees: tooMany }), null, "never past the 25-value cap");
assert.deepEqual(addPayeesToConditions(squareRule.conditions, ["Square", "stripe"]), [anyOf("payee", ["Stripe", "Square"]), { field: "direction", value: "in" }]);

// --- a rule drafted from a transaction (the "Create rule?" prompt) ---
assert.deepEqual(draftFromTransaction({ counterparty: "Coastal Hydro", description: "COASTAL HYDRO 0042", amountCents: -16138 }, "Facilities"), {
  name: "Coastal Hydro → Facilities",
  conditions: [{ field: "payee", operator: "equals", value: "Coastal Hydro" }, { field: "direction", value: "out" }],
  actions: { category: "Facilities" },
});
assert.deepEqual(draftFromTransaction({ description: "E-TRANSFER  N AHMADI", amountCents: 5000 }, "Uncategorized").actions, {}, "no category action for uncategorised");
assert.deepEqual(draftFromTransaction({ description: "E-TRANSFER  N AHMADI", amountCents: 5000 }, "Dues").conditions[0], { field: "payee", operator: "equals", value: "E-TRANSFER N AHMADI" });

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

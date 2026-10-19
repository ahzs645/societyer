/**
 * Transaction categorisation rules: pure matching, validation and suggestion
 * logic shared by the Convex/portable handlers, the static demo mirror and the
 * rules UI (live "matches N transactions" counts run this same code).
 *
 * A rule is "If [condition] and [condition] … then [actions]". Conditions are
 * ANDed. Rules are evaluated in ascending `priority` (1 = first); the first
 * enabled rule whose conditions all match wins, so a specific rule placed above
 * a broad one takes precedence.
 *
 * Amount conditions compare the transaction's magnitude in integer cents (a
 * $42.00 payment and a $42.00 deposit both have amount 4200); use the
 * direction condition to separate money in from money out.
 */

/** `in` ("is any of") matches when the text equals one of `values` exactly
 * (ignoring capitals and extra spaces); the other operators use `value`. */
export type TextOperator = "contains" | "equals" | "starts_with" | "in";
export type AmountOperator = "lt" | "lte" | "eq" | "gte" | "gt" | "between";

/** Most values an "is any of" condition may list. */
export const MAX_IN_VALUES = 25;

export type TextCondition = { field: "description" | "payee"; operator: TextOperator; value: string; values?: string[] };

export type RuleCondition =
  | TextCondition
  | { field: "amount"; operator: AmountOperator; amountCents: number; amountMaxCents?: number }
  | { field: "direction"; value: "in" | "out" }
  | { field: "account"; accountId: string }
  /** The category a line already has, so a rule can re-code it (e.g. bank fees to an expense account). */
  | { field: "category"; value: string };

export type RuleActions = {
  category?: string;
  /** Chart-of-accounts row (financialAccounts) to code the transaction to. */
  accountingAccountId?: string;
  fundRestrictionId?: string;
  markReviewed?: boolean;
};

export type TransactionRuleLike = {
  _id?: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleActions;
};

export type RuleTransaction = {
  _id?: string;
  description?: string | null;
  counterparty?: string | null;
  amountCents: number;
  accountId?: string | null;
  category?: string | null;
  categorizedBy?: string | null;
  ruleId?: string | null;
  /** Line items; two or more mean a split, which rules never change. */
  lines?: readonly unknown[] | null;
};

export const TEXT_OPERATOR_LABELS: Record<TextOperator, string> = {
  contains: "contains",
  equals: "is exactly",
  starts_with: "starts with",
  in: "is any of",
};

export const AMOUNT_OPERATOR_LABELS: Record<AmountOperator, string> = {
  lt: "is less than",
  lte: "is at most",
  eq: "equals",
  gte: "is at least",
  gt: "is more than",
  between: "is between",
};

export function normalizeRuleText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("en-CA")
    .replace(/\s+/g, " ")
    .trim();
}

/** The payee a rule matches: the counterparty, or the bank description when
 * the line has no counterparty (bank CSV exports usually do not). */
export function transactionPayee(txn: RuleTransaction): string {
  const counterparty = String(txn.counterparty ?? "").trim();
  return counterparty || String(txn.description ?? "");
}

/** Distinct, non-blank values of an "is any of" list, in the order typed. */
export function inValues(values: readonly unknown[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = String(raw ?? "").replace(/\s+/g, " ").trim();
    const key = normalizeRuleText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function textMatches(haystack: string, operator: TextOperator, needle: string, values?: readonly string[]): boolean {
  const h = normalizeRuleText(haystack);
  if (operator === "in") return inValues(values).some((value) => normalizeRuleText(value) === h);
  const n = normalizeRuleText(needle);
  if (!n) return false;
  if (operator === "equals") return h === n;
  if (operator === "starts_with") return h.startsWith(n);
  return h.includes(n);
}

export function conditionMatches(condition: RuleCondition, txn: RuleTransaction): boolean {
  switch (condition.field) {
    case "description":
      return textMatches(String(txn.description ?? ""), condition.operator, condition.value, condition.values);
    case "payee":
      return textMatches(transactionPayee(txn), condition.operator, condition.value, condition.values);
    case "category":
      return !isUncategorized(txn) && Boolean(normalizeRuleText(condition.value)) && normalizeRuleText(txn.category) === normalizeRuleText(condition.value);
    case "amount": {
      const amount = Math.abs(Math.round(Number(txn.amountCents) || 0));
      const value = Math.round(condition.amountCents);
      switch (condition.operator) {
        case "lt": return amount < value;
        case "lte": return amount <= value;
        case "eq": return amount === value;
        case "gte": return amount >= value;
        case "gt": return amount > value;
        case "between": {
          const max = Math.round(condition.amountMaxCents ?? value);
          const low = Math.min(value, max);
          const high = Math.max(value, max);
          return amount >= low && amount <= high;
        }
        default: return false;
      }
    }
    case "direction":
      return condition.value === "in" ? txn.amountCents > 0 : txn.amountCents < 0;
    case "account":
      return Boolean(condition.accountId) && String(txn.accountId ?? "") === String(condition.accountId);
    default:
      return false;
  }
}

export function ruleMatches(rule: Pick<TransactionRuleLike, "conditions">, txn: RuleTransaction): boolean {
  return rule.conditions.length > 0 && rule.conditions.every((condition) => conditionMatches(condition, txn));
}

export function sortRules<T extends Pick<TransactionRuleLike, "priority" | "_id">>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || String(a._id ?? "").localeCompare(String(b._id ?? "")));
}

/** The first enabled rule (in priority order) whose conditions all match. */
export function findMatchingRule<T extends TransactionRuleLike>(rules: readonly T[], txn: RuleTransaction): T | null {
  for (const rule of sortRules(rules)) {
    if (rule.enabled && hasAnyAction(rule.actions) && ruleMatches(rule, txn)) return rule;
  }
  return null;
}

/** A rule with a "category is" condition re-codes lines that already have a category. */
export function isRecodeRule(rule: Pick<TransactionRuleLike, "conditions">): boolean {
  return rule.conditions.some((condition) => condition.field === "category");
}

/**
 * The rule that should be applied to this line now, or null. Uncategorised
 * lines take the first matching rule. A line that already has a category is
 * only re-coded by a "category is" rule, never when the category was set by
 * hand, and never twice by the same rule. A split transaction (two or more
 * line items) is never touched: rules set a single category. Rules in `skip`
 * (for example rules that point at a removed account) are passed over.
 */
export function findApplicableRule<T extends TransactionRuleLike>(
  rules: readonly T[],
  txn: RuleTransaction,
  skip?: ReadonlySet<string>,
): T | null {
  if (Array.isArray(txn.lines) && txn.lines.length > 1) return null;
  const uncategorised = isUncategorized(txn);
  if (!uncategorised && txn.categorizedBy === "manual") return null;
  for (const rule of sortRules(rules)) {
    if (!rule.enabled || !hasAnyAction(rule.actions) || skip?.has(String(rule._id ?? ""))) continue;
    if (!uncategorised && !isRecodeRule(rule)) continue;
    if (!ruleMatches(rule, txn)) continue;
    if (!uncategorised && rule._id && String(txn.ruleId ?? "") === String(rule._id)) return null;
    return rule;
  }
  return null;
}

export function isUncategorized(txn: Pick<RuleTransaction, "category">): boolean {
  const category = normalizeRuleText(txn.category);
  return !category || category === "uncategorized" || category === "uncategorised";
}

export function hasAnyAction(actions: RuleActions | undefined): boolean {
  if (!actions) return false;
  return Boolean(
    (actions.category && actions.category.trim()) ||
      actions.accountingAccountId ||
      actions.fundRestrictionId ||
      actions.markReviewed,
  );
}

/** Fields a rule writes, plus the provenance stamp. */
export function ruleActionPatch(rule: TransactionRuleLike & { _id: string }, nowISO: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { categorizedBy: "rule", ruleId: rule._id };
  if (rule.actions.category?.trim()) patch.category = rule.actions.category.trim();
  if (rule.actions.accountingAccountId) patch.accountingAccountId = rule.actions.accountingAccountId;
  if (rule.actions.fundRestrictionId) patch.fundRestrictionId = rule.actions.fundRestrictionId;
  if (rule.actions.markReviewed) patch.reviewedAtISO = nowISO;
  return patch;
}

/** The previous values of every field a rule application can change, so the
 * application can be undone exactly. */
export const RULE_TOUCHED_FIELDS = [
  "category",
  "accountingAccountId",
  "fundRestrictionId",
  "reviewedAtISO",
  "categorizedBy",
  "ruleId",
] as const;

export function snapshotRuleFields(txn: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of RULE_TOUCHED_FIELDS) {
    if (txn[field] !== undefined && txn[field] !== null) out[field] = txn[field];
  }
  return out;
}

/** Patch that restores a snapshot (fields absent from the snapshot are cleared). */
export function restoreRuleFieldsPatch(previous: Record<string, unknown> | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = { ruleApplication: undefined };
  for (const field of RULE_TOUCHED_FIELDS) patch[field] = previous?.[field] ?? undefined;
  return patch;
}

export type RuleValidationInput = {
  name?: string;
  conditions?: RuleCondition[];
  actions?: RuleActions;
};

/** The name is optional: a blank name is replaced by `autoRuleName`. */
export function validateRule(input: RuleValidationInput): string[] {
  const errors: string[] = [];
  if (String(input.name ?? "").trim().length > 120) errors.push("Keep the rule name under 120 characters.");
  const conditions = input.conditions ?? [];
  if (conditions.length === 0) errors.push("Add at least one condition.");
  if (conditions.length > 12) errors.push("A rule can have at most 12 conditions.");
  conditions.forEach((condition, index) => {
    const n = index + 1;
    if (condition.field === "description" || condition.field === "payee") {
      if (!(condition.operator in TEXT_OPERATOR_LABELS)) errors.push(`Condition ${n}: unknown text comparison.`);
      else if (condition.operator === "in") {
        const values = inValues(condition.values);
        if (values.length === 0) errors.push(`Condition ${n}: add at least one ${condition.field === "payee" ? "payee" : "value"}.`);
        if (values.length > MAX_IN_VALUES) errors.push(`Condition ${n}: list at most ${MAX_IN_VALUES} values (there are ${values.length}). Split the rest into another rule.`);
      } else if (!normalizeRuleText(condition.value)) errors.push(`Condition ${n}: enter the text to match.`);
    } else if (condition.field === "category") {
      if (!normalizeRuleText(condition.value) || isUncategorized({ category: condition.value })) errors.push(`Condition ${n}: choose a category.`);
    } else if (condition.field === "amount") {
      if (!(condition.operator in AMOUNT_OPERATOR_LABELS)) errors.push(`Condition ${n}: unknown amount comparison.`);
      if (!Number.isSafeInteger(condition.amountCents) || condition.amountCents < 0) errors.push(`Condition ${n}: enter a positive amount.`);
      if (condition.operator === "between") {
        if (!Number.isSafeInteger(condition.amountMaxCents) || (condition.amountMaxCents ?? -1) < 0) {
          errors.push(`Condition ${n}: enter the upper amount.`);
        } else if ((condition.amountMaxCents ?? 0) < condition.amountCents) {
          errors.push(`Condition ${n}: the upper amount must be at least the lower amount.`);
        }
      }
    } else if (condition.field === "direction") {
      if (condition.value !== "in" && condition.value !== "out") errors.push(`Condition ${n}: choose money in or money out.`);
    } else if (condition.field === "account") {
      if (!condition.accountId) errors.push(`Condition ${n}: choose a bank account.`);
    } else {
      errors.push(`Condition ${n}: unknown field.`);
    }
  });
  if (!hasAnyAction(input.actions)) errors.push("Choose at least one action.");
  return errors;
}

export type StarterRuleSuggestion = {
  key: string;
  label: string;
  count: number;
  transactionIds: string[];
  condition: RuleCondition;
  suggestedCategory?: string;
  /** The exact payees behind the suggestion (at most MAX_IN_VALUES), for "is any of" rules. */
  payees: string[];
};

/** A stable grouping key for a payee: lowercase words without reference
 * numbers, card digits or dates ("BC HYDRO 0042 PAYMENT #881" → "bc hydro payment"). */
export function payeeKey(value: string): string {
  const words = normalizeRuleText(value)
    .replace(/[#*/\\_.,:;()[\]{}|-]+/g, " ")
    .split(" ")
    .filter((word) => word && !/\d/.test(word) && word.length > 1);
  return words.slice(0, 3).join(" ");
}

/** "bc hydro payment" -> "BC Hydro Payment": vowel-less short words read as initialisms. */
function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) => (word.length <= 4 && !/[aeiouy]/i.test(word) ? word.toLocaleUpperCase("en-CA") : word.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("en-CA"))))
    .join(" ");
}

/**
 * Starter rules from frequent payees that no existing rule covers yet. The
 * suggested category is the most common category already used for that payee.
 */
export function suggestStarterRules(
  transactions: readonly RuleTransaction[],
  rules: readonly TransactionRuleLike[],
  limit = 3,
): StarterRuleSuggestion[] {
  const groups = new Map<string, RuleTransaction[]>();
  for (const txn of transactions) {
    const key = payeeKey(transactionPayee(txn));
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(txn);
    groups.set(key, list);
  }
  const suggestions: StarterRuleSuggestion[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    if (list.some((txn) => findMatchingRule(rules, txn))) continue;
    // The longest leading run of key words every payee in the group contains
    // ("bc hydro payment" -> "bc hydro" when reference numbers sit between).
    const words = key.split(" ");
    let condition: RuleCondition | null = null;
    for (let size = words.length; size > 0 && !condition; size -= 1) {
      const candidate: RuleCondition = { field: "payee", operator: "contains", value: words.slice(0, size).join(" ") };
      if (list.every((txn) => conditionMatches(candidate, txn))) condition = candidate;
    }
    if (!condition) continue;
    const categoryCounts = new Map<string, number>();
    for (const txn of list) {
      if (isUncategorized(txn)) continue;
      const category = String(txn.category).trim();
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
    const suggestedCategory = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    suggestions.push({
      key,
      label: titleCase(key),
      count: list.length,
      transactionIds: list.map((txn) => String(txn._id ?? "")).filter(Boolean),
      condition,
      payees: inValues(list.map(transactionPayee)).slice(0, MAX_IN_VALUES),
      ...(suggestedCategory ? { suggestedCategory } : {}),
    });
  }
  return suggestions
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Plain-language condition, e.g. `payee contains "bc hydro"`. */
export function describeCondition(
  condition: RuleCondition,
  options: { accountName?: (id: string) => string | undefined; formatCents?: (cents: number) => string } = {},
): string {
  const money = options.formatCents ?? ((cents: number) => `$${(cents / 100).toFixed(2)}`);
  switch (condition.field) {
    case "description":
    case "payee": {
      const label = condition.field === "payee" ? "payee" : "description";
      if (condition.operator === "in") {
        const values = inValues(condition.values);
        const shown = values.slice(0, 3).map((value) => `"${value}"`).join(", ");
        return `${label} is any of ${shown || "(none)"}${values.length > 3 ? ` and ${values.length - 3} more` : ""}`;
      }
      return `${label} ${TEXT_OPERATOR_LABELS[condition.operator]} "${condition.value}"`;
    }
    case "category":
      return `category is "${condition.value}"`;
    case "amount":
      return condition.operator === "between"
        ? `amount is between ${money(condition.amountCents)} and ${money(condition.amountMaxCents ?? condition.amountCents)}`
        : `amount ${AMOUNT_OPERATOR_LABELS[condition.operator]} ${money(condition.amountCents)}`;
    case "direction":
      return condition.value === "in" ? "money comes in" : "money goes out";
    case "account":
      return `account is ${options.accountName?.(condition.accountId) ?? "the selected account"}`;
    default:
      return "unknown condition";
  }
}

/**
 * The patch that applies the applicable rule (see `findApplicableRule`) to a
 * transaction, with provenance and an undo snapshot, or null when no rule
 * applies. Rules in `skip` (invalid rules) are passed over.
 */
export function rulePatchForTransaction<T extends TransactionRuleLike & { _id: string }>(
  rules: readonly T[],
  txn: RuleTransaction & Record<string, unknown>,
  nowISO: string,
  batchId: string,
  skip?: ReadonlySet<string>,
): { rule: T; patch: Record<string, unknown> } | null {
  const rule = findApplicableRule(rules, txn, skip);
  if (!rule) return null;
  return {
    rule,
    patch: {
      ...ruleActionPatch(rule, nowISO),
      ruleApplication: { ruleName: ruleDisplayName(rule), batchId, appliedAtISO: nowISO, previous: snapshotRuleFields(txn) },
    },
  };
}

// ---------------------------------------------------------------- naming

export type RuleTextOptions = {
  accountName?: (id: string) => string | undefined;
  fundName?: (id: string) => string | undefined;
  formatCents?: (cents: number) => string;
};

/** Typed text as a title: all-lowercase or all-capitals text is title-cased
 * ("coastal hydro" → "Coastal Hydro", "BC HYDRO" → "BC Hydro"); mixed case is kept. */
function displayText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return text;
  const lower = text.toLocaleLowerCase("en-CA");
  if (text !== lower && text !== text.toLocaleUpperCase("en-CA")) return text;
  return titleCase(lower);
}

/** What a rule's actions do, e.g. "category Facilities, account 5200 · Facilities, mark reviewed". */
export function describeActions(actions: RuleActions, options: RuleTextOptions = {}): string {
  const parts: string[] = [];
  if (actions.category?.trim()) parts.push(`category ${actions.category.trim()}`);
  if (actions.accountingAccountId) parts.push(`account ${options.accountName?.(actions.accountingAccountId) ?? "(removed)"}`);
  if (actions.fundRestrictionId) parts.push(`fund ${options.fundName?.(actions.fundRestrictionId) ?? "(removed)"}`);
  if (actions.markReviewed) parts.push("mark reviewed");
  return parts.join(", ");
}

/** The whole rule as one sentence: `If payee contains "coastal hydro" and money goes out → category Facilities`. */
export function describeRule(conditions: readonly RuleCondition[], actions: RuleActions, options: RuleTextOptions = {}): string {
  const when = conditions.length ? conditions.map((condition) => describeCondition(condition, options)).join(" and ") : "…";
  return `If ${when} → ${describeActions(actions, options) || "…"}`;
}

function amountPhrase(condition: Extract<RuleCondition, { field: "amount" }>, money: (cents: number) => string): string {
  if (condition.operator === "between") return `Amounts ${money(condition.amountCents)}–${money(condition.amountMaxCents ?? condition.amountCents)}`;
  const words: Record<Exclude<AmountOperator, "between">, string> = { lt: "under", lte: "up to", eq: "of", gte: "of at least", gt: "over" };
  return `Amounts ${words[condition.operator]} ${money(condition.amountCents)}`;
}

/**
 * A short name for a rule that has none, from what it matches and what it
 * does: "Coastal Hydro → Facilities", "Square and 2 more → Program fees".
 */
export function autoRuleName(conditions: readonly RuleCondition[], actions: RuleActions, options: RuleTextOptions = {}): string {
  const money = options.formatCents ?? ((cents: number) => `$${(cents / 100).toFixed(2)}`);
  const pick = <F extends RuleCondition["field"]>(field: F) => conditions.find((c) => c.field === field) as Extract<RuleCondition, { field: F }> | undefined;
  const textOf = (field: TextCondition["field"]) => conditions.find((c) => c.field === field) as TextCondition | undefined;
  let subject = "";
  for (const text of [textOf("payee"), textOf("description")]) {
    if (!text || subject) continue;
    if (text.operator === "in") {
      const values = inValues(text.values);
      if (values.length) subject = values.length === 1 ? displayText(values[0]) : `${displayText(values[0])} and ${values.length - 1} more`;
    } else if (text.value.trim()) {
      subject = text.field === "description" ? `“${text.value.trim()}”` : displayText(text.value);
    }
  }
  const category = pick("category");
  if (!subject && category?.value.trim()) subject = category.value.trim();
  const account = pick("account");
  if (!subject && account) subject = options.accountName?.(account.accountId) ?? "Bank account";
  const amount = pick("amount");
  if (!subject && amount && Number.isFinite(amount.amountCents)) subject = amountPhrase(amount, money);
  const direction = pick("direction");
  if (!subject && direction) subject = direction.value === "in" ? "Money in" : "Money out";
  if (!subject) subject = "Transactions";

  const outcome =
    actions.category?.trim() ||
    (actions.accountingAccountId && options.accountName?.(actions.accountingAccountId)) ||
    (actions.fundRestrictionId && options.fundName?.(actions.fundRestrictionId)) ||
    (actions.markReviewed ? "Reviewed" : "");
  const name = outcome ? `${subject} → ${outcome}` : subject;
  return name.length > 80 ? `${name.slice(0, 79).trimEnd()}…` : name;
}

/** The rule's name, or its automatic name when it has none. */
export function ruleDisplayName(rule: Pick<TransactionRuleLike, "name" | "conditions" | "actions">, options: RuleTextOptions = {}): string {
  return String(rule.name ?? "").trim() || autoRuleName(rule.conditions, rule.actions, options);
}

// ---------------------------------------------------------- invalid rules

export type RuleReferenceIndex = {
  /** Every chart and bank account id that still exists in the workspace. */
  accountIds: ReadonlySet<string>;
  /** Funds that exist and are not archived. */
  activeFundIds: ReadonlySet<string>;
  /** Funds that exist but are archived. */
  archivedFundIds?: ReadonlySet<string>;
};

/** Why a rule can no longer run (e.g. "the account was removed"); empty when it is fine. */
export function ruleProblems(rule: Pick<TransactionRuleLike, "conditions" | "actions">, refs: RuleReferenceIndex): string[] {
  const problems: string[] = [];
  if (rule.actions.accountingAccountId && !refs.accountIds.has(String(rule.actions.accountingAccountId))) problems.push("the account was removed");
  if (rule.actions.fundRestrictionId && !refs.activeFundIds.has(String(rule.actions.fundRestrictionId))) {
    problems.push(refs.archivedFundIds?.has(String(rule.actions.fundRestrictionId)) ? "the fund was archived" : "the fund was removed");
  }
  if (rule.conditions.some((condition) => condition.field === "account" && !refs.accountIds.has(String(condition.accountId)))) {
    problems.push("the bank account was removed");
  }
  return problems;
}

/** The reference index for a workspace's accounts and fund restrictions. */
export function ruleReferenceIndex(
  accounts: readonly { _id: unknown }[],
  restrictions: readonly { _id: unknown; status?: unknown }[],
): RuleReferenceIndex {
  return {
    accountIds: new Set(accounts.map((a) => String(a._id))),
    activeFundIds: new Set(restrictions.filter((r) => r.status !== "archived").map((r) => String(r._id))),
    archivedFundIds: new Set(restrictions.filter((r) => r.status === "archived").map((r) => String(r._id))),
  };
}

/** Rules that can no longer run (see `ruleProblems`), for the `skip` set of `rulePatchForTransaction`. */
export function invalidRuleIds(rules: readonly (Pick<TransactionRuleLike, "conditions" | "actions"> & { _id: unknown })[], refs: RuleReferenceIndex): Set<string> {
  return new Set(rules.filter((rule) => ruleProblems(rule, refs).length > 0).map((rule) => String(rule._id)));
}

// --------------------------------------------------- coverage and overlap

export type RuleCoverage = {
  ruleId: string;
  /** Lines the rule's conditions match. */
  matches: number;
  /** Matches no active rule above it takes (the lines this rule decides). */
  wins: number;
  /** Matches taken by an active rule above it, by that rule, most first. */
  shadowedBy: { ruleId: string; count: number }[];
};

const isActiveRule = (rule: TransactionRuleLike, inactive?: ReadonlySet<string>) =>
  rule.enabled && hasAnyAction(rule.actions) && !inactive?.has(String(rule._id ?? ""));

/**
 * For every rule, how many lines it matches, how many it actually decides,
 * and which higher rules take the rest. Only active rules (on, with an
 * action, not in `inactive`) take lines; a rule that is off is still scored
 * as if it were on, so the list can warn before it is switched back on.
 */
export function ruleCoverage<T extends TransactionRuleLike & { _id: string }>(
  rules: readonly T[],
  transactions: readonly RuleTransaction[],
  inactive?: ReadonlySet<string>,
): Record<string, RuleCoverage> {
  const sorted = sortRules(rules);
  const out: Record<string, RuleCoverage> = {};
  const shadow = new Map<string, Map<string, number>>();
  for (const rule of sorted) {
    out[rule._id] = { ruleId: rule._id, matches: 0, wins: 0, shadowedBy: [] };
    shadow.set(rule._id, new Map());
  }
  for (const txn of transactions) {
    let winner: T | null = null;
    for (const rule of sorted) {
      if (!ruleMatches(rule, txn)) continue;
      const entry = out[rule._id];
      entry.matches += 1;
      if (winner) {
        const counts = shadow.get(rule._id)!;
        counts.set(winner._id, (counts.get(winner._id) ?? 0) + 1);
      } else {
        entry.wins += 1;
        if (isActiveRule(rule, inactive)) winner = rule;
      }
    }
  }
  const order = new Map(sorted.map((rule, index) => [rule._id, index]));
  for (const rule of sorted) {
    out[rule._id].shadowedBy = [...shadow.get(rule._id)!.entries()]
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => b.count - a.count || (order.get(a.ruleId) ?? 0) - (order.get(b.ruleId) ?? 0));
  }
  return out;
}

function listPositions(positions: number[]): string {
  const sorted = [...positions].sort((a, b) => a - b);
  return sorted.length <= 1 ? String(sorted[0] ?? "") : `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/**
 * Plain-language overlap note for the rules list, or null when nothing above
 * takes this rule's matches. `position` gives a rule's 1-based place.
 * "Never applies: rule 2 catches all 18 matches" / "Rule 1 takes 3 of 10 matches".
 */
export function coverageMessage(
  coverage: RuleCoverage | undefined,
  position: (ruleId: string) => number,
): { text: string; neverApplies: boolean; topRuleId: string } | null {
  if (!coverage || coverage.matches === 0 || coverage.shadowedBy.length === 0) return null;
  const taken = coverage.shadowedBy.reduce((sum, entry) => sum + entry.count, 0);
  const matches = `${coverage.matches} ${coverage.matches === 1 ? "match" : "matches"}`;
  const single = coverage.shadowedBy.length === 1;
  const who = single ? `rule ${position(coverage.shadowedBy[0].ruleId)}` : `rules ${listPositions(coverage.shadowedBy.map((e) => position(e.ruleId)))}`;
  const topRuleId = coverage.shadowedBy[0].ruleId;
  if (coverage.wins === 0) {
    return {
      neverApplies: true,
      topRuleId,
      text: `Never applies: ${who} ${single ? "catches" : "catch"} ${coverage.matches === 1 ? "its only match" : `all ${matches}`}`,
    };
  }
  return { neverApplies: false, topRuleId, text: `${who.charAt(0).toLocaleUpperCase("en-CA")}${who.slice(1)} ${single ? "takes" : "take"} ${taken} of ${matches}` };
}

/**
 * For a draft rule: of the lines its conditions match, how many an active
 * rule placed above it would take first, by rule.
 */
export function shadowingFor<T extends TransactionRuleLike & { _id: string }>(
  conditions: readonly RuleCondition[],
  rulesAbove: readonly T[],
  transactions: readonly RuleTransaction[],
  inactive?: ReadonlySet<string>,
): { matches: number; taken: number; byRule: { rule: T; count: number }[] } {
  const above = sortRules(rulesAbove).filter((rule) => isActiveRule(rule, inactive));
  const counts = new Map<string, { rule: T; count: number }>();
  let matches = 0;
  let taken = 0;
  if (conditions.length === 0) return { matches, taken, byRule: [] };
  for (const txn of transactions) {
    if (!conditions.every((condition) => conditionMatches(condition, txn))) continue;
    matches += 1;
    const winner = above.find((rule) => ruleMatches(rule, txn));
    if (!winner) continue;
    taken += 1;
    const entry = counts.get(winner._id) ?? { rule: winner, count: 0 };
    entry.count += 1;
    counts.set(winner._id, entry);
  }
  return { matches, taken, byRule: [...counts.values()].sort((a, b) => b.count - a.count) };
}

/** Order-insensitive identity of a rule's conditions ("is exactly X" equals "is any of [X]"). */
export function conditionsKey(conditions: readonly RuleCondition[]): string {
  const parts = conditions.map((condition) => {
    switch (condition.field) {
      case "description":
      case "payee": {
        if (condition.operator === "in" || condition.operator === "equals") {
          const values = condition.operator === "in" ? inValues(condition.values) : [condition.value];
          return `${condition.field}|in|${[...new Set(values.map(normalizeRuleText))].sort().join("\u0001")}`;
        }
        return `${condition.field}|${condition.operator}|${normalizeRuleText(condition.value)}`;
      }
      case "amount": {
        if (condition.operator !== "between") return `amount|${condition.operator}|${Math.round(condition.amountCents)}`;
        const max = condition.amountMaxCents ?? condition.amountCents;
        return `amount|between|${Math.min(condition.amountCents, max)}|${Math.max(condition.amountCents, max)}`;
      }
      case "direction":
        return `direction|${condition.value}`;
      case "account":
        return `account|${condition.accountId}`;
      case "category":
        return `category|${normalizeRuleText(condition.value)}`;
      default:
        return "unknown";
    }
  });
  return [...new Set(parts)].sort().join("\u0002");
}

/** Another rule with exactly the same conditions (a soft duplicate warning), or null. */
export function findDuplicateRule<T extends TransactionRuleLike & { _id: string }>(
  rules: readonly T[],
  conditions: readonly RuleCondition[],
  excludeId?: string,
): T | null {
  if (conditions.length === 0) return null;
  const key = conditionsKey(conditions);
  return sortRules(rules).find((rule) => rule._id !== excludeId && conditionsKey(rule.conditions) === key) ?? null;
}

// ------------------------------------------ extending a rule from a suggestion

/** The payee condition of a rule that lists exact payees, if it has exactly one. */
function exactPayeeCondition(rule: Pick<TransactionRuleLike, "conditions">) {
  const payees = rule.conditions.filter((condition) => condition.field === "payee");
  if (payees.length !== 1) return null;
  const condition = payees[0] as TextCondition;
  return condition.operator === "in" || condition.operator === "equals" ? condition : null;
}

/** Conditions with `payees` added to the rule's exact-payee list (as "is any of"). */
export function addPayeesToConditions(conditions: readonly RuleCondition[], payees: readonly string[]): RuleCondition[] {
  return conditions.map((condition) => {
    if (condition.field !== "payee" || (condition.operator !== "in" && condition.operator !== "equals")) return condition;
    const current = condition.operator === "in" ? inValues(condition.values) : [condition.value];
    return { field: "payee", operator: "in", value: "", values: inValues([...current, ...payees]) };
  });
}

/**
 * An existing rule a suggestion can be folded into: it sets the same
 * category and matches an exact list of payees, with room for the new ones.
 */
export function ruleToExtendForSuggestion<T extends TransactionRuleLike & { _id: string }>(
  rules: readonly T[],
  suggestion: Pick<StarterRuleSuggestion, "suggestedCategory" | "payees">,
): T | null {
  const category = normalizeRuleText(suggestion.suggestedCategory);
  if (!category || suggestion.payees.length === 0) return null;
  for (const rule of sortRules(rules)) {
    if (normalizeRuleText(rule.actions.category) !== category) continue;
    const condition = exactPayeeCondition(rule);
    if (!condition) continue;
    const merged = addPayeesToConditions([condition], suggestion.payees)[0] as TextCondition;
    if (inValues(merged.values).length <= MAX_IN_VALUES) return rule;
  }
  return null;
}

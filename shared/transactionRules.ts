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

export type TextOperator = "contains" | "equals" | "starts_with";
export type AmountOperator = "lt" | "lte" | "eq" | "gte" | "gt" | "between";

export type RuleCondition =
  | { field: "description" | "payee"; operator: TextOperator; value: string }
  | { field: "amount"; operator: AmountOperator; amountCents: number; amountMaxCents?: number }
  | { field: "direction"; value: "in" | "out" }
  | { field: "account"; accountId: string };

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
};

export const TEXT_OPERATOR_LABELS: Record<TextOperator, string> = {
  contains: "contains",
  equals: "is exactly",
  starts_with: "starts with",
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

function textMatches(haystack: string, operator: TextOperator, needle: string): boolean {
  const h = normalizeRuleText(haystack);
  const n = normalizeRuleText(needle);
  if (!n) return false;
  if (operator === "equals") return h === n;
  if (operator === "starts_with") return h.startsWith(n);
  return h.includes(n);
}

export function conditionMatches(condition: RuleCondition, txn: RuleTransaction): boolean {
  switch (condition.field) {
    case "description":
      return textMatches(String(txn.description ?? ""), condition.operator, condition.value);
    case "payee":
      return textMatches(transactionPayee(txn), condition.operator, condition.value);
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

export function validateRule(input: RuleValidationInput): string[] {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Give the rule a name.");
  const conditions = input.conditions ?? [];
  if (conditions.length === 0) errors.push("Add at least one condition.");
  if (conditions.length > 12) errors.push("A rule can have at most 12 conditions.");
  conditions.forEach((condition, index) => {
    const n = index + 1;
    if (condition.field === "description" || condition.field === "payee") {
      if (!normalizeRuleText(condition.value)) errors.push(`Condition ${n}: enter the text to match.`);
      if (!(condition.operator in TEXT_OPERATOR_LABELS)) errors.push(`Condition ${n}: unknown text comparison.`);
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
    case "payee":
      return `${condition.field === "payee" ? "payee" : "description"} ${TEXT_OPERATOR_LABELS[condition.operator]} "${condition.value}"`;
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
 * The patch that applies the first matching rule to an uncategorised
 * transaction (with provenance and an undo snapshot), or null when the
 * transaction already has a category or no rule matches.
 */
export function rulePatchForTransaction<T extends TransactionRuleLike & { _id: string }>(
  rules: readonly T[],
  txn: RuleTransaction & Record<string, unknown>,
  nowISO: string,
  batchId: string,
): { rule: T; patch: Record<string, unknown> } | null {
  if (!isUncategorized(txn)) return null;
  const rule = findMatchingRule(rules, txn);
  if (!rule) return null;
  return {
    rule,
    patch: {
      ...ruleActionPatch(rule, nowISO),
      ruleApplication: { ruleName: rule.name, batchId, appliedAtISO: nowISO, previous: snapshotRuleFields(txn) },
    },
  };
}

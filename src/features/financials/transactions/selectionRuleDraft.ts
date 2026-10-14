import { autoRuleName, isUncategorized, normalizeRuleText, transactionPayee } from "../../../../shared/transactionRules";
import { draftFromTransaction, type DraftTransaction, type RuleDraft } from "../rules/draftFromTransaction";

export type DraftSourceTransaction = DraftTransaction & { category?: string | null };

/** Most payees one "Create rule from selection" draft lists. */
export const SELECTION_RULE_MAX_PAYEES = 25;

/** Distinct payees in the selection, in first-seen order (case-insensitive). */
export function selectionPayees(txns: readonly DraftSourceTransaction[]): string[] {
  const seen = new Map<string, string>();
  for (const txn of txns) {
    const payee = transactionPayee({ ...txn, amountCents: txn.amountCents }).trim();
    const key = normalizeRuleText(payee);
    if (key && !seen.has(key)) seen.set(key, payee);
  }
  return [...seen.values()];
}

/** The category most of the selection already shares, if any. */
export function commonCategory(txns: readonly DraftSourceTransaction[]): string | undefined {
  const counts = new Map<string, number>();
  for (const txn of txns) {
    if (isUncategorized(txn)) continue;
    const category = String(txn.category).trim();
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

/**
 * A new-rule draft from selected transactions. One payee gives "payee is
 * exactly"; several give "payee is any of [...]" (the rules editor's
 * multi-value `in` operator with `values`). The direction condition is kept
 * only when every selected line moves money the same way.
 */
export function draftFromSelection(txns: readonly DraftSourceTransaction[]): RuleDraft | null {
  if (txns.length === 0) return null;
  const category = commonCategory(txns);
  const draft = draftFromTransaction(txns[0], category);
  const payees = selectionPayees(txns).slice(0, SELECTION_RULE_MAX_PAYEES);
  const mixedDirection = txns.some((txn) => txn.amountCents > 0) && txns.some((txn) => txn.amountCents < 0);
  const conditions = draft.conditions
    .filter((condition) => !(mixedDirection && condition.field === "direction"))
    .map((condition) => (payees.length > 1 && condition.field === "payee" ? { field: "payee" as const, operator: "in" as const, value: "", values: payees } : condition));
  return { ...draft, name: autoRuleName(conditions, draft.actions), conditions };
}

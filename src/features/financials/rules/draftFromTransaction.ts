import {
  autoRuleName,
  isUncategorized,
  transactionPayee,
  type RuleActions,
  type RuleCondition,
  type RuleTextOptions,
} from "../../../../shared/transactionRules";

/**
 * A rule to open in `RuleEditorDrawer` (its `initialDraft` prop): plain
 * conditions and actions, before any editor state exists. `name` may be
 * left out; the editor then shows the generated name as a placeholder and
 * the server generates it on save.
 */
export type RuleDraft = {
  /** Set to edit an existing rule instead of creating one. */
  id?: string;
  name?: string;
  enabled?: boolean;
  conditions: RuleCondition[];
  actions: RuleActions;
};

export type DraftTransaction = {
  description?: string | null;
  counterparty?: string | null;
  amountCents: number;
};

/**
 * "Categorise every {payee} transaction as {category}": payee is exactly the
 * line's payee (the counterparty, or the bank description when there is
 * none), the same direction, then set the category. The name is generated
 * ("Coastal Hydro → Facilities") so the user can save straight away.
 */
export function draftFromTransaction(txn: DraftTransaction, category: string | null | undefined, options: RuleTextOptions = {}): RuleDraft {
  const payee = transactionPayee(txn).replace(/\s+/g, " ").trim();
  const conditions: RuleCondition[] = [];
  if (payee) conditions.push({ field: "payee", operator: "equals", value: payee });
  if (txn.amountCents !== 0) conditions.push({ field: "direction", value: txn.amountCents < 0 ? "out" : "in" });
  const cleanCategory = String(category ?? "").trim();
  const actions: RuleActions = cleanCategory && !isUncategorized({ category: cleanCategory }) ? { category: cleanCategory } : {};
  return { name: autoRuleName(conditions, actions, options), conditions, actions };
}

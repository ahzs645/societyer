import { useCallback, useRef } from "react";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import { isUncategorized, normalizeRuleText, transactionPayee } from "../../../../shared/transactionRules";
import { draftFromTransaction } from "./draftFromTransaction";
import type { RuleDraft } from "./ruleDraft";
import type { RulesWorkspace } from "./types";

export type PromptTransaction = {
  _id: string;
  description?: string | null;
  counterparty?: string | null;
  amountCents: number;
  category?: string | null;
  categorizedBy?: string | null;
  ruleId?: string | null;
  ruleApplication?: { ruleName?: string } | null;
};

/**
 * After someone changes a transaction's category by hand, offer to turn it
 * into a rule right there:
 * - the old category came from a rule → "Update the rule?" (opens that rule
 *   with the new category);
 * - otherwise, when the payee has at least two other transactions →
 *   "Categorise all {payee} transactions as {category}?" (opens a new rule
 *   prefilled from the transaction).
 * One prompt per payee is on screen at a time, and the same payee and
 * category is only offered once per visit.
 */
export function useRulePromptAfterCategorise({
  transactions,
  workspace,
  openDraft,
  editRule,
  canWrite,
}: {
  transactions: readonly PromptTransaction[] | undefined;
  workspace: RulesWorkspace | undefined;
  openDraft: (draft: RuleDraft) => void;
  editRule: (ruleId: string, patch?: Partial<RuleDraft>) => boolean;
  canWrite: boolean;
}) {
  const toast = useToast();
  const offered = useRef(new Set<string>());

  return useCallback(
    (previous: PromptTransaction, nextCategory: unknown) => {
      if (!canWrite || !workspace) return;
      const category = String(nextCategory ?? "").trim();
      if (!category || isUncategorized({ category })) return;
      if (normalizeRuleText(previous.category) === normalizeRuleText(category)) return;
      const payee = transactionPayee(previous).trim();
      const payeeNorm = normalizeRuleText(payee);
      if (!payeeNorm) return;
      const offerKey = `${payeeNorm}|${normalizeRuleText(category)}`;
      if (offered.current.has(offerKey)) return;
      const dedupeKey = `rule-prompt:${payeeNorm}`;

      const rule = previous.categorizedBy === "rule" && previous.ruleId
        ? workspace.rules.find((row) => row._id === String(previous.ruleId))
        : undefined;
      if (rule) {
        if (normalizeRuleText(rule.actions.category) === normalizeRuleText(category)) return;
        offered.current.add(offerKey);
        toast.info(`You changed a category set by “${rule.name}”. Update the rule?`, {
          description: `The rule would set ${category} from now on.`,
          duration: 12_000,
          dedupeKey,
          action: { label: "Update rule", onClick: () => editRule(rule._id, { category }) },
        });
        return;
      }

      const others = (transactions ?? []).filter(
        (txn) => String(txn._id) !== String(previous._id) && normalizeRuleText(transactionPayee(txn)) === payeeNorm,
      ).length;
      if (others < 2) return;
      offered.current.add(offerKey);
      toast.info(`Categorise all ${payee} transactions as ${category}?`, {
        description: `${pluralize(others, "other transaction")} from this payee. A rule also categorises future imports.`,
        duration: 12_000,
        dedupeKey,
        action: { label: "Create rule", onClick: () => openDraft(draftFromTransaction(previous, category)) },
      });
    },
    [canWrite, editRule, openDraft, toast, transactions, workspace],
  );
}

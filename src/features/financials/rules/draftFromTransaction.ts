// TEMPORARY SHIM (transactions surface batch). The rules batch owns this file
// and ships the real `draftFromTransaction`; when that lands, delete this shim
// and keep the rules batch's version. Callers only rely on the signature below.

import { transactionPayee } from "../../../../shared/transactionRules";
import { emptyCondition, emptyRuleDraft, type RuleDraft } from "./ruleDraft";

export type DraftSourceTransaction = {
  description?: string | null;
  counterparty?: string | null;
  amountCents: number;
  category?: string | null;
};

/**
 * A new-rule draft from one transaction: payee is exactly this payee, the
 * same direction, and the given (or current) category, with a readable name.
 */
export function draftFromTransaction(txn: DraftSourceTransaction, category?: string): RuleDraft {
  const payee = transactionPayee({ ...txn, amountCents: txn.amountCents }).trim();
  const target = String(category ?? txn.category ?? "").trim();
  const payeeCondition = { ...emptyCondition("payee"), textOperator: "equals" as const, text: payee };
  const directionCondition = { ...emptyCondition("direction"), direction: txn.amountCents > 0 ? ("in" as const) : ("out" as const) };
  return {
    ...emptyRuleDraft(),
    name: target ? `${payee} → ${target}` : payee,
    conditions: [payeeCondition, directionCondition],
    category: target,
  };
}

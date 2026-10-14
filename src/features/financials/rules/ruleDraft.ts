import { centsToDollarInput } from "../../../lib/format";
import { parseMoneyInput } from "../../../lib/money";
import type { AmountOperator, RuleActions, RuleCondition, TextOperator } from "../../../../shared/transactionRules";

export type ConditionField = "payee" | "description" | "amount" | "direction" | "account";

/** Editor state for one condition; amounts stay as typed text until saved. */
export type ConditionDraft = {
  key: string;
  field: ConditionField;
  textOperator: TextOperator;
  text: string;
  amountOperator: AmountOperator;
  amount: string;
  amountMax: string;
  direction: "in" | "out";
  accountId: string;
};

export type RuleDraft = {
  id?: string;
  name: string;
  enabled: boolean;
  conditions: ConditionDraft[];
  category: string;
  accountingAccountId: string;
  fundRestrictionId: string;
  markReviewed: boolean;
};

let nextKey = 1;
const key = () => `c${nextKey++}`;

export function emptyCondition(field: ConditionField = "payee"): ConditionDraft {
  return { key: key(), field, textOperator: "contains", text: "", amountOperator: "gte", amount: "", amountMax: "", direction: "out", accountId: "" };
}

export function emptyRuleDraft(): RuleDraft {
  return { name: "", enabled: true, conditions: [emptyCondition()], category: "", accountingAccountId: "", fundRestrictionId: "", markReviewed: false };
}

export function draftFromRule(rule: { _id: string; name: string; enabled: boolean; conditions: RuleCondition[]; actions: RuleActions }): RuleDraft {
  return {
    id: rule._id,
    name: rule.name,
    enabled: rule.enabled,
    conditions: rule.conditions.map(conditionToDraft),
    category: rule.actions.category ?? "",
    accountingAccountId: rule.actions.accountingAccountId ?? "",
    fundRestrictionId: rule.actions.fundRestrictionId ?? "",
    markReviewed: Boolean(rule.actions.markReviewed),
  };
}

export function conditionToDraft(condition: RuleCondition): ConditionDraft {
  const draft = emptyCondition(condition.field as ConditionField);
  if (condition.field === "payee" || condition.field === "description") {
    draft.textOperator = condition.operator;
    draft.text = condition.value;
  } else if (condition.field === "amount") {
    draft.amountOperator = condition.operator;
    draft.amount = centsToDollarInput(condition.amountCents);
    draft.amountMax = condition.amountMaxCents != null ? centsToDollarInput(condition.amountMaxCents) : "";
  } else if (condition.field === "direction") {
    draft.direction = condition.value;
  } else if (condition.field === "account") {
    draft.accountId = condition.accountId;
  }
  return draft;
}

/** Converts a draft condition; incomplete amounts become NaN so validation reports them. */
export function draftToCondition(draft: ConditionDraft): RuleCondition {
  switch (draft.field) {
    case "payee":
    case "description":
      return { field: draft.field, operator: draft.textOperator, value: draft.text };
    case "amount": {
      const amountCents = parseMoneyInput(draft.amount) ?? Number.NaN;
      return draft.amountOperator === "between"
        ? { field: "amount", operator: "between", amountCents: Math.abs(amountCents), amountMaxCents: Math.abs(parseMoneyInput(draft.amountMax) ?? Number.NaN) }
        : { field: "amount", operator: draft.amountOperator, amountCents: Math.abs(amountCents) };
    }
    case "direction":
      return { field: "direction", value: draft.direction };
    case "account":
      return { field: "account", accountId: draft.accountId };
  }
}

export function draftActions(draft: RuleDraft): RuleActions {
  return {
    ...(draft.category.trim() ? { category: draft.category.trim() } : {}),
    ...(draft.accountingAccountId ? { accountingAccountId: draft.accountingAccountId } : {}),
    ...(draft.fundRestrictionId ? { fundRestrictionId: draft.fundRestrictionId } : {}),
    ...(draft.markReviewed ? { markReviewed: true } : {}),
  };
}

/** A complete condition (used for live previews while the user types). */
export function isConditionComplete(condition: RuleCondition): boolean {
  if (condition.field === "payee" || condition.field === "description") return condition.value.trim().length > 0;
  if (condition.field === "amount") {
    if (!Number.isFinite(condition.amountCents)) return false;
    return condition.operator !== "between" || Number.isFinite(condition.amountMaxCents);
  }
  if (condition.field === "account") return Boolean(condition.accountId);
  return true;
}

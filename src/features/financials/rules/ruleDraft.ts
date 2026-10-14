import { centsToDollarInput } from "../../../lib/format";
import { parseMoneyInput } from "../../../lib/money";
import { autoRuleName, inValues, type AmountOperator, type RuleActions, type RuleCondition, type TextOperator } from "../../../../shared/transactionRules";
import type { RuleDraft } from "./draftFromTransaction";

export type ConditionField = "payee" | "description" | "amount" | "direction" | "account" | "category";

/** Editor state for one condition; amounts stay as typed text until saved. */
export type ConditionDraft = {
  key: string;
  field: ConditionField;
  textOperator: TextOperator;
  text: string;
  /** Values of an "is any of" condition (chips). */
  values: string[];
  amountOperator: AmountOperator;
  amount: string;
  amountMax: string;
  direction: "in" | "out";
  accountId: string;
  category: string;
};

/** The rule editor's working state (one per open drawer). */
export type RuleEditorDraft = {
  id?: string;
  /** Blank means "name it for me" (see `autoRuleName`). */
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
  return {
    key: key(),
    field,
    textOperator: "contains",
    text: "",
    values: [],
    amountOperator: "gte",
    amount: "",
    amountMax: "",
    direction: "out",
    accountId: "",
    category: "",
  };
}

export function emptyRuleDraft(): RuleEditorDraft {
  return { name: "", enabled: true, conditions: [emptyCondition()], category: "", accountingAccountId: "", fundRestrictionId: "", markReviewed: false };
}

export function draftFromRule(rule: { _id: string; name: string; autoNamed?: boolean; enabled: boolean; conditions: RuleCondition[]; actions: RuleActions }): RuleEditorDraft {
  return {
    id: rule._id,
    name: rule.autoNamed ? "" : rule.name,
    enabled: rule.enabled,
    conditions: rule.conditions.map(conditionToDraft),
    category: rule.actions.category ?? "",
    accountingAccountId: rule.actions.accountingAccountId ?? "",
    fundRestrictionId: rule.actions.fundRestrictionId ?? "",
    markReviewed: Boolean(rule.actions.markReviewed),
  };
}

/** Editor state for a plain draft (from a transaction, a suggestion or an AI tool). */
export function editorDraftFrom(draft: RuleDraft): RuleEditorDraft {
  // A generated name stays generated, so it follows later edits in the drawer.
  const name = String(draft.name ?? "").trim();
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: name && name !== autoRuleName(draft.conditions, draft.actions) ? name : "",
    enabled: draft.enabled ?? true,
    conditions: draft.conditions.length ? draft.conditions.map(conditionToDraft) : [emptyCondition()],
    category: draft.actions.category ?? "",
    accountingAccountId: draft.actions.accountingAccountId ?? "",
    fundRestrictionId: draft.actions.fundRestrictionId ?? "",
    markReviewed: Boolean(draft.actions.markReviewed),
  };
}

export function conditionToDraft(condition: RuleCondition): ConditionDraft {
  const draft = emptyCondition(condition.field as ConditionField);
  if (condition.field === "payee" || condition.field === "description") {
    draft.textOperator = condition.operator;
    draft.text = condition.operator === "in" ? "" : condition.value;
    draft.values = condition.operator === "in" ? inValues(condition.values) : [];
  } else if (condition.field === "amount") {
    draft.amountOperator = condition.operator;
    draft.amount = centsToDollarInput(condition.amountCents);
    draft.amountMax = condition.amountMaxCents != null ? centsToDollarInput(condition.amountMaxCents) : "";
  } else if (condition.field === "direction") {
    draft.direction = condition.value;
  } else if (condition.field === "account") {
    draft.accountId = condition.accountId;
  } else if (condition.field === "category") {
    draft.category = condition.value;
  }
  return draft;
}

/** Converts a draft condition; incomplete amounts become NaN so validation reports them. */
export function draftToCondition(draft: ConditionDraft): RuleCondition {
  switch (draft.field) {
    case "payee":
    case "description":
      return draft.textOperator === "in"
        ? { field: draft.field, operator: "in", value: "", values: inValues(draft.values) }
        : { field: draft.field, operator: draft.textOperator, value: draft.text };
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
    case "category":
      return { field: "category", value: draft.category };
  }
}

export function draftActions(draft: RuleEditorDraft): RuleActions {
  return {
    ...(draft.category.trim() ? { category: draft.category.trim() } : {}),
    ...(draft.accountingAccountId ? { accountingAccountId: draft.accountingAccountId } : {}),
    ...(draft.fundRestrictionId ? { fundRestrictionId: draft.fundRestrictionId } : {}),
    ...(draft.markReviewed ? { markReviewed: true } : {}),
  };
}

/** A complete condition (used for live previews while the user types). */
export function isConditionComplete(condition: RuleCondition): boolean {
  if (condition.field === "payee" || condition.field === "description") {
    return condition.operator === "in" ? inValues(condition.values).length > 0 : condition.value.trim().length > 0;
  }
  if (condition.field === "amount") {
    if (!Number.isFinite(condition.amountCents)) return false;
    return condition.operator !== "between" || Number.isFinite(condition.amountMaxCents);
  }
  if (condition.field === "account") return Boolean(condition.accountId);
  if (condition.field === "category") return condition.value.trim().length > 0;
  return true;
}

/** What the user can change, without per-render keys: compared to decide whether closing discards edits. */
export function draftSignature(draft: RuleEditorDraft | null): string {
  if (!draft) return "";
  return JSON.stringify({
    name: draft.name.trim(),
    enabled: draft.enabled,
    conditions: draft.conditions.map((condition) => draftToCondition(condition)),
    actions: draftActions(draft),
  });
}

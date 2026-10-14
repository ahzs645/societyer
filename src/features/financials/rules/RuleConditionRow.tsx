import { X } from "lucide-react";
import { Select, type SelectOption } from "../../../components/Select";
import { AMOUNT_OPERATOR_LABELS, MAX_IN_VALUES, TEXT_OPERATOR_LABELS, type AmountOperator, type TextOperator } from "../../../../shared/transactionRules";
import type { ConditionDraft, ConditionField } from "./ruleDraft";
import { ValueChipsInput } from "./ValueChipsInput";

const FIELD_OPTIONS: SelectOption<ConditionField>[] = [
  { value: "payee", label: "Payee", hint: "The counterparty, or the bank description when there isn't one" },
  { value: "description", label: "Description", hint: "Text from the bank description, ignoring capitals" },
  { value: "amount", label: "Amount", hint: "The size of the transaction, in or out" },
  { value: "direction", label: "Direction", hint: "Whether money came in or went out" },
  { value: "account", label: "Bank account", hint: "The bank or card account the line is in" },
  { value: "category", label: "Category", hint: "The category a line already has, to re-code it" },
];

const TEXT_HINTS: Record<TextOperator, string> = {
  contains: "The text appears anywhere",
  equals: "The whole text matches",
  starts_with: "The text begins with this",
  in: `Matches one of a list, exactly (up to ${MAX_IN_VALUES})`,
};
const TEXT_OPTIONS: SelectOption<TextOperator>[] = (Object.keys(TEXT_OPERATOR_LABELS) as TextOperator[]).map((value) => ({
  value,
  label: TEXT_OPERATOR_LABELS[value],
  hint: TEXT_HINTS[value],
}));
const AMOUNT_OPTIONS: SelectOption<AmountOperator>[] = (Object.keys(AMOUNT_OPERATOR_LABELS) as AmountOperator[]).map((value) => ({
  value,
  label: AMOUNT_OPERATOR_LABELS[value],
  ...(value === "between" ? { hint: "Both amounts count as a match" } : {}),
}));

/** One "If / and" condition of the rule editor: field, comparison and value(s). */
export function RuleConditionRow({
  condition,
  index,
  count,
  onChange,
  onRemove,
  bankAccountOptions,
  categories,
  payeeSuggestions,
  descriptionSuggestions,
}: {
  condition: ConditionDraft;
  index: number;
  count: number;
  onChange: (patch: Partial<ConditionDraft>) => void;
  onRemove: () => void;
  bankAccountOptions: SelectOption[];
  categories: string[];
  payeeSuggestions: string[];
  descriptionSuggestions: string[];
}) {
  // Carry what was typed across: one value becomes the first chip, and back.
  const changeTextOperator = (textOperator: TextOperator) => {
    if (textOperator === "in" && condition.textOperator !== "in" && condition.text.trim() && condition.values.length === 0) {
      onChange({ textOperator, values: [condition.text.trim()] });
    } else if (textOperator !== "in" && condition.textOperator === "in" && !condition.text.trim() && condition.values.length) {
      onChange({ textOperator, text: condition.values[0] });
    } else {
      onChange({ textOperator });
    }
  };

  return (
      <li className="rule-editor__condition">
        <span className="rule-editor__joiner" aria-hidden="true">{index === 0 ? "If" : "and"}</span>
        <div className="rule-editor__condition-fields">
          <Select
            size="sm"
            className="rule-editor__select rule-editor__select--field"
            aria-label={`Condition ${index + 1} field`}
            value={condition.field}
            onChange={(field) => onChange({ field })}
            options={FIELD_OPTIONS}
            menuMinWidth={280}
          />
          {(condition.field === "payee" || condition.field === "description") && (
            <>
              <Select
                size="sm"
                className="rule-editor__select rule-editor__select--op"
                aria-label={`Condition ${index + 1} comparison`}
                value={condition.textOperator}
                onChange={(textOperator) => changeTextOperator(textOperator)}
                options={TEXT_OPTIONS}
                menuMinWidth={240}
              />
              {condition.textOperator === "in" ? (
                <div className="rule-editor__chips">
                  <ValueChipsInput
                    aria-label={`Condition ${index + 1} ${condition.field === "payee" ? "payees" : "descriptions"}`}
                    values={condition.values}
                    onChange={(values) => onChange({ values })}
                    suggestions={condition.field === "payee" ? payeeSuggestions : descriptionSuggestions}
                    max={MAX_IN_VALUES}
                    placeholder={condition.field === "payee" ? "Type or pick payees" : "Type or pick descriptions"}
                  />
                </div>
              ) : (
                <input
                  className="input input--sm rule-editor__grow"
                  aria-label={`Condition ${index + 1} text`}
                  value={condition.text}
                  placeholder={condition.field === "payee" ? "e.g. BC Hydro" : "e.g. account fee"}
                  onChange={(event) => onChange({ text: event.target.value })}
                />
              )}
            </>
          )}
          {condition.field === "amount" && (
            <>
              <Select size="sm" className="rule-editor__select rule-editor__select--op" aria-label={`Condition ${index + 1} comparison`} value={condition.amountOperator} onChange={(amountOperator) => onChange({ amountOperator })} options={AMOUNT_OPTIONS} />
              <input
                className="input input--sm rule-editor__amount"
                inputMode="decimal"
                aria-label={condition.amountOperator === "between" ? `Condition ${index + 1} lower amount` : `Condition ${index + 1} amount`}
                value={condition.amount}
                placeholder="$0.00"
                onChange={(event) => onChange({ amount: event.target.value })}
              />
              {condition.amountOperator === "between" && (
                <>
                  <span className="rule-editor__word">and</span>
                  <input
                    className="input input--sm rule-editor__amount"
                    inputMode="decimal"
                    aria-label={`Condition ${index + 1} upper amount`}
                    value={condition.amountMax}
                    placeholder="$0.00"
                    onChange={(event) => onChange({ amountMax: event.target.value })}
                  />
                  <p className="rule-editor__hint rule-editor__condition-hint">Both amounts count: a line of exactly either amount matches.</p>
                </>
              )}
            </>
          )}
          {condition.field === "direction" && (
            <Select
              size="sm"
              className="rule-editor__select rule-editor__select--op"
              aria-label={`Condition ${index + 1} direction`}
              value={condition.direction}
              onChange={(direction) => onChange({ direction })}
              options={[{ value: "out", label: "is money out" }, { value: "in", label: "is money in" }]}
            />
          )}
          {condition.field === "account" && (
            <Select
              size="sm"
              className="rule-editor__grow"
              aria-label={`Condition ${index + 1} bank account`}
              value={condition.accountId}
              placeholder="Choose account"
              onChange={(accountId) => onChange({ accountId })}
              options={bankAccountOptions}
            />
          )}
          {condition.field === "category" && (
            <>
              <span className="rule-editor__word">is</span>
              <Select
                size="sm"
                className="rule-editor__grow"
                aria-label={`Condition ${index + 1} category`}
                value={condition.category}
                placeholder="Choose category"
                searchable
                onChange={(category) => onChange({ category })}
                options={categories.map((category) => ({ value: category, label: category }))}
              />
            </>
          )}
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm rule-editor__remove"
          aria-label={`Remove condition ${index + 1}`}
          disabled={count === 1}
          onClick={() => onRemove()}
        >
          <X size={14} />
        </button>
      </li>
  );
}

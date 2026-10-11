import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import {
  QUORUM_COUNT_BASES,
  QUORUM_COUNT_BASIS_LABELS,
  QUORUM_RULE_TYPES,
  QUORUM_RULE_TYPE_LABELS,
  type QuorumRuleLike,
} from "../../../shared/bodyQuorum";

/** Form state for a quorum rule: numbers stay strings while being typed. */
export type QuorumRuleDraft = {
  quorumType: string;
  quorumValue: string;
  quorumMinimumCount: string;
  countBasis: string;
  notes: string;
};

export function quorumRuleDraft(rule?: QuorumRuleLike | null): QuorumRuleDraft {
  return {
    quorumType: rule?.quorumType ?? "",
    quorumValue: rule?.quorumValue != null ? String(rule.quorumValue) : "",
    quorumMinimumCount: rule?.quorumMinimumCount != null ? String(rule.quorumMinimumCount) : "",
    countBasis: rule?.countBasis ?? "",
    notes: rule?.notes ?? "",
  };
}

/** The rule a draft describes, or null when no quorum type is chosen. */
export function quorumRuleFromDraft(draft: QuorumRuleDraft): QuorumRuleLike | null {
  if (!draft.quorumType) return null;
  const toNumber = (value: string) => (value.trim() === "" ? undefined : Number(value));
  return {
    quorumType: draft.quorumType,
    quorumValue: toNumber(draft.quorumValue),
    quorumMinimumCount: toNumber(draft.quorumMinimumCount),
    countBasis: draft.countBasis || undefined,
    notes: draft.notes || undefined,
  };
}

/**
 * Inputs for one quorum rule (A3). Used for a committee's own rule and for the
 * per-body rules (board, general meetings) of a bylaw rule set.
 */
export function QuorumRuleFields({
  value,
  onChange,
  idPrefix,
  defaultBasis,
  disabled,
  allowUnset = true,
}: {
  value: QuorumRuleDraft;
  onChange: (next: QuorumRuleDraft) => void;
  idPrefix: string;
  defaultBasis: string;
  disabled?: boolean;
  allowUnset?: boolean;
}) {
  const type = value.quorumType;
  const needsValue = type === "fixed" || type === "percentage";
  const takesMinimum = type === "majority" || type === "percentage";
  return (
    <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
      <Field label="Quorum rule">
        <Select
          id={`${idPrefix}-type`}
          disabled={disabled}
          value={type}
          onChange={(next) => onChange({ ...value, quorumType: next })}
          options={QUORUM_RULE_TYPES.map((option) => ({ value: option, label: QUORUM_RULE_TYPE_LABELS[option] ?? option }))}
          placeholder="Not set"
          clearable={allowUnset}
        />
      </Field>
      {needsValue && (
        <Field label={type === "fixed" ? "People present" : "Percent"} required>
          <input
            id={`${idPrefix}-value`}
            className="input"
            type="number"
            min={1}
            max={type === "percentage" ? 100 : undefined}
            step={type === "fixed" ? 1 : "any"}
            disabled={disabled}
            value={value.quorumValue}
            onChange={(event) => onChange({ ...value, quorumValue: event.target.value })}
          />
        </Field>
      )}
      {type && type !== "fixed" && (
        <Field label="Counted from">
          <Select
            id={`${idPrefix}-basis`}
            disabled={disabled}
            value={value.countBasis || defaultBasis}
            onChange={(next) => onChange({ ...value, countBasis: next === defaultBasis ? "" : next })}
            options={QUORUM_COUNT_BASES.map((option) => ({ value: option, label: QUORUM_COUNT_BASIS_LABELS[option] ?? option }))}
          />
        </Field>
      )}
      {takesMinimum && (
        <Field label="At least (people)">
          <input
            id={`${idPrefix}-minimum`}
            className="input"
            type="number"
            min={0}
            step={1}
            disabled={disabled}
            value={value.quorumMinimumCount}
            onChange={(event) => onChange({ ...value, quorumMinimumCount: event.target.value })}
          />
        </Field>
      )}
      {type && (
        <Field label="Source or note" className="field--grow">
          <input
            id={`${idPrefix}-notes`}
            className="input"
            disabled={disabled}
            value={value.notes}
            onChange={(event) => onChange({ ...value, notes: event.target.value })}
            placeholder="e.g. Terms of reference s. 4.2"
          />
        </Field>
      )}
    </div>
  );
}

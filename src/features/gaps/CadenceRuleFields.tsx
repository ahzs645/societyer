import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import {
  CADENCE_FREQUENCIES,
  CADENCE_FREQUENCY_LABELS,
  describeCadenceRule,
  type CadenceRule,
} from "../../../shared/continuityRules";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Form for a structured cadence rule (frequency, count, months, offset, minimum). */
export function CadenceRuleFields({
  value,
  onChange,
  frequencies = CADENCE_FREQUENCIES as readonly string[],
  idPrefix = "cadence",
}: {
  value: CadenceRule;
  onChange: (next: CadenceRule) => void;
  frequencies?: readonly string[];
  idPrefix?: string;
}) {
  const frequency = String(value.frequency);
  const showMonths = frequency === "monthly" || frequency === "per_year_count";
  const toggleMonth = (month: number) => {
    const months = new Set(value.months ?? []);
    if (months.has(month)) months.delete(month);
    else months.add(month);
    onChange({ ...value, months: [...months].sort((a, b) => a - b) });
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <Field label="Frequency">
        <Select
          id={`${idPrefix}-frequency`}
          value={frequency}
          onChange={(next) => onChange({ frequency: next, ...(next === "after_event" ? { anchor: "agm", offsetDays: value.offsetDays ?? 30 } : {}), ...(next === "per_year_count" ? { count: value.count ?? 4 } : {}), ...(showMonthsFor(next) && value.months ? { months: value.months } : {}) })}
          options={frequencies.map((option) => ({ value: option, label: CADENCE_FREQUENCY_LABELS[option as keyof typeof CADENCE_FREQUENCY_LABELS] ?? option }))}
        />
      </Field>
      {frequency === "per_year_count" && (
        <Field label="Times per year">
          <input
            id={`${idPrefix}-count`}
            className="input"
            type="number"
            min={1}
            max={52}
            value={value.count ?? ""}
            onChange={(event) => onChange({ ...value, count: event.target.value ? Number(event.target.value) : undefined })}
          />
        </Field>
      )}
      {showMonths && (
        <Field label="Months (leave empty for every month)">
          <div className="coverage-months" role="group" aria-label="Months">
            {MONTHS.map((label, index) => (
              <label key={label}>
                <input type="checkbox" checked={(value.months ?? []).includes(index + 1)} onChange={() => toggleMonth(index + 1)} />
                {label}
              </label>
            ))}
          </div>
        </Field>
      )}
      {frequency === "after_event" && (
        <Field label="Days after the AGM">
          <input
            id={`${idPrefix}-offset`}
            className="input"
            type="number"
            min={0}
            max={730}
            value={value.offsetDays ?? 0}
            onChange={(event) => onChange({ ...value, anchor: "agm", offsetDays: Number(event.target.value || 0) })}
          />
        </Field>
      )}
      {frequency === "continuous" && (
        <Field label="Minimum count (optional)" hint="For example, at least 3 directors at all times.">
          <input
            id={`${idPrefix}-minimum`}
            className="input"
            type="number"
            min={0}
            value={value.minimumCount ?? ""}
            onChange={(event) => onChange({ ...value, minimumCount: event.target.value === "" ? undefined : Number(event.target.value) })}
          />
        </Field>
      )}
      <div className="muted" style={{ fontSize: 12 }}>Reads as: {describeCadenceRule(value)}</div>
    </div>
  );
}

function showMonthsFor(frequency: string) {
  return frequency === "monthly" || frequency === "per_year_count";
}

/** Strip empty optional fields before sending a rule to a mutation. */
export function cleanCadenceRule(rule: CadenceRule): CadenceRule {
  const out: CadenceRule = { frequency: rule.frequency };
  if (rule.count !== undefined && rule.frequency === "per_year_count") out.count = rule.count;
  if (rule.months?.length && showMonthsFor(String(rule.frequency))) out.months = rule.months;
  if (rule.frequency === "after_event") {
    out.anchor = rule.anchor ?? "agm";
    out.offsetDays = rule.offsetDays ?? 0;
  }
  if (rule.minimumCount !== undefined && rule.frequency === "continuous") out.minimumCount = rule.minimumCount;
  if (rule.seriesKey) out.seriesKey = rule.seriesKey;
  if (rule.notes) out.notes = rule.notes;
  return out;
}

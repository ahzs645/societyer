import { Field } from "./ui";
import { OptionSetName, normalizeOptionChoice, optionChoices } from "../lib/orgHubOptions";
import { Select } from "./Select";

type OptionSelectProps = {
  label: string;
  setName: OptionSetName;
  value?: string | null;
  onChange: (value: string | undefined) => void;
  emptyLabel?: string;
};

export function OptionSelect({ label, setName, value, onChange, emptyLabel }: OptionSelectProps) {
  const normalized = value ? normalizeOptionChoice(setName, value) : "";
  const options = optionChoices(setName, normalized ? [normalized] : []);
  return (
    <Field label={label}>
      <Select
        value={normalized}
        onChange={(next) => onChange(next || undefined)}
        options={options}
        placeholder={emptyLabel ?? "Select…"}
        searchable
        clearable={!!emptyLabel}
        clearLabel={emptyLabel}
      />
    </Field>
  );
}

type OptionMultiSelectProps = {
  label: string;
  setName: OptionSetName;
  values?: string[];
  onChange: (values: string[]) => void;
  rows?: number;
  /** Option values to hide unless already selected (e.g. internal codes that
   *  duplicate a human option, such as "CA-BC" beside "British Columbia"). */
  hideValues?: string[];
};

export function OptionMultiSelect({ label, setName, values = [], onChange, rows = 5, hideValues = [] }: OptionMultiSelectProps) {
  const options = optionChoices(setName, values).filter((option) => !hideValues.includes(option.value) || values.includes(option.value));
  return (
    <Field label={label}>
      <select
        className="input"
        multiple
        size={Math.min(Math.max(rows, 3), 8)}
        value={values}
        onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
        style={{ minHeight: `${Math.min(Math.max(rows, 3), 8) * 32}px` }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

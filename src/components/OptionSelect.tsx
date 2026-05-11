import { Field } from "./ui";
import { OptionSetName, optionChoices } from "../lib/orgHubOptions";

type OptionSelectProps = {
  label: string;
  setName: OptionSetName;
  value?: string | null;
  onChange: (value: string | undefined) => void;
  emptyLabel?: string;
};

export function OptionSelect({ label, setName, value, onChange, emptyLabel }: OptionSelectProps) {
  const options = optionChoices(setName, value ? [value] : []);
  return (
    <Field label={label}>
      <select className="input" value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

type OptionMultiSelectProps = {
  label: string;
  setName: OptionSetName;
  values?: string[];
  onChange: (values: string[]) => void;
  rows?: number;
};

export function OptionMultiSelect({ label, setName, values = [], onChange, rows = 5 }: OptionMultiSelectProps) {
  const options = optionChoices(setName, values);
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

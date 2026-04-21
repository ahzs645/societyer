import type { FieldDisplayProps } from "../FieldDisplay";
import type { SelectFieldConfig, SelectOption } from "../../../types";

export function SelectFieldDisplay({ value, field }: FieldDisplayProps) {
  if (value === null || value === undefined || value === "") {
    return <span className="record-cell__empty">—</span>;
  }
  const config = field.config as SelectFieldConfig;
  const option =
    (config.options ?? []).find((o: SelectOption) => o.value === String(value)) ??
    ({ value: String(value), label: String(value), color: "gray" } as SelectOption);
  return (
    <span
      className={`record-cell__chip record-cell__chip--${option.color ?? "gray"}`}
      title={option.label}
    >
      {option.label}
    </span>
  );
}

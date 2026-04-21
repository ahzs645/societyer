import type { FieldDisplayProps } from "../FieldDisplay";
import type { SelectFieldConfig, SelectOption } from "../../../types";

export function MultiSelectFieldDisplay({ value, field }: FieldDisplayProps) {
  const values = Array.isArray(value) ? value : [];
  if (values.length === 0) {
    return <span className="record-cell__empty">—</span>;
  }
  const config = field.config as SelectFieldConfig;
  const options = config.options ?? [];
  return (
    <div className="record-cell__chip-group">
      {values.map((v) => {
        const option =
          options.find((o: SelectOption) => o.value === String(v)) ??
          ({ value: String(v), label: String(v), color: "gray" } as SelectOption);
        return (
          <span
            key={option.value}
            className={`record-cell__chip record-cell__chip--${option.color ?? "gray"}`}
          >
            {option.label}
          </span>
        );
      })}
    </div>
  );
}

import type { FieldDisplayProps } from "../FieldDisplay";
import type { NumberFieldConfig } from "../../../types";

export function NumberFieldDisplay({ value, field }: FieldDisplayProps) {
  if (value === null || value === undefined || value === "") {
    return <span className="record-cell__empty">—</span>;
  }
  const config = field.config as NumberFieldConfig;
  const num = Number(value);
  if (Number.isNaN(num)) {
    return <span className="record-cell__text">{String(value)}</span>;
  }
  const formatted = config.decimals !== undefined
    ? num.toFixed(config.decimals)
    : num.toLocaleString();
  return (
    <span className="record-cell__number mono">
      {config.prefix ?? ""}{formatted}{config.suffix ?? ""}
    </span>
  );
}

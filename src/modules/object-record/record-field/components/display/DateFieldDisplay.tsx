import type { FieldDisplayProps } from "../FieldDisplay";
import type { DateFieldConfig } from "../../../types";
import { formatDate } from "../../../../../lib/format";

export function DateFieldDisplay({ value, field }: FieldDisplayProps) {
  if (value === null || value === undefined || value === "") {
    return <span className="record-cell__empty">—</span>;
  }
  const config = field.config as DateFieldConfig;
  const includeTime = config.includeTime ?? field.fieldType === "DATE_TIME";
  try {
    if (includeTime) {
      const d = new Date(String(value));
      return (
        <span className="record-cell__date mono">
          {formatDate(d.toISOString().slice(0, 10))}
          <span className="record-cell__date-time">
            {" "}
            {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
      );
    }
    return <span className="record-cell__date mono">{formatDate(String(value))}</span>;
  } catch {
    return <span className="record-cell__date mono">{String(value)}</span>;
  }
}

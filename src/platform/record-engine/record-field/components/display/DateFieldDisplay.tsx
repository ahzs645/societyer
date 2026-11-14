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
      if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
      // The day as the clock beside it reads it (local), not the UTC day: 11 PM in Vancouver is still that day.
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return (
        <span className="record-cell__date">
          {formatDate(day)}
          <span className="record-cell__date-time">
            {" "}
            {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </span>
      );
    }
    return <span className="record-cell__date">{formatDate(String(value))}</span>;
  } catch {
    return <span className="record-cell__date">{String(value)}</span>;
  }
}

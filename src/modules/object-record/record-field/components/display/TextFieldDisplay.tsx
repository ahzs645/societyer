import type { FieldDisplayProps } from "../FieldDisplay";

export function TextFieldDisplay({ value }: FieldDisplayProps) {
  if (value === null || value === undefined || value === "") {
    return <span className="record-cell__empty">—</span>;
  }
  return <span className="record-cell__text">{String(value)}</span>;
}

import type { FieldDisplayProps } from "../FieldDisplay";

export function UuidFieldDisplay({ value }: FieldDisplayProps) {
  if (!value) return <span className="record-cell__empty">—</span>;
  const str = String(value);
  return <span className="record-cell__uuid mono muted">{str.length > 8 ? `…${str.slice(-8)}` : str}</span>;
}

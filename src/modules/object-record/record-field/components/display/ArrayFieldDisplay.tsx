import type { FieldDisplayProps } from "../FieldDisplay";

export function ArrayFieldDisplay({ value }: FieldDisplayProps) {
  const values = Array.isArray(value) ? value : [];
  if (values.length === 0) return <span className="record-cell__empty">—</span>;
  return (
    <div className="record-cell__chip-group">
      {values.map((v, i) => (
        <span key={`${String(v)}-${i}`} className="record-cell__chip record-cell__chip--gray">
          {String(v)}
        </span>
      ))}
    </div>
  );
}

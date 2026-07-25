import type { FieldDisplayProps } from "../FieldDisplay";
import type { RelationFieldConfig } from "../../../types";

/**
 * Minimal relation renderer — shows the related record's id or a passed-in
 * label. A richer implementation would look up the target record by the
 * Convex table implied by `targetObjectNamePlural`; that's easy to add
 * when we wire up relation-aware queries.
 */
export function RelationFieldDisplay({ value, record, field }: FieldDisplayProps) {
  if (!value) return <span className="record-cell__empty">—</span>;
  const config = field.config as RelationFieldConfig;
  // Convention: if the record already has `<fieldName>Label` pre-joined,
  // use that. Otherwise fall back to the id.
  const label =
    (record as any)?.[`${field.name}Label`] ?? String(value).slice(-6);
  return (
    <span className="record-cell__chip record-cell__chip--blue" title={config.targetObjectNamePlural}>
      {label}
    </span>
  );
}

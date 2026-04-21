import type { ReactNode } from "react";

export function RecordTableEmpty({
  title = "No records",
  description,
  action,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="record-table__empty">
      <div className="record-table__empty-title">{title}</div>
      {description && <div className="record-table__empty-description">{description}</div>}
      {action && <div className="record-table__empty-action">{action}</div>}
    </div>
  );
}

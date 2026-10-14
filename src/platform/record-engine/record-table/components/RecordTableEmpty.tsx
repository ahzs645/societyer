import type { ReactNode } from "react";
import { SearchX } from "lucide-react";

/**
 * Empty table body. `variant="filtered"` is the "your filters hid
 * everything" state (with a way back), distinct from a table that simply has
 * no records yet.
 */
export function RecordTableEmpty({
  title = "No records",
  description,
  action,
  variant = "empty",
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  variant?: "empty" | "filtered";
}) {
  return (
    <div className={`record-table__empty${variant === "filtered" ? " record-table__empty--filtered" : ""}`} role={variant === "filtered" ? "status" : undefined}>
      {variant === "filtered" && (
        <span className="record-table__empty-icon" aria-hidden="true">
          <SearchX size={18} />
        </span>
      )}
      <div className="record-table__empty-title">{title}</div>
      {description && <div className="record-table__empty-description">{description}</div>}
      {action && <div className="record-table__empty-action">{action}</div>}
    </div>
  );
}

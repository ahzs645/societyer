import { useMemo, type ReactNode } from "react";
import { SearchX } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { suggestSearchCorrection } from "../utils/filterRecords";

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

/**
 * "Search for janitorial" when a search found nothing because of a misspelt
 * word and the corrected search does find records. Only for tables filtered
 * in memory; a server-filtered table has no vocabulary here to correct from.
 */
export function RecordTableSearchSuggestion({ search }: { search: string }) {
  const handle = useRecordTableStoreHandle();
  const serverProcessed = useRecordTableState((s) => s.serverProcessed);
  const records = useRecordTableState((s) => s.records);
  const columns = useRecordTableState((s) => s.columns);
  const filters = useRecordTableState((s) => s.filters);
  const filterGroups = useRecordTableState((s) => s.filterGroups);
  const dateContext = useRecordTableState((s) => s.dateContext);
  const suggestion = useMemo(
    () => (serverProcessed ? null : suggestSearchCorrection({ records, columns, filters, filterGroups, searchTerm: search, dateContext })),
    [serverProcessed, records, columns, filters, filterGroups, search, dateContext],
  );
  if (!suggestion) return null;
  return (
    <button type="button" className="btn btn--sm btn--primary" onClick={() => handle.get().setSearchTerm(suggestion)}>
      Search for “{suggestion}”
    </button>
  );
}

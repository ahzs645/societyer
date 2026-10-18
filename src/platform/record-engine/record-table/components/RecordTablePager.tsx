import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";

/**
 * Previous / Next under a table whose page owns the query
 * (`RecordTableScope` `serverQuery.pagination`). Renders nothing when there is
 * only one page. One page is kept in memory at a time, so a long catalog never
 * grows the device's memory as it is paged through.
 */
export function RecordTablePager() {
  const { objectMetadata, serverQuery } = useRecordTableContextOrThrow();
  const pagination = serverQuery?.pagination;
  if (!pagination || (!pagination.hasPrevious && !pagination.hasNext)) return null;
  return (
    <nav className="record-table__pager" aria-label={`${objectMetadata.labelPlural} pages`}>
      <button type="button" className="btn btn--sm" disabled={!pagination.hasPrevious} onClick={pagination.onPrevious}>
        <ChevronLeft size={14} aria-hidden="true" /> Previous
      </button>
      <span className="record-table__pager-page" aria-live="polite">Page {pagination.page}</span>
      <button type="button" className="btn btn--sm" disabled={!pagination.hasNext} onClick={pagination.onNext}>
        Next <ChevronRight size={14} aria-hidden="true" />
      </button>
    </nav>
  );
}

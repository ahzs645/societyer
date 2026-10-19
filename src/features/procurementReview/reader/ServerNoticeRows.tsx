/** Bridge the platform table controls to bounded, authenticated server pages. */
import { useEffect, useMemo, useState } from "react";
import {
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../../../platform/record-engine/record-table";
import { toNoticeRow } from "../../../../shared/procurementNoticeRow";
import { useReaderSource } from "./source";
export function ServerNoticeRows({
  kind,
  fixedParty,
}: {
  kind: string;
  fixedParty?: { field: "organization" | "issuedFor"; name: string };
}) {
  const source = useReaderSource(),
    handle = useRecordTableStoreHandle();
  const columns = useRecordTableState((s) => s.columns),
    filters = useRecordTableState((s) => s.filters),
    filterGroups = useRecordTableState((s) => s.filterGroups),
    sorts = useRecordTableState((s) => s.sorts),
    searchTerm = useRecordTableState((s) => s.searchTerm),
    dateContext = useRecordTableState((s) => s.dateContext);
  const request = useMemo(
    () =>
      JSON.stringify({
        party: fixedParty,
        columns,
        filters: [
          ...filters,
          ...(fixedParty
            ? [
                {
                  id: "fixed-party",
                  fieldMetadataId: columns.find(
                    (c) => c.field.name === fixedParty.field,
                  )?.field._id,
                  operator: "eq",
                  value: fixedParty.name,
                },
              ]
            : []),
        ],
        filterGroups,
        sorts: sorts.slice(0, 1),
        searchTerm,
        dateContext,
      }),
    [
      columns,
      filters,
      filterGroups,
      sorts,
      searchTerm,
      dateContext,
      fixedParty?.field,
      fixedParty?.name,
    ],
  );
  const [debounced, setDebounced] = useState(request);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(request), 250);
    return () => clearTimeout(timer);
  }, [request]);
  // The shared table offers multi-sort; this server view replaces it with one indexed ordering.
  useEffect(() => {
    if (sorts.length > 1) handle.get().setSorts(sorts.slice(-1));
  }, [sorts, handle]);
  const [position, setPosition] = useState<{
    request: string;
    cursors: (string | null)[];
    index: number;
  }>({ request: debounced, cursors: [null], index: 0 });
  const current =
    position.request === debounced
      ? position
      : { request: debounced, cursors: [null], index: 0 };
  const page = source.usePage!(kind, debounced, current.cursors[current.index]);
  useEffect(() => {
    handle.get().setRecords(page?.page.map((row) => toNoticeRow(row)) ?? []);
  }, [page, handle]);
  const pending = !page || request !== debounced;
  return (
    <div
      className="procurement-reader__pager"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        padding: "12px 0",
        flexWrap: "wrap",
      }}
    >
      <button
        className="btn btn--secondary btn--sm"
        disabled={pending || current.index === 0}
        onClick={() => setPosition({ ...current, index: current.index - 1 })}
      >
        Previous
      </button>
      <span role="status">
        {pending
          ? "Loading notices…"
          : `${page.page.length} results · batch ${current.index + 1}${page.relevance ? " · search relevance" : ""}`}
      </span>
      <button
        className="btn btn--secondary btn--sm"
        disabled={pending || page.isDone}
        onClick={() =>
          setPosition({
            request: debounced,
            cursors: [
              ...current.cursors.slice(0, current.index + 1),
              page!.continueCursor,
            ],
            index: current.index + 1,
          })
        }
      >
        Next
      </button>
      <small className="muted">
        Filters search the catalog. Empty batches can be continued. One indexed
        sort at a time; grouping applies to this page.
      </small>
    </div>
  );
}

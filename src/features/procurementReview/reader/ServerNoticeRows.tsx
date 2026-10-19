/** Bridge the platform table controls to bounded, authenticated server pages. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../../../platform/record-engine/record-table";
import { toNoticeRow } from "../../../../shared/procurementNoticeRow";
import { useReaderSource } from "./source";
export function ServerNoticeRows({
  kind,
  fixedParty,
  children,
}: {
  children: (props: { onEndReached: () => void; loading: boolean }) => ReactNode;
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
    if (sorts.length > 1) handle.get().setSorts(sorts.slice(0, 1));
  }, [sorts, handle]);
  // Only the current bounded page remains subscribed. Previous metadata pages
  // are retained locally; switching any query dimension discards them together.
  const queryKey = `${source.catalog.generation}:${kind}:${debounced}`;
  const [position, setPosition] = useState({ key: queryKey, cursor: null as string | null });
  const cursor = position.key === queryKey ? position.cursor : null;
  const page = source.usePage!(kind, debounced, cursor);
  const loaded = useRef({ key: queryKey, pages: new Map<string | null, ReturnType<typeof toNoticeRow>[]>() });
  const [loadedCount, setLoadedCount] = useState(0);
  const advancing = useRef<string | null>(null);
  const emptyBatches = useRef(0);
  useEffect(() => {
    if (loaded.current.key !== queryKey) {
      loaded.current = { key: queryKey, pages: new Map() };
      emptyBatches.current = 0;
      advancing.current = null;
    }
    if (page) loaded.current.pages.set(cursor, page.page.map(row => toNoticeRow(row)));
    // A reactive re-delivery replaces its page, never appends duplicate records.
    const unique = new Map([...loaded.current.pages.values()].flat().map(row => [row._id, row]));
    handle.get().setRecords([...unique.values()]);
    setLoadedCount(unique.size);
    advancing.current = null;
  }, [page, cursor, queryKey, handle]);
  const pending = !page || request !== debounced;
  const loadMore = useCallback(() => {
    if (pending || !page || page.isDone || page.continueCursor === cursor || advancing.current === page.continueCursor) return;
    advancing.current = page.continueCursor;
    setPosition({ key: queryKey, cursor: page.continueCursor });
  }, [pending, page, cursor, queryKey]);
  // Filters may leave an empty bounded batch. Continue a few, then give the
  // person an explicit continuation rather than scanning an entire catalog.
  useEffect(() => {
    if (!page || pending || page.isDone) return;
    if (page.page.length > 0) { emptyBatches.current = 0; return; }
    if (emptyBatches.current++ < 4) loadMore();
  }, [page, pending, loadMore]);
  return <>
    {children({ onEndReached: () => { if (page?.page.length) loadMore(); }, loading: pending && loadedCount === 0 })}
    <div className="procurement-reader__pager" style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", flexWrap: "wrap" }}>
      <span role="status">{pending ? "Loading notices…" : `${loadedCount.toLocaleString()} results loaded${page?.isDone ? " · end of results" : ""}`}</span>
      {!page?.isDone && <button className="btn btn--secondary btn--sm" disabled={pending} onClick={() => { emptyBatches.current = 0; loadMore(); }}>Load more</button>}
      <small className="muted">More results load as you scroll. Grouping covers loaded results.</small>
    </div>
  </>;
}

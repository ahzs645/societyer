import type {BcBidSourceFilters} from "../../../../shared/bcBidSourceFilters";
/** Bridge the platform table controls to bounded, authenticated server pages. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../../../platform/record-engine/record-table";
import { getViewGroupBy } from "../../../platform/record-engine/record-table/utils/groupRecords";
import { toNoticeRow } from "../../../../shared/procurementNoticeRow";
import { useReaderSource, type ListRow } from "./source";
import { useProcurementClock } from "../lib/clock";
export function ServerNoticeRows({
  kind,
  fixedParty,
  sourceFilters,
  showArchived = false,
  children,
}: {
  children: (props: { onEndReached: () => void; loading: boolean; hasMore: boolean; footer: ReactNode }) => ReactNode;
  kind: string;
  sourceFilters: BcBidSourceFilters;
  /** Include notices the workspace reviewed and classified as not doable. */
  showArchived?: boolean;
  fixedParty?: { field: "organization" | "issuedFor"; name: string };
}) {
  const source = useReaderSource(),
    handle = useRecordTableStoreHandle();
  const columns = useRecordTableState((s) => s.columns),
    filters = useRecordTableState((s) => s.filters),
    filterGroups = useRecordTableState((s) => s.filterGroups),
    sorts = useRecordTableState((s) => s.sorts),
    searchTerm = useRecordTableState((s) => s.searchTerm),
    dateContext = useRecordTableState((s) => s.dateContext),
    grouped = useRecordTableState((s) => getViewGroupBy(s.viewGroups) !== null);
  // The server reads only which field each column id names. Sizes, order,
  // visibility and option lists stay out of the request (a string, compared by
  // value), so resizing or hiding a column doesn't send a new query or drop the
  // loaded pages, and each subscription sends a few hundred bytes, not ~5 KB.
  const shape = useMemo(
    () =>
      JSON.stringify({
        party: fixedParty,
        sourceFilters,
        ...(showArchived ? { showArchived: true } : {}),
        columns: columns.map((column) => ({ fieldMetadataId: column.fieldMetadataId, field: { _id: column.field._id, name: column.field.name } })),
        filters,
        filterGroups,
        sorts: sorts.slice(0, 1),
        dateContext,
      }),
    [
      columns,
      sourceFilters,
      showArchived,
      filters,
      filterGroups,
      sorts,
      dateContext,
      fixedParty?.field,
      fixedParty?.name,
    ],
  );
  // The search sent to the server: typing waits for a pause; filters, sorts and
  // views are single clicks and apply at once. The first request waits one
  // effect for the table to settle (the URL's search is put into the box by an
  // earlier effect), so a link with a search doesn't first load the list without it.
  const [appliedSearch, setAppliedSearch] = useState<string | null>(null);
  useEffect(() => {
    if (appliedSearch === null) { setAppliedSearch(handle.get().searchTerm); return; }
    if (searchTerm === appliedSearch) return;
    const timer = setTimeout(() => setAppliedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm, appliedSearch, handle]);
  const debounced = useMemo(
    () => (appliedSearch === null ? null : JSON.stringify({ ...JSON.parse(shape), searchTerm: appliedSearch })),
    [shape, appliedSearch],
  );
  // The shared table offers multi-sort; this server view replaces it with one indexed ordering.
  useEffect(() => {
    if (sorts.length > 1) handle.get().setSorts(sorts.slice(0, 1));
  }, [sorts, handle]);
  // Only the current bounded page remains subscribed. Previous metadata pages
  // are retained locally; switching any query dimension discards them together.
  // The clock is not a dimension: a minute tick re-reads the current page and
  // redraws the loaded rows (relative dates, derived status) in place, rather
  // than dropping everything scrolled past and loading from the top again.
  const now = useProcurementClock();
  // A triage saved during this visit shows at once on rows of pages no longer subscribed.
  const overrides = source.triage?.useOverrides();
  const queryKey = `${source.catalog.generation}:${kind}:${debounced}`;
  const [position, setPosition] = useState({ key: queryKey, cursor: null as string | null });
  const cursor = position.key === queryKey ? position.cursor : null;
  const page = source.usePage!(kind, debounced, cursor);
  const loaded = useRef({ key: queryKey, pages: new Map<string | null, ListRow[]>() });
  const [loadedCount, setLoadedCount] = useState(0);
  const advancing = useRef<string | null>(null);
  // Notices read in a row without one matching the filters (a page can come back empty).
  const unmatchedRef = useRef(0);
  const [unmatched, setUnmatched] = useState(0);
  const counted = useRef<unknown>(null);
  useEffect(() => {
    if (loaded.current.key !== queryKey) {
      loaded.current = { key: queryKey, pages: new Map() };
      unmatchedRef.current = 0;
      setUnmatched(0);
      advancing.current = null;
    }
    if (page?.restart && cursor !== null) {
      loaded.current.pages.clear();
      handle.get().setRecords([]);
      setLoadedCount(0);
      setPosition({ key: queryKey, cursor: null });
      return;
    }
    if (page) loaded.current.pages.set(cursor, page.page);
    // A reactive re-delivery replaces its page, never appends duplicate records.
    const unique = new Map([...loaded.current.pages.values()].flat().map(row => [row.recordKey, toNoticeRow(overrides?.has(row.recordKey) ? { ...row, ...overrides.get(row.recordKey) } : row, now)]));
    // Archiving a notice takes it out of the list as soon as it is saved.
    if (!showArchived) for (const [key, row] of unique) if (row.archived) unique.delete(key);
    handle.get().setRecords([...unique.values()]);
    setLoadedCount(unique.size);
    advancing.current = null;
  }, [page, cursor, queryKey, handle, now, overrides, showArchived]);
  const pending = !page || searchTerm !== appliedSearch;
  const loadMore = useCallback(() => {
    if (pending || !page || page.isDone || page.continueCursor === cursor || advancing.current === page.continueCursor) return;
    advancing.current = page.continueCursor;
    setPosition({ key: queryKey, cursor: page.continueCursor });
  }, [pending, page, cursor, queryKey]);
  // A narrow filter or search can leave bounded pages empty. Keep reading on
  // its own until UNMATCHED_BUDGET notices in a row haven't matched, then ask
  // before reading further rather than scanning a whole catalog unattended.
  const stalled = !!page && !pending && !page.isDone && page.page.length === 0 && unmatched >= UNMATCHED_BUDGET;
  useEffect(() => {
    if (!page || pending || page.isDone || counted.current === page) return;
    counted.current = page;
    unmatchedRef.current = page.page.length > 0 ? 0 : unmatchedRef.current + page.scanned;
    setUnmatched(unmatchedRef.current);
    if (page.page.length === 0 && unmatchedRef.current < UNMATCHED_BUDGET) loadMore();
  }, [page, pending, loadMore]);
  const keepChecking = () => {
    unmatchedRef.current = 0;
    setUnmatched(0);
    loadMore();
  };
  const loaded_ = loadedCount.toLocaleString("en-CA");
  // The list's own last row (inside the scroller, where the reader is), not a bar under the table.
  const footer = !page && loadedCount === 0 ? null
    : stalled ? (
      <>
        <span role="status">{loadedCount ? `${loaded_} loaded. ` : ""}The next {unmatched.toLocaleString("en-CA")} notices didn't match.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={keepChecking}>Keep checking</button>
      </>
    )
    : pending ? <span role="status" aria-live="polite">{loadedCount ? `${loaded_} loaded · loading more…` : "Loading notices…"}</span>
    : page?.isDone ? (loadedCount ? <span role="status">{loaded_} {loadedCount === 1 ? "result" : "results"} · end of results</span> : null)
    : <span>{loaded_} loaded · more load as you scroll{grouped ? " · groups cover loaded results" : ""}</span>;
  return <>
    {children({ onEndReached: () => { if (!stalled) loadMore(); }, loading: pending && loadedCount === 0, hasMore: !page?.isDone, footer })}
  </>;
}

/** Notices read in a row without a match before the list asks to keep checking (bounded pages read at most 100). */
const UNMATCHED_BUDGET = 1000;

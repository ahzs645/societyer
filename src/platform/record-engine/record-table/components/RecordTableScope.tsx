import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { withHiddenObjectFields } from "../utils/hiddenObjectFields";
import { useSearchParams } from "react-router-dom";
import {
  RecordTableStoreContext,
  createRecordTableStore,
  useRecordTableState,
  useRecordTableStoreHandle,
  type RecordTableStore,
} from "../state/recordTableStore";
import { useRecordTableRowModel } from "../hooks/useRecordTableRowModel";
import { useSociety } from "@/hooks/useSociety";
import { organizationTodayISO } from "@/lib/dateRanges";
import {
  RecordTableContext,
  type RecordTableContextValue,
} from "../contexts/RecordTableContext";
import type { HydratedView, ObjectMetadata } from "../../types";
import { RecordTableSidePanel } from "./RecordTableSidePanel";
import { useCurrentUserId } from "@/hooks/useCurrentUser";

/** Query parameter that opens a record's side panel, e.g. `/app/tasks?record=<id>`. */
export const RECORD_DEEP_LINK_PARAM = "record";

/**
 * Sets up both the per-instance zustand store *and* the metadata context
 * for a single table. All RecordTable components must render inside this
 * scope.
 *
 * Analogous to Twenty's `RecordTableComponentInstance` +
 * `RecordTableContextProvider` combined.
 */
export function RecordTableScope({
  tableId,
  objectMetadata,
  hydratedView,
  records,
  onRecordClick,
  onUpdate,
  onCreate,
  onReorder,
  recordPreview = false,
  children,
}: {
  tableId: string;
  objectMetadata: ObjectMetadata;
  hydratedView: HydratedView | null;
  records: any[];
  onRecordClick?: RecordTableContextValue["onRecordClick"];
  onUpdate?: RecordTableContextValue["onUpdate"];
  onCreate?: RecordTableContextValue["onCreate"];
  onReorder?: RecordTableContextValue["onReorder"];
  /**
   * Row clicks open the preview sidebar even when the object has no full
   * record page to open (no `onRecordClick`); the sidebar then omits Open.
   */
  recordPreview?: boolean;
  children: ReactNode;
}) {
  // Object metadata is society-scoped, so changing it denotes a workspace
  // switch even when the route's tableId stays the same.
  const actorId = useCurrentUserId();
  const hasAuthorizedView = hydratedView !== null;
  // Every field of the object is available to filters, sorts and the column
  // picker; fields the view doesn't show ride along as hidden columns.
  const loadableView = useMemo(
    () => withHiddenObjectFields(hydratedView, objectMetadata.fields),
    [hydratedView, objectMetadata.fields],
  );
  const scopeIdentity = `${tableId}:${objectMetadata._id}:${actorId ?? "unbound"}:${hasAuthorizedView}`;
  const store = useMemo<RecordTableStore>(
    () => {
      const next = createRecordTableStore({
        tableId,
        objectMetadataId: objectMetadata._id,
        labelIdentifierFieldName: objectMetadata.labelIdentifierFieldName,
      });
      // The first render for a different actor must not retain the previous
      // actor's filters, saved view, selection, cells or drawer record. Hydrate
      // a newly scoped store immediately from the current authorized snapshot.
      if (loadableView) next.getState().loadView(loadableView);
      return next;
    },
    [tableId, objectMetadata._id, objectMetadata.labelIdentifierFieldName, actorId, hasAuthorizedView],
  );
  const [sidePanelRecord, setSidePanelRecord] = useState<{
    scopeIdentity: string;
    recordId: string;
    record: any;
  } | null>(null);

  const handledRequestRef = useRef<string | null>(null);
  useEffect(() => {
    setSidePanelRecord(null);
    // A new scope (or StrictMode's effect replay) may re-apply a `?record=` deep link.
    handledRequestRef.current = null;
  }, [scopeIdentity]);

  // Deep link: `?record=<id>` (used by global search hits) opens that record's
  // side panel once it is among this table's records. Closing the panel drops
  // the parameter so a reload or Back does not reopen it unexpectedly.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRecordId = searchParams.get(RECORD_DEEP_LINK_PARAM);
  useEffect(() => {
    if (!requestedRecordId || handledRequestRef.current === `${scopeIdentity}:${requestedRecordId}`) return;
    const match = records.find((record) => String(record?._id) === requestedRecordId);
    if (!match) return;
    handledRequestRef.current = `${scopeIdentity}:${requestedRecordId}`;
    setSidePanelRecord({ scopeIdentity, recordId: requestedRecordId, record: match });
  }, [records, requestedRecordId, scopeIdentity]);
  const closeSidePanel = useCallback(() => {
    setSidePanelRecord(null);
    if (searchParams.has(RECORD_DEEP_LINK_PARAM)) {
      const next = new URLSearchParams(searchParams);
      next.delete(RECORD_DEEP_LINK_PARAM);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Relative date filters ("Last 30 days", "Fiscal year to date") and export
  // file names use the organisation's calendar, not UTC.
  const organization = useSociety() as ({ fiscalYearEnd?: string | null } & Parameters<typeof organizationTodayISO>[0]) | null | undefined;
  const organizationToday = organizationTodayISO(organization ?? null);
  const fiscalYearEnd = organization?.fiscalYearEnd ?? null;
  useEffect(() => {
    store.getState().setDateContext({ today: organizationToday, fiscalYearEnd });
  }, [store, organizationToday, fiscalYearEnd]);

  // Pipe view + records into the store when they change.
  useEffect(() => {
    if (loadableView) store.getState().loadView(loadableView);
  }, [loadableView, store]);
  useEffect(() => {
    store.getState().setRecords(records);
  }, [records, store]);

  const handleRecordClick = useCallback<NonNullable<RecordTableContextValue["onRecordClick"]>>(
    (recordId, record, options) => {
      const openRecordIn =
        options.source === "row"
          ? hydratedView?.view.openRecordIn ?? "drawer"
          : options.openRecordIn;
      if (openRecordIn === "drawer") {
        setSidePanelRecord({ scopeIdentity, recordId, record });
        return;
      }
      setSidePanelRecord(null);
      onRecordClick?.(recordId, record, { ...options, openRecordIn });
    },
    [hydratedView?.view.openRecordIn, onRecordClick, scopeIdentity],
  );

  const contextValue = useMemo<RecordTableContextValue>(
    () => ({
      tableId,
      objectMetadata,
      onRecordClick: onRecordClick || recordPreview ? handleRecordClick : undefined,
      onUpdate,
      onCreate,
      onReorder,
    }),
    [tableId, objectMetadata, onRecordClick, recordPreview, handleRecordClick, onUpdate, onCreate, onReorder],
  );

  const activeSidePanelRecord = sidePanelRecord?.scopeIdentity === scopeIdentity
    ? sidePanelRecord
    : null;
  const currentSidePanelRecord = activeSidePanelRecord
    ? records.find((record) => String(record._id) === activeSidePanelRecord.recordId) ??
      activeSidePanelRecord.record
    : null;

  return (
    <RecordTableStoreContext.Provider value={store}>
      <RecordTableContext.Provider value={contextValue}>
        {children}
        <RecordTableSidePanelBridge
          recordId={activeSidePanelRecord && currentSidePanelRecord ? activeSidePanelRecord.recordId : null}
          onNavigate={(record) => setSidePanelRecord({ scopeIdentity, recordId: String(record._id), record })}
        />
        {activeSidePanelRecord && currentSidePanelRecord && (
          <RecordTableSidePanel
            open
            record={currentSidePanelRecord}
            objectMetadata={objectMetadata}
            onClose={closeSidePanel}
            onUpdate={onUpdate}
            onOpenRecord={onRecordClick ? () =>
              handleRecordClick(activeSidePanelRecord.recordId, currentSidePanelRecord, {
                source: "action",
                openRecordIn: "page",
              }) : undefined}
          />
        )}
      </RecordTableContext.Provider>
    </RecordTableStoreContext.Provider>
  );
}

function isTypingElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Keeps the table and the preview panel in step: the open record is marked in
 * the table (and its low-priority columns fold away), up/down or j/k inside
 * the panel step to the previous/next record in the table's current order,
 * and moving through the table with the keyboard carries the panel along.
 */
function RecordTableSidePanelBridge({
  recordId,
  onNavigate,
}: {
  recordId: string | null;
  onNavigate: (record: any) => void;
}) {
  const handle = useRecordTableStoreHandle();
  const { records } = useRecordTableRowModel();
  const focusedRow = useRecordTableState((state) => state.focusedCell?.rowIndex ?? null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    handle.get().setPanelRecordId(recordId);
  }, [handle, recordId]);
  useEffect(() => () => handle.get().setPanelRecordId(null), [handle]);

  useEffect(() => {
    if (!recordId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const step = key === "arrowdown" || key === "j" ? 1 : key === "arrowup" || key === "k" ? -1 : 0;
      if (!step) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isTypingElement(target)) return;
      // Only from the panel itself (or with nothing focused): menus, the
      // command palette and the table's own grid keep their arrow keys.
      const fromPanel = !!target?.closest(".record-side-panel");
      const fromNowhere = !target || target === document.body || target === document.documentElement;
      if (!fromPanel && !fromNowhere) return;
      if (target?.closest('[role="menu"], [role="listbox"], [role="tablist"]')) return;
      const index = records.findIndex((record) => String(record._id) === recordId);
      const nextIndex = index < 0 ? 0 : index + step;
      const next = records[nextIndex];
      if (!next) return;
      event.preventDefault();
      onNavigateRef.current(next);
      const columnIndex = handle.get().focusedCell?.columnIndex ?? 0;
      handle.get().setRangeAnchor(null);
      handle.get().setFocusedCell({ rowIndex: nextIndex, columnIndex });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handle, recordId, records]);

  // Arrowing through the grid while the panel is open shows each record.
  const lastFocusedRow = useRef(focusedRow);
  useEffect(() => {
    if (lastFocusedRow.current === focusedRow) return;
    lastFocusedRow.current = focusedRow;
    if (!recordId || focusedRow === null) return;
    const record = records[focusedRow];
    if (record && String(record._id) !== recordId) onNavigateRef.current(record);
  }, [focusedRow, recordId, records]);

  return null;
}

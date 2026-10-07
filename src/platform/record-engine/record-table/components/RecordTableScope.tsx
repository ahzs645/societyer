import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  RecordTableStoreContext,
  createRecordTableStore,
  type RecordTableStore,
} from "../state/recordTableStore";
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
  children: ReactNode;
}) {
  // Object metadata is society-scoped, so changing it denotes a workspace
  // switch even when the route's tableId stays the same.
  const actorId = useCurrentUserId();
  const hasAuthorizedView = hydratedView !== null;
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
      if (hydratedView) next.getState().loadView(hydratedView);
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

  // Pipe view + records into the store when they change.
  useEffect(() => {
    if (hydratedView) store.getState().loadView(hydratedView);
  }, [hydratedView, store]);
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
      onRecordClick: onRecordClick ? handleRecordClick : undefined,
      onUpdate,
      onCreate,
      onReorder,
    }),
    [tableId, objectMetadata, onRecordClick, handleRecordClick, onUpdate, onCreate, onReorder],
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
        {activeSidePanelRecord && currentSidePanelRecord && (
          <RecordTableSidePanel
            open
            record={currentSidePanelRecord}
            objectMetadata={objectMetadata}
            onClose={closeSidePanel}
            onUpdate={onUpdate}
            onOpenRecord={() =>
              handleRecordClick(activeSidePanelRecord.recordId, currentSidePanelRecord, {
                source: "action",
                openRecordIn: "page",
              })
            }
          />
        )}
      </RecordTableContext.Provider>
    </RecordTableStoreContext.Provider>
  );
}

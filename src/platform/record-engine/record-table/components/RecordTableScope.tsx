import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  const scopeIdentity = `${tableId}:${objectMetadata._id}`;
  const store = useMemo<RecordTableStore>(
    () =>
      createRecordTableStore({
        tableId,
        objectMetadataId: objectMetadata._id,
        labelIdentifierFieldName: objectMetadata.labelIdentifierFieldName,
      }),
    [tableId, objectMetadata._id, objectMetadata.labelIdentifierFieldName],
  );
  const [sidePanelRecord, setSidePanelRecord] = useState<{
    scopeIdentity: string;
    recordId: string;
    record: any;
  } | null>(null);

  useEffect(() => {
    setSidePanelRecord(null);
  }, [scopeIdentity]);

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
            onClose={() => setSidePanelRecord(null)}
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

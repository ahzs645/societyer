import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  // Store is created once per tableId for the lifetime of this scope.
  const storeRef = useRef<RecordTableStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createRecordTableStore({
      tableId,
      objectMetadataId: objectMetadata._id,
      labelIdentifierFieldName: objectMetadata.labelIdentifierFieldName,
    });
  }
  const store = storeRef.current;
  const [sidePanelRecord, setSidePanelRecord] = useState<{ recordId: string; record: any } | null>(null);

  // Pipe view + records into the store when they change.
  useEffect(() => {
    if (hydratedView) store.getState().loadView(hydratedView);
  }, [hydratedView, store]);
  useEffect(() => {
    store.getState().setRecords(records);
  }, [records, store]);

  const handleRecordClick = useCallback<NonNullable<RecordTableContextValue["onRecordClick"]>>(
    (recordId, record, options) => {
      if (options.openRecordIn === "drawer") {
        setSidePanelRecord({ recordId, record });
        return;
      }
      setSidePanelRecord(null);
      onRecordClick?.(recordId, record, options);
    },
    [onRecordClick],
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

  const currentSidePanelRecord = sidePanelRecord
    ? records.find((record) => String(record._id) === sidePanelRecord.recordId) ?? sidePanelRecord.record
    : null;

  return (
    <RecordTableStoreContext.Provider value={store}>
      <RecordTableContext.Provider value={contextValue}>
        {children}
        {sidePanelRecord && currentSidePanelRecord && (
          <RecordTableSidePanel
            open
            record={currentSidePanelRecord}
            objectMetadata={objectMetadata}
            onClose={() => setSidePanelRecord(null)}
            onUpdate={onUpdate}
            onOpenRecord={() =>
              handleRecordClick(sidePanelRecord.recordId, currentSidePanelRecord, {
                openRecordIn: "page",
              })
            }
          />
        )}
      </RecordTableContext.Provider>
    </RecordTableStoreContext.Provider>
  );
}

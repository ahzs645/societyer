import { useEffect, useMemo, useRef, type ReactNode } from "react";
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
  children,
}: {
  tableId: string;
  objectMetadata: ObjectMetadata;
  hydratedView: HydratedView | null;
  records: any[];
  onRecordClick?: (recordId: string, record: any) => void;
  onUpdate?: RecordTableContextValue["onUpdate"];
  children: ReactNode;
}) {
  // Store is created once per tableId for the lifetime of this scope.
  const storeRef = useRef<RecordTableStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createRecordTableStore({
      tableId,
      objectMetadataId: objectMetadata._id,
    });
  }
  const store = storeRef.current;

  // Pipe view + records into the store when they change.
  useEffect(() => {
    if (hydratedView) store.getState().loadView(hydratedView);
  }, [hydratedView, store]);
  useEffect(() => {
    store.getState().setRecords(records);
  }, [records, store]);

  const contextValue = useMemo<RecordTableContextValue>(
    () => ({ tableId, objectMetadata, onRecordClick, onUpdate }),
    [tableId, objectMetadata, onRecordClick, onUpdate],
  );

  return (
    <RecordTableStoreContext.Provider value={store}>
      <RecordTableContext.Provider value={contextValue}>
        {children}
      </RecordTableContext.Provider>
    </RecordTableStoreContext.Provider>
  );
}

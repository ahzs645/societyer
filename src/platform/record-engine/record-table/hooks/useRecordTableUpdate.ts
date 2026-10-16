import { useCallback } from "react";
import { useToast } from "../../../../components/Toast";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { useRecordTableStoreHandle } from "../state/recordTableStore";

/** How long a saved edit may wait for the records to catch up before it is dropped. */
const SETTLED_EDIT_TTL_MS = 5000;

export type RecordTableUpdateArgs = { recordId: string; fieldName: string; value: unknown };

/**
 * The table's own way to save a cell: the new value shows at once (and the
 * cell is marked pending) while the page's `onUpdate` runs. A failed save
 * puts the old value back and says so. Resolves to whether it saved.
 */
export function useRecordTableUpdate() {
  const { onUpdate } = useRecordTableContextOrThrow();
  const handle = useRecordTableStoreHandle();
  const toast = useToast();

  return useCallback(
    async (
      args: RecordTableUpdateArgs,
      // `dedupeKey` lets a failure replace a toast the caller already showed
      // (e.g. "Cleared … · Undo"), instead of stacking beside it.
      options: { fieldLabel?: string; dedupeKey?: string } = {},
    ): Promise<boolean> => {
      if (!onUpdate) return false;
      const token = handle.get().beginPendingEdit(args.recordId, args.fieldName, args.value);
      try {
        await onUpdate(args);
        handle.get().settlePendingEdit(token, true);
        window.setTimeout(() => handle.get().settlePendingEdit(token, false), SETTLED_EDIT_TTL_MS);
        return true;
      } catch (error) {
        handle.get().settlePendingEdit(token, false);
        toast.error(options.fieldLabel ? `Couldn't save ${options.fieldLabel.toLowerCase()}` : "Couldn't save the change", {
          description: error instanceof Error && error.message ? error.message : "Try again in a moment.",
          dedupeKey: options.dedupeKey,
        });
        return false;
      }
    },
    [handle, onUpdate, toast],
  );
}

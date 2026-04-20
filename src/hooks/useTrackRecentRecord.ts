import { useEffect } from "react";
import { useUIStore } from "../lib/store";

/** Records a visit to a record detail page so it appears under "Recent" in
 * the command palette. Safe to call with missing args — no-ops until ready. */
export function useTrackRecentRecord(
  entityType: string,
  id: string | null | undefined,
  label: string | null | undefined,
  to: string | null | undefined,
) {
  useEffect(() => {
    if (!id || !label || !to) return;
    useUIStore.getState().pushRecentRecord({
      entityType,
      id,
      label,
      to,
      at: Date.now(),
    });
  }, [entityType, id, label, to]);
}

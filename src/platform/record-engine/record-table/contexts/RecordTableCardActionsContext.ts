import { createContext, useContext, type ReactNode } from "react";
import type { MenuSection } from "../../../../components/Menu";

/**
 * Per-card context from RecordTableCardList: the record a card draws and the
 * table's row actions for it (`renderRowActions`, `rowMenuSections`), so
 * `RecordTablePhoneCard` offers the same "…" menu as the table row without
 * each page wiring it into its card.
 */
export type RecordTableCardActionsValue = {
  record: Record<string, unknown>;
  renderRowActions?: (record: Record<string, unknown>) => ReactNode;
  rowMenuSections?: (record: Record<string, unknown>) => MenuSection[];
};

export const RecordTableCardActionsContext = createContext<RecordTableCardActionsValue | null>(null);

/** The surrounding card's row actions, or null outside a card list. */
export function useRecordTableCardActions(): RecordTableCardActionsValue | null {
  return useContext(RecordTableCardActionsContext);
}

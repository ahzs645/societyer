import { createContext, useContext } from "react";
import type { EntityRef } from "./entityRefs";

/**
 * Provided by a record side panel. Entity chips inside it open the related
 * record as a stacked card instead of navigating away.
 */
export type PanelStackContextValue = {
  openRelated: (ref: EntityRef) => void;
};

export const PanelStackContext = createContext<PanelStackContextValue | null>(null);

export function usePanelStack() {
  return useContext(PanelStackContext);
}

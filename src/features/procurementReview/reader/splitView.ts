/**
 * Whether a notice is open in the side panel over the list (ProcurementReader),
 * so the list keeps the open notice's row in sight as the panel steps through
 * it. Named for the desktop split view the panel replaced; NoticeTable reads
 * it as `useSplitView`.
 */
import { createContext, useContext } from "react";

export const SplitViewContext = createContext(false);
export const useSplitView = () => useContext(SplitViewContext);

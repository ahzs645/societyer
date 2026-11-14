/**
 * Whether the list is showing beside an open notice (ProcurementReader's
 * split view) rather than on its own or covered by it. The list then keeps
 * the open notice's row in sight as the notice steps on.
 */
import { createContext, useContext } from "react";

export const SplitViewContext = createContext(false);
export const useSplitView = () => useContext(SplitViewContext);

/**
 * Whether a notice is open in the side panel over the list (ProcurementReader),
 * so the list keeps the open notice's row in sight as the panel steps through
 * it (NoticeTable).
 */
import { createContext, useContext } from "react";

export const NoticePanelOpenContext = createContext(false);
export const useNoticePanelOpen = () => useContext(NoticePanelOpenContext);

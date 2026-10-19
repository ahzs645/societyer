import { useContext } from "react";
import { useStore } from "zustand";
import { RecordTableContext } from "../contexts/RecordTableContext";
import { useRecordTableStoreHandle, useRecordTableStoreOrThrow } from "../state/recordTableStore";
import {
  DEFAULT_RECORD_TABLE_DISPLAY,
  chooseRecordTableDisplay,
  resolveRecordTableDisplay,
  type RecordTableDisplay,
} from "../utils/viewDisplay";

/**
 * The table's display (continuous scroll or pages, and the page size): the
 * view's own choice, else the scope's default. `choose` records a new choice
 * in the view, where it saves and reverts with the other view settings.
 */
export function useRecordTableDisplay(): RecordTableDisplay & {
  defaults: RecordTableDisplay;
  choose: (next: RecordTableDisplay) => void;
} {
  const store = useRecordTableStoreOrThrow();
  const handle = useRecordTableStoreHandle();
  const defaults = useContext(RecordTableContext)?.displayDefaults ?? DEFAULT_RECORD_TABLE_DISPLAY;
  const mode = useStore(store, (s) => resolveRecordTableDisplay(s.viewGroups, defaults).mode);
  const pageSize = useStore(store, (s) => resolveRecordTableDisplay(s.viewGroups, defaults).pageSize);
  const choose = (next: RecordTableDisplay) =>
    handle.get().setViewGroups(chooseRecordTableDisplay(handle.get().viewGroups, next, defaults));
  return { mode, pageSize, defaults, choose };
}

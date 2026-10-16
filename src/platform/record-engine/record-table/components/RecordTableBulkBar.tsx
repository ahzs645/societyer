import { useEffect, useMemo, type ReactNode } from "react";
import { X } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useFilteredRecords } from "../hooks/useFilteredRecords";

export type BulkAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  keepSelection?: boolean;
  onRun: (recordIds: string[], records: any[]) => void | Promise<void>;
};

/** Surfaces whose Escape closes themselves rather than the row selection. */
const OWNS_ESCAPE_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
  ".record-side-panel",
  ".drawer",
  ".record-table__cell-editor-popover",
].join(", ");

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Floating "island" shown while 1+ rows are selected: count, actions, Clear.
 * Centred at the bottom of the table on desktop; docked above the bottom
 * navigation on phones (with a spacer so it never covers the last rows).
 * Clears selection after each action unless `keepSelection` is set (useful
 * for bulk-edit modals that want the IDs to stick around).
 *
 * The count and every action cover only the selected rows that are on screen
 * (the current search and filters): a row hidden by a search is never
 * archived or merged without being seen.
 */
export function RecordTableBulkBar({ actions }: { actions: BulkAction[] }) {
  const selected = useRecordTableState((s) => s.selectedRecordIds);
  const visible = useFilteredRecords();
  const handle = useRecordTableStoreHandle();

  const selectedRecords = useMemo(
    () => visible.filter((record: any) => selected.has(String(record._id))),
    [visible, selected],
  );
  const ids = selectedRecords.map((record: any) => String(record._id));
  const active = selectedRecords.length > 0;

  // Escape drops the selection while the island is up. Fields, menus,
  // dialogs and panels keep their own Escape (they hold focus, or mark the
  // key handled, as the table does when Escape leaves a cell or editor).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isTypingTarget(target)) return;
      if (target?.closest(OWNS_ESCAPE_SELECTOR)) return;
      event.preventDefault();
      handle.get().clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, handle]);

  if (!active) return null;

  return (
    <>
    <div className="record-table__bulk-bar" role="region" aria-label="Bulk actions">
      <div className="record-table__bulk-bar-count" aria-live="polite">
        <strong>{selectedRecords.length}</strong> selected
      </div>
      <div className="record-table__bulk-bar-actions">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={
              "record-table__bulk-bar-button" +
              (action.tone === "danger" ? " record-table__bulk-bar-button--danger" : "")
            }
            onClick={async () => {
              await action.onRun(ids, selectedRecords);
              if (!action.keepSelection) handle.get().clearSelection();
            }}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="record-table__bulk-bar-clear"
        onClick={() => handle.get().clearSelection()}
        aria-label="Clear selection"
        aria-keyshortcuts="Escape"
      >
        <X size={12} aria-hidden="true" />
        <span>Clear</span>
      </button>
    </div>
    <div className="record-table__bulk-bar-spacer" aria-hidden="true" />
    </>
  );
}

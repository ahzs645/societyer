import { useEffect, useRef } from "react";
import { Modal } from "../../../components/Modal";
import { ShortcutHint } from "../../../components/ShortcutHint";
import { openShortcutHelp } from "../../../components/ShortcutHelp";
import { isTypingTarget, TRANSACTIONS_SHORTCUT_SECTION, type ShortcutSection } from "../../../lib/shortcutsRegistry";
import { useRecordTableStoreHandle } from "../../../platform/record-engine/record-table/state/recordTableStore";
import { RECORD_TABLE_GRID_SHORTCUTS } from "../../../platform/record-engine/record-table/utils/gridShortcuts";
import { keyBelongsElsewhere } from "./transactionHotkeyTarget";

/** The shortcuts the transactions tab really has (its own, the table's and the panel's). */
export const TRANSACTION_SHORTCUT_SECTIONS: ShortcutSection[] = [
  { ...TRANSACTIONS_SHORTCUT_SECTION, items: TRANSACTIONS_SHORTCUT_SECTION.items.map((item) => (item.keys[0] === "?" ? { ...item, label: "Show these shortcuts" } : item)) },
  {
    id: "transactions-table",
    label: "Table",
    items: [
      { keys: ["J", "K"], label: "Move to the next or previous row" },
      { keys: ["↑", "↓"], label: "Move between rows" },
      { keys: ["Enter"], label: "Open the focused transaction, or edit the cell" },
      { keys: ["X"], label: "Select or deselect the focused row" },
      { keys: ["Space"], label: "Select or deselect the focused row" },
      { keys: ["Mod", "C"], label: "Copy the selected cells or rows" },
      { keys: ["Esc"], label: "Cancel editing, then clear the focus or the selection" },
    ],
  },
  {
    id: "transactions-panel",
    label: "Transaction panel",
    items: [
      { keys: ["↑", "↓"], label: "Show the previous or next transaction" },
      { keys: ["J", "K"], label: "Show the next or previous transaction" },
      { keys: ["Esc"], label: "Close the panel" },
    ],
  },
  // Date, description, category, fund and notes edit in place (grid mode).
  RECORD_TABLE_GRID_SHORTCUTS,
];

export function TransactionShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Transaction shortcuts" size="md">
      <div className="shortcut-help">
        <div className="shortcut-help__sections">
          {TRANSACTION_SHORTCUT_SECTIONS.map((section) => (
            <section key={section.id} className="shortcut-help__section" aria-labelledby={`txn-shortcuts-${section.id}`}>
              <h3 id={`txn-shortcuts-${section.id}`} className="shortcut-help__section-label">{section.label}</h3>
              <ul className="shortcut-help__list">
                {section.items.map((item, index) => (
                  <li key={`${item.label}-${index}`} className="shortcut-help__row">
                    <span className="shortcut-help__label">{item.label}</span>
                    <ShortcutHint keys={item.keys} className="shortcut-help__keys" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="shortcut-help__foot">
          Shortcuts pause while you type in a field.{" "}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onClose();
              openShortcutHelp();
            }}
          >
            All keyboard shortcuts
          </button>
        </p>
      </div>
    </Modal>
  );
}

/**
 * The transactions tab's keys: `?` toggles its shortcuts sheet (instead of
 * the app-wide list), and R / U mark the selected rows reviewed / unreviewed.
 * With no selection, the open panel handles R / U for its own row. Mount
 * inside the table scope.
 */
export function TransactionHotkeys({
  canWrite,
  onToggleSheet,
  onSetReviewed,
}: {
  canWrite: boolean;
  /** `?` opens the sheet, or closes it when it is open. */
  onToggleSheet: () => void;
  onSetReviewed: (ids: string[], reviewed: boolean) => void;
}) {
  const handle = useRecordTableStoreHandle();
  const latest = useRef({ canWrite, onToggleSheet, onSetReviewed });
  latest.current = { canWrite, onToggleSheet, onSetReviewed };

  useEffect(() => {
    // Capture phase: runs before the app-wide `?` help and before a focused
    // grid cell turns the letter into an edit.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.metaKey || event.ctrlKey) return;
      // Other dialogs (the rule editor, every other drawer) and open menus
      // keep their keys; only the transaction panel counts as the tab.
      if (isTypingTarget(event.target) || keyBelongsElsewhere(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onToggleSheet();
        return;
      }
      if (event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "r" && key !== "u") return;
      const selected = [...handle.get().selectedRecordIds];
      if (selected.length === 0 || !latest.current.canWrite) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onSetReviewed(selected, key === "r");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handle]);

  return null;
}

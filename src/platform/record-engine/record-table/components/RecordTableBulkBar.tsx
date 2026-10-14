import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";

export type BulkAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  keepSelection?: boolean;
  onRun: (recordIds: string[], records: any[]) => void | Promise<void>;
};

/**
 * Floating "island" shown while 1+ rows are selected: count, actions, Clear.
 * Centred at the bottom of the table on desktop; docked above the bottom
 * navigation on phones (with a spacer so it never covers the last rows).
 * Clears selection after each action unless `keepSelection` is set (useful
 * for bulk-edit modals that want the IDs to stick around).
 */
export function RecordTableBulkBar({ actions }: { actions: BulkAction[] }) {
  const selected = useRecordTableState((s) => s.selectedRecordIds);
  const records = useRecordTableState((s) => s.records);
  const handle = useRecordTableStoreHandle();

  if (selected.size === 0) return null;

  const selectedRecords = records.filter((r: any) => selected.has(String(r._id)));
  const ids = selectedRecords.map((r: any) => String(r._id));

  return (
    <>
    <div className="record-table__bulk-bar" role="region" aria-label="Bulk actions">
      <div className="record-table__bulk-bar-count" aria-live="polite">
        <strong>{selected.size}</strong> selected
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
      >
        <X size={12} aria-hidden="true" />
        <span>Clear</span>
      </button>
    </div>
    <div className="record-table__bulk-bar-spacer" aria-hidden="true" />
    </>
  );
}

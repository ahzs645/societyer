import { useState } from "react";
import { GridChangesetIsland } from "../../../../components/EditableGrid/GridChangesetIsland";
import { useBeforeUnloadGuard } from "../../../../components/EditableGrid/useGridChangeset";
import type { RecordTableInlineEdit, RecordTableInlineEditController } from "../contexts/RecordTableInlineEditContext";
import { useRecordTableState } from "../state/recordTableStore";
import { stagedCount } from "../utils/stagedEdits";

/**
 * What grid mode adds around the table: the polite live region that reads
 * out edits, pastes and undo/redo, and in batch mode the floating
 * "N pending · Discard · Save" island.
 */
export function RecordTableGridChrome({ controller }: { controller: RecordTableInlineEditController }) {
  const announcement = useRecordTableState((state) => state.gridAnnouncement);
  return (
    <>
      {controller.config.batch && <RecordTableBatchIsland batch={controller.config.batch} controller={controller} />}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
}

function RecordTableBatchIsland({
  batch,
  controller,
}: {
  batch: NonNullable<RecordTableInlineEdit["batch"]>;
  controller: RecordTableInlineEditController;
}) {
  const count = useRecordTableState((state) => stagedCount(state.stagedEdits));
  const [saving, setSaving] = useState(false);
  // Closing the tab with unsaved grid edits asks first.
  useBeforeUnloadGuard(count > 0);
  return (
    <GridChangesetIsland
      count={count}
      saving={saving}
      noun={batch.noun ?? "pending change"}
      saveLabel={batch.saveLabel}
      onDiscard={controller.discardBatch}
      onSave={() => {
        setSaving(true);
        void controller.saveBatch().finally(() => setSaving(false));
      }}
    />
  );
}

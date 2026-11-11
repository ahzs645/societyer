/**
 * The notice page's bar for the workspace's bid triage (triage.ts): the same
 * Reviewed and Classification the list edits, the action item, and who last
 * changed them. Built from the shared Checkbox, Select (a bottom sheet on
 * phones) and Button. It keeps its place while the triage loads.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ListTodo, Plus } from "lucide-react";
import { Checkbox } from "../../../components/Controls";
import { Select } from "../../../components/Select";
import { Button } from "../../../components/ui";
import { useToast } from "../../../components/Toast";
import { useUndoableAction } from "../../../hooks/useUndoableAction";
import { formatSourceDate } from "../lib/notice";
import {
  NO_TRIAGE,
  TRIAGE_CLASSIFICATIONS,
  canCreateTriageTask,
  isTriageArchived,
  triageClassification,
  type Triage,
  type TriageTaskNotice,
} from "../../../../shared/procurementTriage";
import { taskHref, useReaderTriage, type ReaderTriage } from "./triage";

const OPTIONS = TRIAGE_CLASSIFICATIONS.map(({ value, label, color }) => ({ value, label, color }));

/** Nothing where the reader has no triage (the offline snapshot, the demo). */
export function NoticeTriage({ recordKey, notice }: { recordKey: string; notice: TriageTaskNotice }) {
  const triage = useReaderTriage();
  return triage ? <NoticeTriageBar triage={triage} recordKey={recordKey} notice={notice} /> : null;
}

function NoticeTriageBar({ triage, recordKey, notice }: { triage: ReaderTriage; recordKey: string; notice: TriageTaskNotice }) {
  const toast = useToast();
  const undoable = useUndoableAction();
  const [creating, setCreating] = useState(false);
  const entry = triage.entries?.get(recordKey);
  const current: Triage = entry ? { reviewed: entry.reviewed, classification: entry.classification } : NO_TRIAGE;
  const disabled = !triage.entries || !triage.canEdit;
  const title = notice.title || "This opportunity";

  const save = async (next: Triage) => {
    try {
      if (isTriageArchived(next) && !isTriageArchived(current))
        await undoable({
          message: "Archived",
          description: `“${title}” is reviewed and not doable. The list shows it in its Archived view.`,
          run: () => triage.set(recordKey, next),
          undo: () => triage.set(recordKey, current),
          dedupeKey: `procurement-triage-${recordKey}`,
        });
      else await triage.set(recordKey, next);
    } catch (error) {
      toast.error("Couldn't save the triage", error instanceof Error ? error.message : "Try again in a moment.");
    }
  };
  const createTask = async () => {
    setCreating(true);
    try {
      const result = await triage.createTask(recordKey, notice);
      toast.success(result.created ? "Action item created" : "Action item already exists", `“${title}” is in Tasks.`);
    } catch (error) {
      toast.error("Couldn't create the action item", error instanceof Error ? error.message : "Try again in a moment.");
    } finally {
      setCreating(false);
    }
  };
  const by = entry && [entry.updatedBy, formatSourceDate(new Date(entry.updatedAt).toISOString())].filter(Boolean).join(" · ");

  return (
    <section className="procurement-triage" aria-label="Our bid triage" aria-busy={!triage.entries || undefined}>
      <span className="procurement-triage__title">Our triage</span>
      <Checkbox checked={current.reviewed} onChange={(reviewed) => void save({ ...current, reviewed })} label="Reviewed" disabled={disabled} />
      <Select
        className="procurement-triage__select"
        value={current.classification}
        onChange={(value) => void save({ ...current, classification: triageClassification(value) })}
        options={OPTIONS}
        clearable
        clearLabel="Not classified"
        placeholder="Not classified"
        aria-label="Classification"
        sheetTitle="Classification"
        disabled={disabled}
      />
      {entry?.taskId ? (
        <Link className="btn btn--sm" to={taskHref(entry.taskId)}>
          <ListTodo size={14} aria-hidden="true" /> Open action item
        </Link>
      ) : (
        triage.canCreateTask &&
        canCreateTriageTask(current) && (
          <Button size="sm" icon={<Plus size={14} />} disabled={creating} onClick={() => void createTask()}>
            Create action item
          </Button>
        )
      )}
      {isTriageArchived(current) && <span className="procurement-triage__archived">Archived: only in the list's Archived view</span>}
      {by && <small className="muted procurement-triage__by">{by}</small>}
    </section>
  );
}

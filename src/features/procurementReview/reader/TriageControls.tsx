/**
 * The workspace's own bid triage of an opportunity (shared/procurementTriage.ts):
 * a "Reviewed" tick and a classification pull-down. They save at once, to
 * Societyer, for everyone in the workspace; Zoer's decision is untouched.
 * Reviewed + Not doable archives the notice: it leaves the list unless
 * "Show archived" is on. The list draws them in two columns; the notice page
 * as one bar.
 */
import { useState, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { ListTodo, Plus } from "lucide-react";
import { useToast } from "../../../components/Toast";
import { formatSourceDate } from "../lib/notice";
import {
  NO_TRIAGE,
  TRIAGE_CLASSIFICATIONS,
  canCreateTriageTask,
  isTriageArchived,
  isTriageClassification,
  type Triage,
} from "../../../../shared/procurementTriage";
import { useReaderSource, type ReaderTriage } from "./source";

const TONES: Record<string, string> = { doable: "success", possible: "warn", needs_partner: "partner", not_doable: "danger" };
/** The row opens the notice; these controls don't. */
const stay = (event: SyntheticEvent) => event.stopPropagation();

/** The saved value, or what this visit changed it to (loaded pages aren't re-read after a save). */
function useTriageEditor(triage: ReaderTriage, recordKey: string, saved: Triage, title: string) {
  const toast = useToast();
  const overrides = triage.useOverrides();
  const [saving, setSaving] = useState(false);
  const current = overrides.get(recordKey) ?? saved;
  const save = (next: Triage) => {
    setSaving(true);
    triage.set(recordKey, next).then(
      () => {
        if (isTriageArchived(next) && !isTriageArchived(current))
          toast.success("Archived", `“${title}” is reviewed and not doable. Turn on “Show archived” to see it again.`);
      },
      (error: unknown) => toast.error("Could not save", error instanceof Error ? error.message : "Try again."),
    ).finally(() => setSaving(false));
  };
  // "Create action item": one task, only when asked for.
  const createTask = () => {
    setSaving(true);
    triage.createTask(recordKey, current).then(
      (created) => toast.success(created ? "Action item created" : "Action item already exists", `“${title}” is in Tasks.`),
      (error: unknown) => toast.error("Could not create the action item", error instanceof Error ? error.message : "Try again."),
    ).finally(() => setSaving(false));
  };
  return { current, saving, save, createTask, taskId: overrides.get(recordKey)?.taskId ?? "" };
}

/** A link to Tasks once the action item exists; before that a button, offered only for a reviewed, classified opportunity. */
function TaskAction({ current, saving, createTask, taskId, savedTaskId, title }: ReturnType<typeof useTriageEditor> & { savedTaskId: string; title: string }) {
  if (taskId || savedTaskId)
    return <Link className="procurement-triage__task-link" to="/app/tasks" onClick={stay} aria-label={`Action item for ${title}: open Tasks`}><ListTodo size={13} aria-hidden="true" /> In Tasks</Link>;
  if (!canCreateTriageTask(current))
    return <span className="muted procurement-triage__task-hint" title="Tick Reviewed and choose a classification other than Not doable first">—</span>;
  return (
    <button type="button" className="btn btn--secondary btn--sm" disabled={saving} onKeyDown={stay} onClick={(event) => { stay(event); createTask(); }} aria-label={`Create action item: ${title}`}>
      <Plus size={13} aria-hidden="true" /> Action item
    </button>
  );
}

function ReviewedBox({ current, saving, save, title }: ReturnType<typeof useTriageEditor> & { title: string }) {
  return (
    <input
      type="checkbox"
      className="procurement-triage__check"
      aria-label={`Reviewed: ${title}`}
      checked={current.reviewed}
      disabled={saving}
      onClick={stay}
      onKeyDown={stay}
      onChange={(event) => save({ ...current, reviewed: event.target.checked })}
    />
  );
}

function ClassificationSelect({ current, saving, save, title }: ReturnType<typeof useTriageEditor> & { title: string }) {
  return (
    <select
      className="procurement-triage__select"
      data-tone={TONES[current.classification] ?? "none"}
      aria-label={`Classification: ${title}`}
      value={current.classification}
      disabled={saving}
      onClick={stay}
      onKeyDown={stay}
      onChange={(event) => {
        const value = event.target.value;
        save({ ...current, classification: isTriageClassification(value) ? value : "" });
      }}
    >
      <option value="">Not classified</option>
      {TRIAGE_CLASSIFICATIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
    </select>
  );
}

type CellProps = { recordKey: string; title: string; reviewed: boolean; classification: string };
const savedOf = ({ reviewed, classification }: CellProps): Triage => ({ reviewed, classification: isTriageClassification(classification) ? classification : "" });

/** The list's Reviewed cell; nothing where the reader can't save a triage (the offline snapshot). */
export function TriageReviewedCell(props: CellProps) {
  const { triage } = useReaderSource();
  return triage ? <ReviewedCell triage={triage} {...props} /> : null;
}
function ReviewedCell({ triage, ...props }: CellProps & { triage: ReaderTriage }) {
  const editor = useTriageEditor(triage, props.recordKey, savedOf(props), props.title);
  return <span className="procurement-triage__cell" onClick={stay}><ReviewedBox {...editor} title={props.title} /></span>;
}

/** The list's Classification cell. */
export function TriageClassificationCell(props: CellProps) {
  const { triage } = useReaderSource();
  return triage ? <ClassificationCell triage={triage} {...props} /> : null;
}
function ClassificationCell({ triage, ...props }: CellProps & { triage: ReaderTriage }) {
  const editor = useTriageEditor(triage, props.recordKey, savedOf(props), props.title);
  return <span className="procurement-triage__cell" onClick={stay}><ClassificationSelect {...editor} title={props.title} /></span>;
}

/** The list's Action item cell. */
export function TriageTaskCell(props: CellProps & { taskId: string }) {
  const { triage } = useReaderSource();
  return triage ? <TaskCell triage={triage} {...props} /> : null;
}
function TaskCell({ triage, taskId, ...props }: CellProps & { taskId: string; triage: ReaderTriage }) {
  const editor = useTriageEditor(triage, props.recordKey, savedOf(props), props.title);
  return <span className="procurement-triage__cell" onClick={stay}><TaskAction {...editor} savedTaskId={taskId} title={props.title} /></span>;
}

/** The notice page's bar: both controls, who last changed them, and whether the notice is archived. */
export function NoticeTriage({ recordKey, title }: { recordKey: string; title: string }) {
  const { triage } = useReaderSource();
  return triage ? <NoticeTriageBar triage={triage} recordKey={recordKey} title={title} /> : null;
}
function NoticeTriageBar({ triage, recordKey, title }: { triage: ReaderTriage; recordKey: string; title: string }) {
  const saved = triage.useOne(recordKey);
  const editor = useTriageEditor(triage, recordKey, saved ? savedOf({ recordKey, title, ...saved }) : NO_TRIAGE, title);
  if (!saved) return null;
  const by = [saved.updatedBy, saved.updatedAt ? formatSourceDate(new Date(saved.updatedAt).toISOString()) : ""].filter(Boolean).join(" · ");
  return (
    <section className="procurement-triage" aria-label="Our bid triage">
      <span className="procurement-triage__title">Our triage</span>
      <label className="procurement-triage__field"><ReviewedBox {...editor} title={title} /><span>Reviewed</span></label>
      <label className="procurement-triage__field"><span>Classification</span><ClassificationSelect {...editor} title={title} /></label>
      <TaskAction {...editor} savedTaskId={saved.taskId ?? ""} title={title} />
      {isTriageArchived(editor.current) && <span className="procurement-triage__archived">Archived: hidden from the list</span>}
      {by && <small className="muted">{by}</small>}
    </section>
  );
}

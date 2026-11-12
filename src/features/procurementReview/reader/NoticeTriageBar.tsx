/**
 * The notice page's bar for the workspace's bid triage (triage.ts): the same
 * Reviewed and Classification the list edits, the action items
 * (actionItems.tsx), and who last changed them. Built from the shared
 * Checkbox, Select (a bottom sheet on phones), Button and Menu. It keeps its
 * place while the triage loads. Three rows: the heading with who last changed
 * it, the triage itself (Reviewed beside the classification), then the action
 * items; on phones the two action buttons share a row with shorter labels.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ListPlus, ListTodo, Plus } from "lucide-react";
import { Checkbox } from "../../../components/Controls";
import { Select } from "../../../components/Select";
import { Button } from "../../../components/ui";
import { useToast } from "../../../components/Toast";
import { Menu } from "../../../components/Menu";
import { mobileCardMediaQuery } from "../../../lib/breakpoints";
import { useMediaQuery } from "../../../lib/useSheetDrag";
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
import { actionItemMenuItems, actionItemsOf, useActionItemCommands } from "./actionItems";

const OPTIONS = TRIAGE_CLASSIFICATIONS.map(({ value, label, color }) => ({ value, label, color }));

/** Nothing where the reader has no triage (the offline snapshot, the demo). */
export function NoticeTriage({ recordKey, notice }: { recordKey: string; notice: TriageTaskNotice }) {
  const triage = useReaderTriage();
  return triage ? <NoticeTriageBar triage={triage} recordKey={recordKey} notice={notice} /> : null;
}

function NoticeTriageBar({ triage, recordKey, notice }: { triage: ReaderTriage; recordKey: string; notice: TriageTaskNotice }) {
  const toast = useToast();
  const undoable = useUndoableAction();
  const navigate = useNavigate();
  const commands = useActionItemCommands(triage);
  const [creating, setCreating] = useState(false);
  const phone = useMediaQuery(mobileCardMediaQuery);
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
      await commands.create({ recordKey, notice });
    } finally {
      setCreating(false);
    }
  };
  const target = { recordKey, notice };
  const items = actionItemsOf(triage, recordKey);
  const mayAct = triage.canCreateTask && canCreateTriageTask(current);
  const by = entry && [entry.updatedBy, formatSourceDate(new Date(entry.updatedAt).toISOString())].filter(Boolean).join(" · ");

  return (
    <section className="procurement-triage" aria-label="Our bid triage" aria-busy={!triage.entries || undefined}>
      <div className="procurement-triage__head">
        <span className="procurement-triage__title">Our triage</span>
        {by && <small className="muted procurement-triage__by">{by}</small>}
      </div>
      <div className="procurement-triage__state">
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
      </div>
      {items?.length === 1 && !mayAct && (
        <div className="procurement-triage__actions">
          <Link className="btn btn--sm" to={taskHref(items[0].taskId)}>
            <ListTodo size={14} aria-hidden="true" /> Open action item
          </Link>
        </div>
      )}
      {items && items.length > 0 && (items.length > 1 || mayAct) && (
        <div className="procurement-triage__actions">
          <Menu
            label="Action items"
            sheetTitle="Action items"
            trigger={
              <button type="button" className="btn btn--sm">
                <ListTodo size={14} aria-hidden="true" /> {items.length === 1 ? "Action item" : `${items.length} action items`}{" "}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            }
            sections={[{ id: "task", items: actionItemMenuItems({ triage, target, current, open: (taskId) => navigate(taskHref(taskId)), commands }) }]}
          />
        </div>
      )}
      {items && items.length === 0 && mayAct && (
        <div className="procurement-triage__actions" data-pair="">
          <Button size="sm" icon={<Plus size={14} />} disabled={creating} onClick={() => void createTask()} aria-label="Create action item">
            {phone ? "New action item" : "Create action item"}
          </Button>
          <Button size="sm" variant="ghost" icon={<ListPlus size={14} />} onClick={() => commands.pick(target)} aria-label="Add to an existing action item">
            {phone ? "Add to existing" : "Add to an existing action item…"}
          </Button>
        </div>
      )}
      {commands.dialog}
      {isTriageArchived(current) && <span className="procurement-triage__archived">Archived: only in the list's Archived view</span>}
    </section>
  );
}

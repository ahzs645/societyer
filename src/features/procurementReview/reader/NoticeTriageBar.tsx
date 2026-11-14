/**
 * The workspace's bid triage of one opportunity (triage.ts) on its notice
 * page: the same Reviewed and Classification the list edits, the action
 * items (actionItems.tsx), and who last changed them. Built from the shared
 * Checkbox, Select (a bottom sheet on phones), Button and Menu. It keeps its
 * place while the triage loads.
 *
 * `useNoticeTriage` is the one place a change is saved from, so the panel,
 * the keyboard (1–4, R) and the notice panel's Classify all archive with the
 * same undo and fail with the same toast.
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
import { taskHref, useReaderTriage, type ReaderTriage, type TriageEntry } from "./triage";
import { actionItemMenuItems, actionItemsOf, useActionItemCommands } from "./actionItems";

export const TRIAGE_OPTIONS = TRIAGE_CLASSIFICATIONS.map(({ value, label, color }) => ({ value, label, color }));

/** One opportunity's triage and how to change it; null where the reader has no triage (the offline snapshot). */
export type NoticeTriageControl = {
  triage: ReaderTriage;
  entry: TriageEntry | undefined;
  current: Triage;
  /** Loaded, and this person may change it. */
  editable: boolean;
  save: (next: Triage) => Promise<void>;
};

export function useNoticeTriage(recordKey: string, title: string): NoticeTriageControl | null {
  const triage = useReaderTriage();
  const toast = useToast();
  const undoable = useUndoableAction();
  if (!triage) return null;
  const entry = triage.entries?.get(recordKey);
  const current: Triage = entry ? { reviewed: entry.reviewed, classification: entry.classification } : NO_TRIAGE;
  const name = title || "This opportunity";
  const save = async (next: Triage) => {
    try {
      if (isTriageArchived(next) && !isTriageArchived(current))
        await undoable({
          message: "Archived",
          description: `“${name}” is reviewed and not doable. The list shows it in its Archived view.`,
          run: () => triage.set(recordKey, next),
          undo: () => triage.set(recordKey, current),
          dedupeKey: `procurement-triage-${recordKey}`,
        });
      else await triage.set(recordKey, next);
    } catch (error) {
      toast.error("Couldn't save the triage", error instanceof Error ? error.message : "Try again in a moment.");
    }
  };
  return { triage, entry, current, editable: Boolean(triage.entries && triage.canEdit), save };
}

/** Our triage, for the notice's decision panel. `hint` adds the keyboard shortcuts under it. */
export function NoticeTriage({ control, recordKey, notice, hint = false }: { control: NoticeTriageControl; recordKey: string; notice: TriageTaskNotice; hint?: boolean }) {
  const { triage, entry, current, editable, save } = control;
  const navigate = useNavigate();
  const commands = useActionItemCommands(triage);
  const [creating, setCreating] = useState(false);
  const phone = useMediaQuery(mobileCardMediaQuery);

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
    <section className="procurement-triage" aria-labelledby="procurement-triage-title" aria-busy={!triage.entries || undefined}>
      <div className="procurement-triage__head">
        <h3 className="procurement-triage__title" id="procurement-triage-title">Our triage</h3>
        {by && <small className="muted procurement-triage__by">{by}</small>}
      </div>
      <div className="procurement-triage__state">
        <Checkbox checked={current.reviewed} onChange={(reviewed) => void save({ ...current, reviewed })} label="Reviewed" disabled={!editable} />
        <Select
          className="procurement-triage__select"
          value={current.classification}
          onChange={(value) => void save({ ...current, classification: triageClassification(value) })}
          options={TRIAGE_OPTIONS}
          clearable
          clearLabel="Not classified"
          placeholder="Not classified"
          aria-label="Classification"
          sheetTitle="Classification"
          searchable={false}
          disabled={!editable}
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
      {hint && editable && (
        <small className="muted procurement-triage__keys">
          Keys: <kbd>1</kbd>–<kbd>4</kbd> classify · <kbd>R</kbd> reviewed
        </small>
      )}
    </section>
  );
}

/**
 * Classify in the notice panel's footer: the classification Select (a
 * bottom sheet on phones) as a footer button. Shows the classification once
 * there is one.
 */
export function ClassifyButton({ control }: { control: NoticeTriageControl }) {
  const { current, editable, save } = control;
  return (
    <Select
      className="procurement-notice__classify"
      value={current.classification}
      onChange={(value) => void save({ ...current, classification: triageClassification(value) })}
      options={TRIAGE_OPTIONS}
      clearable
      clearLabel="Not classified"
      placeholder="Classify"
      aria-label="Classification"
      sheetTitle="Classification"
      searchable={false}
      disabled={!editable}
    />
  );
}

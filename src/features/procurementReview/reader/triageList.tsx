/**
 * The opportunity list's part of the workspace's bid triage (triage.ts): two
 * editable columns the shared table edits in place (Classification, Reviewed),
 * the triage joined onto the rows, the archive (reviewed + not doable leaves
 * every view but "Archived"), and the row menu that offers the same choices
 * on phones, where cards replace cells, plus the action item.
 */
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ListTodo, Plus } from "lucide-react";
import type { MenuSection } from "../../../components/Menu";
import { useToast } from "../../../components/Toast";
import { useUndoableAction } from "../../../hooks/useUndoableAction";
import { FIELD_TYPES } from "../../../platform/record-engine/types";
import type { StaticFieldDefinition } from "../../../platform/record-engine/record-table";
import type { NoticeRow } from "../../../../shared/procurementNoticeRow";
import {
  NO_TRIAGE,
  TRIAGE_CLASSIFICATIONS,
  canCreateTriageTask,
  isTriageArchived,
  triageClassification,
  type Triage,
} from "../../../../shared/procurementTriage";
import { taskHref, triageTaskNotice, type ReaderTriage, type TriageEntry } from "./triage";
import type { ListRow } from "./source";

/** Editable columns; Classification sorts best first (option order), unclassified last. */
export const TRIAGE_FIELDS: StaticFieldDefinition[] = [
  {
    name: "classification",
    label: "Classification",
    fieldType: FIELD_TYPES.SELECT,
    size: 150,
    isReadOnly: false,
    config: {
      options: TRIAGE_CLASSIFICATIONS.map(({ value, label, color }) => ({ value, label, color })),
      sortByOptionOrder: true,
    },
  },
  {
    name: "reviewed",
    label: "Reviewed",
    fieldType: FIELD_TYPES.BOOLEAN,
    size: 100,
    isReadOnly: false,
    config: { groupable: false, trueLabel: "Reviewed", falseLabel: "Not reviewed" },
  },
];

export type TriagedRow = NoticeRow & Triage & { archived: boolean; taskId: string };

/** Untriaged copies keep their identity between triage changes, so the table's search text stays cached. */
const untriaged = new WeakMap<NoticeRow, TriagedRow>();

/** The rows with their triage; `archivedView` keeps only archived ones, any other view leaves them out. */
export function joinTriage(rows: NoticeRow[], entries: ReadonlyMap<string, TriageEntry>, archivedView: boolean): TriagedRow[] {
  const joined: TriagedRow[] = [];
  for (const row of rows) {
    const entry = entries.get(row._id);
    let next = entry ? null : untriaged.get(row);
    if (!next) {
      const triage: Triage = entry ? { reviewed: entry.reviewed, classification: entry.classification } : NO_TRIAGE;
      next = { ...row, ...triage, archived: isTriageArchived(triage), taskId: entry?.taskId ?? "" };
      if (!entry) untriaged.set(row, next);
    }
    if (next.archived === archivedView) joined.push(next);
  }
  return joined;
}

const triageOf = (entries: ReadonlyMap<string, TriageEntry> | undefined, recordKey: string): Triage => {
  const entry = entries?.get(recordKey);
  return entry ? { reviewed: entry.reviewed, classification: entry.classification } : NO_TRIAGE;
};

/**
 * Saving from the list: the table's inline edits (`onUpdate`) and the row
 * menu. Archiving takes the row out of the view, so it says where it went and
 * offers Undo. Without a triage (or the right to change it) there is neither.
 */
export function useTriageEditing(triage: ReaderTriage | null, rows: readonly ListRow[]) {
  const entries = triage?.entries;
  const toast = useToast();
  const undoable = useUndoableAction();
  const navigate = useNavigate();

  const save = useCallback(
    async (recordKey: string, title: string, next: Triage) => {
      if (!triage) return;
      const previous = triageOf(entries, recordKey);
      if (isTriageArchived(next) && !isTriageArchived(previous))
        await undoable({
          message: "Archived",
          description: `“${title}” is reviewed and not doable. It is in the Archived view.`,
          run: () => triage.set(recordKey, next),
          undo: () => triage.set(recordKey, previous),
          dedupeKey: `procurement-triage-${recordKey}`,
        });
      else await triage.set(recordKey, next);
    },
    [entries, triage, undoable],
  );

  /** RecordTableScope's `onUpdate`: only the two triage columns are editable. */
  const onUpdate = useCallback(
    async ({ recordId, fieldName, value }: { recordId: string; fieldName: string; value: unknown }) => {
      const current = triageOf(entries, recordId);
      const title = rows.find((row) => row.recordKey === recordId)?.title ?? "This opportunity";
      if (fieldName === "reviewed") await save(recordId, title, { ...current, reviewed: value === true });
      else if (fieldName === "classification") await save(recordId, title, { ...current, classification: triageClassification(value) });
    },
    [entries, rows, save],
  );

  const createTask = useCallback(
    async (recordKey: string) => {
      const row = rows.find((candidate) => candidate.recordKey === recordKey);
      if (!row || !triage) return;
      try {
        const result = await triage.createTask(
          recordKey,
          triageTaskNotice({ title: row.title, buyer: row.organization, date: row.date, dateText: row.dateText, reference: row.reference }),
        );
        toast.success(result.created ? "Action item created" : "Action item already exists", {
          description: `“${row.title}” is in Tasks.`,
          action: { label: "Open", onClick: () => navigate(taskHref(result.taskId)) },
        });
      } catch (error) {
        toast.error("Couldn't create the action item", error instanceof Error ? error.message : "Try again in a moment.");
      }
    },
    [rows, triage, toast, navigate],
  );

  /** The row's menu (desktop "…" and right-click, and the phone card's menu). */
  const rowMenuSections = useCallback(
    (record: Record<string, unknown>): MenuSection[] => {
      const row = record as unknown as TriagedRow;
      const current: Triage = { reviewed: row.reviewed, classification: row.classification };
      const run = (next: Triage) => () => {
        save(row._id, row.title, next).catch((error: unknown) =>
          toast.error("Couldn't save the triage", error instanceof Error ? error.message : "Try again in a moment."),
        );
      };
      const sections: MenuSection[] = [];
      if (triage?.canEdit)
        sections.push(
          {
            id: "reviewed",
            items: [{
              id: "reviewed",
              label: current.reviewed ? "Mark not reviewed" : "Mark reviewed",
              icon: <Check size={14} />,
              onSelect: run({ ...current, reviewed: !current.reviewed }),
            }],
          },
          {
            id: "classification",
            label: "Classification",
            items: [
              ...TRIAGE_CLASSIFICATIONS.map((option) => ({
                id: option.value,
                label: option.label,
                hint: current.classification === option.value ? <Check size={14} aria-label="Current" /> : undefined,
                onSelect: run({ ...current, classification: option.value }),
              })),
              ...(current.classification
                ? [{ id: "clear", label: "Not classified", onSelect: run({ ...current, classification: "" as const }) }]
                : []),
            ],
          },
        );
      if (row.taskId)
        sections.push({ id: "task", items: [{ id: "open-task", label: "Open action item", icon: <ListTodo size={14} />, onSelect: () => navigate(taskHref(row.taskId)) }] });
      else if (triage?.canCreateTask && canCreateTriageTask(current))
        sections.push({ id: "task", items: [{ id: "create-task", label: "Create action item", icon: <Plus size={14} />, onSelect: () => void createTask(row._id) }] });
      return sections;
    },
    [triage?.canEdit, triage?.canCreateTask, save, toast, navigate, createTask],
  );

  return useMemo(
    () => ({
      onUpdate: triage?.canEdit ? onUpdate : undefined,
      rowMenuSections: triage ? rowMenuSections : undefined,
    }),
    [triage, onUpdate, rowMenuSections],
  );
}

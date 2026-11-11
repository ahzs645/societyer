/**
 * An opportunity's action items (triage.ts): the tasks holding it as an
 * attachment. The notice page's triage bar and the list's row menu (desktop
 * and phone) offer the same choices from here: open each task it is on,
 * create one, or add it to an open task. While it is on a task, a new one is
 * "Create another action item", a choice of its own, so nobody makes a
 * second by accident. Without its action items (still loading, or not
 * readable) none of this shows, and the triage works as before.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { ListPlus, ListTodo, Plus } from "lucide-react";
import { api } from "../../../lib/convexApi";
import { Modal } from "../../../components/Modal";
import { Select } from "../../../components/Select";
import { Button, Field } from "../../../components/ui";
import { useToast } from "../../../components/Toast";
import type { MenuItem } from "../../../components/Menu";
import { canCreateTriageTask, type Triage, type TriageTaskNotice } from "../../../../shared/procurementTriage";
import { isOpenOperationalTask, taskStatusLabel } from "../../../../shared/taskStatus";
import { taskHref, type ActionItem, type ReaderTriage } from "./triage";

/** The tasks an opportunity is on; undefined when they aren't known, and nothing is offered. */
export const actionItemsOf = (triage: ReaderTriage | null, recordKey: string): readonly ActionItem[] | undefined =>
  triage?.actionItems ? triage.actionItems.get(recordKey) ?? [] : undefined;

type Target = { recordKey: string; notice: TriageTaskNotice };
const label = (notice: TriageTaskNotice) => notice.title.trim() || "This opportunity";

/**
 * Creating and adding, with their toasts, and the picker's dialog. Render
 * `dialog` once beside whatever offers the choices.
 */
export function useActionItemCommands(triage: ReaderTriage | null) {
  const toast = useToast();
  const navigate = useNavigate();
  const [picking, setPicking] = useState<Target | null>(null);

  const create = useCallback(
    async ({ recordKey, notice }: Target, another = false) => {
      if (!triage) return;
      try {
        const result = await triage.createTask(recordKey, notice, another);
        toast.success(result.created ? "Action item created" : "Already an action item", {
          description: `“${label(notice)}” is in Tasks.`,
          action: { label: "Open", onClick: () => navigate(taskHref(result.taskId)) },
        });
      } catch (error) {
        toast.error("Couldn't create the action item", error instanceof Error ? error.message : "Try again in a moment.");
      }
    },
    [triage, toast, navigate],
  );

  const add = useCallback(
    async ({ recordKey, notice }: Target, task: { _id: string; title: string }) => {
      if (!triage) return;
      try {
        const result = await triage.addToTask(task._id, recordKey, notice);
        toast.success(result.created ? "Added to the action item" : "Already on that action item", {
          description: `“${label(notice)}” is on “${task.title}”.`,
          action: { label: "Open", onClick: () => navigate(taskHref(task._id)) },
        });
      } catch (error) {
        toast.error("Couldn't add it to the action item", error instanceof Error ? error.message : "Try again in a moment.");
      }
    },
    [triage, toast, navigate],
  );

  const dialog: ReactNode = useMemo(
    () =>
      picking && triage ? (
      <AddToActionItemDialog
        societyId={triage.societyId}
        title={label(picking.notice)}
        exclude={actionItemsOf(triage, picking.recordKey) ?? []}
        onClose={() => setPicking(null)}
        onPick={(task) => {
          const target = picking;
          setPicking(null);
          void add(target, task);
        }}
      />
    ) : null, [picking, triage, add]);

  return useMemo(() => ({ create, pick: setPicking, dialog }), [create, dialog]);
}

/**
 * The menu entries for one opportunity: one "Open" per task it is on, then
 * (with tasks:write, once it is reviewed and worth bidding on) adding it to a
 * task and creating one.
 */
export function actionItemMenuItems({
  triage,
  target,
  current,
  open,
  commands,
}: {
  triage: ReaderTriage | null;
  target: Target;
  current: Triage;
  open: (taskId: string) => void;
  commands: ReturnType<typeof useActionItemCommands>;
}): MenuItem[] {
  const items = actionItemsOf(triage, target.recordKey);
  if (!triage || !items) return [];
  const entries: MenuItem[] = items.map((item) => ({
    id: `open-${item.taskId}`,
    label: items.length === 1 ? "Open action item" : `Open “${item.title}”`,
    hint: items.length === 1 ? undefined : taskStatusLabel(item.status),
    icon: <ListTodo size={14} />,
    onSelect: () => open(item.taskId),
  }));
  if (triage.canCreateTask && canCreateTriageTask(current))
    entries.push(
      { id: "add-to-task", label: "Add to an existing action item…", icon: <ListPlus size={14} />, onSelect: () => commands.pick(target) },
      items.length
        ? { id: "create-another-task", label: "Create another action item", icon: <Plus size={14} />, onSelect: () => void commands.create(target, true) }
        : { id: "create-task", label: "Create action item", icon: <Plus size={14} />, onSelect: () => void commands.create(target) },
    );
  return entries;
}

/** Choose an open task to put the opportunity on. A bottom sheet on phones. */
function AddToActionItemDialog({
  societyId,
  title,
  exclude,
  onClose,
  onPick,
}: {
  societyId: string;
  title: string;
  exclude: readonly ActionItem[];
  onClose: () => void;
  onPick: (task: { _id: string; title: string }) => void;
}) {
  const tasks = useQuery(api.tasks.list, { societyId }) as { _id: string; title: string; status: string; dueDate?: string; tags?: string[] }[] | undefined;
  const [chosen, setChosen] = useState("");
  const options = useMemo(() => {
    const held = new Set(exclude.map((item) => item.taskId));
    return (tasks ?? [])
      .filter((task) => isOpenOperationalTask(task) && !held.has(String(task._id)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((task) => ({ value: String(task._id), label: task.title, hint: taskStatusLabel(task.status) }));
  }, [tasks, exclude]);
  const pick = () => {
    const option = options.find((entry) => entry.value === chosen);
    if (option) onPick({ _id: option.value, title: option.label });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add to an action item"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={!chosen} onClick={pick}>
            Add
          </Button>
        </>
      }
    >
      <p className="muted">“{title}” will show on the task you choose. Only open tasks are listed.</p>
      <Field label="Task">
        <Select
          value={chosen}
          onChange={setChosen}
          options={options}
          searchable
          placeholder={tasks === undefined ? "Loading tasks…" : options.length ? "Choose a task" : "No open tasks"}
          disabled={!options.length}
          aria-label="Task"
          sheetTitle="Choose a task"
        />
      </Field>
    </Modal>
  );
}

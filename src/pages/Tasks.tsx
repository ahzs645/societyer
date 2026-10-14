import { ActionRegisterCard } from "../components/ActionRegisterCard";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Check, History, ListTodo, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { Menu } from "../components/Menu";
import { InfoPopover } from "../components/InfoPopover";
import { isHistoricalSourceAction, taskStatusLabel as sharedTaskStatusLabel } from "../../shared/taskStatus";
import { HistoricalActionSource } from "../features/tasks/HistoricalActionSource";
import { api } from "@/lib/convexApi";
import {
  RecordTable,
  RecordTableBulkBar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableScope,
  RecordTableViewToolbar,
  useFilteredRecords,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../platform/record-engine/record-table/state/recordTableStore";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { usePermissions } from "../hooks/usePermissions";
import { Drawer } from "../components/ui";
import {
  TaskFormFields,
  TASK_STATUSES,
  makeTaskFormDefaults,
  useTaskFormData,
  type TaskFormValue,
} from "../features/tasks/TaskFormFields";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { TaskListView } from "../features/tasks/TaskListView";
import { TaskBoardView } from "../features/tasks/TaskBoardView";
import { TaskScopeBar } from "../features/tasks/TaskScopeBar";
import { TaskChecklist } from "../features/tasks/TaskChecklist";
import { TaskDiscussion, TaskStateBanner } from "../features/tasks/TaskDetailExtras";
import type { TaskViewActions } from "../features/tasks/TaskMenus";
import {
  isClosedStatus,
  isOpenStatus,
  isoDay,
  isMine,
  startOfToday,
  taskInScope,
  type TaskGroupBy,
  type TaskLinkKind,
  type TaskRecord,
  type TaskScope,
} from "../features/tasks/taskModel";
import type { TaskChecklistItem } from "../../shared/taskChecklist";
import { useSociety } from "../hooks/useSociety";
import { formatDate, isPastDue } from "../lib/format";
import { useIsMobile } from "../lib/useIsMobile";
import { useIsBottomSheet } from "../lib/useSheetDrag";
import { TaskViewSummaryButton } from "../features/tasks/TaskViewSheet";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Tooltip } from "../components/Tooltip";

type EditableTaskForm = TaskFormValue & {
  _id?: Id<"tasks">;
  tags?: string[];
  checklist: TaskChecklistItem[];
};

type TaskLayout = "list" | "engine";
const LAYOUT_KEY = "societyer:tasks:layout";
const GROUP_KEY = "societyer:tasks:group-by";

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function taskStatusLabel(status: string) {
  return sharedTaskStatusLabel(status);
}

type TaskRegister = "current" | "historical";

export function TasksPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("tasks:write");
  const tasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const formData = useTaskFormData(canManage ? society?._id : undefined);
  const { committees, goals, users, filings, workflows, documents, commitments } = formData;
  const create = useMutation(api.tasks.create);
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const consolidate = useMutation(api.tasks.consolidateHistoricalActions);
  const promote = useMutation(api.tasks.promoteHistoricalAction);
  const currentUserId = useCurrentUserId();
  const confirm = useConfirm();
  const toast = useToast();
  const undoable = useUndoableAction();
  const isMobile = useIsMobile();
  // Phones fold the register switch, scopes and grouping into one summary button.
  const isPhone = useIsBottomSheet();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedGoalId = searchParams.get("goalId") ?? "";
  const requestedCommitteeId = searchParams.get("committeeId") ?? "";
  const openNewFromUrl = searchParams.get("new") === "1";
  // P2/P4: historical source actions are a separate register, never open work.
  const register: TaskRegister = searchParams.get("register") === "historical" ? "historical" : "current";
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EditableTaskForm | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  // Current tasks open as a grouped list; the record views (table, board,
  // calendar) stay one click away in the toolbar's view switch.
  const [layout, setLayoutState] = useState<TaskLayout>(() => readStored(LAYOUT_KEY, ["list", "engine"] as const, "list"));
  const [groupBy, setGroupByState] = useState<TaskGroupBy>(() => readStored(GROUP_KEY, ["status", "priority", "due", "owner", "none"] as const, "status"));
  const [scope, setScope] = useState<TaskScope>("all");
  const setLayout = useCallback((next: TaskLayout) => { setLayoutState(next); writeStored(LAYOUT_KEY, next); }, []);
  const setGroupBy = useCallback((next: TaskGroupBy) => { setGroupByState(next); writeStored(GROUP_KEY, next); }, []);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "task",
    viewId: currentViewId,
  });

  // Workspaces seeded before the "Linked to" column existed get it once; the
  // seed mutation is idempotent and reconciles new fields.
  const ensureMetadata = useMutation(api.seedRecordTableMetadata.ensureForSociety);
  const metadataHealRef = useRef<string | null>(null);
  useEffect(() => {
    const metadata = tableData.objectMetadata;
    if (!society?._id || !metadata || !loaded || !can("settings:write")) return;
    if (metadata.fields.some((field) => field.name === "linkedTo")) return;
    if (metadataHealRef.current === String(society._id)) return;
    metadataHealRef.current = String(society._id);
    void ensureMetadata({ societyId: society._id }).catch(() => undefined);
  }, [society?._id, tableData.objectMetadata, loaded, can, ensureMetadata]);

  // Committee and goal filters pick from a list instead of typing an id.
  const relationOptions = useMemo<Record<string, { value: string; label: string }[]>>(
    () => ({
      committeeId: ((committees ?? []) as Doc<"committees">[]).map((c) => ({ value: String(c._id), label: c.name })),
      goalId: ((goals ?? []) as Doc<"goals">[]).map((g) => ({ value: String(g._id), label: g.title })),
    }),
    [committees, goals],
  );
  const objectMetadata = useMemo(() => {
    const metadata = tableData.objectMetadata;
    if (!metadata) return metadata;
    return { ...metadata, fields: metadata.fields.map((field) => withRelationOptions(field, relationOptions)) };
  }, [tableData.objectMetadata, relationOptions]);
  const hydratedView = useMemo(() => {
    const view = tableData.hydratedView;
    if (!view) return view;
    return {
      ...view,
      columns: view.columns.map((column) => ({ ...column, field: withRelationOptions(column.field, relationOptions) })),
    };
  }, [tableData.hydratedView, relationOptions]);

  const committeeById = useMemo(
    () => recordsById((committees ?? []) as Doc<"committees">[]),
    [committees],
  );
  const goalById = useMemo(
    () => recordsById((goals ?? []) as Doc<"goals">[]),
    [goals],
  );
  const userById = useMemo(
    () => recordsById((users ?? []) as Doc<"users">[]),
    [users],
  );
  const meetingById = useMemo(
    () => recordsById((meetings ?? []) as Doc<"meetings">[]),
    [meetings],
  );
  const filingById = useMemo(
    () => recordsById((filings ?? []) as Doc<"filings">[]),
    [filings],
  );
  const workflowById = useMemo(
    () => recordsById((workflows ?? []) as Doc<"workflows">[]),
    [workflows],
  );
  const documentById = useMemo(
    () => recordsById((documents ?? []) as Doc<"documents">[]),
    [documents],
  );
  const commitmentById = useMemo(
    () => recordsById((commitments ?? []) as Doc<"commitments">[]),
    [commitments],
  );

  const records = useMemo<TaskRecord[]>(
    () =>
      ((tasks ?? []) as Doc<"tasks">[]).map((task) => {
        const filing = task.filingId ? filingById.get(String(task.filingId)) : undefined;
        const responsibleUserIdsLabel = userNames(task.responsibleUserIds, userById);
        const committeeIdLabel = task.committeeId
          ? committeeById.get(String(task.committeeId))?.name
          : undefined;
        const meetingIdLabel = task.meetingId
          ? meetingById.get(String(task.meetingId))?.title
          : undefined;
        const goalIdLabel = task.goalId
          ? goalById.get(String(task.goalId))?.title
          : undefined;
        const filingIdLabel = filing
          ? `${filing.kind}${filing.periodLabel ? ` — ${filing.periodLabel}` : ""}`
          : undefined;
        const workflowIdLabel = task.workflowId
          ? workflowById.get(String(task.workflowId))?.name
          : undefined;
        const documentIdLabel = task.documentId
          ? documentById.get(String(task.documentId))?.title
          : undefined;
        const commitmentIdLabel = task.commitmentId
          ? commitmentById.get(String(task.commitmentId))?.title
          : undefined;
        const completedByUserIdLabel = task.completedByUserId
          ? userById.get(String(task.completedByUserId))?.displayName
          : undefined;
        return {
          ...task,
          _searchText: [
            task.title,
            task.assignee,
            responsibleUserIdsLabel,
            committeeIdLabel,
            meetingIdLabel,
            goalIdLabel,
            filingIdLabel,
            workflowIdLabel,
            documentIdLabel,
            commitmentIdLabel,
            completedByUserIdLabel,
            task.eventId,
            task.description,
            ...(task.tags ?? []),
          ]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join(" "),
          linkedTo: linkedKinds(task),
          responsibleUserIdsLabel,
          committeeIdLabel,
          meetingIdLabel,
          goalIdLabel,
          filingIdLabel,
          workflowIdLabel,
          documentIdLabel,
          commitmentIdLabel,
          completedByUserIdLabel,
        };
      }),
    [
      tasks,
      committeeById,
      commitmentById,
      documentById,
      filingById,
      goalById,
      meetingById,
      userById,
      workflowById,
    ],
  );

  // Committee, goal and link filtering is the table's own Filter (see
  // TaskUrlFilters for deep links); only the register split stays here.
  const registerRecords = useMemo(
    () => records.filter((task) => (register === "historical") === isHistoricalSourceAction(task)),
    [records, register],
  );
  const scopeCounts = useMemo(() => {
    const open = registerRecords.filter((task) => isOpenStatus(task.status));
    return {
      all: registerRecords.length,
      open: open.length,
      mine: open.filter((task) => isMine(task, currentUserId)).length,
      overdue: registerRecords.filter((task) => taskInScope(task, "overdue", currentUserId)).length,
      week: registerRecords.filter((task) => taskInScope(task, "week", currentUserId)).length,
      unowned: registerRecords.filter((task) => taskInScope(task, "unowned", currentUserId)).length,
    } satisfies Record<TaskScope, number>;
  }, [registerRecords, currentUserId]);
  const activeScope: TaskScope = register === "current" ? scope : "all";
  const pageFilteredRecords = useMemo(
    () => (activeScope === "all" ? registerRecords : registerRecords.filter((task) => taskInScope(task, activeScope, currentUserId))),
    [registerRecords, activeScope, currentUserId],
  );
  const registerCounts = useMemo(() => {
    const historical = records.filter(isHistoricalSourceAction).length;
    return { historical, current: records.length - historical };
  }, [records]);

  const openNew = useCallback(() => {
    if (!canManage) return;
    setForm({
      ...makeTaskFormDefaults({
        committeeId: requestedCommitteeId || undefined,
        goalId: requestedGoalId || undefined,
      }),
      tags: [],
      checklist: [],
    });
    setOpen(true);
  }, [requestedCommitteeId, requestedGoalId, canManage]);

  // "N" starts a new task while the page has focus (not while typing or in a dialog).
  useEffect(() => {
    if (!canManage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']")) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      event.preventDefault();
      openNew();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canManage, openNew]);

  useEffect(() => {
    if (!canManage || !openNewFromUrl || open || society === undefined || society === null) return;
    openNew();
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }, [canManage, openNewFromUrl, open, openNew, setSearchParams, society]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const changeRegister = (next: TaskRegister) => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "historical") params.set("register", "historical");
        else params.delete("register");
        params.delete("new");
        return params;
      },
      { replace: true },
    );
  };

  const openEdit = (task: TaskRecord) => {
    setForm({
      ...makeTaskFormDefaults({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee: task.assignee,
        dueDate: task.dueDate,
        responsibleUserId: task.responsibleUserIds?.[0] ?? "",
        committeeId: task.committeeId,
        goalId: task.goalId,
        meetingId: task.meetingId,
        agendaItemId: task.agendaItemId,
        assigneePersonId: task.assigneePersonId,
        sourceAssignee: task.sourceAssignee,
        filingId: task.filingId,
        workflowId: task.workflowId,
        documentId: task.documentId,
        commitmentId: task.commitmentId,
        eventId: task.eventId,
        completionNote: task.completionNote,
      }),
      _id: task._id,
      tags: task.tags ?? [],
      checklist: task.checklist ?? [],
    });
    setOpen(true);
  };

  /** An existing task's checklist saves on every change; a new task's saves with the form. */
  const changeChecklist = async (items: TaskChecklistItem[]) => {
    const id = form?._id;
    setForm((previous) => (previous ? { ...previous, checklist: items } : previous));
    if (!id || !canManage) return;
    try {
      await update({ id, patch: { checklist: items } });
    } catch (error) {
      toast.error("Could not save the checklist", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const save = async () => {
    if (!form || !canManage || saving) return;
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      if (form._id) {
        await update({
          id: form._id,
          patch: cleanPatch({
            title: form.title,
            description: form.description || undefined,
            status: form.status,
            priority: form.priority,
            assignee: form.assignee || undefined,
            ...(form.assigneePersonId
              ? { assigneePersonId: form.assigneePersonId as Id<"peopleDirectory"> }
              : { clearAssigneePersonId: true }),
            ...(form.meetingId
              ? { meetingId: form.meetingId as Id<"meetings"> }
              : { clearMeetingId: true }),
            ...(form.meetingId && form.agendaItemId
              ? { agendaItemId: form.agendaItemId as Id<"agendaItems"> }
              : { clearAgendaItemId: true }),
            responsibleUserIds: form.responsibleUserId
              ? [form.responsibleUserId as Id<"users">]
              : [],
            dueDate: form.dueDate || undefined,
            committeeId: form.committeeId
              ? (form.committeeId as Id<"committees">)
              : undefined,
            goalId: form.goalId ? (form.goalId as Id<"goals">) : undefined,
            filingId: form.filingId ? (form.filingId as Id<"filings">) : undefined,
            workflowId: form.workflowId
              ? (form.workflowId as Id<"workflows">)
              : undefined,
            documentId: form.documentId
              ? (form.documentId as Id<"documents">)
              : undefined,
            commitmentId: form.commitmentId
              ? (form.commitmentId as Id<"commitments">)
              : undefined,
            eventId: form.eventId || undefined,
            completionNote: form.completionNote || undefined,
            completedByUserId:
              form.status === "Done" && currentUserId ? currentUserId : undefined,
          }),
        });
        setOpen(false);
        toast.success("Task updated", form.title);
        return;
      }

      await create({
        societyId: society._id,
        title: form.title,
        description: form.description || undefined,
        status: form.status,
        priority: form.priority,
        assignee: form.assignee || undefined,
        assigneePersonId: form.assigneePersonId ? (form.assigneePersonId as Id<"peopleDirectory">) : undefined,
        meetingId: form.meetingId ? (form.meetingId as Id<"meetings">) : undefined,
        agendaItemId: form.meetingId && form.agendaItemId ? (form.agendaItemId as Id<"agendaItems">) : undefined,
        responsibleUserIds: form.responsibleUserId
          ? [form.responsibleUserId as Id<"users">]
          : undefined,
        dueDate: form.dueDate || undefined,
        committeeId: form.committeeId
          ? (form.committeeId as Id<"committees">)
          : undefined,
        goalId: form.goalId ? (form.goalId as Id<"goals">) : undefined,
        filingId: form.filingId ? (form.filingId as Id<"filings">) : undefined,
        workflowId: form.workflowId ? (form.workflowId as Id<"workflows">) : undefined,
        documentId: form.documentId ? (form.documentId as Id<"documents">) : undefined,
        commitmentId: form.commitmentId
          ? (form.commitmentId as Id<"commitments">)
          : undefined,
        eventId: form.eventId || undefined,
        tags: form.tags ?? [],
        checklist: form.checklist.length ? form.checklist : undefined,
      });
      setOpen(false);
      toast.success("Task created", form.title);
    } catch (error) {
      toast.error("Could not save task", error instanceof Error ? error.message : "Please try again.");
    } finally { setSaving(false); }
  };

  const confirmDelete = async (id: Id<"tasks">, title: string) => {
    if (!canManage) return;
    const approved = await confirm({
      title: "Delete task?",
      message: `"${title}" will be permanently removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!approved) return;
    try {
      await remove({ id });
      toast.success("Task deleted");
    } catch (error) {
      toast.error("Could not delete task", error instanceof Error ? error.message : "Please try again.");
    }
  };

  /** P3: completing a historical source action records a present-day judgement; ask first. */
  const confirmHistoricalCompletion = async (task: TaskRecord) => {
    if (!isHistoricalSourceAction(task)) return true;
    return confirm({
      title: "Mark this historical action done?",
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>
            “{task.title}” comes from old minutes. The source does not say whether it was completed or is still owed.
          </p>
          <p style={{ margin: 0 }}>
            Marking it done records that <strong>you, today</strong>, confirmed completion. Add the evidence in the completion
            note afterwards. If the action no longer applies, set its status to Cancelled instead.
          </p>
        </>
      ),
      confirmLabel: "Mark done",
      tone: "warn",
    });
  };

  const promoteToCurrent = async (task: TaskRecord) => {
    if (!canManage) return;
    const approved = await confirm({
      title: "Convert to a current task?",
      message: `“${task.title}” will move to Current tasks with status To do and count as open work. Its source meeting and observations stay attached.`,
      confirmLabel: "Convert",
    });
    if (!approved) return;
    try {
      await promote({ id: task._id, title: task.title.replace(/^Review historical action:\s*/i, "") });
      toast.success("Converted to a current task", task.title);
    } catch (error) {
      toast.error("Could not convert the action", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const tidyHistorical = async () => {
    if (!canManage) return;
    try {
      const preview: any = await consolidate({ societyId: society._id, dryRun: true });
      const approved = await confirm({
        title: "Tidy historical source actions?",
        message: (
          <>
            <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              <li>{preview.folded} carried-forward duplicate{preview.folded === 1 ? "" : "s"} folded into {preview.duplicateGroups} action{preview.duplicateGroups === 1 ? "" : "s"} (every source observation is kept on the remaining action)</li>
              <li>{preview.statusUnknown} action{preview.statusUnknown === 1 ? "" : "s"} set to “Unknown (from source)” and no longer assigned to the importing user</li>
              <li>{preview.sourceAssignees} owner{preview.sourceAssignees === 1 ? "" : "s"} recorded as written in the source (for example “Kim”)</li>
              <li>{preview.committeesLinked} linked to the committee of their source meeting</li>
            </ul>
            <p className="muted" style={{ margin: 0 }}>Actions someone has already changed are left as they are. Folded duplicates are deleted after their observations are copied.</p>
          </>
        ),
        confirmLabel: "Apply",
      });
      if (!approved) return;
      const result: any = await consolidate({ societyId: society._id, dryRun: false });
      toast.success("Historical actions tidied", `${result.folded} duplicates folded, ${result.statusUnknown} marked Unknown`);
    } catch (error) {
      toast.error("Could not tidy historical actions", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const markComplete = async (task: TaskRecord) => {
    if (!canManage) return;
    if (!(await confirmHistoricalCompletion(task))) return;
    const previous = task.status;
    await undoable({
      message: "Task completed",
      description: task.title,
      errorMessage: "Could not complete task",
      dedupeKey: `task-complete-${task._id}`,
      run: () => update({
        id: task._id,
        patch: {
          status: "Done",
          completedByUserId: currentUserId ?? undefined,
        },
      }),
      undo: () => update({ id: task._id, patch: { status: previous } }),
      undoneMessage: "Task reopened",
    });
  };

  const updateInlineField = async (
    recordId: string,
    fieldName: string,
    value: unknown,
  ) => {
    if (!canManage) return;
    const id = recordId as Id<"tasks">;
    if (fieldName === "status" && typeof value === "string") {
      const task = records.find((record) => record._id === id);
      if (value === "Done" && task && !(await confirmHistoricalCompletion(task))) return;
      await update({
        id,
        patch: {
          status: value,
          completedByUserId:
            value === "Done" && currentUserId ? currentUserId : undefined,
        },
      });
      return;
    }
    if (fieldName === "priority" && typeof value === "string") {
      await update({ id, patch: { priority: value } });
      return;
    }
    if (fieldName === "assignee" && (typeof value === "string" || value === null)) {
      await update({ id, patch: { assignee: value ?? "" } });
      return;
    }
    if (fieldName === "dueDate" && (typeof value === "string" || value === null)) {
      await update({ id, patch: { dueDate: value ?? "" } });
    }
  };

  const bulkDelete = async (ids: string[], selectedRecords: TaskRecord[]) => {
    if (!canManage || ids.length === 0) return;
    const previewTitles = selectedRecords.slice(0, 5).map((task) => task.title);
    const overflow = selectedRecords.length - previewTitles.length;
    const approved = await confirm({
      title: `Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`,
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>
            This permanently removes the selected task{ids.length === 1 ? "" : "s"}.
            This action cannot be undone.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {previewTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
          {overflow > 0 && (
            <p className="muted" style={{ margin: "6px 0 0", fontSize: "var(--fs-sm)" }}>
              …and {overflow} more
            </p>
          )}
        </>
      ),
      confirmLabel: `Delete ${ids.length}`,
      tone: "danger",
    });
    if (!approved) return;

    setBulkDeleting(true);
    try {
      let failures = 0;
      for (const id of ids) {
        try {
          await remove({ id: id as Id<"tasks"> });
        } catch {
          failures += 1;
        }
      }
      const succeeded = ids.length - failures;
      if (succeeded > 0) {
        toast.success(`${succeeded} task${succeeded === 1 ? "" : "s"} deleted`);
      }
      if (failures > 0) {
        toast.error(`${failures} task${failures === 1 ? "" : "s"} could not be deleted`);
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  const viewActions: TaskViewActions = {
    canManage,
    open: openEdit,
    setStatus: async (task, status) => {
      if (status === task.status) return;
      if (status === "Done") return markComplete(task);
      try {
        await update({ id: task._id, patch: { status } });
        if (isClosedStatus(task.status) && !isClosedStatus(status)) toast.success("Task reopened", task.title);
      } catch (error) {
        toast.error("Could not change the status", error instanceof Error ? error.message : "Please try again.");
      }
    },
    setPriority: async (task, priority) => {
      if (priority === task.priority) return;
      try { await update({ id: task._id, patch: { priority } }); }
      catch (error) { toast.error("Could not change the priority", error instanceof Error ? error.message : "Please try again."); }
    },
    setDue: async (task, dueDate) => {
      try { await update({ id: task._id, patch: { dueDate } }); }
      catch (error) { toast.error("Could not change the due date", error instanceof Error ? error.message : "Please try again."); }
    },
    remove: (task) => confirmDelete(task._id, task.title),
    promote: canManage ? promoteToCurrent : undefined,
    quickAdd: async (title, defaults) => {
      if (!canManage) return false;
      try {
        await create({
          societyId: society._id,
          title,
          status: defaults.status ?? "Todo",
          priority: defaults.priority ?? "Medium",
          dueDate: defaults.dueDate || undefined,
          committeeId: requestedCommitteeId ? (requestedCommitteeId as Id<"committees">) : undefined,
          goalId: requestedGoalId ? (requestedGoalId as Id<"goals">) : undefined,
          // Added while looking at "Assigned to me": keep it in view.
          responsibleUserIds: activeScope === "mine" && currentUserId ? [currentUserId] : undefined,
          tags: [],
        });
        toast.success("Task added", title);
        return true;
      } catch (error) {
        toast.error("Could not add the task", error instanceof Error ? error.message : "Please try again.");
        return false;
      }
    },
  };

  const bulkSetStatus = async (selectedRecords: TaskRecord[], status: string) => {
    const changing = selectedRecords.filter((task) => task.status !== status && !isHistoricalSourceAction(task));
    let failures = 0;
    for (const task of changing) {
      try { await update({ id: task._id, patch: { status, completedByUserId: status === "Done" && currentUserId ? currentUserId : undefined } }); }
      catch { failures += 1; }
    }
    const succeeded = changing.length - failures;
    if (succeeded > 0) {
      await undoable({
        message: `${succeeded} task${succeeded === 1 ? "" : "s"} ${status === "Done" ? "completed" : "reopened"}`,
        dedupeKey: "task-bulk-status",
        // Restore each task's own previous status; one failure fails the undo
        // so the user can retry rather than end up half-restored unawares.
        undo: () => Promise.all(changing.map((task) => update({ id: task._id, patch: { status: task.status } }))),
      });
    }
    if (failures > 0) toast.error(`${failures} task${failures === 1 ? "" : "s"} could not be changed`);
  };

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const registerSwitch = (
    <div className="segmented" role="tablist" aria-label="Task register" style={{ maxWidth: "100%" }}>
      <button type="button" role="tab" aria-selected={register === "current"} className={`segmented__btn${register === "current" ? " is-active" : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => changeRegister("current")}>
        <ListTodo size={12} /> Current ({registerCounts.current})
      </button>
      <button type="button" role="tab" aria-selected={register === "historical"} className={`segmented__btn${register === "historical" ? " is-active" : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => changeRegister("historical")}>
        <History size={12} /> History ({registerCounts.historical})
      </button>
    </div>
  );
  return (
    <div className="page">
      <PageHeader
        title="Tasks"
        icon={<ListTodo size={16} />}
        iconColor="turquoise"
        subtitle="Work items for your board and staff."
        info={
          <p>Dates set by law or regulation belong in Deadlines; promises made to funders or partners belong in Commitments.</p>
        }
        actions={
          <>
            {isPhone && (
              <TaskViewSummaryButton
                registerSwitch={registerSwitch}
                register={register}
                scope={scope}
                onScope={setScope}
                counts={scopeCounts}
                groupBy={groupBy}
                onGroupBy={setGroupBy}
                showGrouping={layout === "list"}
              />
            )}
            <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canManage}>
              <Plus size={12} /> New task
            </button>
          </>
        }
      />

      {!isPhone && (
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
      {registerSwitch}
      {register === "current" && (
        <TaskScopeBar
          scope={scope}
          onScope={setScope}
          counts={scopeCounts}
          groupBy={groupBy}
          onGroupBy={setGroupBy}
          showGrouping={layout === "list"}
        />
      )}
      </div>
      )}
      {register === "historical" && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card__body col" style={{ gap: 8 }}>
            <p className="muted" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
              Action lines from past minutes — not counted as open work.
              <InfoPopover label="About historical actions">
                <p>They show what a meeting asked for; whether each was done, and whether it is still owed, is unknown. Convert one to a current task when it is still relevant.</p>
              </InfoPopover>
            </p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn--sm" disabled={!canManage || registerCounts.historical === 0} onClick={tidyHistorical}>
                <Wand2 size={12} /> Tidy duplicates and statuses…
              </button>
            </div>
          </div>
        </div>
      )}
      {register === "historical" && <ActionRegisterCard societyId={society._id} tasks={pageFilteredRecords} />}

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society._id} objectLabel="task" />
      ) : objectMetadata ? (
        <RecordTableScope
          tableId="tasks"
          objectMetadata={objectMetadata}
          hydratedView={hydratedView}
          records={pageFilteredRecords}
          onRecordClick={(_recordId, record) => openEdit(record as TaskRecord)}
          onUpdate={canManage ? ({ recordId, fieldName, value }) =>
            updateInlineField(recordId, fieldName, value)
          : undefined}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={objectMetadata._id as Id<"objectMetadata">}
            icon={<ListTodo size={14} />}
            label="All tasks"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onViewPicked={() => setLayout("engine")}
            onOpenFilter={() => setFilterOpen((value) => !value)}
            listView={register === "current" ? { active: layout === "list", onSelect: () => setLayout("list"), onLeave: () => setLayout("engine") } : undefined}
          />
          <RecordTableFilterPopover
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
          />
          <TaskUrlFilters committeeId={requestedCommitteeId} goalId={requestedGoalId} />
          <RecordTableFilterChips />

          {register === "current" && layout === "list" ? (
            tableData.loading || tasks === undefined ? (
              <div className="record-table__loading">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="record-table__loading-row" />
                ))}
              </div>
            ) : (
              <TaskListView groupBy={groupBy} actions={viewActions} hasTasks={registerRecords.length > 0} />
            )
          ) : (
          <TaskBoardSwitch enabled={register === "current"} actions={viewActions}>
          {isMobile ? (
            tableData.loading || tasks === undefined ? (
              <div className="record-table__loading">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="record-table__loading-row" />
                ))}
              </div>
            ) : (
              <TaskPhoneList
                canManage={canManage}
                hasTasks={records.length > 0}
                committeeById={committeeById}
                goalById={goalById}
                userById={userById}
                onEdit={openEdit}
                onDelete={confirmDelete}
                onStatusChange={(task, status) =>
                  updateInlineField(task._id, "status", status)
                }
                onPromote={canManage ? promoteToCurrent : undefined}
              />
            )
          ) : (
            <RecordTable
              selectable={canManage}
              loading={tableData.loading || tasks === undefined}
              renderRowActions={(record: TaskRecord) => (
                <>
                  {isHistoricalSourceAction(record) && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={!canManage}
                      title="Convert to a current task"
                      onClick={() => promoteToCurrent(record)}
                    >
                      <ArrowUpRight size={12} /> Make current
                    </button>
                  )}
                  {!["Done", "Cancelled"].includes(record.status) && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={!canManage}
                      onClick={() => markComplete(record)}
                    >
                      <Check size={12} /> Complete
                    </button>
                  )}
                  <Tooltip content={canManage ? "Edit task" : "View task"}>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`${canManage ? "Edit" : "View"} task ${record.title}`}
                      onClick={() => openEdit(record)}
                    >
                      <Pencil size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Delete task">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Delete task ${record.title}`}
                      disabled={!canManage}
                      onClick={() => confirmDelete(record._id, record.title)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </Tooltip>
                </>
              )}
            />
          )}
          </TaskBoardSwitch>
          )}

          <RecordTableBulkBar
            actions={canManage ? [
              ...(register === "current"
                ? [
                    {
                      id: "complete",
                      label: "Mark done",
                      icon: <Check size={12} />,
                      onRun: (_ids: string[], selectedRecords: unknown[]) => bulkSetStatus(selectedRecords as TaskRecord[], "Done"),
                    },
                    {
                      id: "reopen",
                      label: "Reopen",
                      icon: <RotateCcw size={12} />,
                      onRun: (_ids: string[], selectedRecords: unknown[]) => bulkSetStatus((selectedRecords as TaskRecord[]).filter((task) => isClosedStatus(task.status)), "Todo"),
                    },
                  ]
                : []),
              {
                id: "delete",
                label: bulkDeleting ? "Deleting…" : "Delete",
                icon: <Trash2 size={12} />,
                tone: "danger",
                onRun: (ids, selectedRecords) =>
                  bulkDelete(ids, selectedRecords as TaskRecord[]),
              },
            ] : []}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={form?._id ? (canManage ? "Edit task" : "View task") : "New task"}
        footer={
          <>
            {form?._id && (
              <button
                className="btn btn--danger"
                style={{ marginRight: "auto" }}
                disabled={!canManage}
                onClick={async () => {
                  if (!form._id) return;
                  const approved = await confirm({
                    title: "Delete task?",
                    message: `"${form.title}" will be permanently removed.`,
                    confirmLabel: "Delete",
                    tone: "danger",
                  });
                  if (!approved) return;
                  await remove({ id: form._id });
                  toast.success("Task deleted");
                  setOpen(false);
                }}
              >
                Delete
              </button>
            )}
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save} disabled={!canManage || saving || !form?.title.trim()}>
              {saving ? "Saving…" : form?._id ? "Save" : "Create"}
            </button>
          </>
        }
      >
        {form && (
          <>
            {!form._id && (
              <p
                className="muted"
                style={{
                  fontSize: "var(--fs-sm)",
                  marginTop: 0,
                  marginBottom: 12,
                }}
              >
                Use a task for internal work your board or staff needs to do. Legal or
                regulatory dates belong in Deadlines; promises to funders or partners
                belong in Commitments.
              </p>
            )}
            {form._id && (() => {
              const task = records.find((record) => record._id === form._id);
              return task ? (
                <TaskStateBanner
                  task={task}
                  canManage={canManage}
                  onReopen={() => { void viewActions.setStatus(task, "Todo"); setForm((previous) => previous ? { ...previous, status: "Todo" } : previous); }}
                  onRescheduleToday={() => { const today = isoDay(startOfToday()); void viewActions.setDue(task, today); setForm((previous) => previous ? { ...previous, dueDate: today } : previous); }}
                />
              ) : null;
            })()}
            {form._id && (() => {
              const task = records.find((record) => record._id === form._id);
              return task && (isHistoricalSourceAction(task) || task.sourceObservations?.length || task.meetingId) ? (
                <HistoricalActionSource
                  task={task}
                  meetingTitle={task.meetingIdLabel}
                  onPromote={canManage && isHistoricalSourceAction(task) ? async () => { await promoteToCurrent(task); setOpen(false); } : undefined}
                />
              ) : null;
            })()}
            <fieldset disabled={!canManage || saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <TaskFormFields
              readOnly={!canManage}
              value={form}
              onChange={(patch) =>
                setForm((previous) =>
                  previous ? { ...previous, ...patch } : previous,
                )
              }
              data={formData}
              mode={form._id ? "edit" : "create"}
            />
            </fieldset>
            <TaskChecklist items={form.checklist} onChange={(items) => void changeChecklist(items)} readOnly={!canManage} />
            {form._id && <TaskDiscussion taskId={String(form._id)} />}
          </>
        )}
      </Drawer>
    </div>
  );
}

/**
 * The toolbar's Board view: current tasks get the task board (grouped by the
 * view's kanban field when it is status or priority); anything else falls
 * through to the generic record views.
 */
function TaskBoardSwitch({ enabled, actions, children }: { enabled: boolean; actions: TaskViewActions; children: ReactNode }) {
  const viewType = useRecordTableState((state) => state.type);
  const savedView = useRecordTableState((state) => state.savedView);
  const columns = useRecordTableState((state) => state.columns);
  // A saved board keeps its own field; switching to Board ad hoc groups by status.
  const savedField = savedView && (savedView.type === "kanban" || savedView.type === "board") ? savedView.kanbanFieldMetadataId : undefined;
  const fieldName = columns.find((column) => column.fieldMetadataId === savedField)?.field.name ?? "status";
  if (!enabled || (viewType !== "kanban" && viewType !== "board") || (fieldName !== "status" && fieldName !== "priority")) return <>{children}</>;
  return <TaskBoardView by={fieldName} actions={actions} />;
}

function TaskPhoneList({
  canManage,
  hasTasks,
  committeeById,
  goalById,
  userById,
  onEdit,
  onDelete,
  onStatusChange,
  onPromote,
}: {
  canManage: boolean;
  hasTasks: boolean;
  committeeById: Map<string, Doc<"committees">>;
  goalById: Map<string, Doc<"goals">>;
  userById: Map<string, Doc<"users">>;
  onEdit: (task: TaskRecord) => void;
  onDelete: (id: Id<"tasks">, title: string) => Promise<void>;
  onStatusChange: (task: TaskRecord, status: string) => Promise<void>;
  onPromote?: (task: TaskRecord) => Promise<void>;
}) {
  const records = useFilteredRecords() as TaskRecord[];
  const viewType = useRecordTableState((state) => state.type);
  if (viewType !== "table") return <RecordTable selectable={false} />;

  if (records.length === 0) {
    return (
      <div className="record-table__empty">
        <div className="record-table__empty-title">
          {hasTasks ? "No matching tasks" : "No tasks"}
        </div>
        <div className="record-table__empty-desc">
          {hasTasks
            ? "Change or clear the current search and filters."
            : "Create a task to start tracking internal work."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {records.map((task) => {
        const committee = task.committeeId
          ? committeeById.get(String(task.committeeId))
          : undefined;
        const goal = task.goalId ? goalById.get(String(task.goalId)) : undefined;
        const responsible =
          userNames(task.responsibleUserIds, userById) || task.assignee;
        const overdue =
          Boolean(task.dueDate) &&
          isPastDue(task.dueDate) &&
          !["Done", "Cancelled", "Unknown"].includes(task.status);

        return (
          <div
            key={task._id}
            className="card"
            style={{ padding: 12, cursor: "pointer" }}
            role="button"
            tabIndex={0}
            onClick={() => onEdit(task)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onEdit(task);
              }
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span
                className={`priority-dot priority-${task.priority}`}
                style={{ marginTop: 6, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{task.title}</strong>
                {task.description && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    {task.description}
                  </div>
                )}
                <div
                  className="row"
                  style={{
                    gap: 6,
                    flexWrap: "wrap",
                    marginTop: 6,
                    fontSize: "var(--fs-sm)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <span>{task.priority}</span>
                  {responsible && <span>· {responsible}</span>}
                  {committee && (
                    <span className="row" style={{ gap: 4 }}>
                      <span>·</span>
                      <span
                        className="color-chip"
                        style={{ background: committee.color }}
                      />
                      {committee.name}
                    </span>
                  )}
                  {goal && <span>· {goal.title}</span>}
                  {task.dueDate && (
                    <span style={{ color: overdue ? "var(--danger)" : undefined }}>
                      · {formatDate(task.dueDate)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div
              className="row"
              style={{ marginTop: 10, gap: 8, alignItems: "center" }}
              onClick={(event) => event.stopPropagation()}
            >
              <Select
                size="sm"
                disabled={!canManage}
                value={task.status}
                onChange={(status) => void onStatusChange(task, status)}
                style={{ width: 150 }}
                options={TASK_STATUSES.map((status) => ({
                  value: status,
                  label: taskStatusLabel(status),
                }))}
              />
              {onPromote && isHistoricalSourceAction(task) && (
                <button type="button" className="btn btn--sm" onClick={() => void onPromote(task)}>
                  <ArrowUpRight size={12} /> Make current
                </button>
              )}
              <span style={{ marginLeft: "auto" }}>
                <Menu
                  align="right"
                  trigger={
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for task ${task.title}`}>
                      <MoreHorizontal size={14} />
                    </button>
                  }
                  sections={[{
                    id: "task",
                    items: [
                      { id: "edit", label: canManage ? "Edit" : "View", icon: <Pencil size={14} />, onSelect: () => onEdit(task) },
                      { id: "delete", label: "Delete", icon: <Trash2 size={14} />, destructive: true, disabled: !canManage, onSelect: () => void onDelete(task._id, task.title) },
                    ],
                  }]}
                />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function recordsById<T extends { _id: string }>(records: readonly T[]) {
  return new Map(records.map((record) => [String(record._id), record]));
}

function userNames(
  ids: Id<"users">[] | undefined,
  userById: Map<string, Doc<"users">>,
) {
  return (ids ?? [])
    .map((id) => userById.get(String(id))?.displayName)
    .filter((name): name is string => Boolean(name))
    .join(", ");
}

const TASK_LINK_KINDS: readonly TaskLinkKind[] = ["meeting", "goal", "filing", "workflow", "document", "commitment", "event"];

/** What a task is linked to, as values of the read-only "Linked to" column. */
function linkedKinds(task: Doc<"tasks">): TaskLinkKind[] {
  const present: Record<TaskLinkKind, unknown> = {
    meeting: task.meetingId,
    goal: task.goalId,
    filing: task.filingId,
    workflow: task.workflowId,
    document: task.documentId,
    commitment: task.commitmentId,
    event: task.eventId,
  };
  return TASK_LINK_KINDS.filter((kind) => Boolean(present[kind]));
}

function withRelationOptions<F extends { name: string; config?: unknown }>(
  field: F,
  optionsByField: Record<string, { value: string; label: string }[]>,
): F {
  const options = optionsByField[field.name];
  if (!options?.length) return field;
  return { ...field, config: { ...((field.config as object | undefined) ?? {}), options } };
}

const NOT_APPLIED = Symbol("not applied");

/**
 * Other pages link here as /app/tasks?committeeId=… or ?goalId=…. Those land
 * as ordinary table filters (removable chips). They are re-applied whenever
 * the view reloads, and removing the chip drops the parameter from the address.
 */
function TaskUrlFilters({ committeeId, goalId }: { committeeId: string; goalId: string }) {
  const handle = useRecordTableStoreHandle();
  const columns = useRecordTableState((s) => s.columns);
  const filters = useRecordTableState((s) => s.filters);
  const savedView = useRecordTableState((s) => s.savedView);
  const [, setSearchParams] = useSearchParams();
  const appliedFor = useRef<unknown>(NOT_APPLIED);
  useEffect(() => {
    const wanted = [
      { fieldName: "committeeId", value: committeeId },
      { fieldName: "goalId", value: goalId },
    ].filter((entry) => entry.value);
    if (wanted.length === 0) return;
    if (appliedFor.current === savedView) {
      const removed = wanted.filter((entry) => !filters.some((filter) => filter.id === `url-${entry.fieldName}`));
      if (removed.length === 0) return;
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const entry of removed) next.delete(entry.fieldName);
          return next;
        },
        { replace: true },
      );
      return;
    }
    const additions = wanted.flatMap((entry) => {
      const column = columns.find((c) => c.field.name === entry.fieldName);
      return column ? [{ ...entry, fieldMetadataId: column.fieldMetadataId }] : [];
    });
    if (additions.length < wanted.length) return; // wait for the view to load
    appliedFor.current = savedView;
    const existing = handle.get().filters.filter(
      (filter) => !additions.some((addition) => addition.fieldMetadataId === filter.fieldMetadataId),
    );
    handle.get().setFilters([
      ...existing,
      ...additions.map((addition) => ({
        id: `url-${addition.fieldName}`,
        fieldMetadataId: addition.fieldMetadataId,
        operator: "eq" as const,
        value: addition.value,
      })),
    ]);
  }, [columns, committeeId, filters, goalId, handle, savedView, setSearchParams]);
  return null;
}

function cleanPatch<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as T;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { Check, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
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
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import { Select } from "../components/Select";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Drawer } from "../components/ui";
import {
  TaskFormFields,
  TASK_STATUSES,
  makeTaskFormDefaults,
  useTaskFormData,
  type TaskFormValue,
} from "../features/tasks/TaskFormFields";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { formatDate } from "../lib/format";
import { useIsMobile } from "../lib/useIsMobile";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";

type EditableTaskForm = TaskFormValue & {
  _id?: Id<"tasks">;
  tags?: string[];
};

type TaskRecord = Doc<"tasks"> & {
  responsibleUserIdsLabel?: string;
  committeeIdLabel?: string;
  meetingIdLabel?: string;
  goalIdLabel?: string;
  filingIdLabel?: string;
  workflowIdLabel?: string;
  documentIdLabel?: string;
  commitmentIdLabel?: string;
  completedByUserIdLabel?: string;
};

const TASK_STATUS_LABELS: Record<(typeof TASK_STATUSES)[number], string> = {
  Todo: "To do",
  InProgress: "In progress",
  Blocked: "Blocked",
  Done: "Done",
};

export function taskStatusLabel(status: string) {
  return status in TASK_STATUS_LABELS
    ? TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS]
    : status;
}

export function TasksPage() {
  const society = useSociety();
  const tasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const formData = useTaskFormData(society?._id);
  const { committees, goals, users, filings, workflows, documents, commitments } = formData;
  const create = useMutation(api.tasks.create);
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const currentUserId = useCurrentUserId();
  const confirm = useConfirm();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedGoalId = searchParams.get("goalId") ?? "";
  const requestedCommitteeId = searchParams.get("committeeId") ?? "";
  const openNewFromUrl = searchParams.get("new") === "1";
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterCommittee, setFilterCommittee] = useState(requestedCommitteeId);
  const [filterGoal, setFilterGoal] = useState(requestedGoalId);
  const [filterLink, setFilterLink] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EditableTaskForm | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "task",
    viewId: currentViewId,
  });

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
        return {
          ...task,
          responsibleUserIdsLabel: userNames(task.responsibleUserIds, userById),
          committeeIdLabel: task.committeeId
            ? committeeById.get(String(task.committeeId))?.name
            : undefined,
          meetingIdLabel: task.meetingId
            ? meetingById.get(String(task.meetingId))?.title
            : undefined,
          goalIdLabel: task.goalId ? goalById.get(String(task.goalId))?.title : undefined,
          filingIdLabel: filing
            ? `${filing.kind}${filing.periodLabel ? ` — ${filing.periodLabel}` : ""}`
            : undefined,
          workflowIdLabel: task.workflowId
            ? workflowById.get(String(task.workflowId))?.name
            : undefined,
          documentIdLabel: task.documentId
            ? documentById.get(String(task.documentId))?.title
            : undefined,
          commitmentIdLabel: task.commitmentId
            ? commitmentById.get(String(task.commitmentId))?.title
            : undefined,
          completedByUserIdLabel: task.completedByUserId
            ? userById.get(String(task.completedByUserId))?.displayName
            : undefined,
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

  const pageFilteredRecords = useMemo(
    () =>
      records.filter((task) => {
        if (filterCommittee && String(task.committeeId ?? "") !== filterCommittee) return false;
        if (filterGoal && String(task.goalId ?? "") !== filterGoal) return false;
        return !filterLink || matchesLinkFilter(task, filterLink);
      }),
    [records, filterCommittee, filterGoal, filterLink],
  );

  const openNew = useCallback(() => {
    setForm({
      ...makeTaskFormDefaults({
        committeeId: filterCommittee || undefined,
        goalId: filterGoal || undefined,
      }),
      tags: [],
    });
    setOpen(true);
  }, [filterCommittee, filterGoal]);

  useEffect(() => {
    setFilterGoal(requestedGoalId);
  }, [requestedGoalId]);

  useEffect(() => {
    if (requestedCommitteeId) setFilterCommittee(requestedCommitteeId);
  }, [requestedCommitteeId]);

  useEffect(() => {
    if (!openNewFromUrl || open || society === undefined || society === null) return;
    openNew();
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }, [openNewFromUrl, open, openNew, setSearchParams, society]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const changeGoalFilter = (goalId: string) => {
    setFilterGoal(goalId);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (goalId) next.set("goalId", goalId);
        else next.delete("goalId");
        next.delete("new");
        return next;
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
        filingId: task.filingId,
        workflowId: task.workflowId,
        documentId: task.documentId,
        commitmentId: task.commitmentId,
        eventId: task.eventId,
        completionNote: task.completionNote,
      }),
      _id: task._id,
      tags: task.tags ?? [],
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form) return;
    if (form._id) {
      await update({
        id: form._id,
        patch: cleanPatch({
          title: form.title,
          description: form.description || undefined,
          status: form.status,
          priority: form.priority,
          assignee: form.assignee || undefined,
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
    });
    setOpen(false);
    toast.success("Task created", form.title);
  };

  const confirmDelete = async (id: Id<"tasks">, title: string) => {
    const approved = await confirm({
      title: "Delete task?",
      message: `"${title}" will be permanently removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!approved) return;
    await remove({ id });
    toast.success("Task deleted");
  };

  const markComplete = async (task: TaskRecord) => {
    await update({
      id: task._id,
      patch: {
        status: "Done",
        completedByUserId: currentUserId ?? undefined,
      },
    });
    toast.success("Task completed", task.title);
  };

  const updateInlineField = async (
    recordId: string,
    fieldName: string,
    value: unknown,
  ) => {
    const id = recordId as Id<"tasks">;
    if (fieldName === "status" && typeof value === "string") {
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
    if (ids.length === 0) return;
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

  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const activePageFilterCount = [filterCommittee, filterGoal, filterLink].filter(Boolean).length;

  return (
    <div className="page">
      <PageHeader
        title="Tasks"
        icon={<ListTodo size={16} />}
        iconColor="turquoise"
        subtitle="Internal work items for your board and staff to get done. For dates set by law or regulation, use Deadlines; for promises made to funders or partners, use Commitments."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New task
          </button>
        }
      />

      <div className="row" style={{ marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
        {isMobile && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
          >
            Page filters{activePageFilterCount ? ` (${activePageFilterCount})` : ""}
          </button>
        )}
        {(!isMobile || filtersOpen) && (
          <>
            <Select
              value={filterCommittee}
              onChange={setFilterCommittee}
              clearable
              clearLabel="All committees"
              placeholder="All committees"
              style={{ width: isMobile ? "100%" : 200, maxWidth: "100%" }}
              options={((committees ?? []) as Doc<"committees">[]).map((committee) => ({
                value: committee._id,
                label: committee.name,
              }))}
            />
            <Select
              value={filterGoal}
              onChange={changeGoalFilter}
              clearable
              clearLabel="All goals"
              placeholder="All goals"
              style={{ width: isMobile ? "100%" : 220, maxWidth: "100%" }}
              options={((goals ?? []) as Doc<"goals">[]).map((goal) => ({
                value: goal._id,
                label: goal.title,
              }))}
            />
            <Select
              value={filterLink}
              onChange={setFilterLink}
              clearable
              clearLabel="All links"
              placeholder="All links"
              style={{ width: isMobile ? "100%" : 180, maxWidth: "100%" }}
              options={[
                { value: "linked", label: "Any linked record" },
                { value: "goal", label: "Goal linked" },
                { value: "filing", label: "Filing linked" },
                { value: "workflow", label: "Workflow linked" },
                { value: "document", label: "Document linked" },
                { value: "commitment", label: "Commitment linked" },
                { value: "event", label: "Event linked" },
              ]}
            />
          </>
        )}
        <div
          className="muted"
          style={{
            marginLeft: isMobile ? 0 : "auto",
            fontSize: "var(--fs-sm)",
            flexShrink: 0,
          }}
        >
          {pageFilteredRecords.length} of {records.length}
        </div>
      </div>

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society._id} objectLabel="task" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="tasks"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={pageFilteredRecords}
          onRecordClick={(_recordId, record) => openEdit(record as TaskRecord)}
          onUpdate={({ recordId, fieldName, value }) =>
            updateInlineField(recordId, fieldName, value)
          }
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<ListTodo size={14} />}
            label="All tasks"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((value) => !value)}
          />
          <RecordTableFilterPopover
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
          />
          <RecordTableFilterChips />

          {isMobile ? (
            tableData.loading || tasks === undefined ? (
              <div className="record-table__loading">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="record-table__loading-row" />
                ))}
              </div>
            ) : (
              <TaskPhoneList
                hasTasks={records.length > 0}
                committeeById={committeeById}
                goalById={goalById}
                userById={userById}
                onEdit={openEdit}
                onDelete={confirmDelete}
                onStatusChange={(task, status) =>
                  updateInlineField(task._id, "status", status)
                }
              />
            )
          ) : (
            <RecordTable
              selectable
              loading={tableData.loading || tasks === undefined}
              renderRowActions={(record: TaskRecord) => (
                <>
                  {record.status !== "Done" && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => markComplete(record)}
                    >
                      <Check size={12} /> Complete
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Edit task ${record.title}`}
                    title="Edit task"
                    onClick={() => openEdit(record)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm btn--icon"
                    aria-label={`Delete task ${record.title}`}
                    title="Delete task"
                    onClick={() => confirmDelete(record._id, record.title)}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            />
          )}

          <RecordTableBulkBar
            actions={[
              {
                id: "delete",
                label: bulkDeleting ? "Deleting…" : "Delete",
                icon: <Trash2 size={12} />,
                tone: "danger",
                onRun: (ids, selectedRecords) =>
                  bulkDelete(ids, selectedRecords as TaskRecord[]),
              },
            ]}
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
        title={form?._id ? "Edit task" : "New task"}
        footer={
          <>
            {form?._id && (
              <button
                className="btn btn--danger"
                style={{ marginRight: "auto" }}
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
            <button className="btn btn--accent" onClick={save}>
              {form?._id ? "Save" : "Create"}
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
            <TaskFormFields
              value={form}
              onChange={(patch) =>
                setForm((previous) =>
                  previous ? { ...previous, ...patch } : previous,
                )
              }
              data={formData}
              mode={form._id ? "edit" : "create"}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}

function TaskPhoneList({
  hasTasks,
  committeeById,
  goalById,
  userById,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  hasTasks: boolean;
  committeeById: Map<string, Doc<"committees">>;
  goalById: Map<string, Doc<"goals">>;
  userById: Map<string, Doc<"users">>;
  onEdit: (task: TaskRecord) => void;
  onDelete: (id: Id<"tasks">, title: string) => Promise<void>;
  onStatusChange: (task: TaskRecord, status: string) => Promise<void>;
}) {
  const records = useFilteredRecords() as TaskRecord[];

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
          new Date(task.dueDate ?? "").getTime() < Date.now() &&
          task.status !== "Done";

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
                value={task.status}
                onChange={(status) => void onStatusChange(task, status)}
                style={{ width: 150 }}
                options={TASK_STATUSES.map((status) => ({
                  value: status,
                  label: taskStatusLabel(status),
                }))}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                style={{ marginLeft: "auto" }}
                aria-label={`Edit task ${task.title}`}
                onClick={() => onEdit(task)}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete task ${task.title}`}
                onClick={() => void onDelete(task._id, task.title)}
              >
                <Trash2 size={12} />
              </button>
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

function matchesLinkFilter(task: TaskRecord, filter: string) {
  if (filter === "linked") {
    return Boolean(
      task.goalId ||
        task.filingId ||
        task.workflowId ||
        task.documentId ||
        task.commitmentId ||
        task.eventId,
    );
  }
  if (filter === "goal") return Boolean(task.goalId);
  if (filter === "filing") return Boolean(task.filingId);
  if (filter === "workflow") return Boolean(task.workflowId);
  if (filter === "document") return Boolean(task.documentId);
  if (filter === "commitment") return Boolean(task.commitmentId);
  if (filter === "event") return Boolean(task.eventId);
  return true;
}

function cleanPatch<T extends Record<string, unknown>>(source: T): T {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as T;
}

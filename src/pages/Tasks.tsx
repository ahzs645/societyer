import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field, Badge, MenuRow } from "../components/ui";
import { Checkbox } from "../components/Controls";
import { Segmented } from "../components/primitives";
import { Kanban } from "../components/Kanban";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Pencil, Plus, Search, ListTodo, Trash2, X } from "lucide-react";
import { formatDate } from "../lib/format";

const STATUSES = ["Todo", "InProgress", "Blocked", "Done"];
const COLS = [
  { id: "Todo", label: "To do", accent: "var(--text-tertiary)" },
  { id: "InProgress", label: "In progress", accent: "var(--accent)" },
  { id: "Blocked", label: "Blocked", accent: "var(--danger)" },
  { id: "Done", label: "Done", accent: "var(--success)" },
];

export function TasksPage() {
  const society = useSociety();
  const tasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const goals = useQuery(api.goals.list, society ? { societyId: society._id } : "skip");
  const users = useQuery(api.users.list, society ? { societyId: society._id } : "skip");
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");
  const workflows = useQuery(api.workflows.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const commitments = useQuery(api.commitments.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.tasks.create);
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const currentUserId = useCurrentUserId();
  const confirm = useConfirm();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedGoalId = searchParams.get("goalId") ?? "";
  const openNewFromUrl = searchParams.get("new") === "1";
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [q, setQ] = useState("");
  const [filterCommittee, setFilterCommittee] = useState<string>("");
  const [filterGoal, setFilterGoal] = useState<string>(requestedGoalId);
  const [filterLink, setFilterLink] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [cardMenu, setCardMenu] = useState<{ task: any; top: number; left: number } | null>(null);
  const cardMenuRef = useRef<HTMLDivElement | null>(null);

  const committeeById = useMemo(() => new Map<string, any>((committees ?? []).map((c: any) => [c._id, c])), [committees]);
  const goalById = useMemo(() => new Map<string, any>((goals ?? []).map((g: any) => [g._id, g])), [goals]);
  const userById = useMemo(() => new Map<string, any>((users ?? []).map((u: any) => [u._id, u])), [users]);
  const filingById = useMemo(() => new Map<string, any>((filings ?? []).map((f: any) => [f._id, f])), [filings]);
  const workflowById = useMemo(() => new Map<string, any>((workflows ?? []).map((w: any) => [w._id, w])), [workflows]);
  const documentById = useMemo(() => new Map<string, any>((documents ?? []).map((d: any) => [d._id, d])), [documents]);
  const commitmentById = useMemo(() => new Map<string, any>((commitments ?? []).map((c: any) => [c._id, c])), [commitments]);

  const filtered = useMemo(() => {
    const base = tasks ?? [];
    const ql = q.toLowerCase();
    return base.filter((t: any) => {
      if (filterCommittee && t.committeeId !== filterCommittee) return false;
      if (filterGoal && t.goalId !== filterGoal) return false;
      if (filterLink && !matchesLinkFilter(t, filterLink)) return false;
      if (!ql) return true;
      const responsibleNames = (t.responsibleUserIds ?? []).map((id: string) => userById.get(id)?.displayName).filter(Boolean).join(" ");
      const linkedText = [
        goalById.get(t.goalId)?.title,
        filingById.get(t.filingId)?.kind,
        workflowById.get(t.workflowId)?.name,
        documentById.get(t.documentId)?.title,
        commitmentById.get(t.commitmentId)?.title,
        t.eventId,
      ].filter(Boolean).join(" ");
      return t.title.toLowerCase().includes(ql) ||
        (t.assignee ?? "").toLowerCase().includes(ql) ||
        responsibleNames.toLowerCase().includes(ql) ||
        linkedText.toLowerCase().includes(ql) ||
        (t.tags ?? []).join(" ").toLowerCase().includes(ql);
    });
  }, [tasks, q, filterCommittee, filterGoal, filterLink, userById, goalById, filingById, workflowById, documentById, commitmentById]);

  const openNew = useCallback(() => {
    setForm({
      title: "",
      status: "Todo",
      priority: "Medium",
      assignee: "",
      dueDate: "",
      tags: [],
      committeeId: filterCommittee || undefined,
      goalId: filterGoal || undefined,
      responsibleUserId: "",
      filingId: "",
      workflowId: "",
      documentId: "",
      commitmentId: "",
      eventId: "",
      completionNote: "",
    });
    setOpen(true);
  }, [filterCommittee, filterGoal]);

  useEffect(() => {
    setFilterGoal(requestedGoalId);
  }, [requestedGoalId]);

  useEffect(() => {
    if (!openNewFromUrl || open || society === undefined || society === null) return;
    openNew();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("new");
      return next;
    }, { replace: true });
  }, [openNewFromUrl, open, openNew, setSearchParams, society]);

  const changeGoalFilter = (goalId: string) => {
    setFilterGoal(goalId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (goalId) next.set("goalId", goalId);
      else next.delete("goalId");
      next.delete("new");
      return next;
    }, { replace: true });
  };

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openEdit = (task: any) => {
    setForm({
      ...task,
      responsibleUserId: task.responsibleUserIds?.[0] ?? "",
      dueDate: task.dueDate ?? "",
      filingId: task.filingId ?? "",
      workflowId: task.workflowId ?? "",
      documentId: task.documentId ?? "",
      commitmentId: task.commitmentId ?? "",
      eventId: task.eventId ?? "",
      completionNote: task.completionNote ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (form._id) {
      await update({
        id: form._id,
        patch: cleanPatch({
          title: form.title,
          description: form.description || undefined,
          status: form.status,
          priority: form.priority,
          assignee: form.assignee || undefined,
          responsibleUserIds: form.responsibleUserId ? [form.responsibleUserId] : [],
          dueDate: form.dueDate || undefined,
          committeeId: form.committeeId || undefined,
          goalId: form.goalId || undefined,
          filingId: form.filingId || undefined,
          workflowId: form.workflowId || undefined,
          documentId: form.documentId || undefined,
          commitmentId: form.commitmentId || undefined,
          eventId: form.eventId || undefined,
          completionNote: form.completionNote || undefined,
          completedByUserId: form.status === "Done" && currentUserId ? currentUserId : undefined,
        }),
      });
      setOpen(false);
      toast.success("Task updated", form.title);
      return;
    }
    await create({
      societyId: society._id,
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      assignee: form.assignee,
      responsibleUserIds: form.responsibleUserId ? [form.responsibleUserId] : undefined,
      dueDate: form.dueDate || undefined,
      committeeId: form.committeeId || undefined,
      goalId: form.goalId || undefined,
      filingId: form.filingId || undefined,
      workflowId: form.workflowId || undefined,
      documentId: form.documentId || undefined,
      commitmentId: form.commitmentId || undefined,
      eventId: form.eventId || undefined,
      tags: form.tags ?? [],
    });
    setOpen(false);
    toast.success("Task created", form.title);
  };

  const confirmDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: "Delete task?",
      message: `"${title}" will be permanently removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await remove({ id: id as any });
    toast.success("Task deleted");
  };

  const closeCardMenu = () => setCardMenu(null);

  // Dismiss the card context menu on outside click or Escape — same pattern
  // as the sidebar nav context menu.
  useEffect(() => {
    if (!cardMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (cardMenuRef.current?.contains(event.target as Node)) return;
      closeCardMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCardMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [cardMenu]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const visibleSelectedCount = filtered.reduce(
    (count: number, task: any) => count + (selectedIds.has(task._id) ? 1 : 0),
    0,
  );
  const allVisibleSelected = filtered.length > 0 && visibleSelectedCount === filtered.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const task of filtered) next.delete(task._id);
      } else {
        for (const task of filtered) next.add(task._id);
      }
      return next;
    });
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const titles = (tasks ?? [])
      .filter((task: any) => selectedIds.has(task._id))
      .map((task: any) => task.title);
    const previewTitles = titles.slice(0, 5);
    const overflow = titles.length - previewTitles.length;
    const message = (
      <>
        <p style={{ margin: "0 0 8px" }}>
          This permanently removes the selected task{ids.length === 1 ? "" : "s"}. This action cannot be undone.
        </p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {previewTitles.map((title: string, index: number) => (
            <li key={index}>{title}</li>
          ))}
        </ul>
        {overflow > 0 && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "var(--fs-sm)" }}>
            …and {overflow} more
          </p>
        )}
      </>
    );
    const ok = await confirm({
      title: `Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`,
      message,
      confirmLabel: `Delete ${ids.length}`,
      tone: "danger",
    });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      // Sequential — Convex mutations run on the server one at a time per
      // call anyway, and serialising keeps optimistic state consistent if a
      // single delete fails partway through.
      let failures = 0;
      for (const id of ids) {
        try {
          await remove({ id: id as any });
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
      clearSelection();
    } finally {
      setBulkDeleting(false);
    }
  };

  const columns = COLS.map((col) => ({
    id: col.id,
    label: col.label,
    accent: col.accent,
    items: filtered.filter((t: any) => t.status === col.id),
  }));

  return (
    <div className="page">
      <PageHeader
        title="Tasks"
        icon={<ListTodo size={16} />}
        iconColor="turquoise"
        subtitle="Kanban for everything in flight — linked to committees, goals, and meetings."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              items={[
                { id: "kanban", label: "Kanban" },
                { id: "list", label: "List" },
              ]}
            />
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New task
            </button>
          </>
        }
      />

      <div className="row" style={{ marginBottom: 16, gap: 8 }}>
        <div className="table-toolbar__search" style={{ maxWidth: 280 }}>
          <Search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…" />
        </div>
        <Select
          value={filterCommittee}
          onChange={setFilterCommittee}
          clearable
          clearLabel="All committees"
          placeholder="All committees"
          style={{ width: 200, maxWidth: "100%" }}
          options={(committees ?? []).map((c: any) => ({ value: c._id, label: c.name }))}
        />
        <Select
          value={filterGoal}
          onChange={changeGoalFilter}
          clearable
          clearLabel="All goals"
          placeholder="All goals"
          style={{ width: 220, maxWidth: "100%" }}
          options={(goals ?? []).map((g: any) => ({ value: g._id, label: g.title }))}
        />
        <Select
          value={filterLink}
          onChange={setFilterLink}
          clearable
          clearLabel="All links"
          placeholder="All links"
          style={{ width: 180, maxWidth: "100%" }}
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
        <div className="muted" style={{ marginLeft: "auto", fontSize: "var(--fs-sm)" }}>
          {filtered.length} of {tasks?.length ?? 0}
        </div>
      </div>

      {view === "kanban" ? (
        <Kanban
          columns={columns}
          onItemClick={(t: any) => openEdit(t)}
          onItemContextMenu={(t: any, event) => {
            // Position the menu at the click coordinates, clamped so it never
            // renders off the viewport edge — quick eyeball clamp, the menu is
            // ~180px wide and ~120px tall.
            const x = Math.min(event.clientX, window.innerWidth - 200);
            const y = Math.min(event.clientY, window.innerHeight - 140);
            setCardMenu({ task: t, top: y, left: x });
          }}
          onMove={(id, status) => update({
            id: id as any,
            patch: {
              status,
              completedByUserId: status === "Done" && currentUserId ? currentUserId : undefined,
            },
          })}
          renderCard={(t: any) => {
            const committee = committeeById.get(t.committeeId);
            const goal = goalById.get(t.goalId);
            const responsible = userNames(t.responsibleUserIds, userById) || t.assignee;
            const overdue = t.dueDate && new Date(t.dueDate).getTime() < Date.now() && t.status !== "Done";
            return (
              <>
                <div className="kanban__card-title">{t.title}</div>
                {t.description && <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 4 }}>{t.description}</div>}
                <div className="kanban__card-meta">
                  <span className={`priority-dot priority-${t.priority}`} />
                  <span>{t.priority}</span>
                  {responsible && <span>· {responsible}</span>}
                  {committee && (
                    <>
                      <span>·</span>
                      <span className="row" style={{ gap: 4 }}>
                        <span className="color-chip" style={{ background: committee.color }} />
                        {committee.name}
                      </span>
                    </>
                  )}
                  {goal && <span>· {goal.title}</span>}
                  {(t.filingId || t.workflowId || t.documentId || t.commitmentId || t.eventId) && <span>· linked</span>}
                  {t.dueDate && (
                    <span style={{ color: overdue ? "var(--danger)" : undefined, marginLeft: "auto" }}>
                      {formatDate(t.dueDate)}
                    </span>
                  )}
                </div>
              </>
            );
          }}
        />
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div
              className="row"
              style={{
                marginBottom: 12,
                padding: "8px 12px",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                gap: 12,
                alignItems: "center",
              }}
              role="region"
              aria-label="Bulk actions"
            >
              <strong>{selectedIds.size} selected</strong>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={clearSelection}
                disabled={bulkDeleting}
                title="Clear selection"
              >
                <X size={12} /> Clear
              </button>
              <div style={{ marginLeft: "auto" }}>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={bulkDelete}
                  disabled={bulkDeleting}
                >
                  <Trash2 size={12} /> {bulkDeleting ? "Deleting…" : `Delete ${selectedIds.size}`}
                </button>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <Checkbox
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      label=""
                      bare
                    />
                  </th>
                  <th />
                  <th>Title</th>
                  <th>Committee</th>
                  <th>Responsible</th>
                  <th>Links</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t: any) => {
                  const committee = committeeById.get(t.committeeId);
                  const goal = goalById.get(t.goalId);
                  const responsible = userNames(t.responsibleUserIds, userById) || t.assignee;
                  return (
                    <tr key={t._id} className={selectedIds.has(t._id) ? "is-selected" : undefined}>
                      <td onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(t._id)}
                          onChange={() => toggleSelected(t._id)}
                          label=""
                          bare
                        />
                      </td>
                      <td><span className={`priority-dot priority-${t.priority}`} /></td>
                      <td><strong>{t.title}</strong>{t.description && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{t.description}</div>}</td>
                    <td>
                      {committee ? (
                        <Link to={`/app/committees/${committee._id}`} className="row" style={{ gap: 6 }}>
                          <span className="color-chip" style={{ background: committee.color }} />
                          {committee.name}
                        </Link>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>{responsible || "—"}</td>
                    <td>
                      <LinkedTaskRecords
                        task={t}
                        goal={goal}
                        filingById={filingById}
                        workflowById={workflowById}
                        documentById={documentById}
                        commitmentById={commitmentById}
                      />
                    </td>
                    <td className="table__cell--mono">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                    <td>
                      <Select
                        size="sm"
                        value={t.status}
                        onChange={(v) => update({
                          id: t._id,
                          patch: {
                            status: v,
                            completedByUserId: v === "Done" && currentUserId ? currentUserId : undefined,
                          },
                        })}
                        style={{ width: 120, maxWidth: "100%" }}
                        options={COLS.map((c) => ({ value: c.id, label: c.label }))}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn--ghost btn--sm" onClick={() => openEdit(t)}>Edit</button>
                        <button className="btn btn--ghost btn--sm" onClick={() => confirmDelete(t._id, t.title)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
                {filtered.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>No tasks.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cardMenu && createPortal(
        <div
          ref={cardMenuRef}
          className="menu menu--actions"
          role="menu"
          style={{ position: "fixed", top: cardMenu.top, left: cardMenu.left, width: 180, zIndex: 1000 }}
        >
          <div className="menu__section">
            <MenuRow
              role="menuitem"
              icon={<Pencil size={14} />}
              label="Edit task"
              onClick={() => {
                const task = cardMenu.task;
                closeCardMenu();
                openEdit(task);
              }}
            />
            <div className="menu__separator" />
            <MenuRow
              role="menuitem"
              icon={<Trash2 size={14} />}
              label="Delete task"
              destructive
              onClick={() => {
                const { _id, title } = cardMenu.task;
                closeCardMenu();
                void confirmDelete(_id, title);
              }}
            />
          </div>
        </div>,
        document.body,
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
                  const ok = await confirm({
                    title: "Delete task?",
                    message: `"${form.title}" will be permanently removed.`,
                    confirmLabel: "Delete",
                    tone: "danger",
                  });
                  if (!ok) return;
                  await remove({ id: form._id as any });
                  toast.success("Task deleted");
                  setOpen(false);
                }}
              >
                Delete
              </button>
            )}
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>{form?._id ? "Save" : "Create"}</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={(v) => setForm({ ...form, status: v })}
                  options={STATUSES.map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Priority">
                <Select
                  value={form.priority}
                  onChange={(v) => setForm({ ...form, priority: v })}
                  options={["Low", "Medium", "High", "Urgent"].map((p) => ({ value: p, label: p }))}
                />
              </Field>
              <Field label="Due">
                <DatePicker value={form.dueDate ?? ""} onChange={(v) => setForm({ ...form, dueDate: v })} />
              </Field>
            </div>
            <Field label="Assignee"><input className="input" value={form.assignee ?? ""} onChange={(e) => setForm({ ...form, assignee: e.target.value })} /></Field>
            <Field label="Responsible user">
              <Select
                value={form.responsibleUserId ?? ""}
                onChange={(v) => setForm({ ...form, responsibleUserId: v || "" })}
                clearable
                searchable
                options={(users ?? []).map((u: any) => ({ value: u._id, label: u.displayName }))}
              />
            </Field>
            <Field label="Committee (optional)">
              <Select
                value={form.committeeId ?? ""}
                onChange={(v) => setForm({ ...form, committeeId: v || undefined })}
                clearable
                searchable
                options={(committees ?? []).map((c: any) => ({ value: c._id, label: c.name }))}
              />
            </Field>
            <Field label="Goal (optional)">
              <Select
                value={form.goalId ?? ""}
                onChange={(v) => setForm({ ...form, goalId: v || undefined })}
                clearable
                searchable
                options={(goals ?? []).map((g: any) => ({ value: g._id, label: g.title }))}
              />
            </Field>
            <Field label="Filing (optional)">
              <Select
                value={form.filingId ?? ""}
                onChange={(v) => setForm({ ...form, filingId: v || "" })}
                clearable
                searchable
                options={(filings ?? []).map((f: any) => ({ value: f._id, label: `${f.kind}${f.periodLabel ? ` - ${f.periodLabel}` : ""}` }))}
              />
            </Field>
            <Field label="Workflow (optional)">
              <Select
                value={form.workflowId ?? ""}
                onChange={(v) => setForm({ ...form, workflowId: v || "" })}
                clearable
                searchable
                options={(workflows ?? []).map((w: any) => ({ value: w._id, label: w.name }))}
              />
            </Field>
            <Field label="Document (optional)">
              <Select
                value={form.documentId ?? ""}
                onChange={(v) => setForm({ ...form, documentId: v || "" })}
                clearable
                searchable
                options={(documents ?? []).map((d: any) => ({ value: d._id, label: d.title }))}
              />
            </Field>
            <Field label="Commitment (optional)">
              <Select
                value={form.commitmentId ?? ""}
                onChange={(v) => setForm({ ...form, commitmentId: v || "" })}
                clearable
                searchable
                options={(commitments ?? []).map((c: any) => ({ value: c._id, label: c.title, hint: c.nextDueDate ? `Due ${formatDate(c.nextDueDate)}` : c.status }))}
              />
            </Field>
            <Field label="Event ID (optional)"><input className="input mono" value={form.eventId ?? ""} onChange={(e) => setForm({ ...form, eventId: e.target.value })} placeholder="custom.event or imported event id" /></Field>
            <Field label="Completion note">
              <textarea
                className="textarea"
                value={form.completionNote ?? ""}
                onChange={(e) => setForm({ ...form, completionNote: e.target.value })}
                placeholder="Evidence captured, filed confirmation, or blocker resolution."
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function userNames(ids: string[] | undefined, userById: Map<string, any>) {
  return (ids ?? []).map((id) => userById.get(id)?.displayName).filter(Boolean).join(", ");
}

function matchesLinkFilter(task: any, filter: string) {
  if (filter === "linked") return Boolean(task.goalId || task.filingId || task.workflowId || task.documentId || task.commitmentId || task.eventId);
  if (filter === "goal") return Boolean(task.goalId);
  if (filter === "filing") return Boolean(task.filingId);
  if (filter === "workflow") return Boolean(task.workflowId);
  if (filter === "document") return Boolean(task.documentId);
  if (filter === "commitment") return Boolean(task.commitmentId);
  if (filter === "event") return Boolean(task.eventId);
  return true;
}

function cleanPatch<T extends Record<string, any>>(source: T) {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as T;
}

function LinkedTaskRecords({
  task,
  goal,
  filingById,
  workflowById,
  documentById,
  commitmentById,
}: {
  task: any;
  goal?: any;
  filingById: Map<string, any>;
  workflowById: Map<string, any>;
  documentById: Map<string, any>;
  commitmentById: Map<string, any>;
}) {
  const filing = task.filingId ? filingById.get(task.filingId) : null;
  const workflow = task.workflowId ? workflowById.get(task.workflowId) : null;
  const document = task.documentId ? documentById.get(task.documentId) : null;
  const commitment = task.commitmentId ? commitmentById.get(task.commitmentId) : null;
  if (!goal && !filing && !workflow && !document && !commitment && !task.eventId) return <span className="muted">—</span>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {goal && <Link to={`/app/goals/${goal._id}`}><Badge tone="info">{goal.title}</Badge></Link>}
      {filing && <Link to="/app/filings"><Badge tone="orange">{filing.kind}</Badge></Link>}
      {workflow && <Link to={`/app/workflows/${workflow._id}`}><Badge tone="purple">{workflow.name}</Badge></Link>}
      {document && <Link to="/app/documents"><Badge>{document.title}</Badge></Link>}
      {commitment && <Link to="/app/commitments"><Badge tone="green">{commitment.title}</Badge></Link>}
      {task.eventId && <Badge tone="gray">{task.eventId}</Badge>}
    </div>
  );
}

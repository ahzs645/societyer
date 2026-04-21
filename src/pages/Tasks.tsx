import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Drawer, Field, Badge } from "../components/ui";
import { Segmented } from "../components/primitives";
import { Kanban } from "../components/Kanban";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Plus, Search, ListTodo } from "lucide-react";
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
  const create = useMutation(api.tasks.create);
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const currentUserId = useCurrentUserId();
  const confirm = useConfirm();
  const toast = useToast();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [q, setQ] = useState("");
  const [filterCommittee, setFilterCommittee] = useState<string>("");
  const [filterLink, setFilterLink] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  const committeeById = useMemo(() => new Map<string, any>((committees ?? []).map((c: any) => [c._id, c])), [committees]);
  const userById = useMemo(() => new Map<string, any>((users ?? []).map((u: any) => [u._id, u])), [users]);
  const filingById = useMemo(() => new Map<string, any>((filings ?? []).map((f: any) => [f._id, f])), [filings]);
  const workflowById = useMemo(() => new Map<string, any>((workflows ?? []).map((w: any) => [w._id, w])), [workflows]);
  const documentById = useMemo(() => new Map<string, any>((documents ?? []).map((d: any) => [d._id, d])), [documents]);

  const filtered = useMemo(() => {
    const base = tasks ?? [];
    const ql = q.toLowerCase();
    return base.filter((t: any) => {
      if (filterCommittee && t.committeeId !== filterCommittee) return false;
      if (filterLink && !matchesLinkFilter(t, filterLink)) return false;
      if (!ql) return true;
      const responsibleNames = (t.responsibleUserIds ?? []).map((id: string) => userById.get(id)?.displayName).filter(Boolean).join(" ");
      const linkedText = [
        filingById.get(t.filingId)?.kind,
        workflowById.get(t.workflowId)?.name,
        documentById.get(t.documentId)?.title,
        t.eventId,
      ].filter(Boolean).join(" ");
      return t.title.toLowerCase().includes(ql) ||
        (t.assignee ?? "").toLowerCase().includes(ql) ||
        responsibleNames.toLowerCase().includes(ql) ||
        linkedText.toLowerCase().includes(ql) ||
        t.tags.join(" ").toLowerCase().includes(ql);
    });
  }, [tasks, q, filterCommittee, filterLink, userById, filingById, workflowById, documentById]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      title: "",
      status: "Todo",
      priority: "Medium",
      assignee: "",
      dueDate: "",
      tags: [],
      committeeId: filterCommittee || undefined,
      responsibleUserId: "",
      filingId: "",
      workflowId: "",
      documentId: "",
      eventId: "",
      completionNote: "",
    });
    setOpen(true);
  };
  const save = async () => {
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
          value={filterLink}
          onChange={setFilterLink}
          clearable
          clearLabel="All links"
          placeholder="All links"
          style={{ width: 180, maxWidth: "100%" }}
          options={[
            { value: "linked", label: "Any linked record" },
            { value: "filing", label: "Filing linked" },
            { value: "workflow", label: "Workflow linked" },
            { value: "document", label: "Document linked" },
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
          onMove={(id, status) => update({
            id: id as any,
            patch: {
              status,
              completedByUserId: status === "Done" && currentUserId ? currentUserId : undefined,
            },
          })}
          renderCard={(t: any) => {
            const committee = committeeById.get(t.committeeId);
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
                  {(t.filingId || t.workflowId || t.documentId || t.eventId) && <span>· linked</span>}
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
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
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
                const responsible = userNames(t.responsibleUserIds, userById) || t.assignee;
                return (
                  <tr key={t._id}>
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
                        filingById={filingById}
                        workflowById={workflowById}
                        documentById={documentById}
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
                    <td><button className="btn btn--ghost btn--sm" onClick={() => confirmDelete(t._id, t.title)}>Delete</button></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>No tasks.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New task"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Create</button>
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
            <Field label="Event ID (optional)"><input className="input mono" value={form.eventId ?? ""} onChange={(e) => setForm({ ...form, eventId: e.target.value })} placeholder="custom.event or imported event id" /></Field>
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
  if (filter === "linked") return Boolean(task.filingId || task.workflowId || task.documentId || task.eventId);
  if (filter === "filing") return Boolean(task.filingId);
  if (filter === "workflow") return Boolean(task.workflowId);
  if (filter === "document") return Boolean(task.documentId);
  if (filter === "event") return Boolean(task.eventId);
  return true;
}

function LinkedTaskRecords({
  task,
  filingById,
  workflowById,
  documentById,
}: {
  task: any;
  filingById: Map<string, any>;
  workflowById: Map<string, any>;
  documentById: Map<string, any>;
}) {
  const filing = task.filingId ? filingById.get(task.filingId) : null;
  const workflow = task.workflowId ? workflowById.get(task.workflowId) : null;
  const document = task.documentId ? documentById.get(task.documentId) : null;
  if (!filing && !workflow && !document && !task.eventId) return <span className="muted">—</span>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {filing && <Link to="/app/filings"><Badge tone="orange">{filing.kind}</Badge></Link>}
      {workflow && <Link to={`/app/workflows/${workflow._id}`}><Badge tone="purple">{workflow.name}</Badge></Link>}
      {document && <Link to="/app/documents"><Badge>{document.title}</Badge></Link>}
      {task.eventId && <Badge tone="gray">{task.eventId}</Badge>}
    </div>
  );
}

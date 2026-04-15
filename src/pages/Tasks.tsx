import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
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
  const create = useMutation(api.tasks.create);
  const update = useMutation(api.tasks.update);
  const remove = useMutation(api.tasks.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [q, setQ] = useState("");
  const [filterCommittee, setFilterCommittee] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  const committeeById = useMemo(() => new Map<string, any>((committees ?? []).map((c: any) => [c._id, c])), [committees]);

  const filtered = useMemo(() => {
    const base = tasks ?? [];
    const ql = q.toLowerCase();
    return base.filter((t: any) => {
      if (filterCommittee && t.committeeId !== filterCommittee) return false;
      if (!ql) return true;
      return t.title.toLowerCase().includes(ql) || (t.assignee ?? "").toLowerCase().includes(ql) || t.tags.join(" ").toLowerCase().includes(ql);
    });
  }, [tasks, q, filterCommittee]);

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
      dueDate: form.dueDate || undefined,
      committeeId: form.committeeId || undefined,
      goalId: form.goalId || undefined,
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
          style={{ width: 200 }}
          options={(committees ?? []).map((c: any) => ({ value: c._id, label: c.name }))}
        />
        <div className="muted" style={{ marginLeft: "auto", fontSize: "var(--fs-sm)" }}>
          {filtered.length} of {tasks?.length ?? 0}
        </div>
      </div>

      {view === "kanban" ? (
        <Kanban
          columns={columns}
          onMove={(id, status) => update({ id: id as any, patch: { status } })}
          renderCard={(t: any) => {
            const committee = committeeById.get(t.committeeId);
            const overdue = t.dueDate && new Date(t.dueDate).getTime() < Date.now() && t.status !== "Done";
            return (
              <>
                <div className="kanban__card-title">{t.title}</div>
                {t.description && <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 4 }}>{t.description}</div>}
                <div className="kanban__card-meta">
                  <span className={`priority-dot priority-${t.priority}`} />
                  <span>{t.priority}</span>
                  {t.assignee && <span>· {t.assignee}</span>}
                  {committee && (
                    <>
                      <span>·</span>
                      <span className="row" style={{ gap: 4 }}>
                        <span className="color-chip" style={{ background: committee.color }} />
                        {committee.name}
                      </span>
                    </>
                  )}
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
                <th>Assignee</th>
                <th>Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t: any) => {
                const committee = committeeById.get(t.committeeId);
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
                    <td>{t.assignee ?? "—"}</td>
                    <td className="table__cell--mono">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                    <td>
                      <Select
                        size="sm"
                        value={t.status}
                        onChange={(v) => update({ id: t._id, patch: { status: v } })}
                        style={{ width: 120 }}
                        options={STATUSES.map((s) => ({ value: s, label: s }))}
                      />
                    </td>
                    <td><button className="btn btn--ghost btn--sm" onClick={() => confirmDelete(t._id, t.title)}>Delete</button></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No tasks.</td></tr>}
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
          </div>
        )}
      </Drawer>
    </div>
  );
}

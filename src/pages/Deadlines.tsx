import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { CalendarView } from "../components/CalendarView";
import { Segmented } from "../components/primitives";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Checkbox } from "../components/Controls";
import { Plus, Trash2, Calendar, Tag, CheckCircle2 } from "lucide-react";
import { formatDate, relative } from "../lib/format";
import { patchInList } from "../lib/optimistic";

const DEADLINE_FIELDS: FilterField<any>[] = [
  { id: "title", label: "Title", icon: <Tag size={14} />, match: (d, q) => d.title.toLowerCase().includes(q.toLowerCase()) },
  { id: "category", label: "Category", icon: <Tag size={14} />, options: ["Governance", "Tax", "Payroll", "Privacy", "Other"], match: (d, q) => d.category === q },
  { id: "recurrence", label: "Recurrence", icon: <Tag size={14} />, options: ["None", "Monthly", "Quarterly", "Annual"], match: (d, q) => (d.recurrence ?? "None") === q },
  { id: "done", label: "Status", icon: <CheckCircle2 size={14} />, options: ["Open", "Done"], match: (d, q) => (d.done ? "Done" : "Open") === q },
  { id: "overdue", label: "Overdue", icon: <Calendar size={14} />, options: ["Yes", "No"], match: (d, q) => {
    const isOver = !d.done && new Date(d.dueDate).getTime() < Date.now();
    return q === (isOver ? "Yes" : "No");
  } },
];

export function DeadlinesPage() {
  const society = useSociety();
  const items = useQuery(api.deadlines.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.deadlines.create);
  const toggle = useMutation(api.deadlines.toggleDone).withOptimisticUpdate(
    (store, args) => {
      patchInList(store, api.deadlines.list, String(args.id), { done: args.done });
    },
  );
  const remove = useMutation(api.deadlines.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [view, setView] = useState<"list" | "calendar">("list");

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ title: "", dueDate: new Date().toISOString().slice(0, 10), category: "Governance", recurrence: "None" });
    setOpen(true);
  };
  const save = async () => { await create({ societyId: society._id, ...form }); setOpen(false); };

  const now = Date.now();

  return (
    <div className="page">
      <PageHeader
        title="Deadlines"
        icon={<Calendar size={16} />}
        iconColor="yellow"
        subtitle="Rolling calendar of compliance obligations — governance, tax, payroll, privacy."
        actions={
          <>
            <Segmented<"list" | "calendar">
              value={view}
              onChange={setView}
              items={[
                { id: "list", label: "List" },
                { id: "calendar", label: "Calendar" },
              ]}
            />
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New deadline
            </button>
          </>
        }
      />

      {view === "calendar" && (
        <CalendarView
          items={(items ?? []) as any[]}
          getId={(r) => r._id}
          getLabel={(r) => r.title}
          getDate={(r) => r.dueDate}
          getTone={(r) => {
            if (r.done) return "success";
            const overdue = new Date(r.dueDate).getTime() < now;
            return overdue ? "danger" : "info";
          }}
        />
      )}

      {view === "list" && (
      <DataTable
        label="All deadlines"
        icon={<Calendar size={14} />}
        data={(items ?? []) as any[]}
        loading={items === undefined}
        rowKey={(r) => r._id}
        filterFields={DEADLINE_FIELDS}
        searchPlaceholder="Search deadlines…"
        defaultSort={{ columnId: "dueDate", dir: "asc" }}
        columns={[
          {
            id: "done", header: "", width: 36,
            render: (r) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={!!r.done}
                  onChange={() => toggle({ id: r._id, done: !r.done })}
                  bare
                />
              </span>
            ),
          },
          {
            id: "title", header: "Task", sortable: true,
            accessor: (r) => r.title,
            render: (r) => (
              <div>
                <strong style={{ textDecoration: r.done ? "line-through" : "none", color: r.done ? "var(--text-tertiary)" : undefined }}>
                  {r.title}
                </strong>
                {r.description && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{r.description}</div>}
              </div>
            ),
          },
          {
            id: "category", header: "Category", sortable: true,
            accessor: (r) => r.category,
            render: (r) => <Badge tone={catTone(r.category)}>{r.category}</Badge>,
          },
          {
            id: "dueDate", header: "Due", sortable: true,
            accessor: (r) => r.dueDate,
            render: (r) => <span className="mono">{formatDate(r.dueDate)}</span>,
          },
          {
            id: "when", header: "When",
            render: (r) => {
              if (r.done) return <Badge tone="success">Done</Badge>;
              const overdue = new Date(r.dueDate).getTime() < now;
              return <Badge tone={overdue ? "danger" : "info"}>{relative(r.dueDate)}</Badge>;
            },
          },
          {
            id: "recurrence", header: "Recurrence", sortable: true,
            accessor: (r) => r.recurrence ?? "None",
            render: (r) => <span className="muted">{r.recurrence ?? "None"}</span>,
          },
        ]}
        renderRowActions={(r) => (
          <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete deadline ${r.title}`} onClick={() => remove({ id: r._id })}>
            <Trash2 size={12} />
          </button>
        )}
      />
      )}

      <Drawer
        open={open} onClose={() => setOpen(false)} title="Add deadline"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Category">
                <Select
                  value={form.category}
                  onChange={(v) => setForm({ ...form, category: v })}
                  options={["Governance", "Tax", "Payroll", "Privacy", "Other"].map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Due date">
                <DatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
              </Field>
              <Field label="Recurrence">
                <Select
                  value={form.recurrence}
                  onChange={(v) => setForm({ ...form, recurrence: v })}
                  options={["None", "Monthly", "Quarterly", "Annual"].map((r) => ({ value: r, label: r }))}
                />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function catTone(cat: string) {
  return cat === "Tax" ? "warn" : cat === "Privacy" ? "info" : cat === "Payroll" ? "accent" : "neutral";
}

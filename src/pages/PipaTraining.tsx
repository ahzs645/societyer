import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, ShieldCheck, Trash2, Tag } from "lucide-react";
import { formatDate } from "../lib/format";

const FIELDS: FilterField<any>[] = [
  { id: "role", label: "Role", icon: <Tag size={14} />, options: ["Director", "Staff", "Volunteer"], match: (r, q) => r.role === q },
  { id: "topic", label: "Topic", icon: <Tag size={14} />, options: ["PIPA", "CASL", "Privacy-refresh"], match: (r, q) => r.topic === q },
];

export function PipaTrainingPage() {
  const society = useSociety();
  const items = useQuery(api.pipaTraining.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.pipaTraining.create);
  const remove = useMutation(api.pipaTraining.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      participantName: "",
      role: "Staff",
      topic: "PIPA",
      completedAtISO: new Date().toISOString().slice(0, 10),
      nextDueAtISO: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
    });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="PIPA training"
        icon={<ShieldCheck size={16} />}
        iconColor="green"
        subtitle="PIPA + CASL training records for directors, staff, and volunteers. Annual renewal recommended."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> Log training
          </button>
        }
      />

      <DataTable
        label="All training records"
        icon={<ShieldCheck size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search participant, topic…"
        defaultSort={{ columnId: "completedAtISO", dir: "desc" }}
        columns={[
          { id: "participantName", header: "Participant", sortable: true, accessor: (r) => r.participantName, render: (r) => <strong>{r.participantName}</strong> },
          { id: "role", header: "Role", sortable: true, accessor: (r) => r.role, render: (r) => <Badge>{r.role}</Badge> },
          { id: "topic", header: "Topic", sortable: true, accessor: (r) => r.topic, render: (r) => <span className="cell-tag">{r.topic}</span> },
          { id: "completedAtISO", header: "Completed", sortable: true, accessor: (r) => r.completedAtISO, render: (r) => <span className="mono">{formatDate(r.completedAtISO)}</span> },
          {
            id: "nextDueAtISO", header: "Next due", sortable: true, accessor: (r) => r.nextDueAtISO ?? "",
            render: (r) => {
              if (!r.nextDueAtISO) return <span className="muted">—</span>;
              const days = Math.floor((new Date(r.nextDueAtISO).getTime() - Date.now()) / 86_400_000);
              return <><span className="mono">{formatDate(r.nextDueAtISO)}</span> <Badge tone={days < 0 ? "danger" : days <= 30 ? "warn" : "info"}>{days < 0 ? `${-days}d overdue` : `in ${days}d`}</Badge></>;
            },
          },
          { id: "trainer", header: "Trainer", accessor: (r) => r.trainer ?? "", render: (r) => <span className="muted">{r.trainer ?? "—"}</span> },
        ]}
        renderRowActions={(r) => (
          <button className="btn btn--ghost btn--sm btn--icon" onClick={() => remove({ id: r._id })}>
            <Trash2 size={12} />
          </button>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Log training"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Participant"><input className="input" value={form.participantName} onChange={(e) => setForm({ ...form, participantName: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={form.participantEmail ?? ""} onChange={(e) => setForm({ ...form, participantEmail: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Role">
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option>Director</option><option>Staff</option><option>Volunteer</option>
                </select>
              </Field>
              <Field label="Topic">
                <select className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
                  <option>PIPA</option><option>CASL</option><option>Privacy-refresh</option>
                </select>
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Completed"><input className="input" type="date" value={form.completedAtISO} onChange={(e) => setForm({ ...form, completedAtISO: e.target.value })} /></Field>
              <Field label="Next due"><input className="input" type="date" value={form.nextDueAtISO ?? ""} onChange={(e) => setForm({ ...form, nextDueAtISO: e.target.value })} /></Field>
            </div>
            <Field label="Trainer"><input className="input" value={form.trainer ?? ""} onChange={(e) => setForm({ ...form, trainer: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

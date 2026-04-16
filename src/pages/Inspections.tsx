import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, Eye, Trash2, Tag } from "lucide-react";
import { formatDate, money } from "../lib/format";

const FIELDS: FilterField<any>[] = [
  { id: "inspector", label: "Inspector", icon: <Tag size={14} />, match: (r, q) => r.inspectorName.toLowerCase().includes(q.toLowerCase()) },
  { id: "memberStatus", label: "Inspector type", options: ["Member", "Public"], match: (r, q) => (r.isMember ? "Member" : "Public") === q },
  { id: "method", label: "Delivery", options: ["in-person", "electronic"], match: (r, q) => r.deliveryMethod === q },
];

export function InspectionsPage() {
  const society = useSociety();
  const items = useQuery(api.inspections.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.inspections.create);
  const remove = useMutation(api.inspections.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      inspectorName: "",
      isMember: false,
      recordsRequested: "",
      inspectedAtISO: new Date().toISOString().slice(0, 10),
      deliveryMethod: "in-person",
      feeCents: 0,
      copyPages: 0,
      copyFeeCents: 0,
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
        title="Records inspections"
        icon={<Eye size={16} />}
        iconColor="gray"
        subtitle="Log of who inspected official records and what fees were charged (s.24 — public may pay up to $10/day inspection + $0.50/page copies, $0.10 electronic)."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> Log inspection
          </button>
        }
      />

      <DataTable
        label="All inspections"
        icon={<Eye size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search inspector, records…"
        defaultSort={{ columnId: "inspectedAtISO", dir: "desc" }}
        columns={[
          { id: "inspectedAtISO", header: "Date", sortable: true, accessor: (r) => r.inspectedAtISO, render: (r) => <span className="mono">{formatDate(r.inspectedAtISO)}</span> },
          { id: "inspectorName", header: "Inspector", sortable: true, accessor: (r) => r.inspectorName, render: (r) => <strong>{r.inspectorName}</strong> },
          { id: "isMember", header: "Type", sortable: true, accessor: (r) => (r.isMember ? 1 : 0), render: (r) => r.isMember ? <Badge tone="info">Member</Badge> : <Badge>Public</Badge> },
          { id: "records", header: "Records requested", accessor: (r) => r.recordsRequested, render: (r) => <span className="muted">{r.recordsRequested}</span> },
          { id: "method", header: "Delivery", sortable: true, accessor: (r) => r.deliveryMethod, render: (r) => <span className="cell-tag">{r.deliveryMethod}</span> },
          { id: "fee", header: "Inspection fee", sortable: true, align: "right", accessor: (r) => r.feeCents ?? 0, render: (r) => <span className="mono">{money(r.feeCents)}</span> },
          { id: "copies", header: "Copies", align: "right", render: (r) => r.copyPages ? <span className="mono">{r.copyPages} pg · {money(r.copyFeeCents)}</span> : <span className="muted">—</span> },
        ]}
        renderRowActions={(r) => (
          <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete inspection by ${r.inspectorName}`} onClick={() => remove({ id: r._id })}>
            <Trash2 size={12} />
          </button>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Log records inspection"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Save</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Inspector name">
              <input className="input" value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })} />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.isMember} onChange={(e) => setForm({ ...form, isMember: e.target.checked })} /> Member of the society (no fee)
            </label>
            <Field label="Records requested" hint="e.g. members register (excluded from public), bylaws, 2025 AGM minutes">
              <textarea className="textarea" value={form.recordsRequested} onChange={(e) => setForm({ ...form, recordsRequested: e.target.value })} />
            </Field>
            <Field label="Related document (optional)">
              <select className="input" value={form.documentId ?? ""} onChange={(e) => setForm({ ...form, documentId: e.target.value || undefined })}>
                <option value="">— none —</option>
                {(documents ?? []).map((d: any) => <option key={d._id} value={d._id}>{d.title}</option>)}
              </select>
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Date"><input className="input" type="date" value={form.inspectedAtISO} onChange={(e) => setForm({ ...form, inspectedAtISO: e.target.value })} /></Field>
              <Field label="Delivery">
                <select className="input" value={form.deliveryMethod} onChange={(e) => setForm({ ...form, deliveryMethod: e.target.value })}>
                  <option value="in-person">In-person</option>
                  <option value="electronic">Electronic</option>
                </select>
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Inspection fee (cents)">
                <input className="input" type="number" value={form.feeCents} onChange={(e) => setForm({ ...form, feeCents: Number(e.target.value) })} />
              </Field>
              <Field label="Copies (pages)">
                <input className="input" type="number" value={form.copyPages} onChange={(e) => setForm({ ...form, copyPages: Number(e.target.value) })} />
              </Field>
              <Field label="Copy fee (cents)">
                <input className="input" type="number" value={form.copyFeeCents} onChange={(e) => setForm({ ...form, copyFeeCents: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

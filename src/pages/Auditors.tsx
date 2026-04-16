import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, Calculator, Trash2, Tag } from "lucide-react";
import { formatDate } from "../lib/format";

const FIELDS: FilterField<any>[] = [
  { id: "engagementType", label: "Engagement", icon: <Tag size={14} />, options: ["Audit", "ReviewEngagement", "CompilationEngagement"], match: (r, q) => r.engagementType === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Active", "Completed", "Resigned", "Replaced"], match: (r, q) => r.status === q },
  { id: "appointedBy", label: "Appointed by", icon: <Tag size={14} />, options: ["Directors", "Members"], match: (r, q) => r.appointedBy === q },
];

export function AuditorsPage() {
  const society = useSociety();
  const items = useQuery(api.auditors.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.auditors.create);
  const remove = useMutation(api.auditors.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      firmName: "",
      engagementType: "ReviewEngagement",
      fiscalYear: new Date().getFullYear().toString(),
      appointedBy: "Directors",
      appointedAtISO: new Date().toISOString().slice(0, 10),
      independenceAttested: true,
      status: "Active",
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
        title="Auditor appointments"
        icon={<Calculator size={16} />}
        iconColor="green"
        subtitle="First auditor appointed by directors; subsequent appointments made by members at the AGM. Only independent CPAs or CPA firms may serve as auditors."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New appointment
          </button>
        }
      />

      <DataTable
        label="All appointments"
        icon={<Calculator size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search firm, fiscal year…"
        defaultSort={{ columnId: "appointedAtISO", dir: "desc" }}
        columns={[
          { id: "firmName", header: "Firm", sortable: true, accessor: (r) => r.firmName, render: (r) => <strong>{r.firmName}</strong> },
          { id: "engagementType", header: "Engagement", sortable: true, accessor: (r) => r.engagementType, render: (r) => <Badge tone={r.engagementType === "Audit" ? "success" : "info"}>{r.engagementType}</Badge> },
          { id: "fiscalYear", header: "FY", sortable: true, accessor: (r) => r.fiscalYear, render: (r) => <span className="mono">{r.fiscalYear}</span> },
          { id: "appointedBy", header: "Appointed by", sortable: true, accessor: (r) => r.appointedBy, render: (r) => <span className="cell-tag">{r.appointedBy}</span> },
          { id: "appointedAtISO", header: "Date", sortable: true, accessor: (r) => r.appointedAtISO, render: (r) => <span className="mono">{formatDate(r.appointedAtISO)}</span> },
          { id: "independenceAttested", header: "Independent", sortable: true, accessor: (r) => (r.independenceAttested ? 1 : 0), render: (r) => r.independenceAttested ? <Badge tone="success">Yes</Badge> : <Badge tone="danger">No</Badge> },
          { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, render: (r) => <Badge tone={r.status === "Active" ? "success" : "warn"}>{r.status}</Badge> },
        ]}
        renderRowActions={(r) => (
          <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete auditor ${r.firmName}`} onClick={() => remove({ id: r._id })}>
            <Trash2 size={12} />
          </button>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New auditor appointment"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Firm name"><input className="input" value={form.firmName} onChange={(e) => setForm({ ...form, firmName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Engagement">
                <select className="input" value={form.engagementType} onChange={(e) => setForm({ ...form, engagementType: e.target.value })}>
                  <option>Audit</option><option>ReviewEngagement</option><option>CompilationEngagement</option>
                </select>
              </Field>
              <Field label="Fiscal year"><input className="input" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })} /></Field>
              <Field label="Appointed by">
                <select className="input" value={form.appointedBy} onChange={(e) => setForm({ ...form, appointedBy: e.target.value })}>
                  <option>Directors</option><option>Members</option>
                </select>
              </Field>
            </div>
            <Field label="Appointed on"><input className="input" type="date" value={form.appointedAtISO} onChange={(e) => setForm({ ...form, appointedAtISO: e.target.value })} /></Field>
            <Field label="Engagement letter">
              <select className="input" value={form.engagementLetterDocId ?? ""} onChange={(e) => setForm({ ...form, engagementLetterDocId: e.target.value || undefined })}>
                <option value="">— none —</option>
                {(documents ?? []).map((d: any) => <option key={d._id} value={d._id}>{d.title}</option>)}
              </select>
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={form.independenceAttested} onChange={(e) => setForm({ ...form, independenceAttested: e.target.checked })} /> Firm has confirmed independence from the society
            </label>
          </div>
        )}
      </Drawer>
    </div>
  );
}

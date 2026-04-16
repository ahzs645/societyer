import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, Gavel, Trash2, Tag } from "lucide-react";
import { formatDate } from "../lib/format";

const FIELDS: FilterField<any>[] = [
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Active", "Satisfied", "Vacated"], match: (r, q) => r.status === q },
];

export function CourtOrdersPage() {
  const society = useSociety();
  const items = useQuery(api.courtOrders.list, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.courtOrders.create);
  const remove = useMutation(api.courtOrders.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      title: "",
      orderDate: new Date().toISOString().slice(0, 10),
      court: "Supreme Court of British Columbia",
      description: "",
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
        title="Court orders"
        icon={<Gavel size={16} />}
        iconColor="red"
        subtitle="Court orders affecting the society — required to be kept with governance records under s.20."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> Record order
          </button>
        }
      />

      <DataTable
        label="All court orders"
        icon={<Gavel size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search orders…"
        defaultSort={{ columnId: "orderDate", dir: "desc" }}
        columns={[
          { id: "title", header: "Title", sortable: true, accessor: (r) => r.title, render: (r) => <strong>{r.title}</strong> },
          { id: "court", header: "Court", sortable: true, accessor: (r) => r.court },
          { id: "fileNumber", header: "File #", accessor: (r) => r.fileNumber ?? "", render: (r) => <span className="mono">{r.fileNumber ?? "—"}</span> },
          { id: "orderDate", header: "Date", sortable: true, accessor: (r) => r.orderDate, render: (r) => <span className="mono">{formatDate(r.orderDate)}</span> },
          { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, render: (r) => <Badge tone={r.status === "Active" ? "warn" : "neutral"}>{r.status}</Badge> },
        ]}
        renderRowActions={(r) => (
          <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete court order ${r.title}`} onClick={() => remove({ id: r._id })}>
            <Trash2 size={12} />
          </button>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Record court order"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Court"><input className="input" value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} /></Field>
              <Field label="File #"><input className="input" value={form.fileNumber ?? ""} onChange={(e) => setForm({ ...form, fileNumber: e.target.value })} /></Field>
              <Field label="Order date"><input className="input" type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} /></Field>
            </div>
            <Field label="Description"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Document (optional)">
              <select className="input" value={form.documentId ?? ""} onChange={(e) => setForm({ ...form, documentId: e.target.value || undefined })}>
                <option value="">— none —</option>
                {(documents ?? []).map((d: any) => <option key={d._id} value={d._id}>{d.title}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option>Active</option><option>Satisfied</option><option>Vacated</option>
              </select>
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

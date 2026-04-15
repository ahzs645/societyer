import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, UserCheck, Trash2, Tag } from "lucide-react";
import { formatDate } from "../lib/format";

const FIELDS: FilterField<any>[] = [
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Active", "Revoked"], match: (r, q) => (r.revokedAtISO ? "Revoked" : "Active") === q },
];

export function ProxiesPage() {
  const society = useSociety();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const proxies = useQuery(api.proxies.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.proxies.create);
  const revoke = useMutation(api.proxies.revoke);
  const remove = useMutation(api.proxies.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const meetingById = new Map<string, any>((meetings ?? []).map((m: any) => [m._id, m]));

  const openNew = () => {
    setForm({
      meetingId: meetings?.[0]?._id,
      grantorName: "",
      proxyHolderName: "",
      signedAtISO: new Date().toISOString().slice(0, 10),
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
        title="Proxies & ballots"
        icon={<UserCheck size={16} />}
        iconColor="purple"
        subtitle="Proxy appointments for general meetings (if bylaws permit). Each grantor may appoint one holder per meeting."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New proxy
          </button>
        }
      />

      <DataTable
        label="All proxies"
        icon={<UserCheck size={14} />}
        data={(proxies ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search grantor, holder…"
        defaultSort={{ columnId: "signedAtISO", dir: "desc" }}
        columns={[
          { id: "meeting", header: "Meeting", sortable: true, accessor: (r) => meetingById.get(r.meetingId)?.title ?? "", render: (r) => <span>{meetingById.get(r.meetingId)?.title ?? "—"}</span> },
          { id: "grantorName", header: "Grantor", sortable: true, accessor: (r) => r.grantorName, render: (r) => <strong>{r.grantorName}</strong> },
          { id: "proxyHolderName", header: "Proxy holder", sortable: true, accessor: (r) => r.proxyHolderName },
          { id: "signedAtISO", header: "Signed", sortable: true, accessor: (r) => r.signedAtISO, render: (r) => <span className="mono">{formatDate(r.signedAtISO)}</span> },
          { id: "status", header: "Status", sortable: true, accessor: (r) => (r.revokedAtISO ? "Revoked" : "Active"), render: (r) => r.revokedAtISO ? <Badge tone="danger">Revoked {formatDate(r.revokedAtISO)}</Badge> : <Badge tone="success">Active</Badge> },
          { id: "instructions", header: "Instructions", accessor: (r) => r.instructions ?? "", render: (r) => <span className="muted">{r.instructions ?? "—"}</span> },
        ]}
        renderRowActions={(r) => (
          <>
            {!r.revokedAtISO && <button className="btn btn--ghost btn--sm" onClick={() => revoke({ id: r._id })}>Revoke</button>}
            <button className="btn btn--ghost btn--sm btn--icon" onClick={() => remove({ id: r._id })}><Trash2 size={12} /></button>
          </>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New proxy"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Meeting">
              <select className="input" value={form.meetingId ?? ""} onChange={(e) => setForm({ ...form, meetingId: e.target.value })}>
                {(meetings ?? []).map((m: any) => <option key={m._id} value={m._id}>{m.title}</option>)}
              </select>
            </Field>
            <Field label="Grantor (voting member)"><input className="input" value={form.grantorName} onChange={(e) => setForm({ ...form, grantorName: e.target.value })} /></Field>
            <Field label="Proxy holder"><input className="input" value={form.proxyHolderName} onChange={(e) => setForm({ ...form, proxyHolderName: e.target.value })} /></Field>
            <Field label="Instructions (optional)"><textarea className="textarea" value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
            <Field label="Signed on"><input className="input" type="date" value={form.signedAtISO} onChange={(e) => setForm({ ...form, signedAtISO: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

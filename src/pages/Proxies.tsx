import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, InspectorNote } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, UserCheck, Trash2, Tag } from "lucide-react";
import { formatDate } from "../lib/format";
import { useBylawRules } from "../hooks/useBylawRules";

const FIELDS: FilterField<any>[] = [
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Active", "Revoked"], match: (r, q) => (r.revokedAtISO ? "Revoked" : "Active") === q },
];

export function ProxiesPage() {
  const society = useSociety();
  const { rules } = useBylawRules();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
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
        subtitle={`Proxy appointments for general meetings. Active rule set: ${rules?.allowProxyVoting ? "proxies allowed" : "proxies disabled"}, ${rules?.proxyLimitPerGrantorPerMeeting ?? 1} holder(s) per grantor per meeting.`}
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!rules?.allowProxyVoting}>
            <Plus size={12} /> New proxy
          </button>
        }
      />

      {rules && !rules.allowProxyVoting && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body">
            The active bylaw rule set disables proxy voting. Existing proxy records remain
            visible for history, but new appointments are blocked.
          </div>
        </div>
      )}

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
            <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete proxy for ${r.memberName ?? "member"}`} onClick={() => remove({ id: r._id })}><Trash2 size={12} /></button>
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
            <InspectorNote tone="warn" title="Proxy rules come from your bylaws">
              Confirm the meeting, holder eligibility, and appointment limits before saving. This
              record should match the signed proxy form kept with meeting materials.
            </InspectorNote>
            <Field label="Meeting">
              <select className="input" value={form.meetingId ?? ""} onChange={(e) => setForm({ ...form, meetingId: e.target.value })}>
                {(meetings ?? []).map((m: any) => <option key={m._id} value={m._id}>{m.title}</option>)}
              </select>
            </Field>
            <Field label="Grantor member (optional)">
              <select
                className="input"
                value={form.grantorMemberId ?? ""}
                onChange={(e) => {
                  const member = (members ?? []).find((row: any) => row._id === e.target.value);
                  setForm({
                    ...form,
                    grantorMemberId: e.target.value || undefined,
                    grantorName: member ? `${member.firstName} ${member.lastName}` : form.grantorName,
                  });
                }}
              >
                <option value="">— none —</option>
                {(members ?? []).map((member: any) => (
                  <option key={member._id} value={member._id}>
                    {member.firstName} {member.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grantor (voting member)"><input className="input" value={form.grantorName} onChange={(e) => setForm({ ...form, grantorName: e.target.value })} /></Field>
            <Field label={`Proxy holder${rules?.proxyHolderMustBeMember ? " member" : " member (optional)"}`}>
              <select
                className="input"
                value={form.proxyHolderMemberId ?? ""}
                onChange={(e) => {
                  const member = (members ?? []).find((row: any) => row._id === e.target.value);
                  setForm({
                    ...form,
                    proxyHolderMemberId: e.target.value || undefined,
                    proxyHolderName: member ? `${member.firstName} ${member.lastName}` : form.proxyHolderName,
                  });
                }}
              >
                <option value="">— none —</option>
                {(members ?? []).map((member: any) => (
                  <option key={member._id} value={member._id}>
                    {member.firstName} {member.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Proxy holder"><input className="input" value={form.proxyHolderName} onChange={(e) => setForm({ ...form, proxyHolderName: e.target.value })} /></Field>
            <Field label="Instructions (optional)"><textarea className="textarea" value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
            <Field label="Signed on"><input className="input" type="date" value={form.signedAtISO} onChange={(e) => setForm({ ...form, signedAtISO: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, Vote, Trash2, Tag } from "lucide-react";
import { formatDate } from "../lib/format";

const FIELDS: FilterField<any>[] = [
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Submitted", "MeetsThreshold", "Rejected", "Included"], match: (r, q) => r.status === q },
  { id: "included", label: "In agenda", options: ["Yes", "No"], match: (r, q) => (r.includedInAgenda ? "Yes" : "No") === q },
];

export function MemberProposalsPage() {
  const society = useSociety();
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const items = useQuery(api.memberProposals.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.memberProposals.create);
  const update = useMutation(api.memberProposals.update);
  const remove = useMutation(api.memberProposals.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const eligibleVoters = (members ?? []).filter((m: any) => m.status === "Active" && m.votingRights).length;

  const openNew = () => {
    setForm({
      title: "",
      text: "",
      submittedByName: "",
      submittedAtISO: new Date().toISOString().slice(0, 10),
      signatureCount: 1,
      thresholdPercent: 5,
      eligibleVotersAtSubmission: eligibleVoters,
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
        title="Member proposals"
        icon={<Vote size={16} />}
        iconColor="purple"
        subtitle={`Proposals from members — need signatures of at least 5% of voting members (or lower if bylaws permit) and must be received ≥ 7 days before the AGM notice is sent. Current voting members: ${eligibleVoters}.`}
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New proposal
          </button>
        }
      />

      <DataTable
        label="All proposals"
        icon={<Vote size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search proposals…"
        defaultSort={{ columnId: "submittedAtISO", dir: "desc" }}
        columns={[
          { id: "title", header: "Title", sortable: true, accessor: (r) => r.title, render: (r) => <strong>{r.title}</strong> },
          { id: "submittedByName", header: "Submitted by", sortable: true, accessor: (r) => r.submittedByName },
          { id: "submittedAtISO", header: "Date", sortable: true, accessor: (r) => r.submittedAtISO, render: (r) => <span className="mono">{formatDate(r.submittedAtISO)}</span> },
          {
            id: "signatures", header: "Signatures", sortable: true, accessor: (r) => r.signatureCount,
            render: (r) => {
              const req = Math.max(1, Math.ceil((r.eligibleVotersAtSubmission ?? 0) * (r.thresholdPercent / 100)));
              return <span><strong>{r.signatureCount}</strong><span className="muted"> / {req} req ({r.thresholdPercent}%)</span></span>;
            },
          },
          { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, render: (r) => <Badge tone={r.status === "MeetsThreshold" || r.status === "Included" ? "success" : r.status === "Rejected" ? "danger" : "warn"}>{r.status}</Badge> },
          { id: "includedInAgenda", header: "Agenda", render: (r) => r.includedInAgenda ? <Badge tone="success">Yes</Badge> : <Badge>No</Badge> },
        ]}
        renderRowActions={(r) => (
          <>
            {!r.includedInAgenda && r.status === "MeetsThreshold" && (
              <button className="btn btn--ghost btn--sm" onClick={() => update({ id: r._id, patch: { includedInAgenda: true, status: "Included" } })}>Include</button>
            )}
            {r.status !== "Rejected" && (
              <button className="btn btn--ghost btn--sm" onClick={() => update({ id: r._id, patch: { status: "Rejected" } })}>Reject</button>
            )}
            <button className="btn btn--ghost btn--sm btn--icon" onClick={() => remove({ id: r._id })}><Trash2 size={12} /></button>
          </>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New member proposal"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Proposal text"><textarea className="textarea" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
            <Field label="Submitted by"><input className="input" value={form.submittedByName} onChange={(e) => setForm({ ...form, submittedByName: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Submitted on"><input className="input" type="date" value={form.submittedAtISO} onChange={(e) => setForm({ ...form, submittedAtISO: e.target.value })} /></Field>
              <Field label="Signature count"><input className="input" type="number" value={form.signatureCount} onChange={(e) => setForm({ ...form, signatureCount: Number(e.target.value) })} /></Field>
              <Field label="Threshold %"><input className="input" type="number" value={form.thresholdPercent} onChange={(e) => setForm({ ...form, thresholdPercent: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Eligible voters at submission"><input className="input" type="number" value={form.eligibleVotersAtSubmission ?? eligibleVoters} onChange={(e) => setForm({ ...form, eligibleVotersAtSubmission: Number(e.target.value) })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

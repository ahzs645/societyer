import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Progress } from "../components/primitives";
import { Plus, PenLine, Trash2, Tag } from "lucide-react";
import { formatDate } from "../lib/format";
import { usePrompt } from "../components/Modal";
import { useToast } from "../components/Toast";
import { Select } from "../components/Select";

const FIELDS: FilterField<any>[] = [
  { id: "kind", label: "Kind", icon: <Tag size={14} />, options: ["Ordinary", "Special"], match: (r, q) => r.kind === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Circulating", "Carried", "Failed", "Draft"], match: (r, q) => r.status === q },
];

export function WrittenResolutionsPage() {
  const society = useSociety();
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const items = useQuery(api.writtenResolutions.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.writtenResolutions.create);
  const sign = useMutation(api.writtenResolutions.sign);
  const markFailed = useMutation(api.writtenResolutions.markFailed);
  const remove = useMutation(api.writtenResolutions.remove);
  const prompt = usePrompt();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const eligibleVoters = (members ?? []).filter((m: any) => m.status === "Active" && m.votingRights).length;

  const openNew = () => {
    setForm({
      title: "",
      text: "",
      kind: "Special",
      requiredCount: eligibleVoters,
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
        title="Written resolutions"
        icon={<PenLine size={16} />}
        iconColor="purple"
        subtitle="Members' resolutions in lieu of a meeting — ordinary resolutions need majority consent in writing; special resolutions need unanimous written consent from all voting members."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New resolution
          </button>
        }
      />

      <DataTable
        label="All written resolutions"
        icon={<PenLine size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search resolutions…"
        defaultSort={{ columnId: "circulatedAtISO", dir: "desc" }}
        columns={[
          { id: "title", header: "Title", sortable: true, accessor: (r) => r.title, render: (r) => <strong>{r.title}</strong> },
          { id: "kind", header: "Kind", sortable: true, accessor: (r) => r.kind, render: (r) => <Badge tone={r.kind === "Special" ? "warn" : "neutral"}>{r.kind}</Badge> },
          { id: "circulatedAtISO", header: "Circulated", sortable: true, accessor: (r) => r.circulatedAtISO, render: (r) => <span className="mono">{formatDate(r.circulatedAtISO)}</span> },
          {
            id: "signatures", header: "Signatures", sortable: true, accessor: (r) => r.signatures.length,
            render: (r) => (
              <div style={{ minWidth: 140 }}>
                <Progress value={Math.min(100, (r.signatures.length / Math.max(1, r.requiredCount)) * 100)} tone={r.signatures.length >= r.requiredCount ? "success" : undefined} />
                <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>{r.signatures.length} / {r.requiredCount}</div>
              </div>
            ),
          },
          { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, render: (r) => <Badge tone={r.status === "Carried" ? "success" : r.status === "Failed" ? "danger" : "warn"}>{r.status}</Badge> },
        ]}
        renderRowActions={(r) => (
          <>
            {r.status === "Circulating" && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  const name = await prompt({
                    title: "Sign resolution",
                    message: "Enter the name of the signer as it will appear on the record.",
                    placeholder: "Full name",
                    confirmLabel: "Sign",
                    required: true,
                  });
                  if (!name) return;
                  await sign({ id: r._id, signerName: name });
                  toast.success(`Signed by ${name}`);
                }}
              >
                <PenLine size={12} /> Sign
              </button>
            )}
            {r.status === "Circulating" && (
              <button className="btn btn--ghost btn--sm" onClick={() => markFailed({ id: r._id })}>Mark failed</button>
            )}
            <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete written resolution ${r.title}`} onClick={() => remove({ id: r._id })}><Trash2 size={12} /></button>
          </>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New written resolution"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Circulate</button></>}
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Resolution text"><textarea className="textarea" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Kind">
                <Select value={form.kind} onChange={value => {
  const k = value;
  setForm({
    ...form,
    kind: k,
    requiredCount: k === "Special" ? eligibleVoters : Math.ceil(eligibleVoters / 2)
  });
}} options={[{
  value: "Ordinary",
  label: "Ordinary (majority)"
}, {
  value: "Special",
  label: "Special (unanimous, in lieu of meeting)"
}]} className="input" />
              </Field>
              <Field label="Required signatures" hint={`Eligible voting members: ${eligibleVoters}`}>
                <input className="input" type="number" value={form.requiredCount} onChange={(e) => setForm({ ...form, requiredCount: Number(e.target.value) })} />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

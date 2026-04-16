import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Plus, Shield, Trash2, Tag } from "lucide-react";
import { dollarInputToCents, formatDate, money } from "../lib/format";

const KINDS = ["DirectorsOfficers", "GeneralLiability", "PropertyCasualty", "CyberLiability", "Other"];
const FIELDS: FilterField<any>[] = [
  { id: "kind", label: "Kind", icon: <Tag size={14} />, options: KINDS, match: (r, q) => r.kind === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Active", "Lapsed", "Cancelled"], match: (r, q) => r.status === q },
  { id: "renewal", label: "Renewal within 60 days", options: ["Yes", "No"], match: (r, q) => {
    const days = (new Date(r.renewalDate).getTime() - Date.now()) / 86_400_000;
    return q === "Yes" ? days <= 60 && days >= 0 : !(days <= 60 && days >= 0);
  } },
];

export function InsurancePage() {
  const society = useSociety();
  const items = useQuery(api.insurance.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.insurance.create);
  const remove = useMutation(api.insurance.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({
      kind: "DirectorsOfficers",
      insurer: "",
      policyNumber: "",
      coverageDollars: "500000.00",
      premiumDollars: "",
      startDate: new Date().toISOString().slice(0, 10),
      renewalDate: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
      status: "Active",
    });
    setOpen(true);
  };
  const save = async () => {
    const { coverageDollars, premiumDollars, ...rest } = form;
    await create({
      societyId: society._id,
      ...rest,
      coverageCents: dollarInputToCents(coverageDollars) ?? 0,
      premiumCents: dollarInputToCents(premiumDollars),
    });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Insurance"
        icon={<Shield size={16} />}
        iconColor="green"
        subtitle="Directors' & Officers' liability, general liability, and other policies. Many funders require proof of coverage."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New policy
          </button>
        }
      />

      <DataTable
        label="All policies"
        icon={<Shield size={14} />}
        data={(items ?? []) as any[]}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search insurer, policy #…"
        defaultSort={{ columnId: "renewalDate", dir: "asc" }}
        columns={[
          { id: "kind", header: "Kind", sortable: true, accessor: (r) => r.kind, render: (r) => <span className="cell-tag">{r.kind}</span> },
          { id: "insurer", header: "Insurer", sortable: true, accessor: (r) => r.insurer, render: (r) => <strong>{r.insurer}</strong> },
          { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, render: (r) => <span className="mono">{r.policyNumber}</span> },
          { id: "coverage", header: "Coverage", sortable: true, align: "right", accessor: (r) => r.coverageCents, render: (r) => <span className="mono">{money(r.coverageCents)}</span> },
          { id: "premium", header: "Premium", align: "right", accessor: (r) => r.premiumCents ?? 0, render: (r) => <span className="mono">{money(r.premiumCents)}</span> },
          {
            id: "renewalDate", header: "Renewal", sortable: true, accessor: (r) => r.renewalDate,
            render: (r) => {
              const days = Math.floor((new Date(r.renewalDate).getTime() - Date.now()) / 86_400_000);
              const tone: any = days < 0 ? "danger" : days <= 30 ? "warn" : days <= 60 ? "info" : "neutral";
              return <><span className="mono">{formatDate(r.renewalDate)}</span> <Badge tone={tone}>{days < 0 ? `${-days}d late` : `in ${days}d`}</Badge></>;
            },
          },
          { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, render: (r) => <Badge tone={r.status === "Active" ? "success" : "warn"}>{r.status}</Badge> },
        ]}
        renderRowActions={(r) => (
          <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete insurance policy ${r.policyNumber ?? r.provider}`} onClick={() => remove({ id: r._id })}>
            <Trash2 size={12} />
          </button>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New policy"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <Field label="Kind">
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Insurer"><input className="input" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} /></Field>
            <Field label="Policy number"><input className="input" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Coverage" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.coverageDollars} onChange={(e) => setForm({ ...form, coverageDollars: e.target.value })} /></Field>
              <Field label="Premium" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.premiumDollars ?? ""} onChange={(e) => setForm({ ...form, premiumDollars: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start"><input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="Renewal"><input className="input" type="date" value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

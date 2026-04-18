import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { FileSearch, Pencil, Plus, Shield, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { centsToDollarInput, dollarInputToCents, formatDate, money } from "../lib/format";

const KINDS = ["DirectorsOfficers", "GeneralLiability", "PropertyCasualty", "CyberLiability", "Other"];
const STATUSES = ["NeedsReview", "Active", "Lapsed", "Cancelled"];

const FIELDS: FilterField<any>[] = [
  { id: "kind", label: "Kind", icon: <Tag size={14} />, options: KINDS, match: (r, q) => r.kind === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: STATUSES, match: (r, q) => r.status === q },
  { id: "risk", label: "Risk flags", icon: <ShieldAlert size={14} />, options: ["restricted", "needs review", "cleanup"], match: (r, q) => riskFlagsForPolicy(r).includes(q) },
  { id: "renewal", label: "Renewal within 60 days", options: ["Yes", "No"], match: (r, q) => {
    const days = daysUntil(r.renewalDate);
    const dueSoon = days != null && days <= 60 && days >= 0;
    return q === "Yes" ? dueSoon : !dueSoon;
  } },
];

export function InsurancePage() {
  const society = useSociety();
  const items = useQuery(api.insurance.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.insurance.create);
  const update = useMutation(api.insurance.update);
  const remove = useMutation(api.insurance.remove);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(null);

  const rows = (items ?? []) as any[];
  const summary = useMemo(() => summarizePolicies(rows), [rows]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setEditingId(null);
    setForm({
      kind: "DirectorsOfficers",
      insurer: "",
      broker: "",
      policyNumber: "",
      coverageDollars: "",
      premiumDollars: "",
      deductibleDollars: "",
      coverageSummary: "",
      additionalInsuredsInput: "",
      startDate: todayDate(),
      endDate: oneYearFromToday(),
      renewalDate: oneYearFromToday(),
      status: "Active",
      sourceExternalIdsInput: "",
      confidence: "",
      sensitivity: "",
      riskFlagsInput: "",
      notes: "",
    });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditingId(row._id);
    setForm({
      kind: row.kind ?? "Other",
      insurer: row.insurer ?? "",
      broker: row.broker ?? "",
      policyNumber: row.policyNumber ?? "",
      coverageDollars: centsToDollarInput(row.coverageCents),
      premiumDollars: centsToDollarInput(row.premiumCents),
      deductibleDollars: centsToDollarInput(row.deductibleCents),
      coverageSummary: row.coverageSummary ?? "",
      additionalInsuredsInput: (row.additionalInsureds ?? []).join(", "),
      startDate: dateInput(row.startDate) || todayDate(),
      endDate: dateInput(row.endDate),
      renewalDate: dateInput(row.renewalDate) || dateInput(row.endDate) || todayDate(),
      status: row.status ?? "Active",
      sourceExternalIdsInput: (row.sourceExternalIds ?? []).join(", "),
      confidence: row.confidence ?? "",
      sensitivity: row.sensitivity ?? "",
      riskFlagsInput: riskFlagsForPolicy(row).join(", "),
      notes: row.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    const payload = normalizePolicyDraft(form);
    if (editingId) {
      await update({ id: editingId as any, patch: payload });
    } else {
      await create({ societyId: society._id, ...payload });
    }
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Insurance"
        icon={<Shield size={16} />}
        iconColor="green"
        subtitle="Policy records, renewal dates, source references, and restricted import flags."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn-action" to="/app/imports"><FileSearch size={12} /> Review imports</Link>
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New policy
            </button>
          </div>
        }
      />

      <div className="stat-grid">
        <Stat label="Policies" value={summary.total} sub="records in register" />
        <Stat label="Active" value={summary.active} sub="currently marked active" />
        <Stat label="Renewal due" value={summary.renewalDue} sub="within 60 days or late" tone={summary.renewalDue > 0 ? "warn" : undefined} />
        <Stat label="Restricted" value={summary.restricted} sub="restricted-risk flagged" tone={summary.restricted > 0 ? "danger" : undefined} />
      </div>

      <DataTable
        label="Insurance policies"
        icon={<Shield size={14} />}
        data={rows}
        rowKey={(r) => r._id}
        filterFields={FIELDS}
        searchPlaceholder="Search insurer, policy #, source ID..."
        searchExtraFields={[
          (r) => r.broker,
          (r) => r.coverageSummary,
          (r) => r.notes,
          (r) => (r.sourceExternalIds ?? []).join(" "),
          (r) => riskFlagsForPolicy(r).join(" "),
        ]}
        defaultSort={{ columnId: "renewalDate", dir: "asc" }}
        emptyMessage="No insurance policies yet."
        onRowClick={openEdit}
        rowActionLabel={(r) => `Edit insurance policy ${r.policyNumber ?? r.insurer}`}
        columns={[
          { id: "kind", header: "Kind", sortable: true, accessor: (r) => r.kind, render: (r) => <span className="cell-tag">{kindLabel(r.kind)}</span> },
          {
            id: "insurer",
            header: "Insurer",
            sortable: true,
            accessor: (r) => r.insurer,
            render: (r) => <PolicyCell row={r} />,
          },
          { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, render: (r) => <span className="mono">{r.policyNumber}</span> },
          { id: "coverage", header: "Coverage", sortable: true, align: "right", accessor: (r) => r.coverageCents, render: (r) => <span className="mono">{money(r.coverageCents)}</span> },
          { id: "premium", header: "Premium", sortable: true, align: "right", accessor: (r) => r.premiumCents, render: (r) => <span className="mono">{money(r.premiumCents)}</span> },
          { id: "period", header: "Coverage dates", accessor: (r) => `${r.startDate ?? ""} ${r.endDate ?? ""}`, render: (r) => <span className="mono">{formatDate(r.startDate)} to {formatDate(r.endDate)}</span> },
          {
            id: "renewalDate", header: "Renewal", sortable: true, accessor: (r) => r.renewalDate,
            render: (r) => <RenewalCell date={r.renewalDate} />,
          },
        ]}
        renderRowActions={(r) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => openEdit(r)}>
              <Pencil size={12} /> Edit
            </button>
            <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete insurance policy ${r.policyNumber ?? r.insurer}`} onClick={() => remove({ id: r._id })}>
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit policy" : "New policy"}
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Save</button></>}
      >
        {form && (
          <div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Kind">
                <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Insurer"><input className="input" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} /></Field>
            <Field label="Broker"><input className="input" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} /></Field>
            <Field label="Policy number"><input className="input" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Coverage" hint="Dollars, only when explicit"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.coverageDollars} onChange={(e) => setForm({ ...form, coverageDollars: e.target.value })} /></Field>
              <Field label="Premium" hint="Dollars, only when explicit"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.premiumDollars ?? ""} onChange={(e) => setForm({ ...form, premiumDollars: e.target.value })} /></Field>
              <Field label="Deductible" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.deductibleDollars ?? ""} onChange={(e) => setForm({ ...form, deductibleDollars: e.target.value })} /></Field>
            </div>
            <Field label="Coverage summary"><textarea className="textarea" value={form.coverageSummary ?? ""} onChange={(e) => setForm({ ...form, coverageSummary: e.target.value })} /></Field>
            <Field label="Additional insureds" hint="Comma-separated"><input className="input" value={form.additionalInsuredsInput ?? ""} onChange={(e) => setForm({ ...form, additionalInsuredsInput: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start"><input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="End"><input className="input" type="date" value={form.endDate ?? ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
              <Field label="Renewal"><input className="input" type="date" value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} /></Field>
            </div>
            <Field label="Source external IDs" hint="Comma-separated Paperless or external IDs"><input className="input" value={form.sourceExternalIdsInput ?? ""} onChange={(e) => setForm({ ...form, sourceExternalIdsInput: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Sensitivity">
                <select className="input" value={form.sensitivity ?? ""} onChange={(e) => setForm({ ...form, sensitivity: e.target.value })}>
                  <option value="">Standard</option>
                  <option value="restricted">Restricted</option>
                </select>
              </Field>
              <Field label="Confidence">
                <select className="input" value={form.confidence ?? ""} onChange={(e) => setForm({ ...form, confidence: e.target.value })}>
                  <option value="">Unspecified</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Review</option>
                </select>
              </Field>
            </div>
            <Field label="Risk flags" hint="Comma-separated"><input className="input" value={form.riskFlagsInput ?? ""} onChange={(e) => setForm({ ...form, riskFlagsInput: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: "warn" | "danger" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={tone ? { color: tone === "danger" ? "var(--danger)" : "var(--warn)" } : undefined}>{value}</div>
      <div className="stat__sub">{sub}</div>
    </div>
  );
}

function PolicyCell({ row }: { row: any }) {
  const flags = riskFlagsForPolicy(row);
  return (
    <div>
      <strong>{row.insurer}</strong>
      <div className="row" style={{ gap: 6, marginTop: 2 }}>
        <Badge tone={statusTone(row.status)}>{row.status}</Badge>
        {flags.map((flag) => (
          <Badge key={flag} tone={flag === "restricted" ? "danger" : "warn"}>{flag}</Badge>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {row.broker || "Broker not set"}
        {row.sourceExternalIds?.length ? ` · ${row.sourceExternalIds.length} source${row.sourceExternalIds.length === 1 ? "" : "s"}` : ""}
      </div>
    </div>
  );
}

function RenewalCell({ date }: { date?: string }) {
  const days = daysUntil(date);
  if (days == null) return <span className="muted">—</span>;
  const tone: any = days < 0 ? "danger" : days <= 30 ? "warn" : days <= 60 ? "info" : "neutral";
  return (
    <>
      <span className="mono">{formatDate(date)}</span>{" "}
      <Badge tone={tone}>{days < 0 ? `${-days}d late` : `in ${days}d`}</Badge>
    </>
  );
}

function summarizePolicies(rows: any[]) {
  return rows.reduce(
    (summary, row) => {
      const days = daysUntil(row.renewalDate);
      summary.total += 1;
      if (row.status === "Active") summary.active += 1;
      if (days != null && days <= 60) summary.renewalDue += 1;
      if (riskFlagsForPolicy(row).includes("restricted")) summary.restricted += 1;
      return summary;
    },
    { total: 0, active: 0, renewalDue: 0, restricted: 0 },
  );
}

function normalizePolicyDraft(form: any) {
  const riskFlags = splitList(form.riskFlagsInput);
  if (form.sensitivity === "restricted" && !riskFlags.includes("restricted")) riskFlags.push("restricted");
  if (form.confidence === "Review" && !riskFlags.includes("needs review")) riskFlags.push("needs review");
  return {
    kind: form.kind || "Other",
    insurer: cleanOptional(form.insurer) || "Needs review",
    broker: cleanOptional(form.broker),
    policyNumber: cleanOptional(form.policyNumber) || "Needs review",
    coverageCents: dollarInputToCents(form.coverageDollars),
    premiumCents: dollarInputToCents(form.premiumDollars),
    deductibleCents: dollarInputToCents(form.deductibleDollars),
    coverageSummary: cleanOptional(form.coverageSummary),
    additionalInsureds: splitList(form.additionalInsuredsInput),
    startDate: dateInput(form.startDate) || todayDate(),
    endDate: dateInput(form.endDate),
    renewalDate: dateInput(form.renewalDate) || dateInput(form.endDate) || dateInput(form.startDate) || todayDate(),
    sourceExternalIds: splitList(form.sourceExternalIdsInput),
    confidence: cleanOptional(form.confidence),
    sensitivity: cleanOptional(form.sensitivity),
    riskFlags,
    notes: cleanOptional(form.notes),
    status: form.status || "Active",
  };
}

function riskFlagsForPolicy(row: any) {
  const flags = new Set<string>((row.riskFlags ?? []).map(String).filter(Boolean));
  if (row.sensitivity === "restricted") flags.add("restricted");
  if (row.confidence === "Review" || row.status === "NeedsReview") flags.add("needs review");
  return Array.from(flags);
}

function splitList(value: unknown) {
  return Array.from(new Set(String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean)));
}

function cleanOptional(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function dateInput(value?: string) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function oneYearFromToday() {
  return new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
}

function daysUntil(value?: string) {
  if (!value) return null;
  const date = new Date(value).getTime();
  if (!Number.isFinite(date)) return null;
  return Math.floor((date - Date.now()) / 86_400_000);
}

function kindLabel(kind: string) {
  return ({
    DirectorsOfficers: "D&O",
    GeneralLiability: "General liability",
    PropertyCasualty: "Property",
    CyberLiability: "Cyber",
    Other: "Other",
  } as Record<string, string>)[kind] ?? kind;
}

function statusTone(status: string): any {
  if (status === "Active") return "success";
  if (status === "Cancelled") return "danger";
  if (status === "NeedsReview") return "warn";
  return "neutral";
}

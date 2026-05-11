import { Link, useNavigate, useParams } from "react-router-dom";
import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { ArrowLeft, FileSearch, Pencil, Plus, Shield, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { centsToDollarInput, dollarInputToCents, formatDate, money } from "../lib/format";
import { CitationBadge } from "../components/CitationTooltip";
import { Select } from "../components/Select";

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
  const navigate = useNavigate();
  const items = useQuery(api.insurance.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.insurance.create);
  const update = useMutation(api.insurance.update);
  const remove = useMutation(api.insurance.remove);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<"view" | "edit" | "new">("view");
  const [form, setForm] = useState<any>(null);

  const rows = (items ?? []) as any[];
  const summary = useMemo(() => summarizePolicies(rows), [rows]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setEditingId(null);
    setDrawerMode("new");
    setForm({
      kind: "DirectorsOfficers",
      insurer: "",
      broker: "",
      policyNumber: "",
      policySeriesKey: "",
      policyTermLabel: "",
      versionType: "",
      renewalOfPolicyNumber: "",
      coverageDollars: "",
      premiumDollars: "",
      deductibleDollars: "",
      coverageSummary: "",
      additionalInsuredsInput: "",
      coveredPartiesInput: "",
      coverageItemsInput: "",
      coveredLocationsInput: "",
      policyDefinitionsInput: "",
      declinedCoveragesInput: "",
      certificatesInput: "",
      insuranceRequirementsInput: "",
      claimsMadeTermsInput: "",
      claimIncidentsInput: "",
      annualReviewsInput: "",
      complianceChecksInput: "",
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

  const formFromPolicy = (row: any) => ({
    kind: row.kind ?? "Other",
    insurer: row.insurer ?? "",
    broker: row.broker ?? "",
    policyNumber: row.policyNumber ?? "",
    policySeriesKey: row.policySeriesKey ?? "",
    policyTermLabel: row.policyTermLabel ?? "",
    versionType: row.versionType ?? "",
    renewalOfPolicyNumber: row.renewalOfPolicyNumber ?? "",
    coverageDollars: centsToDollarInput(row.coverageCents),
    premiumDollars: centsToDollarInput(row.premiumCents),
    deductibleDollars: centsToDollarInput(row.deductibleCents),
    coverageSummary: row.coverageSummary ?? "",
    additionalInsuredsInput: (row.additionalInsureds ?? []).join(", "),
    coveredPartiesInput: serializeCoveredParties(row.coveredParties),
    coverageItemsInput: serializeCoverageItems(row.coverageItems),
    coveredLocationsInput: serializeCoveredLocations(row.coveredLocations),
    policyDefinitionsInput: serializePolicyDefinitions(row.policyDefinitions),
    declinedCoveragesInput: serializeDeclinedCoverages(row.declinedCoverages),
    certificatesInput: serializeCertificates(row.certificatesOfInsurance),
    insuranceRequirementsInput: serializeInsuranceRequirements(row.insuranceRequirements),
    claimsMadeTermsInput: serializeClaimsMadeTerms(row.claimsMadeTerms),
    claimIncidentsInput: serializeClaimIncidents(row.claimIncidents),
    annualReviewsInput: serializeAnnualReviews(row.annualReviews),
    complianceChecksInput: serializeComplianceChecks(row.complianceChecks),
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

  const openEdit = (row: any) => {
    setEditingId(row._id);
    setDrawerMode("edit");
    setForm(formFromPolicy(row));
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
          (r) => searchableStructuredPolicyText(r),
          (r) => r.notes,
          (r) => (r.sourceExternalIds ?? []).join(" "),
          (r) => riskFlagsForPolicy(r).join(" "),
        ]}
        defaultSort={{ columnId: "renewalDate", dir: "asc" }}
        emptyMessage="No insurance policies yet."
        onRowClick={(row) => navigate(`/app/insurance/${row._id}`)}
        rowActionLabel={(r) => `Open insurance policy ${r.policyNumber ?? r.insurer}`}
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
        title={drawerMode === "new" ? "New policy" : drawerMode === "edit" ? "Edit policy" : policyDrawerTitle(form)}
        size="wide"
        footer={
          drawerMode === "view"
            ? (
              <>
                <button className="btn" onClick={() => setOpen(false)}>Close</button>
                <button className="btn btn--accent" onClick={() => setDrawerMode("edit")}>
                  <Pencil size={12} /> Edit policy
                </button>
              </>
            )
            : (
              <>
                <button className="btn" onClick={() => (editingId ? setDrawerMode("view") : setOpen(false))}>Cancel</button>
                <button className="btn btn--accent" onClick={save}>Save</button>
              </>
            )
        }
      >
        {form && (
          drawerMode === "view" ? (
            <PolicyStructuredDetails row={normalizePolicyDraft(form)} />
          ) : (
          <div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Kind">
                <Select value={form.kind} onChange={value => setForm({
  ...form,
  kind: value
})} options={[...KINDS.map(k => ({
  value: k,
  label: kindLabel(k)
}))]} className="input" />
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={value => setForm({
  ...form,
  status: value
})} options={[...STATUSES.map(status => ({
  value: status,
  label: status
}))]} className="input" />
              </Field>
            </div>
            <Field label="Insurer"><input className="input" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} /></Field>
            <Field label="Broker"><input className="input" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} /></Field>
            <Field label="Policy number"><input className="input" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Policy series key" hint="Groups renewals of the same policy line"><input className="input" value={form.policySeriesKey ?? ""} onChange={(e) => setForm({ ...form, policySeriesKey: e.target.value })} /></Field>
              <Field label="Policy term"><input className="input" value={form.policyTermLabel ?? ""} onChange={(e) => setForm({ ...form, policyTermLabel: e.target.value })} /></Field>
              <Field label="Version type"><input className="input" value={form.versionType ?? ""} onChange={(e) => setForm({ ...form, versionType: e.target.value })} /></Field>
            </div>
            <Field label="Renewal of policy number"><input className="input" value={form.renewalOfPolicyNumber ?? ""} onChange={(e) => setForm({ ...form, renewalOfPolicyNumber: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Coverage" hint="Dollars, only when explicit"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.coverageDollars} onChange={(e) => setForm({ ...form, coverageDollars: e.target.value })} /></Field>
              <Field label="Premium" hint="Dollars, only when explicit"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.premiumDollars ?? ""} onChange={(e) => setForm({ ...form, premiumDollars: e.target.value })} /></Field>
              <Field label="Deductible" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.deductibleDollars ?? ""} onChange={(e) => setForm({ ...form, deductibleDollars: e.target.value })} /></Field>
            </div>
            <Field label="Coverage summary"><textarea className="textarea" value={form.coverageSummary ?? ""} onChange={(e) => setForm({ ...form, coverageSummary: e.target.value })} /></Field>
            <Field label="Additional insureds" hint="Comma-separated"><input className="input" value={form.additionalInsuredsInput ?? ""} onChange={(e) => setForm({ ...form, additionalInsuredsInput: e.target.value })} /></Field>
            <Field label="Covered parties/classes" hint="One per line: name | type | class | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.coveredPartiesInput ?? ""} onChange={(e) => setForm({ ...form, coveredPartiesInput: e.target.value })} />
            </Field>
            <Field label="Coverage items and limits" hint="One per line: label | type | class | limit dollars | deductible dollars | summary | source IDs | citation ID">
              <textarea className="textarea" value={form.coverageItemsInput ?? ""} onChange={(e) => setForm({ ...form, coverageItemsInput: e.target.value })} />
            </Field>
            <Field label="Covered rooms/locations" hint="One per line: label | address | room | coverage dollars | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.coveredLocationsInput ?? ""} onChange={(e) => setForm({ ...form, coveredLocationsInput: e.target.value })} />
            </Field>
            <Field label="Policy definitions" hint="One per line: term | definition | source IDs | citation ID">
              <textarea className="textarea" value={form.policyDefinitionsInput ?? ""} onChange={(e) => setForm({ ...form, policyDefinitionsInput: e.target.value })} />
            </Field>
            <Field label="Declined coverages" hint="One per line: label | reason | offered limit dollars | premium dollars | declined date | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.declinedCoveragesInput ?? ""} onChange={(e) => setForm({ ...form, declinedCoveragesInput: e.target.value })} />
            </Field>
            <Field label="Certificates of insurance" hint="One per line: holder | additional insured legal name | event | event date | required limit dollars | issued | expires | status | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.certificatesInput ?? ""} onChange={(e) => setForm({ ...form, certificatesInput: e.target.value })} />
            </Field>
            <Field label="Event / room insurance requirements" hint="One per line: context | type | coverage source | required CGL dollars | confirmed CGL dollars | additional insured? | legal name | COI status | COI due | tenants legal liability dollars | liquor | indemnity? | waiver? | vendor COI? | checklist? | risk triggers | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.insuranceRequirementsInput ?? ""} onChange={(e) => setForm({ ...form, insuranceRequirementsInput: e.target.value })} />
            </Field>
            <Field label="D&O claims-made terms" hint="Single line: retroactive date | continuity date | reporting deadline | extended reporting | defence costs inside limit? | territory | retention dollars | claims notice contact | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.claimsMadeTermsInput ?? ""} onChange={(e) => setForm({ ...form, claimsMadeTermsInput: e.target.value })} />
            </Field>
            <Field label="Claims / incident register" hint="One per line: incident date | claim notice date | status | privacy? | insurer notified | broker notified | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.claimIncidentsInput ?? ""} onChange={(e) => setForm({ ...form, claimIncidentsInput: e.target.value })} />
            </Field>
            <Field label="Annual insurance reviews" hint="One per line: review date | board meeting date | reviewer | outcome | next review | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.annualReviewsInput ?? ""} onChange={(e) => setForm({ ...form, annualReviewsInput: e.target.value })} />
            </Field>
            <Field label="Compliance checks" hint="One per line: label | status | due date | completed date | source IDs | citation ID | notes">
              <textarea className="textarea" value={form.complianceChecksInput ?? ""} onChange={(e) => setForm({ ...form, complianceChecksInput: e.target.value })} />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start"><input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="End"><input className="input" type="date" value={form.endDate ?? ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
              <Field label="Renewal"><input className="input" type="date" value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })} /></Field>
            </div>
            <Field label="Source external IDs" hint="Comma-separated Paperless or external IDs"><input className="input" value={form.sourceExternalIdsInput ?? ""} onChange={(e) => setForm({ ...form, sourceExternalIdsInput: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Sensitivity">
                <Select value={form.sensitivity ?? ""} onChange={value => setForm({
  ...form,
  sensitivity: value
})} options={[{
  value: "",
  label: "Standard"
}, {
  value: "restricted",
  label: "Restricted"
}]} className="input" />
              </Field>
              <Field label="Confidence">
                <Select value={form.confidence ?? ""} onChange={value => setForm({
  ...form,
  confidence: value
})} options={[{
  value: "",
  label: "Unspecified"
}, {
  value: "",
  label: "High"
}, {
  value: "",
  label: "Medium"
}, {
  value: "",
  label: "Review"
}]} className="input" />
              </Field>
            </div>
            <Field label="Risk flags" hint="Comma-separated"><input className="input" value={form.riskFlagsInput ?? ""} onChange={(e) => setForm({ ...form, riskFlagsInput: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          )
        )}
      </Drawer>
    </div>
  );
}

export function InsurancePolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const items = useQuery(api.insurance.list, society ? { societyId: society._id } : "skip");

  if (society === undefined || items === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const rows = (items ?? []) as any[];
  const policy = rows.find((row) => String(row._id) === String(id));
  if (!policy) {
    return (
      <div className="page">
        <Link to="/app/insurance" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
          <ArrowLeft size={12} /> Insurance policies
        </Link>
        <div className="card">
          <div className="card__body">Policy not found.</div>
        </div>
      </div>
    );
  }

  const versions = rows
    .filter((row) => row.policySeriesKey && row.policySeriesKey === policy.policySeriesKey)
    .sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")));
  const sourceIds = sourceIdsForPolicy(policy);
  const noteSummary = displayPolicyNotes(policy.notes);

  return (
    <div className="page">
      <Link to="/app/insurance" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Insurance policies
      </Link>
      <PageHeader
        title={`${kindLabel(policy.kind)} ${policy.policyNumber}`}
        icon={<Shield size={16} />}
        iconColor="green"
        subtitle={[policy.insurer, policy.policyTermLabel, policy.broker].filter(Boolean).join(" · ")}
        actions={
          <>
            <Badge tone={statusTone(policy.status)}>{policy.status}</Badge>
            {policy.sensitivity === "restricted" && <Badge tone="danger">restricted</Badge>}
          </>
        }
      />
      <InsuranceInsightCards policy={policy} />

      <div className="insurance-full-layout">
        <div className="insurance-full-layout__main">
          <PolicyStructuredDetails row={policy} />
        </div>
        <aside className="insurance-full-layout__side">
          <div className="card">
            <div className="card__head"><h2 className="card__title">Policy file</h2></div>
            <div className="card__body col">
              <DetailRow label="Kind">{kindLabel(policy.kind)}</DetailRow>
              <DetailRow label="Policy #">{policy.policyNumber}</DetailRow>
              <DetailRow label="Series">
                <span title={policy.policySeriesKey || undefined}>{shortPolicySeries(policy.policySeriesKey)}</span>
              </DetailRow>
              <DetailRow label="Term">{policy.policyTermLabel || "Not set"}</DetailRow>
              <DetailRow label="Period">{formatDate(policy.startDate)} to {formatDate(policy.endDate)}</DetailRow>
              <DetailRow label="Renewal">{formatDate(policy.renewalDate)}</DetailRow>
              <DetailRow label="Confidence">{policy.confidence || "Unspecified"}</DetailRow>
            </div>
          </div>

          {versions.length > 1 && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">Renewal history</h2></div>
              <div className="card__body col">
                {versions.map((version) => (
                  <Link key={version._id} to={`/app/insurance/${version._id}`} className="insurance-version-link">
                    <span>{version.policyTermLabel || formatDate(version.startDate)}</span>
                    <Badge tone={statusTone(version.status)}>{version.status}</Badge>
                    <span className="muted">{money(version.premiumCents)} premium</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__head"><h2 className="card__title">Sources</h2></div>
            <div className="card__body col">
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Source IDs are collapsed in the brief. Hover a source chip to see the preserved IDs.
              </div>
              <SourceBadges ids={sourceIds} />
              {sourceIds.length === 0 && <div className="muted">No source IDs recorded.</div>}
            </div>
          </div>

          {noteSummary && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">Notes</h2></div>
              <div className="card__body">
                <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{noteSummary}</p>
              </div>
            </div>
          )}
        </aside>
      </div>
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

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span>{children || "—"}</span>
    </div>
  );
}

function InsuranceInsightCards({ policy }: { policy: any }) {
  const parties = policy.coveredParties ?? [];
  const coverageItems = policy.coverageItems ?? [];
  const locations = policy.coveredLocations ?? [];
  const certificates = policy.certificatesOfInsurance ?? [];
  const checks = policy.complianceChecks ?? [];
  const largestLimit = largestCoverageLimit(policy);
  const openChecks = checks.filter((check: any) => {
    const status = String(check.status ?? "").toLowerCase();
    return status === "open" || status.includes("review") || status.includes("todo");
  }).length;
  const coveredLabel = parties.length
    ? `${parties.length} covered ${parties.length === 1 ? "party/class" : "parties/classes"}`
    : "No covered parties entered";
  const evidenceCount = sourceIdsForPolicy(policy).length;

  return (
    <div className="insurance-insights" aria-label="Insurance policy quick answers">
      <div className="insurance-insight-card">
        <span>What it covers</span>
        <strong>{largestLimit != null ? money(largestLimit) : money(policy.coverageCents)}</strong>
        <small>{coverageItems.length ? `${coverageItems.length} limit item${coverageItems.length === 1 ? "" : "s"} captured` : "Policy-level coverage"}</small>
      </div>
      <div className="insurance-insight-card">
        <span>Who it covers</span>
        <strong>{coveredLabel}</strong>
        <small>{policy.additionalInsureds?.length ? `${policy.additionalInsureds.length} additional insured${policy.additionalInsureds.length === 1 ? "" : "s"}` : "Named insured/classes"}</small>
      </div>
      <div className="insurance-insight-card">
        <span>Rooms / COIs</span>
        <strong>{locations.length || certificates.length ? `${locations.length + certificates.length} record${locations.length + certificates.length === 1 ? "" : "s"}` : "None captured"}</strong>
        <small>{locations.length ? "Premises coverage present" : "No room schedule found"}</small>
      </div>
      <div className="insurance-insight-card">
        <span>Review state</span>
        <strong>{openChecks ? `${openChecks} open check${openChecks === 1 ? "" : "s"}` : policy.confidence || "No open checks"}</strong>
        <small>{evidenceCount ? `${evidenceCount} preserved source${evidenceCount === 1 ? "" : "s"}` : "No source IDs"}</small>
      </div>
    </div>
  );
}

function policyDrawerTitle(form: any) {
  if (!form) return "Insurance policy";
  return [kindLabel(form.kind), form.policyNumber].filter(Boolean).join(" · ") || "Insurance policy";
}

function PolicyStructuredDetails({ row }: { row: any }) {
  const parties = row.coveredParties ?? [];
  const items = row.coverageItems ?? [];
  const locations = row.coveredLocations ?? [];
  const definitions = row.policyDefinitions ?? [];
  const declined = row.declinedCoverages ?? [];
  const certificates = row.certificatesOfInsurance ?? [];
  const requirements = row.insuranceRequirements ?? [];
  const claimsTerms = row.claimsMadeTerms;
  const incidents = row.claimIncidents ?? [];
  const reviews = row.annualReviews ?? [];
  const checks = row.complianceChecks ?? [];
  const allSourceIds = sourceIdsForPolicy(row);
  const hasDetails = parties.length || items.length || locations.length || definitions.length || declined.length || certificates.length || requirements.length || claimsTerms || incidents.length || reviews.length || checks.length;
  if (!hasDetails) {
    return (
      <div className="insurance-brief">
        <div className="insurance-brief__hero">
          <PolicyBriefHeader row={row} sourceIds={allSourceIds} />
          <div className="insurance-empty">No first-class coverage details entered yet.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="insurance-brief">
      <div className="insurance-brief__hero">
        <PolicyBriefHeader row={row} sourceIds={allSourceIds} />
      </div>

      <div className="insurance-brief__grid">
        <BriefMetric label="Policy" value={row.policyNumber || "Not set"} sub={[row.policyTermLabel, row.versionType].filter(Boolean).join(" · ")} />
        <BriefMetric label="Coverage" value={money(row.coverageCents)} sub={row.deductibleCents != null ? `Deductible ${money(row.deductibleCents)}` : ""} />
        <BriefMetric label="Premium" value={money(row.premiumCents)} sub={row.broker || "Broker not set"} />
        <BriefMetric label="Renewal" value={formatDate(row.renewalDate)} sub={`${formatDate(row.startDate)} to ${formatDate(row.endDate)}`} />
      </div>

      {row.coverageSummary && <div className="insurance-brief__summary">{row.coverageSummary}</div>}

      <DetailSection title="Who is covered" rows={parties} render={(party) => (
        <BriefItem
          title={party.name}
          meta={[party.partyType, party.coveredClass]}
          sourceIds={party.sourceExternalIds}
          citationId={party.citationId}
          notes={party.notes}
        />
      )} />
      <DetailSection title="Coverage items" rows={items} render={(item) => (
        <BriefItem
          title={item.label}
          meta={[item.coverageType, item.coveredClass]}
          amount={item.limitCents != null ? money(item.limitCents) : undefined}
          subAmount={item.deductibleCents != null ? `Deductible ${money(item.deductibleCents)}` : undefined}
          sourceIds={item.sourceExternalIds}
          citationId={item.citationId}
          notes={item.summary}
        />
      )} />
      <DetailSection title="Rooms / locations" rows={locations} render={(location) => (
        <BriefItem
          title={location.label}
          meta={[location.room ? `Room ${location.room}` : undefined, location.address]}
          amount={location.coverageCents != null ? money(location.coverageCents) : undefined}
          sourceIds={location.sourceExternalIds}
          citationId={location.citationId}
          notes={location.notes}
        />
      )} />
      <DetailSection title="Definitions" rows={definitions} render={(definition) => (
        <BriefItem
          title={definition.term}
          sourceIds={definition.sourceExternalIds}
          citationId={definition.citationId}
          notes={definition.definition}
        />
      )} />
      <DetailSection title="Declined coverages" rows={declined} render={(coverage) => (
        <BriefItem
          title={coverage.label}
          meta={[coverage.declinedAt ? `Declined ${formatDate(coverage.declinedAt)}` : undefined]}
          amount={coverage.offeredLimitCents != null ? `Limit ${money(coverage.offeredLimitCents)}` : undefined}
          subAmount={coverage.premiumCents != null ? `Premium ${money(coverage.premiumCents)}` : undefined}
          sourceIds={coverage.sourceExternalIds}
          citationId={coverage.citationId}
          notes={[coverage.reason, coverage.notes].filter(Boolean).join(" · ")}
        />
      )} />
      <DetailSection title="Certificates of insurance" rows={certificates} render={(certificate) => (
        <BriefItem
          title={certificate.holderName}
          meta={[certificate.additionalInsuredLegalName, certificate.status]}
          amount={certificate.requiredLimitCents != null ? money(certificate.requiredLimitCents) : undefined}
          sourceIds={certificate.sourceExternalIds}
          citationId={certificate.citationId}
          notes={[certificate.eventName, certificate.eventDate && `Event ${formatDate(certificate.eventDate)}`, certificate.issuedAt && `Issued ${formatDate(certificate.issuedAt)}`, certificate.expiresAt && `Expires ${formatDate(certificate.expiresAt)}`, certificate.notes].filter(Boolean).join(" · ")}
        />
      )} />
      <DetailSection title="Event / room requirements" rows={requirements} render={(requirement) => (
        <BriefItem
          title={requirement.context}
          meta={[requirement.requirementType, requirement.coverageSource, requirement.coiStatus]}
          amount={requirement.cglLimitConfirmedCents != null ? `Confirmed ${money(requirement.cglLimitConfirmedCents)}` : requirement.cglLimitRequiredCents != null ? `Required ${money(requirement.cglLimitRequiredCents)}` : undefined}
          subAmount={requirement.tenantLegalLiabilityLimitCents != null ? `Tenants legal liability ${money(requirement.tenantLegalLiabilityLimitCents)}` : undefined}
          sourceIds={requirement.sourceExternalIds}
          citationId={requirement.citationId}
          notes={[
              requirement.additionalInsuredRequired === true ? `additional insured: ${requirement.additionalInsuredLegalName || "required"}` : undefined,
              requirement.coiDueDate && `COI due ${formatDate(requirement.coiDueDate)}`,
              requirement.hostLiquorLiability && `liquor: ${requirement.hostLiquorLiability}`,
              requirement.indemnityRequired === true ? "indemnity required" : undefined,
              requirement.waiverRequired === true ? "waiver required" : undefined,
              requirement.vendorCoiRequired === true ? "vendor COI required" : undefined,
              requirement.studentEventChecklistRequired === true ? "student event checklist" : undefined,
              requirement.riskTriggers?.length ? `triggers: ${requirement.riskTriggers.join(", ")}` : undefined,
              requirement.notes,
            ].filter(Boolean).join(" · ")}
        />
      )} />
      {claimsTerms && (
        <DetailSection title="D&O claims-made terms" rows={[claimsTerms]} render={(terms) => (
          <BriefItem
            title="Claims-made reporting"
            meta={[terms.retroactiveDate && `Retro ${formatDate(terms.retroactiveDate)}`, terms.reportingDeadline && `Report by ${formatDate(terms.reportingDeadline)}`, terms.defenseCostsInsideLimit != null ? (terms.defenseCostsInsideLimit ? "Defence inside limit" : "Defence outside limit") : undefined, terms.territory]}
            amount={terms.retentionCents != null ? `Retention ${money(terms.retentionCents)}` : undefined}
            sourceIds={terms.sourceExternalIds}
            citationId={terms.citationId}
            notes={[terms.continuityDate && `Continuity ${formatDate(terms.continuityDate)}`, terms.extendedReportingPeriod, terms.claimsNoticeContact, terms.notes].filter(Boolean).join(" · ")}
          />
        )} />
      )}
      <DetailSection title="Claims / incidents" rows={incidents} render={(incident) => (
        <BriefItem
          title={incident.incidentDate ? formatDate(incident.incidentDate) : "Incident"}
          meta={[incident.status, incident.privacyFlag ? "restricted" : undefined]}
          sourceIds={incident.sourceExternalIds}
          citationId={incident.citationId}
          notes={[incident.claimNoticeDate && `Notice ${formatDate(incident.claimNoticeDate)}`, incident.insurerNotifiedAt && `Insurer notified ${formatDate(incident.insurerNotifiedAt)}`, incident.brokerNotifiedAt && `Broker notified ${formatDate(incident.brokerNotifiedAt)}`, incident.notes].filter(Boolean).join(" · ")}
        />
      )} />
      <DetailSection title="Annual reviews" rows={reviews} render={(review) => (
        <BriefItem
          title={formatDate(review.reviewDate)}
          meta={[review.boardMeetingDate && `Board ${formatDate(review.boardMeetingDate)}`, review.outcome]}
          sourceIds={review.sourceExternalIds}
          citationId={review.citationId}
          notes={[review.reviewer, review.nextReviewDate && `Next ${formatDate(review.nextReviewDate)}`, review.notes].filter(Boolean).join(" · ")}
        />
      )} />
      <DetailSection title="Compliance checks" rows={checks} render={(check) => (
        <BriefItem
          title={check.label}
          meta={[check.status, check.dueDate && `Due ${formatDate(check.dueDate)}`]}
          sourceIds={check.sourceExternalIds}
          citationId={check.citationId}
          notes={[check.completedAt && `Completed ${formatDate(check.completedAt)}`, check.notes].filter(Boolean).join(" · ")}
        />
      )} />
    </div>
  );
}

function DetailSection({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <section className="insurance-brief__section">
      <div className="insurance-brief__section-head">
        <h3>{title}</h3>
        <span>{rows.length}</span>
      </div>
      <div className="insurance-brief__items">
        {rows.map((row, index) => (
          <div key={`${title}-${index}`} className="insurance-brief__item">
            {render(row)}
          </div>
        ))}
      </div>
    </section>
  );
}

function PolicyBriefHeader({ row, sourceIds }: { row: any; sourceIds: string[] }) {
  return (
    <>
      <div className="insurance-brief__eyebrow">{kindLabel(row.kind)} coverage</div>
      <div className="insurance-brief__title-row">
        <h2>{row.insurer || "Insurance policy"}</h2>
        <Badge tone={statusTone(row.status)}>{row.status || "Unspecified"}</Badge>
      </div>
      <div className="insurance-brief__subtitle">
        {[row.policyNumber && `Policy ${row.policyNumber}`, row.policyTermLabel, row.broker].filter(Boolean).join(" · ")}
      </div>
      {row.sensitivity === "restricted" && <Badge tone="danger">restricted</Badge>}
      <SourceBadges ids={sourceIds} />
    </>
  );
}

function BriefMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="insurance-brief__metric">
      <div className="insurance-brief__metric-label">{label}</div>
      <div className="insurance-brief__metric-value">{value || "—"}</div>
      {sub && <div className="insurance-brief__metric-sub">{sub}</div>}
    </div>
  );
}

function BriefItem({
  title,
  meta = [],
  amount,
  subAmount,
  sourceIds,
  citationId,
  notes,
}: {
  title: string;
  meta?: Array<string | undefined | null | false>;
  amount?: string;
  subAmount?: string;
  sourceIds?: string[];
  citationId?: string;
  notes?: string;
}) {
  const cleanMeta = meta.filter(Boolean) as string[];
  return (
    <>
      <div className="insurance-brief__item-main">
        <div>
          <strong>{title}</strong>
          {cleanMeta.length > 0 && (
            <div className="insurance-brief__meta">
              {cleanMeta.map((item) => <span key={item}>{item}</span>)}
            </div>
          )}
        </div>
        {(amount || subAmount) && (
          <div className="insurance-brief__amount">
            {amount && <span>{amount}</span>}
            {subAmount && <small>{subAmount}</small>}
          </div>
        )}
      </div>
      {notes && <p>{notes}</p>}
      <div className="insurance-brief__proof">
        <SourceBadges ids={sourceIds} />
        <PolicyCitation id={citationId} />
      </div>
    </>
  );
}

function SourceBadges({ ids }: { ids?: string[] }) {
  if (!ids?.length) return null;
  const cleanIds = Array.from(new Set(ids.filter(Boolean)));
  return (
    <span className="insurance-source-chip" title={cleanIds.join("\n")}>
      {cleanIds.length} source{cleanIds.length === 1 ? "" : "s"}
    </span>
  );
}

function sourceIdsForPolicy(row: any) {
  const ids = new Set<string>();
  collectPolicySourceIds(row, ids);
  return Array.from(ids);
}

function largestCoverageLimit(row: any) {
  const values = [
    row.coverageCents,
    ...(row.coverageItems ?? []).map((item: any) => item.limitCents),
    ...(row.coveredLocations ?? []).map((location: any) => location.coverageCents),
    ...(row.certificatesOfInsurance ?? []).map((certificate: any) => certificate.requiredLimitCents),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : null;
}

function shortPolicySeries(series?: string) {
  if (!series) return "Not grouped";
  const parts = series.split("|").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 2).join(" / ");
  return series.length > 42 ? `${series.slice(0, 39)}...` : series;
}

function displayPolicyNotes(notes?: string) {
  const clean = String(notes ?? "").trim();
  if (!clean) return "";
  return clean
    .split(/\n(?=Sources:|Linked source document ids:|Confidence:|Sensitivity:)/)[0]
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectPolicySourceIds(value: any, ids: Set<string>) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPolicySourceIds(item, ids);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value.sourceExternalIds)) {
    for (const id of value.sourceExternalIds) {
      const cleanId = String(id ?? "").trim();
      if (cleanId) ids.add(cleanId);
    }
  }
  for (const key of ["coveredParties", "coverageItems", "coveredLocations", "policyDefinitions", "declinedCoverages", "certificatesOfInsurance", "insuranceRequirements", "claimsMadeTerms", "claimIncidents", "annualReviews", "complianceChecks"]) {
    collectPolicySourceIds(value[key], ids);
  }
}

function PolicyCitation({ id }: { id?: string }) {
  return id ? <CitationBadge citationId={id} iconOnly /> : null;
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
        {row.policyTermLabel ? ` · ${row.policyTermLabel}` : ""}
        {row.versionType ? ` · ${row.versionType}` : ""}
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
    policySeriesKey: cleanOptional(form.policySeriesKey),
    policyTermLabel: cleanOptional(form.policyTermLabel),
    versionType: cleanOptional(form.versionType),
    renewalOfPolicyNumber: cleanOptional(form.renewalOfPolicyNumber),
    coverageCents: dollarInputToCents(form.coverageDollars),
    premiumCents: dollarInputToCents(form.premiumDollars),
    deductibleCents: dollarInputToCents(form.deductibleDollars),
    coverageSummary: cleanOptional(form.coverageSummary),
    additionalInsureds: splitList(form.additionalInsuredsInput),
    coveredParties: parseCoveredParties(form.coveredPartiesInput),
    coverageItems: parseCoverageItems(form.coverageItemsInput),
    coveredLocations: parseCoveredLocations(form.coveredLocationsInput),
    policyDefinitions: parsePolicyDefinitions(form.policyDefinitionsInput),
    declinedCoverages: parseDeclinedCoverages(form.declinedCoveragesInput),
    certificatesOfInsurance: parseCertificates(form.certificatesInput),
    insuranceRequirements: parseInsuranceRequirements(form.insuranceRequirementsInput),
    claimsMadeTerms: parseClaimsMadeTerms(form.claimsMadeTermsInput),
    claimIncidents: parseClaimIncidents(form.claimIncidentsInput),
    annualReviews: parseAnnualReviews(form.annualReviewsInput),
    complianceChecks: parseComplianceChecks(form.complianceChecksInput),
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

function parseCoveredParties(value: unknown) {
  return lineRows(value).map((line) => {
    const [name, partyType, coveredClass, sourceExternalIds, citationId, notes] = splitPiped(line);
    return compact({
      name,
      partyType,
      coveredClass,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.name);
}

function parseCoverageItems(value: unknown) {
  return lineRows(value).map((line) => {
    const [label, coverageType, coveredClass, limitDollars, deductibleDollars, summary, sourceExternalIds, citationId] = splitPiped(line);
    return compact({
      label,
      coverageType,
      coveredClass,
      limitCents: dollarInputToCents(limitDollars),
      deductibleCents: dollarInputToCents(deductibleDollars),
      summary,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
    });
  }).filter((row) => row.label);
}

function parseCoveredLocations(value: unknown) {
  return lineRows(value).map((line) => {
    const [label, address, room, coverageDollars, sourceExternalIds, citationId, notes] = splitPiped(line);
    return compact({
      label,
      address,
      room,
      coverageCents: dollarInputToCents(coverageDollars),
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.label);
}

function parsePolicyDefinitions(value: unknown) {
  return lineRows(value).map((line) => {
    const [term, definition, sourceExternalIds, citationId] = splitPiped(line);
    return compact({
      term,
      definition,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
    });
  }).filter((row) => row.term && row.definition);
}

function parseDeclinedCoverages(value: unknown) {
  return lineRows(value).map((line) => {
    const [label, reason, offeredLimitDollars, premiumDollars, declinedAt, sourceExternalIds, citationId, notes] = splitPiped(line);
    return compact({
      label,
      reason,
      offeredLimitCents: dollarInputToCents(offeredLimitDollars),
      premiumCents: dollarInputToCents(premiumDollars),
      declinedAt: dateInput(declinedAt) || undefined,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.label);
}

function parseCertificates(value: unknown) {
  return lineRows(value).map((line) => {
    const [holderName, additionalInsuredLegalName, eventName, eventDate, requiredLimitDollars, issuedAt, expiresAt, status, sourceExternalIds, citationId, notes] = splitPiped(line);
    return compact({
      holderName,
      additionalInsuredLegalName,
      eventName,
      eventDate: dateInput(eventDate) || undefined,
      requiredLimitCents: dollarInputToCents(requiredLimitDollars),
      issuedAt: dateInput(issuedAt) || undefined,
      expiresAt: dateInput(expiresAt) || undefined,
      status,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.holderName);
}

function parseInsuranceRequirements(value: unknown) {
  return lineRows(value).map((line) => {
    const [
      context,
      requirementType,
      coverageSource,
      cglLimitRequiredDollars,
      cglLimitConfirmedDollars,
      additionalInsuredRequired,
      additionalInsuredLegalName,
      coiStatus,
      coiDueDate,
      tenantLegalLiabilityLimitDollars,
      hostLiquorLiability,
      indemnityRequired,
      waiverRequired,
      vendorCoiRequired,
      studentEventChecklistRequired,
      riskTriggers,
      sourceExternalIds,
      citationId,
      notes,
    ] = splitPiped(line);
    return compact({
      context,
      requirementType,
      coverageSource,
      cglLimitRequiredCents: dollarInputToCents(cglLimitRequiredDollars),
      cglLimitConfirmedCents: dollarInputToCents(cglLimitConfirmedDollars),
      additionalInsuredRequired: parseBoolean(additionalInsuredRequired),
      additionalInsuredLegalName,
      coiStatus,
      coiDueDate: dateInput(coiDueDate) || undefined,
      tenantLegalLiabilityLimitCents: dollarInputToCents(tenantLegalLiabilityLimitDollars),
      hostLiquorLiability,
      indemnityRequired: parseBoolean(indemnityRequired),
      waiverRequired: parseBoolean(waiverRequired),
      vendorCoiRequired: parseBoolean(vendorCoiRequired),
      studentEventChecklistRequired: parseBoolean(studentEventChecklistRequired),
      riskTriggers: splitList(riskTriggers),
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.context);
}

function parseClaimsMadeTerms(value: unknown) {
  const line = lineRows(value)[0];
  if (!line) return undefined;
  const [retroactiveDate, continuityDate, reportingDeadline, extendedReportingPeriod, defenseCostsInsideLimit, territory, retentionDollars, claimsNoticeContact, sourceExternalIds, citationId, notes] = splitPiped(line);
  return compact({
    retroactiveDate: dateInput(retroactiveDate) || undefined,
    continuityDate: dateInput(continuityDate) || undefined,
    reportingDeadline: dateInput(reportingDeadline) || undefined,
    extendedReportingPeriod,
    defenseCostsInsideLimit: parseBoolean(defenseCostsInsideLimit),
    territory,
    retentionCents: dollarInputToCents(retentionDollars),
    claimsNoticeContact,
    sourceExternalIds: splitList(sourceExternalIds),
    citationId,
    notes,
  });
}

function parseClaimIncidents(value: unknown) {
  return lineRows(value).map((line) => {
    const [incidentDate, claimNoticeDate, status, privacyFlag, insurerNotifiedAt, brokerNotifiedAt, sourceExternalIds, citationId, notes] = splitPiped(line);
    return compact({
      incidentDate: dateInput(incidentDate) || undefined,
      claimNoticeDate: dateInput(claimNoticeDate) || undefined,
      status,
      privacyFlag: parseBoolean(privacyFlag),
      insurerNotifiedAt: dateInput(insurerNotifiedAt) || undefined,
      brokerNotifiedAt: dateInput(brokerNotifiedAt) || undefined,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.incidentDate || row.claimNoticeDate || row.notes);
}

function parseAnnualReviews(value: unknown) {
  return lineRows(value).map((line) => {
    const [reviewDate, boardMeetingDate, reviewer, outcome, nextReviewDate, sourceExternalIds, citationId, notes] = splitPiped(line);
    return compact({
      reviewDate: dateInput(reviewDate) || undefined,
      boardMeetingDate: dateInput(boardMeetingDate) || undefined,
      reviewer,
      outcome,
      nextReviewDate: dateInput(nextReviewDate) || undefined,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.reviewDate);
}

function parseComplianceChecks(value: unknown) {
  return lineRows(value).map((line) => {
    const [label, status, dueDate, completedAt, sourceExternalIds, citationId, notes] = splitPiped(line);
    return compact({
      label,
      status,
      dueDate: dateInput(dueDate) || undefined,
      completedAt: dateInput(completedAt) || undefined,
      sourceExternalIds: splitList(sourceExternalIds),
      citationId,
      notes,
    });
  }).filter((row) => row.label);
}

function serializeCoveredParties(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.name, row.partyType, row.coveredClass, (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes])).join("\n");
}

function serializeCoverageItems(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.label, row.coverageType, row.coveredClass, centsToDollarInput(row.limitCents), centsToDollarInput(row.deductibleCents), row.summary, (row.sourceExternalIds ?? []).join(", "), row.citationId])).join("\n");
}

function serializeCoveredLocations(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.label, row.address, row.room, centsToDollarInput(row.coverageCents), (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes])).join("\n");
}

function serializePolicyDefinitions(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.term, row.definition, (row.sourceExternalIds ?? []).join(", "), row.citationId])).join("\n");
}

function serializeDeclinedCoverages(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.label, row.reason, centsToDollarInput(row.offeredLimitCents), centsToDollarInput(row.premiumCents), row.declinedAt, (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes])).join("\n");
}

function serializeCertificates(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.holderName, row.additionalInsuredLegalName, row.eventName, row.eventDate, centsToDollarInput(row.requiredLimitCents), row.issuedAt, row.expiresAt, row.status, (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes])).join("\n");
}

function serializeInsuranceRequirements(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([
    row.context,
    row.requirementType,
    row.coverageSource,
    centsToDollarInput(row.cglLimitRequiredCents),
    centsToDollarInput(row.cglLimitConfirmedCents),
    booleanText(row.additionalInsuredRequired),
    row.additionalInsuredLegalName,
    row.coiStatus,
    row.coiDueDate,
    centsToDollarInput(row.tenantLegalLiabilityLimitCents),
    row.hostLiquorLiability,
    booleanText(row.indemnityRequired),
    booleanText(row.waiverRequired),
    booleanText(row.vendorCoiRequired),
    booleanText(row.studentEventChecklistRequired),
    (row.riskTriggers ?? []).join(", "),
    (row.sourceExternalIds ?? []).join(", "),
    row.citationId,
    row.notes,
  ])).join("\n");
}

function serializeClaimsMadeTerms(row?: any) {
  if (!row) return "";
  return joinPiped([row.retroactiveDate, row.continuityDate, row.reportingDeadline, row.extendedReportingPeriod, booleanText(row.defenseCostsInsideLimit), row.territory, centsToDollarInput(row.retentionCents), row.claimsNoticeContact, (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes]);
}

function serializeClaimIncidents(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.incidentDate, row.claimNoticeDate, row.status, booleanText(row.privacyFlag), row.insurerNotifiedAt, row.brokerNotifiedAt, (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes])).join("\n");
}

function serializeAnnualReviews(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.reviewDate, row.boardMeetingDate, row.reviewer, row.outcome, row.nextReviewDate, (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes])).join("\n");
}

function serializeComplianceChecks(rows?: any[]) {
  return (rows ?? []).map((row) => joinPiped([row.label, row.status, row.dueDate, row.completedAt, (row.sourceExternalIds ?? []).join(", "), row.citationId, row.notes])).join("\n");
}

function lineRows(value: unknown) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitPiped(line: string) {
  return line.split("|").map((part) => cleanOptional(part) ?? "");
}

function joinPiped(parts: unknown[]) {
  return parts.map((part) => String(part ?? "").trim()).join(" | ").replace(/( \|)+\s*$/g, "");
}

function compact<T extends Record<string, any>>(row: T) {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as T;
}

function searchableStructuredPolicyText(row: any) {
  return [
    ...(row.coveredParties ?? []).flatMap((item: any) => [item.name, item.partyType, item.coveredClass, item.notes]),
    ...(row.coverageItems ?? []).flatMap((item: any) => [item.label, item.coverageType, item.coveredClass, item.summary]),
    ...(row.coveredLocations ?? []).flatMap((item: any) => [item.label, item.address, item.room, item.notes]),
    ...(row.policyDefinitions ?? []).flatMap((item: any) => [item.term, item.definition]),
    ...(row.declinedCoverages ?? []).flatMap((item: any) => [item.label, item.reason, item.notes]),
    row.policySeriesKey,
    row.policyTermLabel,
    row.versionType,
    row.renewalOfPolicyNumber,
    ...(row.certificatesOfInsurance ?? []).flatMap((item: any) => [item.holderName, item.additionalInsuredLegalName, item.eventName, item.status, item.notes]),
    ...(row.insuranceRequirements ?? []).flatMap((item: any) => [item.context, item.requirementType, item.coverageSource, item.additionalInsuredLegalName, item.coiStatus, item.hostLiquorLiability, ...(item.riskTriggers ?? []), item.notes]),
    ...(row.claimIncidents ?? []).flatMap((item: any) => [item.status, item.notes]),
    ...(row.annualReviews ?? []).flatMap((item: any) => [item.reviewer, item.outcome, item.notes]),
    ...(row.complianceChecks ?? []).flatMap((item: any) => [item.label, item.status, item.notes]),
    row.claimsMadeTerms ? [row.claimsMadeTerms.territory, row.claimsMadeTerms.claimsNoticeContact, row.claimsMadeTerms.notes] : [],
  ].filter(Boolean).join(" ");
}

function parseBoolean(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (["yes", "y", "true", "1", "required", "inside"].includes(text)) return true;
  if (["no", "n", "false", "0", "not required", "outside"].includes(text)) return false;
  return undefined;
}

function booleanText(value: unknown) {
  return typeof value === "boolean" ? (value ? "yes" : "no") : "";
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

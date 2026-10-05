import { EvidenceRowsEditor, type EvidenceColumn } from "../components/EvidenceRowsEditor";
import { InsuranceOperationsCard } from "../components/InsuranceOperationsCard";
import { currentRenewalPolicies } from "../../shared/insuranceOperations";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { ArrowLeft, FileSearch, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { centsToDollarInput, dollarInputToCents, formatDate, money } from "../lib/format";
import { CitationBadge } from "../components/CitationTooltip";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import { policyHistory, policyCostChange, estimatePayrollAssessment, policyCoverageChanges } from "../../shared/insuranceHistory";
import type { Id } from "../../convex/_generated/dataModel";

const KINDS = ["DirectorsOfficers", "GeneralLiability", "PropertyCasualty", "CyberLiability", "Other"];
const STATUSES = ["NeedsReview", "Active", "Lapsed", "Cancelled"];

export function InsurancePage() {
  const { canWrite } = useFinancePermissions();
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
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "insurancePolicy",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const rows = (items ?? []) as any[];
  const summary = useMemo(() => summarizePolicies(rows), [rows]);
  const records = useMemo(
    () => rows.map((r) => ({
      ...r,
      period: `${formatDate(r.startDate)} to ${formatDate(r.endDate)}`,
    })),
    [rows],
  );

  if (society === undefined) return <PageLoading />;
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
      policyFeeDollars: "",
      totalCostDollars: "",
      deductibleDollars: "",
      coverageSummary: "",
      additionalInsuredsInput: "",
      coveredPartiesInput: "",
      coverageItemsInput: "",
      coveredLocationsInput: "",
      policyDefinitionsInput: "",
      policyExclusions: [],
      assessmentRates: [],
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
    policyFeeDollars: centsToDollarInput(row.policyFeeCents),
    totalCostDollars: centsToDollarInput(row.totalCostCents),
    deductibleDollars: centsToDollarInput(row.deductibleCents),
    coverageSummary: row.coverageSummary ?? "",
    additionalInsuredsInput: (row.additionalInsureds ?? []).join(", "),
    coveredPartiesInput: serializeCoveredParties(row.coveredParties),
    coverageItemsInput: serializeCoverageItems(row.coverageItems),
    coveredLocationsInput: serializeCoveredLocations(row.coveredLocations),
    policyDefinitionsInput: serializePolicyDefinitions(row.policyDefinitions),
    policyExclusions: row.policyExclusions ?? [],
    assessmentRates: row.assessmentRates ?? [],
    declinedCoveragesInput: serializeDeclinedCoverages(row.declinedCoverages),
    certificatesInput: serializeCertificates(row.certificatesOfInsurance),
    insuranceRequirementsInput: serializeInsuranceRequirements(row.insuranceRequirements),
    claimsMadeTermsInput: serializeClaimsMadeTerms(row.claimsMadeTerms),
    claimIncidentsInput: serializeClaimIncidents(row.claimIncidents),
    annualReviewsInput: serializeAnnualReviews(row.annualReviews),
    complianceChecksInput: serializeComplianceChecks(row.complianceChecks),
    startDate: dateInput(row.startDate),
    endDate: dateInput(row.endDate),
    renewalDate: dateInput(row.renewalDate) || dateInput(row.endDate),
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
            <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
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

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="insurance policy" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="insurancePolicies"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(recordId) => navigate(`/app/insurance/${recordId}`)}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Shield size={14} />}
            label="Insurance policies"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || items === undefined}
            renderCell={({ record, field }) => {
              if (field.name === "kind") return <span className="cell-tag">{kindLabel(record.kind)}</span>;
              if (field.name === "insurer") return <PolicyCell row={record} />;
              if (field.name === "policyNumber") return <span className="mono">{record.policyNumber}</span>;
              if (field.name === "coverageCents") return <span className="mono">{money(record.coverageCents)}</span>;
              if (field.name === "premiumCents") return <span className="mono">{money(record.premiumCents)}</span>;
              if (field.name === "period") return <span className="mono">{formatDate(record.startDate)} to {formatDate(record.endDate)}</span>;
              if (field.name === "renewalDate") return <RenewalCell date={record.renewalDate} />;
              return undefined;
            }}
            renderRowActions={(r) => (
              <>
                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} disabled={!canWrite}>
                  <Pencil size={12} /> Edit
                </button>
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete insurance policy ${r.policyNumber ?? r.insurer}`} onClick={(e) => { e.stopPropagation(); remove({ id: r._id }); }} disabled={!canWrite}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

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
                <button className="btn btn--accent" onClick={() => setDrawerMode("edit")} disabled={!canWrite}>
                  <Pencil size={12} /> Edit policy
                </button>
              </>
            )
            : (
              <>
                <button className="btn" onClick={() => (editingId ? setDrawerMode("view") : setOpen(false))}>Cancel</button>
                <button className="btn btn--accent" onClick={save} disabled={!canWrite}>Save</button>
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
              <Field label="Kind" hint="D&O = Directors & Officers liability">
                <Select value={form.kind} onChange={(value) => setForm({ ...form, kind: value })}
                  options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(value) => setForm({ ...form, status: value })}
                  options={STATUSES.map((status) => ({ value: status, label: status }))} />
              </Field>
            </div>
            <Field label="Insurer"><input className="input" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} /></Field>
            <Field label="Broker"><input className="input" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} /></Field>
            <Field label="Policy number"><input className="input" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Policy series key" hint="An identifier you choose to link this policy to its future renewals, e.g. the insurer's account number"><input className="input" value={form.policySeriesKey ?? ""} onChange={(e) => setForm({ ...form, policySeriesKey: e.target.value })} /></Field>
              <Field label="Policy term"><input className="input" value={form.policyTermLabel ?? ""} onChange={(e) => setForm({ ...form, policyTermLabel: e.target.value })} /></Field>
              <Field label="Version type" hint="e.g. New, Renewal, or Amendment"><input className="input" value={form.versionType ?? ""} onChange={(e) => setForm({ ...form, versionType: e.target.value })} /></Field>
            </div>
            <Field label="Renewal of policy number"><input className="input" value={form.renewalOfPolicyNumber ?? ""} onChange={(e) => setForm({ ...form, renewalOfPolicyNumber: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Coverage" hint="Dollars, only when explicit"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.coverageDollars} onChange={(e) => setForm({ ...form, coverageDollars: e.target.value })} /></Field>
              <Field label="Premium" hint="Dollars, only when explicit"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.premiumDollars ?? ""} onChange={(e) => setForm({ ...form, premiumDollars: e.target.value })} /></Field>
              <Field label="Deductible" hint="Dollars"><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.deductibleDollars ?? ""} onChange={(e) => setForm({ ...form, deductibleDollars: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Policy fee" hint="Dollars, from invoice"><input className="input" type="number" min="0" step="0.01" value={form.policyFeeDollars ?? ""} onChange={(e) => setForm({ ...form, policyFeeDollars: e.target.value })} /></Field>
              <Field label="Total invoiced cost" hint="Dollars, including documented fees/taxes"><input className="input" type="number" min="0" step="0.01" value={form.totalCostDollars ?? ""} onChange={(e) => setForm({ ...form, totalCostDollars: e.target.value })} /></Field>
            </div>
            <Field label="Coverage summary"><MarkdownEditor rows={4} value={form.coverageSummary ?? ""} onChange={(markdown) => setForm({ ...form, coverageSummary: markdown })} /></Field>
            <Field label="Additional insureds" hint="Comma-separated"><input className="input" value={form.additionalInsuredsInput ?? ""} onChange={(e) => setForm({ ...form, additionalInsuredsInput: e.target.value })} /></Field>
            <EvidenceRowsEditor title="Covered parties/classes" rows={form.coveredParties ?? parseCoveredParties(form.coveredPartiesInput)} columns={INSURANCE_ROW_COLUMNS.coveredParties} onChange={rows => setForm({ ...form, coveredParties: rows })} />
            <EvidenceRowsEditor title="Coverage items and limits" rows={form.coverageItems ?? parseCoverageItems(form.coverageItemsInput)} columns={INSURANCE_ROW_COLUMNS.coverageItems} onChange={rows => setForm({ ...form, coverageItems: rows })} />
            <EvidenceRowsEditor title="Covered rooms/locations" rows={form.coveredLocations ?? parseCoveredLocations(form.coveredLocationsInput)} columns={INSURANCE_ROW_COLUMNS.coveredLocations} onChange={rows => setForm({ ...form, coveredLocations: rows })} />
            <EvidenceRowsEditor title="Policy definitions" rows={form.policyDefinitions ?? parsePolicyDefinitions(form.policyDefinitionsInput)} columns={INSURANCE_ROW_COLUMNS.policyDefinitions} onChange={rows => setForm({ ...form, policyDefinitions: rows })} />
            <AssessmentRatesEditor rows={form.assessmentRates ?? []} onChange={(assessmentRates) => setForm({ ...form, assessmentRates })} />
            <PolicyExclusionsEditor rows={form.policyExclusions ?? []} onChange={(policyExclusions) => setForm({ ...form, policyExclusions })} />
            <EvidenceRowsEditor title="Declined coverages" rows={form.declinedCoverages ?? parseDeclinedCoverages(form.declinedCoveragesInput)} columns={INSURANCE_ROW_COLUMNS.declinedCoverages} onChange={rows => setForm({ ...form, declinedCoverages: rows })} />
            <EvidenceRowsEditor title="Certificates of insurance" rows={form.certificatesOfInsurance ?? parseCertificates(form.certificatesInput)} columns={INSURANCE_ROW_COLUMNS.certificatesOfInsurance} onChange={rows => setForm({ ...form, certificatesOfInsurance: rows })} />
            <EvidenceRowsEditor title="Event / room insurance requirements" rows={form.insuranceRequirements ?? parseInsuranceRequirements(form.insuranceRequirementsInput)} columns={INSURANCE_ROW_COLUMNS.insuranceRequirements} onChange={rows => setForm({ ...form, insuranceRequirements: rows })} />
            <EvidenceRowsEditor title="D&O claims-made terms" rows={form.claimsMadeTermsRows ?? (parseClaimsMadeTerms(form.claimsMadeTermsInput) ? [parseClaimsMadeTerms(form.claimsMadeTermsInput)] : [])} columns={INSURANCE_ROW_COLUMNS.claimsMadeTerms} onChange={rows => setForm({ ...form, claimsMadeTermsRows: rows })} />
            <EvidenceRowsEditor title="Claims / incident register" rows={form.claimIncidents ?? parseClaimIncidents(form.claimIncidentsInput)} columns={INSURANCE_ROW_COLUMNS.claimIncidents} onChange={rows => setForm({ ...form, claimIncidents: rows })} />
            <EvidenceRowsEditor title="Annual insurance reviews" rows={form.annualReviews ?? parseAnnualReviews(form.annualReviewsInput)} columns={INSURANCE_ROW_COLUMNS.annualReviews} onChange={rows => setForm({ ...form, annualReviews: rows })} />
            <EvidenceRowsEditor title="Compliance checks" rows={form.complianceChecks ?? parseComplianceChecks(form.complianceChecksInput)} columns={INSURANCE_ROW_COLUMNS.complianceChecks} onChange={rows => setForm({ ...form, complianceChecks: rows })} />
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start"><DatePicker value={form.startDate} onChange={(value) => setForm({ ...form, startDate: value })} /></Field>
              <Field label="End"><DatePicker value={form.endDate ?? ""} onChange={(value) => setForm({ ...form, endDate: value })} /></Field>
              <Field label="Renewal"><DatePicker value={form.renewalDate} onChange={(value) => setForm({ ...form, renewalDate: value })} /></Field>
            </div>
            <Field label="Source external IDs" hint="Comma-separated Paperless or external IDs"><input className="input" value={form.sourceExternalIdsInput ?? ""} onChange={(e) => setForm({ ...form, sourceExternalIdsInput: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Sensitivity">
                <Select value={form.sensitivity ?? ""} onChange={(value) => setForm({ ...form, sensitivity: value })}
                  options={[
                    { value: "", label: "Standard" },
                    { value: "restricted", label: "Restricted" },
                  ]} />
              </Field>
              <Field label="Confidence">
                <Select value={form.confidence ?? ""} onChange={(value) => setForm({ ...form, confidence: value })}
                  options={[
                    { value: "", label: "Unspecified" },
                    { value: "High", label: "High" },
                    { value: "Medium", label: "Medium" },
                    { value: "Review", label: "Review" },
                  ]} />
              </Field>
            </div>
            <Field label="Risk flags" hint="Comma-separated"><input className="input" value={form.riskFlagsInput ?? ""} onChange={(e) => setForm({ ...form, riskFlagsInput: e.target.value })} /></Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={form.notes ?? ""} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
          </div>
          )
        )}
      </Drawer>
    </div>
  );
}

export function InsurancePolicyDetailPage() {
  const { canWrite } = useFinancePermissions();
  const createRenewal = useMutation(api.insurance.createRenewal);
  const navigate = useNavigate();
  const [renewal, setRenewal] = useState<any>(null);
  const [renewalError, setRenewalError] = useState("");
  const [savingRenewal, setSavingRenewal] = useState(false);
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const items = useQuery(api.insurance.list, society ? { societyId: society._id } : "skip");

  if (society === undefined || items === undefined) return <PageLoading />;
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

  const versions = policyHistory(policy, rows);
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
            <button className="btn-action" disabled={!canWrite} onClick={() => { setRenewalError(""); setRenewal({ policyNumber: "", startDate: dateInput(policy.endDate || policy.renewalDate), endDate: "", premiumDollars: "", policyFeeDollars: "", totalCostDollars: "" }); }}><Plus size={12} /> Record renewal</button>
            <Badge tone={statusTone(policy.status)}>{policy.status}</Badge>
            {policy.sensitivity === "restricted" && <Badge tone="danger">restricted</Badge>}
          </>
        }
      />
      <Drawer open={Boolean(renewal)} onClose={() => setRenewal(null)} title="Record renewal" footer={<>
        <button className="btn" onClick={() => setRenewal(null)}>Cancel</button>
        <button className="btn btn--accent" disabled={!canWrite || savingRenewal} onClick={async () => {
          setSavingRenewal(true); setRenewalError("");
          try {
            const renewalId = await createRenewal({ id: policy._id, policyNumber: renewal.policyNumber, startDate: renewal.startDate, endDate: renewal.endDate,
              premiumCents: dollarInputToCents(renewal.premiumDollars), policyFeeCents: dollarInputToCents(renewal.policyFeeDollars), totalCostCents: dollarInputToCents(renewal.totalCostDollars) });
            setRenewal(null); navigate(`/app/insurance/${renewalId}`);
          } catch (error) { setRenewalError(error instanceof Error ? error.message : "Unable to record renewal."); }
          finally { setSavingRenewal(false); }
        }}>Save renewal</button>
      </>}>
        {renewal && <>
          <p>The prior term stays in history. The new term starts as NeedsReview; add its coverage, exclusions and evidence from the new policy documents.</p>
          <Field label="Renewal policy number"><input className="input" value={renewal.policyNumber} onChange={(e) => setRenewal({ ...renewal, policyNumber: e.target.value })} /></Field>
          <Field label="Start"><DatePicker value={renewal.startDate} onChange={(startDate) => setRenewal({ ...renewal, startDate })} /></Field>
          <Field label="End"><DatePicker value={renewal.endDate} onChange={(endDate) => setRenewal({ ...renewal, endDate })} /></Field>
          {[["Premium", "premiumDollars"], ["Policy fee", "policyFeeDollars"], ["Total invoiced cost", "totalCostDollars"]].map(([label, key]) => <Field key={key} label={label} hint="Dollars, only when explicit"><input className="input" type="number" min="0" step="0.01" value={renewal[key]} onChange={(e) => setRenewal({ ...renewal, [key]: e.target.value })} /></Field>)}
          {renewalError && <p role="alert">{renewalError}</p>}
        </>}
      </Drawer>
      <InsuranceOperationsCard policy={policy} />
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

          <PolicyHistoryCard versions={versions} />

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
  const exclusions = row.policyExclusions ?? [];
  const assessments = row.assessmentRates ?? [];
  const declined = row.declinedCoverages ?? [];
  const certificates = row.certificatesOfInsurance ?? [];
  const requirements = row.insuranceRequirements ?? [];
  const claimsTerms = row.claimsMadeTerms;
  const incidents = row.claimIncidents ?? [];
  const reviews = row.annualReviews ?? [];
  const checks = row.complianceChecks ?? [];
  const allSourceIds = sourceIdsForPolicy(row);
  const hasDetails = parties.length || items.length || locations.length || definitions.length || assessments.length || exclusions.length || declined.length || certificates.length || requirements.length || claimsTerms || incidents.length || reviews.length || checks.length;
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
        <BriefMetric label="Premium" value={money(row.premiumCents)} sub={`Fee ${money(row.policyFeeCents)} · Total invoiced ${money(row.totalCostCents)}`} />
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
      <DetailSection title="Payroll assessment rate history" rows={assessments} render={(assessment) => (
        <BriefItem title={`${assessment.assessmentYear} · Classification ${assessment.classificationCode}`}
          meta={[assessment.effectiveDate && `Effective ${formatDate(assessment.effectiveDate)}`, assessment.experienceDiscountPercent != null ? `Experience discount ${assessment.experienceDiscountPercent}%` : undefined]}
          amount={assessment.netRatePer100PayrollCents != null ? `${money(assessment.netRatePer100PayrollCents)} per $100 assessable payroll` : "Net rate unknown"}
          subAmount={estimatePayrollAssessment(assessment.assessedPayrollCents, assessment.netRatePer100PayrollCents) != null ? `Estimated assessment ${money(estimatePayrollAssessment(assessment.assessedPayrollCents, assessment.netRatePer100PayrollCents))}` : "Assessment estimate unavailable: payroll or net rate not recorded"}
          sourceIds={assessment.sourceExternalIds} citationId={assessment.citationId}
          notes={[assessment.baseRatePer100PayrollCents != null ? `Base rate ${money(assessment.baseRatePer100PayrollCents)} per $100` : undefined, assessment.assessedPayrollCents != null ? `Assessable payroll ${money(assessment.assessedPayrollCents)}` : undefined, assessment.notes].filter(Boolean).join(" · ")} />
      )} />
      <DetailSection title="Exclusions and limiting endorsements" rows={exclusions} render={(exclusion) => (
        <BriefItem title={exclusion.label}
          meta={[exclusion.endorsementNumber, exclusion.effectiveDate && `Effective ${formatDate(exclusion.effectiveDate)}`]}
          sourceIds={exclusion.sourceExternalIds} citationId={exclusion.citationId} notes={exclusion.summary} />
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
  for (const key of ["coveredParties", "coverageItems", "coveredLocations", "policyDefinitions", "policyExclusions", "assessmentRates", "declinedCoverages", "certificatesOfInsurance", "insuranceRequirements", "claimsMadeTerms", "claimIncidents", "annualReviews", "complianceChecks"]) {
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
  const current = new Set(currentRenewalPolicies(rows, new Date().toISOString().slice(0,10)).map(row => row._id));
  return rows.reduce(
    (summary, row) => {
      const days = daysUntil(row.renewalDate);
      summary.total += 1;
      if (row.status === "Active") summary.active += 1;
      if (current.has(row._id) && days != null && days <= 60) summary.renewalDue += 1;
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
    policyFeeCents: dollarInputToCents(form.policyFeeDollars),
    totalCostCents: dollarInputToCents(form.totalCostDollars),
    deductibleCents: dollarInputToCents(form.deductibleDollars),
    coverageSummary: cleanOptional(form.coverageSummary),
    additionalInsureds: splitList(form.additionalInsuredsInput),
    coveredParties: form.coveredParties ? form.coveredParties.map(stripEditorId) : parseCoveredParties(form.coveredPartiesInput),
    coverageItems: form.coverageItems ? form.coverageItems.map(stripEditorId) : parseCoverageItems(form.coverageItemsInput),
    coveredLocations: form.coveredLocations ? form.coveredLocations.map(stripEditorId) : parseCoveredLocations(form.coveredLocationsInput),
    policyDefinitions: form.policyDefinitions ? form.policyDefinitions.map(stripEditorId) : parsePolicyDefinitions(form.policyDefinitionsInput),
    assessmentRates: (form.assessmentRates ?? []).filter((item: any) => item.classificationCode?.trim() && item.assessmentYear?.trim()).map((item: any) => compact(item)),
    policyExclusions: (form.policyExclusions ?? []).filter((item: any) => item.label?.trim()).map((item: any) => compact({ ...item, label: item.label.trim() })),
    declinedCoverages: form.declinedCoverages ? form.declinedCoverages.map(stripEditorId) : parseDeclinedCoverages(form.declinedCoveragesInput),
    certificatesOfInsurance: form.certificatesOfInsurance ? form.certificatesOfInsurance.map(stripEditorId) : parseCertificates(form.certificatesInput),
    insuranceRequirements: form.insuranceRequirements ? form.insuranceRequirements.map(stripEditorId) : parseInsuranceRequirements(form.insuranceRequirementsInput),
    claimsMadeTerms: form.claimsMadeTermsRows ? stripEditorId(form.claimsMadeTermsRows[0]) : parseClaimsMadeTerms(form.claimsMadeTermsInput),
    claimIncidents: form.claimIncidents ? form.claimIncidents.map(stripEditorId) : parseClaimIncidents(form.claimIncidentsInput),
    annualReviews: form.annualReviews ? form.annualReviews.map(stripEditorId) : parseAnnualReviews(form.annualReviewsInput),
    complianceChecks: form.complianceChecks ? form.complianceChecks.map(stripEditorId) : parseComplianceChecks(form.complianceChecksInput),
    startDate: dateInput(form.startDate),
    endDate: dateInput(form.endDate),
    renewalDate: dateInput(form.renewalDate) || dateInput(form.endDate),
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
    ...(row.assessmentRates ?? []).flatMap((item: any) => [item.classificationCode, item.assessmentYear, item.notes]),
    ...(row.policyExclusions ?? []).flatMap((item: any) => [item.label, item.endorsementNumber, item.summary]),
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

function PolicyExclusionsEditor({ rows, onChange }: { rows: any[]; onChange: (rows: any[]) => void }) {
  const change = (index: number, patch: Record<string, any>) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return (
    <section aria-label="Exclusions and limiting endorsements">
      <h3>Exclusions and limiting endorsements</h3>
      <p className="muted">Record the policy wording and source for each restriction. Confirm whether each endorsement applies to this term.</p>
      {rows.map((row, index) => (
        <div className="card" key={index} style={{ padding: 12, marginBottom: 12 }}>
          <Field label="Exclusion label"><input className="input" value={row.label ?? ""} onChange={(e) => change(index, { label: e.target.value })} /></Field>
          <Field label="Endorsement number"><input className="input" value={row.endorsementNumber ?? ""} onChange={(e) => change(index, { endorsementNumber: e.target.value })} /></Field>
          <Field label="Restriction / wording summary"><textarea className="textarea" value={row.summary ?? ""} onChange={(e) => change(index, { summary: e.target.value })} /></Field>
          <Field label="Effective date"><DatePicker value={row.effectiveDate ?? ""} onChange={(effectiveDate) => change(index, { effectiveDate })} /></Field>
          <Field label="Source IDs" hint="Comma-separated"><input className="input" value={(row.sourceExternalIds ?? []).join(", ")} onChange={(e) => change(index, { sourceExternalIds: splitList(e.target.value) })} /></Field>
          <Field label="Citation ID"><input className="input" value={row.citationId ?? ""} onChange={(e) => change(index, { citationId: e.target.value })} /></Field>
          <button className="btn btn--ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove exclusion</button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...rows, { label: "" }])}><Plus size={12} /> Add exclusion</button>
    </section>
  );
}

function PolicyHistoryCard({ versions }: { versions: any[] }) {
  return (
    <div className="card">
      <div className="card__head"><h2 className="card__title">Cost and coverage history</h2></div>
      <div className="card__body col">
        <p className="muted" style={{ margin: 0 }}>Compare recorded premiums, limits, and deductibles for this policy series. Premiums are policy costs; payment records belong in Finance.</p>
        {versions.length < 2 && <p className="muted">Add earlier or renewal records with the same policy series key to compare changes.</p>}
        {versions.map((version, index) => {
          const previous = versions[index - 1];
          return (
            <div key={version._id} className="insurance-version-link" style={{ flexWrap: "wrap" }}>
              <Link to={`/app/insurance/${version._id}`}>{version.policyTermLabel || formatDate(version.startDate)}</Link>
              <Badge tone={statusTone(version.status)}>{version.status}</Badge>
              <span>Premium {money(version.premiumCents)}</span>
              <span>Fee {money(version.policyFeeCents)} · Total invoiced {money(version.totalCostCents)}</span>
              <span>Coverage {money(version.coverageCents)}</span>
              <span>Deductible {money(version.deductibleCents)}</span>
              {previous && <div style={{ width: "100%" }} className="muted">
                Changes from prior record: premium {changeLabel(version.premiumCents, previous.premiumCents)}, total invoiced {changeLabel(version.totalCostCents, previous.totalCostCents)}, coverage {changeLabel(version.coverageCents, previous.coverageCents)}, deductible {changeLabel(version.deductibleCents, previous.deductibleCents)}.
                <div>Coverage items in the recorded schedules:</div>
                {policyCoverageChanges(previous.coverageItems, version.coverageItems).length === 0 ? <div>Known item limits unchanged.</div> :
                  policyCoverageChanges(previous.coverageItems, version.coverageItems).map((change, changeIndex) => <div key={changeIndex}>
                    {change.label}: {change.status === "changed" ? `${money(change.previousCents)} → ${money(change.currentCents)} (${changeLabel(change.currentCents, change.previousCents)})` :
                      change.status === "added" ? `added to schedule; limit ${change.currentCents == null ? "unknown" : money(change.currentCents)}` :
                      change.status === "removed" ? `removed from schedule; prior limit ${change.previousCents == null ? "unknown" : money(change.previousCents)}` : "comparison unknown; missing or ambiguous item limits"}.
                  </div>)}
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function changeLabel(current?: number, previous?: number) {
  const change = policyCostChange(current, previous);
  if (!change) return "unknown";
  if (change.cents === 0) return "unchanged";
  return `${change.cents > 0 ? "+" : "−"}${money(Math.abs(change.cents))}${change.percent == null ? "" : ` (${change.percent > 0 ? "+" : ""}${change.percent.toFixed(1)}%)`}`;
}

function AssessmentRatesEditor({ rows, onChange }: { rows: any[]; onChange: (rows: any[]) => void }) {
  const change = (index: number, patch: Record<string, any>) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section aria-label="Payroll assessment rate history">
    <h3>Payroll assessment rate history</h3>
    <p className="muted">Keep yearly rate notices separate from flat premiums. Estimates need an explicit net rate and assessable payroll.</p>
    {rows.map((row, index) => <div className="card" key={index} style={{ padding: 12, marginBottom: 12 }}>
      <Field label="Classification code"><input className="input" value={row.classificationCode ?? ""} onChange={(e) => change(index, { classificationCode: e.target.value })} /></Field>
      <Field label="Assessment year"><input className="input" value={row.assessmentYear ?? ""} onChange={(e) => change(index, { assessmentYear: e.target.value })} /></Field>
      <Field label="Effective date" hint="Only when documented"><DatePicker value={row.effectiveDate ?? ""} onChange={(effectiveDate) => change(index, { effectiveDate })} /></Field>
      {[["Net rate per $100 payroll", "netRatePer100PayrollCents"], ["Base rate per $100 payroll", "baseRatePer100PayrollCents"], ["Assessable payroll", "assessedPayrollCents"]].map(([label, key]) => <Field key={key} label={label} hint="Dollars; leave blank if unknown"><input className="input" type="number" min="0" step="0.01" value={centsToDollarInput(row[key])} onChange={(e) => change(index, { [key]: dollarInputToCents(e.target.value) })} /></Field>)}
      <Field label="Experience discount (%)"><input className="input" type="number" min="0" max="100" step="0.01" value={row.experienceDiscountPercent ?? ""} onChange={(e) => change(index, { experienceDiscountPercent: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
      <Field label="Source IDs" hint="Comma-separated"><input className="input" value={(row.sourceExternalIds ?? []).join(", ")} onChange={(e) => change(index, { sourceExternalIds: splitList(e.target.value) })} /></Field>
      <Field label="Citation ID"><input className="input" value={row.citationId ?? ""} onChange={(e) => change(index, { citationId: e.target.value })} /></Field>
      <Field label="Notes"><textarea className="textarea" value={row.notes ?? ""} onChange={(e) => change(index, { notes: e.target.value })} /></Field>
      <p className="muted">{estimatePayrollAssessment(row.assessedPayrollCents, row.netRatePer100PayrollCents) == null ? "Assessment estimate unavailable: payroll or net rate not recorded." : `Estimated assessment ${money(estimatePayrollAssessment(row.assessedPayrollCents, row.netRatePer100PayrollCents))} from recorded assessable payroll and net rate.`}</p>
      <button className="btn btn--ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove assessment rate</button>
    </div>)}
    <button className="btn" onClick={() => onChange([...rows, { classificationCode: "", assessmentYear: "" }])}><Plus size={12} /> Add assessment rate</button>
  </section>;
}

const INSURANCE_ROW_COLUMNS: Record<string, EvidenceColumn[]> = {
  "coveredParties": [
    {
      "key": "name",
      "label": "Name"
    },
    {
      "key": "partyType",
      "label": "Party type"
    },
    {
      "key": "coveredClass",
      "label": "Covered class"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "coverageItems": [
    {
      "key": "label",
      "label": "Label"
    },
    {
      "key": "coverageType",
      "label": "Coverage type"
    },
    {
      "key": "coveredClass",
      "label": "Covered class"
    },
    {
      "key": "limitCents",
      "label": "Limit cents",
      "type": "number"
    },
    {
      "key": "deductibleCents",
      "label": "Deductible cents",
      "type": "number"
    },
    {
      "key": "summary",
      "label": "Summary"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    }
  ],
  "coveredLocations": [
    {
      "key": "label",
      "label": "Label"
    },
    {
      "key": "address",
      "label": "Address"
    },
    {
      "key": "room",
      "label": "Room"
    },
    {
      "key": "coverageCents",
      "label": "Coverage cents",
      "type": "number"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "policyDefinitions": [
    {
      "key": "term",
      "label": "Term"
    },
    {
      "key": "definition",
      "label": "Definition"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    }
  ],
  "declinedCoverages": [
    {
      "key": "label",
      "label": "Label"
    },
    {
      "key": "reason",
      "label": "Reason"
    },
    {
      "key": "offeredLimitCents",
      "label": "Offered limit cents",
      "type": "number"
    },
    {
      "key": "premiumCents",
      "label": "Premium cents",
      "type": "number"
    },
    {
      "key": "declinedAt",
      "label": "Declined at"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "certificatesOfInsurance": [
    {
      "key": "holderName",
      "label": "Holder name"
    },
    {
      "key": "additionalInsuredLegalName",
      "label": "Additional insured legal name"
    },
    {
      "key": "eventName",
      "label": "Event name"
    },
    {
      "key": "eventDate",
      "label": "Event date"
    },
    {
      "key": "requiredLimitCents",
      "label": "Required limit cents",
      "type": "number"
    },
    {
      "key": "issuedAt",
      "label": "Issued at"
    },
    {
      "key": "expiresAt",
      "label": "Expires at"
    },
    {
      "key": "status",
      "label": "Status"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "insuranceRequirements": [
    {
      "key": "context",
      "label": "Context"
    },
    {
      "key": "requirementType",
      "label": "Requirement type"
    },
    {
      "key": "coverageSource",
      "label": "Coverage source"
    },
    {
      "key": "cglLimitRequiredCents",
      "label": "Cgl limit required cents",
      "type": "number"
    },
    {
      "key": "cglLimitConfirmedCents",
      "label": "Cgl limit confirmed cents",
      "type": "number"
    },
    {
      "key": "additionalInsuredRequired",
      "label": "Additional insured required",
      "type": "boolean"
    },
    {
      "key": "additionalInsuredLegalName",
      "label": "Additional insured legal name"
    },
    {
      "key": "coiStatus",
      "label": "Coi status"
    },
    {
      "key": "coiDueDate",
      "label": "Coi due date"
    },
    {
      "key": "tenantLegalLiabilityLimitCents",
      "label": "Tenant legal liability limit cents",
      "type": "number"
    },
    {
      "key": "hostLiquorLiability",
      "label": "Host liquor liability"
    },
    {
      "key": "indemnityRequired",
      "label": "Indemnity required",
      "type": "boolean"
    },
    {
      "key": "waiverRequired",
      "label": "Waiver required",
      "type": "boolean"
    },
    {
      "key": "vendorCoiRequired",
      "label": "Vendor coi required",
      "type": "boolean"
    },
    {
      "key": "studentEventChecklistRequired",
      "label": "Student event checklist required",
      "type": "boolean"
    },
    {
      "key": "riskTriggers",
      "label": "Risk triggers",
      "type": "list"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "claimsMadeTerms": [
    {
      "key": "retroactiveDate",
      "label": "Retroactive date"
    },
    {
      "key": "continuityDate",
      "label": "Continuity date"
    },
    {
      "key": "reportingDeadline",
      "label": "Reporting deadline"
    },
    {
      "key": "extendedReportingPeriod",
      "label": "Extended reporting period"
    },
    {
      "key": "defenseCostsInsideLimit",
      "label": "Defense costs inside limit",
      "type": "boolean"
    },
    {
      "key": "territory",
      "label": "Territory"
    },
    {
      "key": "retentionCents",
      "label": "Retention cents",
      "type": "number"
    },
    {
      "key": "claimsNoticeContact",
      "label": "Claims notice contact"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "claimIncidents": [
    {
      "key": "incidentDate",
      "label": "Incident date"
    },
    {
      "key": "claimNoticeDate",
      "label": "Claim notice date"
    },
    {
      "key": "status",
      "label": "Status"
    },
    {
      "key": "privacyFlag",
      "label": "Privacy flag",
      "type": "boolean"
    },
    {
      "key": "insurerNotifiedAt",
      "label": "Insurer notified at"
    },
    {
      "key": "brokerNotifiedAt",
      "label": "Broker notified at"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "annualReviews": [
    {
      "key": "reviewDate",
      "label": "Review date"
    },
    {
      "key": "boardMeetingDate",
      "label": "Board meeting date"
    },
    {
      "key": "reviewer",
      "label": "Reviewer"
    },
    {
      "key": "outcome",
      "label": "Outcome"
    },
    {
      "key": "nextReviewDate",
      "label": "Next review date"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ],
  "complianceChecks": [
    {
      "key": "label",
      "label": "Label"
    },
    {
      "key": "status",
      "label": "Status"
    },
    {
      "key": "dueDate",
      "label": "Due date"
    },
    {
      "key": "completedAt",
      "label": "Completed at"
    },
    {
      "key": "sourceExternalIds",
      "label": "Source external ids",
      "type": "list"
    },
    {
      "key": "citationId",
      "label": "Citation id"
    },
    {
      "key": "notes",
      "label": "Notes"
    }
  ]
};
function stripEditorId(row: any) { if (!row) return undefined; const { id, ...record } = row; return record; }

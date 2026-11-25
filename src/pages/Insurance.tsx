import { Segmented } from "../components/primitives";
import { InsuranceDialogAction } from "../features/insurance/InsuranceDialogAction";
import { EvidenceRowsEditor, type EvidenceColumn } from "../components/EvidenceRowsEditor";
import { InsuranceOperationsCard } from "../components/InsuranceOperationsCard";
import { currentRenewalPolicies } from "../../shared/insuranceOperations";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { SourceProvenanceButton } from "../components/SourceProvenanceButton";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { ArrowLeft, FileSearch, Pencil, Plus, Shield, Archive } from "lucide-react";
import { centsToDollarInput, daysUntilDate, dollarInputToCents, formatDate, money, todayDateOnly } from "../lib/format";
import { CitationBadge } from "../components/CitationTooltip";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTablePhoneCard,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import { policyHistory, policyCostChange, estimatePayrollAssessment, policyCoverageChanges } from "../../shared/insuranceHistory";
import type { Id } from "../../convex/_generated/dataModel";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { RecordNotFound } from "../components/RecordNotFound";
import { hasErrors, validateInsurancePolicyInput, type FieldErrors } from "../../shared/recordValidation";
import { policyCellBadges, coverageCodes, insuranceAmount, insuranceTermTextFields, limitBases, optionalPolicyFields } from "../../shared/insuranceRegister";
import { usePermissions } from "@/hooks/usePermissions";
import { InsuranceRenewalImport } from "../components/InsuranceRenewalImport";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { StatTile } from "../components/StatTile";

const KINDS = ["DirectorsOfficers", "GeneralLiability", "PropertyCasualty", "CyberLiability", "ProfessionalLiability", "Other"];
const STATUSES = ["NeedsReview", "Active", "Lapsed", "Cancelled"];

export function InsurancePage() {
  const { canWrite } = useFinancePermissions();
  const society = useSociety();
  const navigate = useNavigate();
  const items = useQuery(api.insurance.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.insurance.create);
  const update = useMutation(api.insurance.update);
  const { can } = usePermissions();
  const docs = useQuery(api.documents.listSummaries, society && can("documents:read") ? { societyId: society._id } : "skip");
  const [showArchived, setShowArchived] = useState(false);
  const remove = useMutation(api.insurance.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<"view" | "edit" | "new">("view");
  const [form, setForm] = useState<any>(null);
  const [editView, setEditView] = useState("Policy");
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const problem = editorRef.current?.querySelector<HTMLElement>(".field__error");
    if (!problem || !hasErrors(errors)) return;
    const view = problem.closest<HTMLElement>("[data-edit-view]")?.dataset.editView;
    if (view) setEditView(view);
    const frame = requestAnimationFrame(() => problem.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [errors]);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "insurancePolicy",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const rows = (items ?? []) as any[];
  const activeRows = useMemo(() => rows.filter(row => !row.archivedAtISO), [rows]);
  const summary = useMemo(() => summarizePolicies(activeRows), [activeRows]);
  const records = useMemo(
    () => (showArchived ? rows : activeRows).map((r) => ({
      ...r,
      period: `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`,
    })),
    [rows, activeRows, showArchived],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setEditView("Policy");
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
    ...row,
    claimsMadeTermsRows: row.claimsMadeTerms ? [row.claimsMadeTerms] : [],
    grossReceiptsDollars: centsToDollarInput(row.grossReceiptsCents),
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
    policyExclusions: row.policyExclusions ?? [],
    assessmentRates: row.assessmentRates ?? [],
    startDate: dateInput(row.startDate),
    endDate: dateInput(row.endDate),
    renewalDate: dateInput(row.renewalDate) || dateInput(row.endDate),
    status: row.status ?? "Active",
    sourceExternalIdsInput: (row.sourceExternalIds ?? []).join(", "),
    confidence: row.confidence ?? "",
    sensitivity: row.sensitivity ?? "",
    riskFlagsInput: (row.riskFlags ?? []).join(", "),
    notes: row.notes ?? "",
  });

  const openEdit = (row: any) => {
    setEditView("Policy");
    setEditingId(row._id);
    setDrawerMode("edit");
    setForm(formFromPolicy(row));
    setOpen(true);
  };

  const save = async () => {
    const payload = normalizePolicyDraft(form);
    const validation = validateInsurancePolicyInput(payload);
    setErrors(validation);
    if (hasErrors(validation)) {
      toast.error("Check the highlighted fields", Object.values(validation)[0]);
      return;
    }
    try {
      if (editingId) {
        const original = rows.find(row => row._id === editingId);
        const clearFields = Object.entries(payload).filter(([key, value]) => optionalPolicyFields.has(key) && value == null && original?.[key] != null).map(([key]) => key);
        await update({ id: editingId as any, patch: payload, clearFields });
        toast.success("Policy updated");
      } else {
        await create({ societyId: society._id, ...payload });
        toast.success("Policy added");
      }
      setOpen(false);
    } catch (error: any) {
      toast.error("Could not save policy", error?.data?.message ?? error?.message);
    }
  };

  const confirmRemove = async (row: any) => {
    const label = [row.insurer, row.policyNumber].filter(Boolean).join(" · ") || "this policy";
    const approved = await confirm({
      title: "Archive insurance policy?",
      message: `${label} (${kindLabel(row.kind)}, ${formatDate(row.startDate)} to ${formatDate(row.endDate)}) will move to the archive. Its policy file and renewal history stay available.`,
      confirmLabel: "Archive policy",
      tone: "danger",
    });
    if (!approved) return;
    try {
      await remove({ id: row._id });
      toast.success("Policy archived", label);
    } catch (error: any) {
      toast.error("Could not archive policy", error?.message);
    }
  };

  return (
    <div className="page insurance-register">
      <PageHeader
        title="Insurance"
        icon={<Shield size={16} />}
        iconColor="green"
        subtitle="Policy records, renewal dates, source references, and restricted import flags."
        actions={
          <div className="insurance-toolbar">
            <label className="insurance-toolbar__desktop"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Include archived</label>
            {canWrite && can("documents:read") && can("settings:write") && can("documents:write") && <InsuranceRenewalImport key={society._id} society={society} />}
            <Link className="btn-action insurance-toolbar__desktop" to="/app/imports"><FileSearch size={12} /> Review imports</Link>
            <span className="insurance-toolbar__mobile"><MoreActionsMenu label="" items={[
              { id: "imports", label: "Review imports", icon: <FileSearch size={16} />, onSelect: () => navigate("/app/imports") },
              { id: "archive", label: showArchived ? "Hide archived policies" : "Include archived policies", icon: <Archive size={16} />, onSelect: () => setShowArchived(!showArchived) },
            ]} /></span>
            <button className="btn-action btn-action--primary" aria-label="New policy" title="New policy" onClick={openNew} disabled={!canWrite}>
              <Plus size={16} /><span className="insurance-action-label">New policy</span>
            </button>
          </div>
        }
      />

      <div className="stat-grid">
        <StatTile label="Policies" value={summary.total} sub="records in register" />
        <StatTile label="Active" value={summary.active} sub="currently marked active" />
        <StatTile label="Renewal due" value={summary.renewalDue} sub="within 60 days or late" tone={summary.renewalDue > 0 ? "warn" : undefined} />
        <StatTile label="Restricted" value={summary.restricted} sub="restricted-risk flagged" tone={summary.restricted > 0 ? "danger" : undefined} />
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
            renderPhoneCard={(row, { open, selecting }) => (
              <RecordTablePhoneCard title={String(row.insurer || "Insurance policy")} wrapTitle onOpen={open} selecting={selecting}
                meta={[kindLabel(String(row.kind ?? "")), row.policyNumber ? String(row.policyNumber) : null]}
                detail={[<span key="review" className="insurance-policy-detail"><PolicyBadges row={row} />{row.renewalDate ? <span>Renewal {formatDate(String(row.renewalDate))}</span> : null}</span>]} />
            )}
            renderCell={({ record, field }) => {
              if (field.name === "status" && record.archivedAtISO) return <Badge>Archived</Badge>;
              if (field.name === "kind") return <span className="cell-tag">{kindLabel(record.kind)}</span>;
              if (field.name === "insurer") return <PolicyCell row={record} />;
              if (field.name === "policyNumber") return <span>{record.policyNumber}</span>;
              if (field.name === "coverageCents") return <span style={{ fontVariantNumeric: "tabular-nums" }}>{record.coverageCents != null ? insuranceAmount(record.coverageCents, record.currency) : record.coverageItems?.length ? `${record.coverageItems.length} coverage line${record.coverageItems.length === 1 ? "" : "s"}` : "—"}</span>;
              if (field.name === "premiumCents") return <span style={{ fontVariantNumeric: "tabular-nums" }}>{insuranceAmount(record.premiumCents, record.currency)}</span>;
              if (field.name === "period") return <span style={{ whiteSpace: "nowrap" }} title={`${formatDate(record.startDate)} – ${formatDate(record.endDate)}`}>{formatDate(record.startDate, "MMM d, yyyy")} – {formatDate(record.endDate, "MMM d, yyyy")}</span>;
              if (field.name === "renewalDate") return <RenewalCell date={record.renewalDate} />;
              return undefined;
            }}
            renderRowActions={(r) => (
              <>
                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} disabled={!canWrite}>
                  <Pencil size={12} /> Edit
                </button>
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Archive insurance policy ${r.policyNumber ?? r.insurer}`} onClick={(e) => { e.stopPropagation(); void confirmRemove(r); }} disabled={!canWrite || Boolean(r.archivedAtISO)}>
                  <Archive size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={open}
        onClose={() => { setOpen(false); setErrors({}); }}
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
          <div className="insurance-edit" ref={editorRef}>
            <Segmented aria-label="Policy editor views" className="insurance-segments" value={editView} onChange={setEditView} items={["Policy","Coverage","Costs","Evidence"].map(id => ({id, label:id}))} />
            <section data-edit-view="Policy" hidden={editView !== "Policy"}>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Kind" hint="D&O = Directors & Officers liability" required error={errors.kind}>
                <Select value={form.kind} onChange={(value) => setForm({ ...form, kind: value })}
                  options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))} />
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(value) => setForm({ ...form, status: value })}
                  options={STATUSES.map((status) => ({ value: status, label: status }))} />
              </Field>
            </div>
            <Field label="Insurer" required error={errors.insurer}><input className="input" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} /></Field>
            <Field label="Policy number" required error={errors.policyNumber}><input className="input" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start" required error={errors.startDate}><DatePicker value={form.startDate} onChange={(value) => setForm({ ...form, startDate: value })} /></Field>
              <Field label="End" error={errors.endDate}><DatePicker value={form.endDate ?? ""} onChange={(value) => setForm({ ...form, endDate: value })} /></Field>
              <Field label="Renewal" required error={errors.renewalDate}><DatePicker value={form.renewalDate} onChange={(value) => setForm({ ...form, renewalDate: value })} /></Field>
            </div>
            </section>
            <section data-edit-view="Policy" hidden={editView !== "Policy"}><h3>Insured organization and policy term</h3>
            <Field label="Broker"><input className="input" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} /></Field>
            {insuranceTermTextFields.map(([key, label]) => <Field label={label} key={key} error={errors[key]}><input className="input" value={form[key] ?? ""} onChange={e => setForm({ ...form, [key]: e.target.value })} /></Field>)}
            <div className="row" style={{ gap: 12 }}>
              <Field label="Policy series key" hint="An identifier you choose to link this policy to its future renewals, e.g. the insurer's account number"><input className="input" value={form.policySeriesKey ?? ""} onChange={(e) => setForm({ ...form, policySeriesKey: e.target.value })} /></Field>
              <Field label="Policy term"><input className="input" value={form.policyTermLabel ?? ""} onChange={(e) => setForm({ ...form, policyTermLabel: e.target.value })} /></Field>
              <Field label="Version type" hint="e.g. New, Renewal, or Amendment"><input className="input" value={form.versionType ?? ""} onChange={(e) => setForm({ ...form, versionType: e.target.value })} /></Field>
            </div>
            <Field label="Renewal of policy number"><input className="input" value={form.renewalOfPolicyNumber ?? ""} onChange={(e) => setForm({ ...form, renewalOfPolicyNumber: e.target.value })} /></Field>
            </section>
            <section data-edit-view="Costs" hidden={editView !== "Costs"}><h3>Premium, fees and rating</h3>
            <Field label="Gross receipts used for rating" hint="Dollars" error={errors.grossReceiptsCents}><input className="input" type="number" min="0" step="0.01" value={form.grossReceiptsDollars ?? ""} onChange={e => setForm({ ...form, grossReceiptsDollars: e.target.value })} /></Field>
            <Field label="Minimum retained premium (%)" error={errors.minimumRetainedPremiumPercent}><input className="input" type="number" min="0" max="100" step="any" value={form.minimumRetainedPremiumPercent ?? ""} onChange={e => setForm({ ...form, minimumRetainedPremiumPercent: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Coverage" hint="Dollars, only when explicit" error={errors.coverageCents}><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.coverageDollars} onChange={(e) => setForm({ ...form, coverageDollars: e.target.value })} /></Field>
              <Field label="Premium" hint="Dollars, only when explicit" error={errors.premiumCents}><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.premiumDollars ?? ""} onChange={(e) => setForm({ ...form, premiumDollars: e.target.value })} /></Field>
              <Field label="Deductible" hint="Dollars" error={errors.deductibleCents}><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.deductibleDollars ?? ""} onChange={(e) => setForm({ ...form, deductibleDollars: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Policy fee" hint="Dollars, from invoice" error={errors.policyFeeCents}><input className="input" type="number" min="0" step="0.01" value={form.policyFeeDollars ?? ""} onChange={(e) => setForm({ ...form, policyFeeDollars: e.target.value })} /></Field>
              <Field label="Total invoiced cost" hint="Dollars, including documented fees/taxes" error={errors.totalCostCents}><input className="input" type="number" min="0" step="0.01" value={form.totalCostDollars ?? ""} onChange={(e) => setForm({ ...form, totalCostDollars: e.target.value })} /></Field>
            </div>
            <AssessmentRatesEditor rows={form.assessmentRates ?? []} onChange={(assessmentRates) => setForm({ ...form, assessmentRates })} />
            </section>
            <section data-edit-view="Coverage" hidden={editView !== "Coverage"}><h3>Coverage lines and wording</h3>
            <EvidenceRowsEditor title="Coverage items and limits" rows={form.coverageItems ?? parseCoverageItems(form.coverageItemsInput)} columns={INSURANCE_ROW_COLUMNS.coverageItems} onChange={rows => setForm({ ...form, coverageItems: rows })} />
            <Field label="Coverage summary"><MarkdownEditor rows={4} value={form.coverageSummary ?? ""} onChange={(markdown) => setForm({ ...form, coverageSummary: markdown })} /></Field>
            <Field label="Additional insureds" hint="Comma-separated"><input className="input" value={form.additionalInsuredsInput ?? ""} onChange={(e) => setForm({ ...form, additionalInsuredsInput: e.target.value })} /></Field>
            <EvidenceRowsEditor title="Covered parties/classes" rows={form.coveredParties ?? parseCoveredParties(form.coveredPartiesInput)} columns={INSURANCE_ROW_COLUMNS.coveredParties} onChange={rows => setForm({ ...form, coveredParties: rows })} />
            <EvidenceRowsEditor title="Covered rooms/locations" rows={form.coveredLocations ?? parseCoveredLocations(form.coveredLocationsInput)} columns={INSURANCE_ROW_COLUMNS.coveredLocations} onChange={rows => setForm({ ...form, coveredLocations: rows })} />
            <EvidenceRowsEditor title="Policy definitions" rows={form.policyDefinitions ?? parsePolicyDefinitions(form.policyDefinitionsInput)} columns={INSURANCE_ROW_COLUMNS.policyDefinitions} onChange={rows => setForm({ ...form, policyDefinitions: rows })} />
            <PolicyExclusionsEditor rows={form.policyExclusions ?? []} onChange={(policyExclusions) => setForm({ ...form, policyExclusions })} />
            <EvidenceRowsEditor title="Declined coverages" rows={form.declinedCoverages ?? parseDeclinedCoverages(form.declinedCoveragesInput)} columns={INSURANCE_ROW_COLUMNS.declinedCoverages} onChange={rows => setForm({ ...form, declinedCoverages: rows })} />
            </section>
            <section data-edit-view="Evidence" hidden={editView !== "Evidence"}><h3>Certificates and agreement requirements</h3>
            <EvidenceRowsEditor title="Certificates of insurance" rows={form.certificatesOfInsurance ?? parseCertificates(form.certificatesInput)} columns={INSURANCE_ROW_COLUMNS.certificatesOfInsurance} onChange={rows => setForm({ ...form, certificatesOfInsurance: rows })} />
            <EvidenceRowsEditor title="Event / room insurance requirements" rows={form.insuranceRequirements ?? parseInsuranceRequirements(form.insuranceRequirementsInput)} columns={INSURANCE_ROW_COLUMNS.insuranceRequirements} onChange={rows => setForm({ ...form, insuranceRequirements: rows })} />
            </section>
            <section data-edit-view="Evidence" hidden={editView !== "Evidence"}><h3>Claims and policy reviews</h3>
            <EvidenceRowsEditor title="D&O claims-made terms" rows={form.claimsMadeTermsRows ?? (parseClaimsMadeTerms(form.claimsMadeTermsInput) ? [parseClaimsMadeTerms(form.claimsMadeTermsInput)] : [])} columns={INSURANCE_ROW_COLUMNS.claimsMadeTerms} onChange={rows => setForm({ ...form, claimsMadeTermsRows: rows })} />
            <EvidenceRowsEditor title="Claims / incident register" rows={form.claimIncidents ?? parseClaimIncidents(form.claimIncidentsInput)} columns={INSURANCE_ROW_COLUMNS.claimIncidents} onChange={rows => setForm({ ...form, claimIncidents: rows })} />
            <EvidenceRowsEditor title="Annual insurance reviews" rows={form.annualReviews ?? parseAnnualReviews(form.annualReviewsInput)} columns={INSURANCE_ROW_COLUMNS.annualReviews} onChange={rows => setForm({ ...form, annualReviews: rows })} />
            <EvidenceRowsEditor title="Compliance checks" rows={form.complianceChecks ?? parseComplianceChecks(form.complianceChecksInput)} columns={INSURANCE_ROW_COLUMNS.complianceChecks} onChange={rows => setForm({ ...form, complianceChecks: rows })} />
            </section>
            <section data-edit-view="Evidence" hidden={editView !== "Evidence"}><h3>Sources and notes</h3>
            {docs && <Field label="Source documents"><select multiple className="input" value={form.sourceDocumentIds ?? []} onChange={e => setForm({ ...form, sourceDocumentIds: Array.from(e.target.selectedOptions, o => o.value) })}>{docs.map((doc: any) => <option key={doc._id} value={doc._id}>{doc.title}</option>)}</select></Field>}
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
            </section>
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
    return <RecordNotFound recordLabel="Insurance policy" backTo="/app/insurance" backLabel="Insurance policies" />;
  }

  const versions = policyHistory(policy, rows);
  const sourceIds = sourceIdsForPolicy(policy);
  const noteSummary = displayPolicyNotes(policy.notes);

  return (
    <div className="page insurance-policy-page">
      <Link to="/app/insurance" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Insurance policies
      </Link>
      <PageHeader
        title={policy.insurer || `${kindLabel(policy.kind)} ${policy.policyNumber}`}
        icon={<Shield size={16} />}
        iconColor="green"
        subtitle={[kindLabel(policy.kind), policy.policyNumber ? `Policy ${policy.policyNumber}` : "", policy.policyTermLabel, policy.broker].filter(Boolean).join(" · ")}
        actions={
          <>
            <button className="btn-action" disabled={!canWrite} onClick={() => { setRenewalError(""); setRenewal({ policyNumber: "", startDate: dateInput(policy.endDate || policy.renewalDate), endDate: "", premiumDollars: "", policyFeeDollars: "", totalCostDollars: "" }); }}><Plus size={12} /> Record renewal</button>
            <Badge tone={statusTone(policy.status)}>{policy.status}</Badge>
            {policy.sensitivity === "restricted" && <Badge tone="danger">restricted</Badge>}
            <SourceProvenanceButton table="insurancePolicies" id={policy._id} />
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
          <p>The new term starts in review. Its coverage and evidence come from the renewal documents.</p>
          <Field label="Renewal policy number"><input className="input" value={renewal.policyNumber} onChange={(e) => setRenewal({ ...renewal, policyNumber: e.target.value })} /></Field>
          <Field label="Start"><DatePicker value={renewal.startDate} onChange={(startDate) => setRenewal({ ...renewal, startDate })} /></Field>
          <Field label="End"><DatePicker value={renewal.endDate} onChange={(endDate) => setRenewal({ ...renewal, endDate })} /></Field>
          <section><h3>Renewal costs (optional)</h3>
          {[["Premium", "premiumDollars"], ["Policy fee", "policyFeeDollars"], ["Total invoiced cost", "totalCostDollars"]].map(([label, key]) => <Field key={key} label={label + " (dollars)"}><input className="input" type="number" min="0" step="0.01" value={renewal[key]} onChange={(e) => setRenewal({ ...renewal, [key]: e.target.value })} /></Field>)}
          </section>
          {renewalError && <p role="alert">{renewalError}</p>}
        </>}
      </Drawer>
      <InsuranceInsightCards policy={policy} />

      <div className="insurance-full-layout">
        <div className="insurance-full-layout__main">
          <PolicyStructuredDetails row={policy} hideIdentity />
          <InsuranceOperationsCard policy={policy} />
        </div>
        <aside className="insurance-full-layout__side">
          <InsuranceDialogAction label="View policy file" title="Policy file">
            <div className="card__body col">
              <DetailRow label="Kind">{kindLabel(policy.kind)}</DetailRow>
              {policy.archivedAtISO && <DetailRow label="Archived">{formatDate(policy.archivedAtISO)}</DetailRow>}
              {insuranceTermTextFields.map(([key,label]) => policy[key] && <DetailRow key={key} label={label}>{policy[key]}</DetailRow>)}
              {policy.grossReceiptsCents != null && <DetailRow label="Gross receipts used for rating">{insuranceAmount(policy.grossReceiptsCents, policy.currency)}</DetailRow>}
              {policy.minimumRetainedPremiumPercent != null && <DetailRow label="Minimum retained premium">{policy.minimumRetainedPremiumPercent}%</DetailRow>}
              <DetailRow label="Policy #">{policy.policyNumber}</DetailRow>
              {policy.policySeriesKey && (
                <DetailRow label="Series">
                  <span title={policy.policySeriesKey}>{shortPolicySeries(policy.policySeriesKey)}</span>
                </DetailRow>
              )}
              {policy.policyTermLabel && <DetailRow label="Term">{policy.policyTermLabel}</DetailRow>}
              <DetailRow label="Period">{formatDate(policy.startDate)} – {formatDate(policy.endDate)}</DetailRow>
              <DetailRow label="Renewal">{formatDate(policy.renewalDate)}</DetailRow>
              {policy.confidence && <DetailRow label="Confidence">{policy.confidence}</DetailRow>}
            </div>
          </InsuranceDialogAction>

          <PolicyHistoryCard versions={versions} />

          {sourceIds.length > 0 && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">Sources</h2></div>
              <div className="card__body col">
                <SourceBadges ids={sourceIds} />
              </div>
            </div>
          )}

          {noteSummary && (
            <InsuranceDialogAction label="Read notes" title="Notes">
              <div className="card__body">
                <p className="muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{noteSummary}</p>
              </div>
            </InsuranceDialogAction>
          )}
        </aside>
      </div>
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

  const openChecks = checks.filter((check: any) => {
    const status = String(check.status ?? "").toLowerCase();
    return status === "open" || status.includes("review") || status.includes("todo");
  }).length;
  const coveredLabel = parties.length
    ? `${parties.length} ${parties.length === 1 ? "party or class" : "parties or classes"}`
    : "No covered parties entered";
  const evidenceCount = sourceIdsForPolicy(policy).length;

  return (
    <div className="insurance-insights" aria-label="Insurance policy quick answers">
      <div className="insurance-insight-card">
        <span>What it covers</span>
        <strong>{policy.coverageCents != null ? insuranceAmount(policy.coverageCents, policy.currency) : `${coverageItems.length} coverage line${coverageItems.length === 1 ? "" : "s"}`}</strong>

      </div>
      <div className="insurance-insight-card">
        <span>Who it covers</span>
        <strong>{coveredLabel}</strong>
        {!!policy.additionalInsureds?.length && <small>{policy.additionalInsureds.length} additional insured</small>}
      </div>
      <div className="insurance-insight-card">
        <span>Rooms / COIs</span>
        <strong>{locations.length || certificates.length ? `${locations.length + certificates.length} record${locations.length + certificates.length === 1 ? "" : "s"}` : "None captured"}</strong>

      </div>
      <div className="insurance-insight-card">
        <span>Review state</span>
        <strong>{openChecks ? `${openChecks} open check${openChecks === 1 ? "" : "s"}` : "No open checks"}</strong>
        {evidenceCount > 0 && <small>{`${evidenceCount} preserved source${evidenceCount === 1 ? "" : "s"}`}</small>}
      </div>
    </div>
  );
}

function policyDrawerTitle(form: any) {
  if (!form) return "Insurance policy";
  return [kindLabel(form.kind), form.policyNumber].filter(Boolean).join(" · ") || "Insurance policy";
}

/** hideIdentity: the policy page header already shows insurer, policy number and status. */
function PolicyStructuredDetails({ row, hideIdentity = false }: { row: any; hideIdentity?: boolean }) {
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
  const views = [
    {id: "Coverage", available: parties.length || items.length || locations.length},
    {id: "Terms", available: definitions.length || assessments.length || exclusions.length || declined.length || claimsTerms},
    {id: "Records", available: certificates.length || requirements.length || incidents.length || reviews.length || checks.length},
  ].filter(view => view.available).map(({id}) => ({id,label:id}));
  const [selection, setSelection] = useState("Coverage");
  const activeView = views.find(view => view.id === selection)?.id ?? views[0]?.id;
  if (!hasDetails) {
    return (
      <div className="insurance-brief">
        <div className="insurance-brief__hero">
          {!hideIdentity && <PolicyBriefHeader row={row} sourceIds={allSourceIds} />}
          <div className="insurance-empty">No coverage details entered yet.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="insurance-brief">
      {!hideIdentity && (
        <div className="insurance-brief__hero">
          <PolicyBriefHeader row={row} sourceIds={allSourceIds} />
        </div>
      )}

      <div className="insurance-brief__grid">
        {!hideIdentity && <BriefMetric label="Policy" value={row.policyNumber || "Not set"} sub={[row.policyTermLabel, row.versionType].filter(Boolean).join(" · ")} />}
        {row.coverageCents != null && <BriefMetric label="Coverage" value={insuranceAmount(row.coverageCents, row.currency)} sub={row.deductibleCents != null ? `Deductible ${insuranceAmount(row.deductibleCents, row.currency)}` : ""} />}
        <BriefMetric label="Premium" value={insuranceAmount(row.premiumCents, row.currency)} sub={[row.policyFeeCents != null && `Fee ${insuranceAmount(row.policyFeeCents, row.currency)}`, row.totalCostCents != null && `Invoiced ${insuranceAmount(row.totalCostCents, row.currency)}`].filter(Boolean).join(" · ")} />
        <BriefMetric label="Renewal" value={formatDate(row.renewalDate)} sub={`${formatDate(row.startDate)} – ${formatDate(row.endDate)}`} />
      </div>

      {row.coverageSummary && <InsuranceDialogAction label="Read coverage wording" title="Coverage wording and notes"><p className="insurance-original-text">{row.coverageSummary}</p></InsuranceDialogAction>}

      {views.length > 1 && <Segmented className="insurance-segments" aria-label="Policy detail views" value={activeView} onChange={setSelection} items={views} />}
      {activeView === "Coverage" && <>
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
          meta={[item.coverageType || coverageCodes[item.coverageCode] || item.coverageCode, item.limitBasis, item.coveredClass, item.formNumber, item.effectiveDate, item.expiryDate]}
          amount={item.limitCents != null ? insuranceAmount(item.limitCents, item.currency || row.currency) : undefined}
          subAmount={item.deductibleCents != null ? `Deductible ${insuranceAmount(item.deductibleCents, item.currency || row.currency)}` : undefined}
          sourceIds={item.sourceExternalIds}
          citationId={item.citationId}
          notes={[item.summary, item.allocatedPremiumCents != null && `Allocated premium ${insuranceAmount(item.allocatedPremiumCents, item.currency || row.currency)}`].filter(Boolean).join(" · ")}
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
      </>}
      {activeView === "Terms" && <>
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
      </>}
      {activeView === "Records" && <>
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
      </>}
    </div>
  );
}

function DetailSection({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <section className="insurance-brief__section">
      <header className="insurance-brief__section-head">
        <strong>{title}</strong>
        <span>{rows.length}</span>
      </header>
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

function PolicyBadges({ row }: { row: any }) {
  const badges = policyCellBadges(row.status, riskFlagsForPolicy(row));
  if (!badges.length && !row.archivedAtISO) return null;
  return <span className="insurance-policy-badges">
    {row.archivedAtISO && <Badge>Archived</Badge>}
    {badges.map(({ label, tone }) => <Badge key={label} tone={tone === "status" ? statusTone(row.status) : tone}>{label}</Badge>)}
  </span>;
}

function PolicyCell({ row }: { row: any }) {
  const details = [row.broker || "Broker not set", row.policyTermLabel, row.versionType].filter(Boolean).join(" · ");
  return (
    <span title={details} style={{ display: "inline-flex", flexDirection: "column", gap: 3, maxWidth: "100%", overflow: "hidden" }}>
      <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.insurer}</strong>
      <PolicyBadges row={row} />
    </span>
  );
}

function RenewalCell({ date }: { date?: string }) {
  const days = daysUntil(date);
  if (days == null) return <span className="muted">—</span>;
  const tone: any = days < 0 ? "danger" : days <= 30 ? "warn" : days <= 60 ? "info" : "neutral";
  return (
    <>
      <span>{formatDate(date)}</span>{" "}
      <Badge tone={tone}>{days < 0 ? `${-days}d late` : `in ${days}d`}</Badge>
    </>
  );
}

function summarizePolicies(rows: any[]) {
  const current = new Set(currentRenewalPolicies(rows, todayDateOnly()).map(row => row._id));
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
  return {
    kind: form.kind || "Other",
    // Required fields stay empty when blank so validation can flag them
    // (they used to be filled with "Needs review", creating blank policies).
    insurer: cleanOptional(form.insurer) ?? "",
    ...Object.fromEntries(insuranceTermTextFields.map(([key]) => [key, key === "currency" ? cleanOptional(form[key])?.toUpperCase() : cleanOptional(form[key])])),
    grossReceiptsCents: dollarInputToCents(form.grossReceiptsDollars),
    minimumRetainedPremiumPercent: form.minimumRetainedPremiumPercent === "" || form.minimumRetainedPremiumPercent == null ? undefined : Number(form.minimumRetainedPremiumPercent),
    sourceDocumentIds: form.sourceDocumentIds ?? [],
    broker: cleanOptional(form.broker),
    policyNumber: cleanOptional(form.policyNumber) ?? "",
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
    coverageItems: form.coverageItems ? form.coverageItems.map((row: any) => ({ ...stripEditorId(row), lineId: row.lineId || row.id })) : parseCoverageItems(form.coverageItemsInput),
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

function lineRows(value: unknown) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitPiped(line: string) {
  return line.split("|").map((part) => cleanOptional(part) ?? "");
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


function cleanOptional(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function dateInput(value?: string) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function todayDate() {
  return todayDateOnly();
}

function oneYearFromToday() {
  return new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
}

function daysUntil(value?: string) {
  // Calendar days in the local calendar; date-only renewals are not shifted by UTC.
  return daysUntilDate(value);
}

function kindLabel(kind: string) {
  return ({
    DirectorsOfficers: "D&O",
    GeneralLiability: "General liability",
    PropertyCasualty: "Property and casualty",
    ProfessionalLiability: "Professional liability",
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
        {versions.length < 2 && <p className="muted" style={{ margin: 0 }}>Record a renewal to compare premiums, limits and deductibles across terms.</p>}
        {versions.map((version, index) => {
          const previous = versions[index - 1];
          return (
            <div key={version._id} className="insurance-version-link" style={{ flexWrap: "wrap" }}>
              <Link to={`/app/insurance/${version._id}`}>{version.policyTermLabel || formatDate(version.startDate)}</Link>
              <Badge tone={statusTone(version.status)}>{version.archivedAtISO ? "Archived" : version.status}</Badge>
              <span>Premium {insuranceAmount(version.premiumCents, version.currency)}</span>
              <span>Fee {insuranceAmount(version.policyFeeCents, version.currency)} · Total invoiced {insuranceAmount(version.totalCostCents, version.currency)}</span>
              <span>Coverage {insuranceAmount(version.coverageCents, version.currency)}</span>
              <span>Deductible {insuranceAmount(version.deductibleCents, version.currency)}</span>
              {previous && (previous.currency ?? "") === (version.currency ?? "") && <div style={{ width: "100%" }} className="muted">
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
    { key: "coverageCode", label: "Coverage code", choices: Object.entries(coverageCodes).map(([value, label]) => ({value, label})), emptyLabel: "Unclassified" },
    { key: "allocatedPremiumCents", label: "Allocated share of term premium (cents)", type: "number" },
    { key: "limitBasis", label: "Limit basis", choices: limitBases.map(value => ({value, label:value})), emptyLabel: "Unknown" },
    { key: "currency", label: "Currency" },
    { key: "formNumber", label: "Coverage form" },
    { key: "effectiveDate", label: "Effective date", type: "date" },
    { key: "expiryDate", label: "Expiry date", type: "date" },
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

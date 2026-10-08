import { GuidedOrganizationSetup } from "../components/GuidedOrganizationSetup";
import { MonthDayPicker } from "../components/MonthDayPicker";
import { formatAddressText } from "../../shared/structuredAddress";
import { EntitySetupFields } from "../components/EntitySetupFields";
import { entitySetupFields, validateEntitySetup } from "../../shared/entitySetup";
import { IncorporationPreparation } from "../components/IncorporationPreparation";
import { authenticatedFetch } from "@/lib/authToken";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FileDown, KeyRound, Landmark, MapPin, Plus, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { setStoredSocietyId } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Field, LockedField, Badge, Drawer } from "../components/ui";
import { Select } from "../components/Select";
import { OptionSelect } from "../components/OptionSelect";
import { DatePicker } from "../components/DatePicker";
import { StructuredAddressFields } from "../components/StructuredAddressFields";
import { Toggle } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { JURISDICTION_OPTIONS } from "../lib/jurisdictionGuideTracks";
import { optionChoices, optionLabel } from "../lib/orgHubOptions";
import { jurisdictionDisplayCopy, jurisdictionModuleContract, workspaceGovernanceCopy } from "../../shared/jurisdictionWorkspace";
import { homeJurisdictionCode, isCorporation, isSociety } from "../../shared/organizationDomain";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { useAuth } from "../auth/AuthProvider";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";
import {
  localWorkspaceRestoreSupported,
  restoreLocalWorkspaceBackup,
  readWorkspaceBackupFile,
  summarizeWorkspaceBackup,
  type WorkspaceBackupSummary,
} from "../lib/localWorkspaceExport";

type DrawerKind = "address" | "registration" | "identifier";
type LifecycleDateKey = "incorporationDate" | "continuanceDate" | "amalgamationDate" | "archivedAtISO" | "removedAtISO";

const LIFECYCLE_DATE_TYPES: { value: LifecycleDateKey; label: string }[] = [
  { value: "incorporationDate", label: "Incorporation date" },
  { value: "continuanceDate", label: "Continuance date" },
  { value: "amalgamationDate", label: "Amalgamation date" },
  { value: "archivedAtISO", label: "Archived date" },
  { value: "removedAtISO", label: "Removed date" },
];

export function SocietyNewPage() {
  const createWorkspace = useMutation(api.society.createWorkspace);
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const canRestore = isLocalDataRuntime() && !isStaticDemoRuntime() && localWorkspaceRestoreSupported();
  const restoreCard = canRestore ? <RestoreBackupCard
    onRestored={(summary) => {
      const restoredSocietyId = summary.preferredSocietyId;
      if (restoredSocietyId) setStoredSocietyId(restoredSocietyId as any);
      toast.success("Backup restored", `${summary.rowCount} records across ${summary.tableCount} tables.`);
      navigate("/app");
    }}
    onError={(message) => toast.error("Could not restore the backup", message)}
  /> : null;
  const create = async (values: Record<string, any>) => {
    setSaving(true);
    try {
      const result = await createWorkspace(values as any);
      auth.refreshMembership(result.societyId);
      setStoredSocietyId(result.societyId);
      toast.success("Workspace created", `${result.taskIds.length} onboarding tasks created.`);
      // Land on the dashboard with the new organization's setup checklist.
      navigate(`/app?welcome=${encodeURIComponent(String(result.workflowId))}`);
    } finally { setSaving(false); }
  };
  return <GuidedOrganizationSetup onCreate={create} saving={saving} restoreCard={restoreCard} canRestore={canRestore} restoreRequested={searchParams.get("restore") === "1"} />;
}

/**
 * Upload path for people who already ran Societyer somewhere else — a previous
 * browser, another device, or the desktop app — and are carrying their data in
 * a backup file. Restoring replaces whatever this local workspace holds.
 */
function RestoreBackupCard({
  onRestored,
  onError,
}: {
  onRestored: (summary: WorkspaceBackupSummary) => void;
  onError: (message: string) => void;
}) {
  const [restoring, setRestoring] = useState(false);
  const confirm = useConfirm();

  const restore = async (file: File | null | undefined, input: HTMLInputElement) => {
    if (!file) return;
    input.value = "";
    setRestoring(true);
    try {
      const preview = summarizeWorkspaceBackup(await readWorkspaceBackupFile(file));
      const ok = await confirm({
        title: "Restore this backup?",
        message: `Replace this device's local workspace with ${preview.rowCount} records for ${preview.societies.slice(0, 5).map((society) => society.name).join(", ") + (preview.societies.length > 5 ? ` and ${preview.societies.length - 5} more organizations` : "")} from "${file.name}"? Export current records first if you need to keep them. ${preview.includedFiles} saved files are bundled; ${preview.unavailableFiles} saved files are unavailable and ${preview.externalFiles} files remain external links. This replaces local records and cannot be undone.`,
        confirmLabel: "Restore", tone: "danger",
      });
      if (ok) onRestored(await restoreLocalWorkspaceBackup(file));
    } catch (error: any) {
      onError(error?.message ?? "The backup file could not be read.");
    } finally { setRestoring(false); }
  };

  return (
    <section className="card society-create__card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Restore from a backup</h2>
          <span className="card__subtitle">Already used Societyer? Bring your workspace back.</span>
        </div>
      </div>
      <div className="card__body">
        <p className="muted" style={{ marginTop: 0 }}>
          Choose the <code className="mono">.zip</code> or <code className="mono">.json</code> backup exported from Societyer on another device or
          from the desktop app. ZIP backups restore records, saved files, and retained change history together. JSON restores records and references only.
        </p>
        <label className={`btn btn--accent${restoring ? " is-disabled" : ""}`} style={{ justifySelf: "start" }}>
          <Upload size={14} /> {restoring ? "Restoring…" : "Choose backup file"}
          <input
            type="file"
            accept="application/json,application/zip,.json,.zip"
            disabled={restoring}
            style={{ display: "none" }}
            onChange={(event) => void restore(event.currentTarget.files?.[0], event.currentTarget)}
          />
        </label>
      </div>
    </section>
  );
}

export function SocietyPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("society:write");
  const detail = useQuery(api.organizationDetails.overview, society ? { societyId: society._id } : "skip");
  const evidenceDocuments = useQuery(api.documents.list, society ? { societyId: society._id } : "skip") as any[] | undefined;
  const toast = useToast();
  const confirm = useConfirm();
  const upsert = useMutation(api.society.upsert);
  const seedStructuredAddresses = useMutation(api.organizationDetails.seedFromSocietyAddresses);
  const backfillRecords = useMutation(api.organizationDetails.backfillFromExistingRecords);
  const upsertAddress = useMutation(api.organizationDetails.upsertAddress);
  const removeAddress = useMutation(api.organizationDetails.removeAddress);
  const upsertRegistration = useMutation(api.organizationDetails.upsertRegistration);
  const removeRegistration = useMutation(api.organizationDetails.removeRegistration);
  const upsertIdentifier = useMutation(api.organizationDetails.upsertIdentifier);
  const removeIdentifier = useMutation(api.organizationDetails.removeIdentifier);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importingGovernance, setImportingGovernance] = useState(false);
  const [seededAddressSocietyId, setSeededAddressSocietyId] = useState<string | null>(null);
  const [autoBackfilledSocietyId, setAutoBackfilledSocietyId] = useState<string | null>(null);
  const [drawerKind, setDrawerKind] = useState<DrawerKind | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [addingLifecycleDate, setAddingLifecycleDate] = useState(false);
  const [lifecycleDateType, setLifecycleDateType] = useState<LifecycleDateKey | "">("");
  const [lifecycleDateValue, setLifecycleDateValue] = useState("");

  // Re-seed whenever the workspace itself changes, not just the first time a
  // society arrives. A local workspace answers from its seed until IndexedDB is
  // read back, so the first `society` can be a different organization entirely —
  // and holding onto it left the form showing (and ready to save) one org's
  // details under another org's name.
  useEffect(() => {
    if (!society) return;
    setForm((current: any) => (current && current._id === society._id ? current : { ...society }));
  }, [society]);

  useEffect(() => {
    if (!canEdit || !society || detail === undefined || seededAddressSocietyId === society._id) return;
    setSeededAddressSocietyId(society._id);
    const addresses = detail?.addresses ?? [];
    const hasStructuredRegisteredOffice = addresses.some((row: any) => row.type === "registered_office");
    const hasStructuredMailing = addresses.some((row: any) => row.type === "mailing");
    const hasLegacyAddress = Boolean(society.registeredOfficeAddress || society.mailingAddress);
    if (hasLegacyAddress && (!hasStructuredRegisteredOffice || !hasStructuredMailing)) {
      void seedStructuredAddresses({ societyId: society._id }).catch((error) => {
        console.error("Society address backfill failed", error);
      });
    }
  }, [canEdit, detail, seededAddressSocietyId, seedStructuredAddresses, society]);

  useEffect(() => {
    if (!canEdit || !society || detail === undefined || autoBackfilledSocietyId === society._id) return;
    setAutoBackfilledSocietyId(society._id);
    void backfillRecords({ societyId: society._id }).catch((error) => {
      console.error("Organization detail backfill failed", error);
    });
  }, [canEdit, autoBackfilledSocietyId, backfillRecords, detail, society]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!form) return null;

  const jurisdictionCopy = jurisdictionDisplayCopy(form);
  const jurisdictionModule = jurisdictionModuleContract(form);
  const governance = workspaceGovernanceCopy(form);
  const corporate = isCorporation(form);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v, ...(k === "isCharity" ? { charityStatus: v ? "registered" : "not_applied" } : k === "isMemberFunded" ? { legalSubtype: v ? "member_funded_society" : "ordinary_society" } : k === "legalSubtype" ? { isMemberFunded: v === "member_funded_society" } : {}) }));
  const missingGovernanceCount = [
    society.constitutionDocId,
    society.bylawsDocId,
    society.privacyPolicyDocId,
  ].filter((value) => !value).length;
  const addresses = detail?.addresses ?? [];
  const currentRegisteredOffice = findCurrentAddress(addresses, "registered_office");
  const currentMailingAddress = findCurrentAddress(addresses, "mailing");
  const registeredOfficeLine = currentRegisteredOffice
    ? addressLine(currentRegisteredOffice)
    : form.registeredOfficeAddress ?? "";
  const mailingAddressLine = currentMailingAddress
    ? addressLine(currentMailingAddress)
    : form.mailingAddress ?? "";
  // Count locations actually shown below, not just structured rows — a legacy
  // plain-text address (pre-migration) still renders as a location, so the
  // badge shouldn't read "0" while the two summaries beneath it are populated.
  const displayedLocationCount =
    (registeredOfficeLine ? 1 : 0) + (mailingAddressLine ? 1 : 0);

  const lifecycleRows = LIFECYCLE_DATE_TYPES.filter((item) => Boolean(form[item.value]));
  const missingLifecycleDateOptions = LIFECYCLE_DATE_TYPES.filter((item) => !form[item.value]);
  const startAddingLifecycleDate = () => {
    const nextType = missingLifecycleDateOptions[0]?.value ?? "";
    setLifecycleDateType(nextType);
    setLifecycleDateValue("");
    setAddingLifecycleDate(Boolean(nextType));
  };
  const addLifecycleDate = () => {
    if (!lifecycleDateType || !lifecycleDateValue) return;
    set(lifecycleDateType, lifecycleDateValue);
    setLifecycleDateType("");
    setLifecycleDateValue("");
    setAddingLifecycleDate(false);
  };

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      validateEntitySetup(form);
      await upsert({
        id: form._id,
        name: form.name,
        incorporationNumber: form.incorporationNumber,
        incorporationDate: form.incorporationDate,
        fiscalYearEnd: form.fiscalYearEnd,
        jurisdictionCode: form.jurisdictionCode || undefined,
        ...entitySetupFields(form),
        anniversaryDate: form.anniversaryDate || undefined,
        entityType: form.entityType,
        actFormedUnder: form.actFormedUnder,
        officialEmail: form.officialEmail,
        numbered: !!form.numbered,
        distributing: !!form.distributing,
        solicitingPublicBenefit: !!form.solicitingPublicBenefit,
        organizationStatus: form.organizationStatus,
        archivedAtISO: form.archivedAtISO,
        removedAtISO: form.removedAtISO,
        continuanceDate: form.continuanceDate,
        amalgamationDate: form.amalgamationDate,
        naicsCode: form.naicsCode,
        niceClassification: form.niceClassification,
        isCharity: form.isCharity,
        isMemberFunded: form.isMemberFunded,
        registeredOfficeAddress: society.onboardingAnswersJson && currentRegisteredOffice ? guidedAddressText(currentRegisteredOffice) : registeredOfficeLine,
        mailingAddress: society.onboardingAnswersJson && currentMailingAddress ? guidedAddressText(currentMailingAddress) : mailingAddressLine,
        purposes: form.purposes,
        privacyOfficerName: form.privacyOfficerName,
        privacyOfficerEmail: form.privacyOfficerEmail,
        privacyProgramStatus: form.privacyProgramStatus,
        privacyProgramReviewedAtISO: form.privacyProgramReviewedAtISO,
        privacyProgramNotes: form.privacyProgramNotes,
        memberDataAccessStatus: form.memberDataAccessStatus,
        memberDataGapDocumented: !!form.memberDataGapDocumented,
        memberDataAccessReviewedAtISO: form.memberDataAccessReviewedAtISO,
        memberDataAccessNotes: form.memberDataAccessNotes,
        boardCadence: form.boardCadence,
        boardCadenceDayOfWeek: form.boardCadenceDayOfWeek,
        boardCadenceTime: form.boardCadenceTime,
        boardCadenceNotes: form.boardCadenceNotes,
        publicSlug: form.publicSlug,
        publicSummary: form.publicSummary,
        publicContactEmail: form.publicContactEmail,
        publicTransparencyEnabled: form.publicTransparencyEnabled,
        publicShowBoard: form.publicShowBoard,
        publicShowBylaws: form.publicShowBylaws,
        publicShowFinancials: form.publicShowFinancials,
        publicVolunteerIntakeEnabled: form.publicVolunteerIntakeEnabled,
        publicGrantIntakeEnabled: form.publicGrantIntakeEnabled,
        demoMode: form.demoMode,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      toast.success("Organization profile saved");
    } catch (error: any) {
      toast.error("Could not save organization", error?.message ?? String(error));
    } finally {
      setSaving(false);
    }
  };

  const backfillExistingRecords = async () => {
    const result = await backfillRecords({ societyId: society._id });
    const total = result.addressesCreated + result.minuteBookItemsCreated;
    toast.success(
      total ? "Backfill complete" : "No records added",
      `${result.addressesCreated} addresses, ${result.minuteBookItemsCreated} minute-book records`,
    );
  };

  const openNewDetailRow = (kind: DrawerKind) => {
    setDrawerKind(kind);
    if (kind === "address") {
      setDraft({
        type: "registered_office",
        status: "current",
        country: "Canada",
        street: "",
        city: "",
      });
    }
    if (kind === "registration") {
      setDraft({
        registrationType: "extra_provincial",
        jurisdiction: homeJurisdictionCode(society),
        homeJurisdiction: homeJurisdictionCode(society),
        representativeIds: [],
        status: "active",
      });
    }
    if (kind === "identifier") {
      setDraft({
        kind: "business_number",
        number: "",
        status: "active",
        accessLevel: "restricted",
      });
    }
  };

  const saveDetailDrawer = async () => {
    if (!drawerKind || !draft) return;
    try {
    if (drawerKind === "address") {
      await upsertAddress({
        id: draft._id,
        societyId: society._id,
        type: draft.type,
        status: draft.status,
        effectiveFrom: draft.effectiveFrom || undefined,
        effectiveTo: draft.effectiveTo || undefined,
        street: draft.street || "Needs review",
        unit: draft.unit || undefined,
        city: draft.city || "Needs review",
        provinceState: draft.provinceState || undefined,
        postalCode: draft.postalCode || undefined,
        country: draft.country || "Canada",
        notes: draft.notes || undefined,
      });
    }
    if (drawerKind === "registration") {
      await upsertRegistration({
        id: draft._id,
        societyId: society._id,
        registrationType: draft.registrationType || "extra_provincial",
        corporationClass: draft.corporationClass || undefined,
        licenceEvidenceDocumentId: draft.licenceEvidenceDocumentId || undefined,
        jurisdiction: draft.jurisdiction || "Needs review",
        homeJurisdiction: draft.homeJurisdiction || undefined,
        assumedName: draft.assumedName || undefined,
        registrationNumber: draft.registrationNumber || undefined,
        registrationDate: draft.registrationDate || undefined,
        activityCommencementDate: draft.activityCommencementDate || undefined,
        deRegistrationDate: draft.deRegistrationDate || undefined,
        nuansNumber: draft.nuansNumber || undefined,
        officialEmail: draft.officialEmail || undefined,
        annualReturnDueDate: draft.annualReturnDueDate || undefined,
        lastAnnualReturnFiledDate: draft.lastAnnualReturnFiledDate || undefined,
        registryProfileReportDate: draft.registryProfileReportDate || undefined,
        registryPortalKey: draft.registryPortalKey || undefined,
        agentForServiceName: draft.agentForServiceName || undefined,
        agentForServiceAddress: draft.agentForServiceAddress || undefined,
        principalOfficeAddress: draft.principalOfficeAddress || undefined,
        representativeIds: csv(draft.representativeIdsText ?? draft.representativeIds),
        status: draft.status || "active",
        notes: draft.notes || undefined,
      });
    }
    if (drawerKind === "identifier") {
      await upsertIdentifier({
        id: draft._id,
        societyId: society._id,
        kind: draft.kind || "other",
        number: draft.number || "Needs review",
        jurisdiction: draft.jurisdiction || undefined,
        foreignJurisdiction: draft.foreignJurisdiction || undefined,
        registeredAt: draft.registeredAt || undefined,
        status: draft.status || "active",
        accessLevel: draft.accessLevel || "restricted",
        notes: draft.notes || undefined,
      });
    }
    toast.success("Saved");
    setDrawerKind(null);
    setDraft(null);
    } catch (error: any) { toast.error("Could not save record", error?.message ?? String(error)); }
  };

  const removeDetailRow = async (kind: DrawerKind, row: any) => {
    const ok = await confirm({
      title: "Remove record?",
      message: `"${row.title ?? row.jurisdiction ?? row.type ?? row.kind}" will be removed from the organization detail register.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    if (kind === "address") await removeAddress({ id: row._id });
    if (kind === "registration") await removeRegistration({ id: row._id });
    if (kind === "identifier") await removeIdentifier({ id: row._id });
    toast.success("Removed");
  };

  const importGovernanceDocuments = async () => {
    setImportingGovernance(true);
    try {
      const response = await authenticatedFetch("/api/v1/browser-connectors/governance-documents/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          societyId: society._id,
          corpNum: society.incorporationNumber,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.message ?? `Request failed with ${response.status}`);
      }
      const data = payload.data ?? {};
      const imported = Array.isArray(data.imported) ? data.imported : [];
      const missing = Array.isArray(data.missing) ? data.missing : [];
      if (imported.length) {
        toast.success(
          "Governance documents imported",
          `${imported.length} document${imported.length === 1 ? "" : "s"} linked from BC Registry.`,
        );
      } else if (missing.length) {
        toast.warn(
          "No registry documents imported",
          missing.map((item: any) => item.message ?? item.reason).filter(Boolean).join(" "),
        );
      } else {
        toast.info("Governance documents already on file");
      }
    } catch (error: any) {
      toast.error("Could not import governance documents", error?.message ?? "Open a BC Registry browser session and try again.");
    } finally {
      setImportingGovernance(false);
    }
  };

  return (
    <div className="page page--wide">
      <PageHeader
        routeKey="/app/society"
        title="Organization profile"
        subtitle={form.organizationStatus === "pre_incorporation" ? "Preparing incorporation. Add the assigned registry number and effective date after confirmation." : "Governing details, registered office, and key flags."}
        actions={
          <>
            <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              {saved ? "Saved" : `Last updated ${formatDate(society.updatedAt)}`}
            </span>
            <button className="btn btn--accent" onClick={save} disabled={saving || !canEdit}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      />

      {["preparing", "submitted"].includes(form.formationStatus ?? "") && <IncorporationPreparation organization={form} />}

      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="society-layout">
        <main className="society-layout__main">
          <div className="card">
            <div className="card__head"><h2 className="card__title">Identity</h2></div>
            <div className="card__body">
              <LockedField
                label="Legal name"
                reason="Changing the legal name can require a special resolution, name reservation, and registry filing. Review the active jurisdiction guide and governing documents first."
              >
                {(locked) => (
                  <input
                    className="input"
                    disabled={locked}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                )}
              </LockedField>

              <div className="society-field-grid society-field-grid--three society-field-grid--registry-dates">
                <LockedField
                  label="Incorporation #"
                  reason="The incorporation or corporation number is assigned by the registry and generally stays stable for the life of the organization. Edit only to fix a data-entry error."
                >
                  {(locked) => (
                    <input
                      className="input"
                      disabled={locked}
                      value={form.incorporationNumber ?? ""}
                      onChange={(e) => set("incorporationNumber", e.target.value)}
                    />
                  )}
                </LockedField>
                <LockedField
                  label="Incorporation date"
                  reason="The date of incorporation is a historical fact recorded by the registry. Edit only to fix a data-entry error."
                >
                  {(locked) => (
                    <DatePicker
                      disabled={locked}
                      value={form.incorporationDate ?? ""}
                      onChange={(v) => set("incorporationDate", v)}
                    />
                  )}
                </LockedField>
                <LockedField
                  label="Fiscal year end"
                  reason="Changing the fiscal year end can require a bylaw amendment and notification to the CRA. Affects every filing deadline downstream."
                >
                  {(locked) => (
                    <MonthDayPicker
                      ariaLabel="Fiscal year end"
                      disabled={locked}
                      value={form.fiscalYearEnd}
                      onChange={(value) => set("fiscalYearEnd", value)}
                    />
                  )}
                </LockedField>
              </div>

              <LockedField
                label={governance.purposesLabel}
                reason="Purposes or articles can require member/shareholder approval and a registry filing to change. Charities may also need CRA review."
              >
                {(locked) => (
                  <MarkdownEditor
                    rows={4}
                    readOnly={locked}
                    value={form.purposes ?? ""}
                    onChange={(markdown) => set("purposes", markdown)}
                  />
                )}
              </LockedField>

              <div className="society-field-grid">
                <Field label="Legal jurisdiction" hint="Used for statutory guide tracks and point-in-time legal sources.">
                  <Select
                    value={form.jurisdictionCode ?? ""}
                    onChange={(value) => set("jurisdictionCode", value)}
                    options={JURISDICTION_OPTIONS}
                  />
                </Field>

                <LockedField
                  label="Status flags"
                  reason="Charity status is controlled by the CRA. Jurisdiction-specific status flags should be reviewed against the governing statute and filed documents."
                >
                  {(locked) => (
                    <div className="society-toggle-stack">
                      <Toggle
                        checked={!!form.isCharity}
                        onChange={(v) => set("isCharity", v)}
                        disabled={locked}
                        label="Registered CRA charity"
                      />
                      {!corporate && <Toggle
                        checked={!!form.isMemberFunded}
                        onChange={(v) => set("isMemberFunded", v)}
                        disabled={locked}
                        label="Member-funded society"
                      />}
                    </div>
                  )}
                </LockedField>
              </div>
            </div>
          </div>
        </main>

        <aside className="society-layout__side">
          <div className="card">
            <div className="card__head">
              <div className="row" style={{ gap: 8 }}>
                <MapPin size={14} />
                <h2 className="card__title">Registered locations</h2>
                <Badge>{detail === undefined ? "..." : displayedLocationCount}</Badge>
              </div>
              <a className="btn btn--sm" href="#more-organization-details" style={{ marginLeft: "auto" }}>Manage</a>
            </div>
            <div className="card__body">
              <div className="society-address-list">
                <AddressSummary
                  label="Registered office"
                  row={currentRegisteredOffice}
                  fallback={form.registeredOfficeAddress}
                  hint={jurisdictionCopy.registeredOfficeHint}
                />
                <AddressSummary
                  label="Mailing address"
                  row={currentMailingAddress}
                  fallback={form.mailingAddress}
                />
              </div>
              <div className="hr" />
              <div className="society-field-grid society-field-grid--mobile-pair">
                <Field label={jurisdictionCopy.privacyOfficerLabel}>
                  <input className="input" value={form.privacyOfficerName ?? ""} onChange={(e) => set("privacyOfficerName", e.target.value)} />
                </Field>
                <Field label="Privacy officer email">
                  <input className="input" value={form.privacyOfficerEmail ?? ""} onChange={(e) => set("privacyOfficerEmail", e.target.value)} />
                </Field>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Governance documents</h2>
              {jurisdictionModule.registryImportSupported && (
                <button
                  className="btn btn--sm"
                  onClick={importGovernanceDocuments}
                  disabled={importingGovernance || missingGovernanceCount === 0}
                  style={{ marginLeft: "auto" }}
                  type="button"
                >
                  <FileDown size={12} />
                  {importingGovernance ? "Checking…" : "Auto-fill missing"}
                </button>
              )}
            </div>
            <div className="card__body">
              <div className="table-wrap society-doc-table-wrap">
                <table className="table society-doc-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <DocTableRow label={governance.formationDocumentLabel} present={!!society.constitutionDocId} />
                    <DocTableRow label="Bylaws" present={!!society.bylawsDocId} />
                    <DocTableRow label={jurisdictionCopy.privacyPolicyLabel} present={!!society.privacyPolicyDocId} />
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2 className="card__title">Board meeting cadence</h2></div>
            <div className="card__body">
              <div className="society-field-grid society-field-grid--mobile-pair">
                <Field label="Cadence">
                  <Select
                    value={form.boardCadence ?? ""}
                    onChange={(v) => set("boardCadence", v)}
                    clearable
                    options={["Weekly", "Biweekly", "Monthly", "Bimonthly", "Quarterly", "Ad-hoc"].map((c) => ({ value: c, label: c }))}
                  />
                </Field>
                <Field label="Day of week">
                  <Select
                    value={form.boardCadenceDayOfWeek ?? ""}
                    onChange={(v) => set("boardCadenceDayOfWeek", v)}
                    clearable
                    clearLabel="—"
                    options={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => ({ value: d, label: d }))}
                  />
                </Field>
              </div>
              <Field label="Time (24h)">
                <input className="input" type="time" value={form.boardCadenceTime ?? ""} onChange={(e) => set("boardCadenceTime", e.target.value)} />
              </Field>
              <Field label="Notes" hint="e.g. Fourth Thursday of each month, except July & August.">
                <input className="input" value={form.boardCadenceNotes ?? ""} onChange={(e) => set("boardCadenceNotes", e.target.value)} />
              </Field>
            </div>
          </div>
        </aside>
      </div>

      <details id="more-organization-details" className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", padding: "var(--space-4, 16px)", fontWeight: 600 }}>
          More organization details
          <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: "var(--fs-sm)" }}>
            Registry classification, lifecycle dates, extra-provincial registrations, and tax identifiers.
          </span>
        </summary>
        <div className="card__body" style={{ paddingTop: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn-action" type="button" onClick={backfillExistingRecords}>Backfill records</button>
          </div>

          <div className="org-details-top">
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Registry profile</h2>
                <span className="card__subtitle">Stable facts used across filings and workflows.</span>
              </div>
              <div className="card__body">
                <div className="org-details-field-grid">
                  <OptionSelect label="Entity type" setName="entityTypes" value={form.entityType ?? ""} onChange={(value) => { set("entityType", value); set("legalSubtype", "other"); }} emptyLabel="Needs classification" />
                  <OptionSelect label="Act formed under" setName="actsFormedUnder" value={form.actFormedUnder ?? ""} onChange={(value) => set("actFormedUnder", value)} emptyLabel="Review governing Act" />
                  <OptionSelect label="Organization status" setName="organizationStatuses" value={form.organizationStatus ?? ""} onChange={(value) => set("organizationStatus", value)} emptyLabel="No status" />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Lifecycle dates</h2>
                <span className="card__subtitle">Primary incorporation plus registry events.</span>
                <button
                  className="btn btn--sm"
                  type="button"
                  onClick={startAddingLifecycleDate}
                  disabled={addingLifecycleDate || missingLifecycleDateOptions.length === 0}
                  style={{ marginLeft: "auto" }}
                >
                  <Plus size={12} />
                  Add date
                </button>
              </div>
              <div className="card__body">
                <div className="org-details-date-list">
                  {lifecycleRows.length === 0 && !addingLifecycleDate && (
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No lifecycle dates recorded.</div>
                  )}
                  {lifecycleRows.map((item) => (
                    <div className="org-details-date-row" key={item.value}>
                      <Field label={item.label}>
                        <DatePicker value={form[item.value] ?? ""} onChange={(value) => set(item.value, value)} />
                      </Field>
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        type="button"
                        aria-label={`Clear ${item.label}`}
                        onClick={() => set(item.value, "")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {addingLifecycleDate && (
                    <div className="org-details-date-row org-details-date-row--draft">
                      <Field label="Date type">
                        <Select
                          value={lifecycleDateType}
                          onChange={(value) => setLifecycleDateType(value as LifecycleDateKey)}
                          options={missingLifecycleDateOptions}
                        />
                      </Field>
                      <Field label="Date">
                        <DatePicker value={lifecycleDateValue} onChange={setLifecycleDateValue} />
                      </Field>
                      <div className="org-details-date-row__actions">
                        <button className="btn btn--sm" type="button" onClick={() => setAddingLifecycleDate(false)}>Cancel</button>
                        <button className="btn btn--sm btn--accent" type="button" onClick={addLifecycleDate} disabled={!lifecycleDateType || !lifecycleDateValue}>Add</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card org-details-classification-card">
              <div className="card__head">
                <h2 className="card__title">Classification and flags</h2>
              </div>
              <div className="card__body">
                <div className="org-details-field-grid">
                  <Field label="NAICS code">
                    <input className="input" value={form.naicsCode ?? ""} onChange={(e) => set("naicsCode", e.target.value)} />
                  </Field>
                  <Field label="Nice classification">
                    <input className="input" value={form.niceClassification ?? ""} onChange={(e) => set("niceClassification", e.target.value)} />
                  </Field>
                </div>
                <EntitySetupFields form={form} set={set} includeDates documents={evidenceDocuments ?? []} />
                <div className="org-details-toggle-row">
                  <Toggle checked={!!form.numbered} onChange={(value) => set("numbered", value)} label="Numbered entity" />
                  <Toggle checked={!!form.distributing} onChange={(value) => set("distributing", value)} label="Distributing" />
                  <Toggle checked={!!form.solicitingPublicBenefit} onChange={(value) => set("solicitingPublicBenefit", value)} label="Soliciting / public benefit" />
                </div>
              </div>
            </div>
          </div>

          <div className="org-detail-registers">
            <DetailSection
              icon={<MapPin size={14} />}
              title="Structured addresses"
              count={detail?.addresses?.length ?? 0}
              action={<button className="btn-action btn-action--primary" onClick={() => openNewDetailRow("address")}><Plus size={12} /> Address</button>}
            >
              <SimpleTable
                rows={detail?.addresses ?? []}
                empty="No structured addresses yet."
                columns={["Type", "Status", "Address", "Effective", ""]}
                tableClassName="org-address-table"
                render={(row: any) => [
                  optionLabel("addressTypes", row.type),
                  <Badge key="s" tone={row.status === "current" ? "success" : "neutral"}>{optionLabel("addressStatuses", row.status)}</Badge>,
                  <span key="address" className="org-address-table__address">{addressLine(row)}</span>,
                  dateRange(row.effectiveFrom, row.effectiveTo),
                  <RowActions key="a" onEdit={() => { setDrawerKind("address"); setDraft(row); }} onRemove={() => removeDetailRow("address", row)} />,
                ]}
              />
            </DetailSection>

            <div className="org-detail-registers__pair">
              <DetailSection
                icon={<Landmark size={14} />}
                title="Registration records"
                count={detail?.registrations?.length ?? 0}
                action={<button className="btn-action btn-action--primary" onClick={() => openNewDetailRow("registration")}><Plus size={12} /> Registration</button>}
              >
                <SimpleTable
                  rows={detail?.registrations ?? []}
                  empty="No external or extra-provincial registrations yet."
                  columns={["Jurisdiction", "Registration", "Dates", "Status", ""]}
                  render={(row: any) => [
                    <div key="j">
                      <strong>{optionLabel("entityJurisdictions", row.jurisdiction)}</strong>
                      <div className="muted">{optionLabel("registrationTypes", row.registrationType ?? "extra_provincial")}</div>
                    </div>,
                    <div key="r"><strong>{row.assumedName || "Legal name"}</strong><div className="mono muted">{row.registrationNumber ?? "No number"}{row.nuansNumber ? ` · NUANS ${row.nuansNumber}` : ""}</div></div>,
                    <div key="dates"><div>Registered: {row.registrationDate ? formatDate(row.registrationDate) : "Unknown"}</div><div>Business started: {row.activityCommencementDate ? formatDate(row.activityCommencementDate) : "Unknown"}</div>{row.deRegistrationDate && <div>Ended: {formatDate(row.deRegistrationDate)}</div>}</div>,
                    <Badge key="s" tone={row.status === "active" ? "success" : "warn"}>{optionLabel("registrationStatuses", row.status)}</Badge>,
                    <RowActions key="a" onEdit={() => { setDrawerKind("registration"); setDraft({ ...row, representativeIdsText: (row.representativeIds ?? []).join(", ") }); }} onRemove={() => removeDetailRow("registration", row)} />,
                  ]}
                />
              </DetailSection>

              <DetailSection
                icon={<KeyRound size={14} />}
                title="Tax and registry identifiers"
                count={detail?.identifiers?.length ?? 0}
                action={<button className="btn-action btn-action--primary" onClick={() => openNewDetailRow("identifier")}><Plus size={12} /> Identifier</button>}
              >
                <SimpleTable
                  rows={detail?.identifiers ?? []}
                  empty="No tax or registry identifiers yet."
                  columns={["Kind", "Number", "Jurisdiction", "Status", ""]}
                  render={(row: any) => [
                    optionLabel("taxNumberTypes", row.kind),
                    <span key="n" className="mono">{row.accessLevel === "restricted" ? mask(row.number) : row.number}</span>,
                    row.foreignJurisdiction || row.jurisdiction || "-",
                    <Badge key="s" tone={row.accessLevel === "restricted" ? "danger" : row.status === "active" ? "success" : "warn"}>{optionLabel("identifierStatuses", row.status)}</Badge>,
                    <RowActions key="a" onEdit={() => { setDrawerKind("identifier"); setDraft(row); }} onRemove={() => removeDetailRow("identifier", row)} />,
                  ]}
                />
              </DetailSection>
            </div>
          </div>
        </div>
      </details>
      </fieldset>

      <Drawer
        open={!!drawerKind}
        onClose={() => { setDrawerKind(null); setDraft(null); }}
        title={drawerTitle(drawerKind, draft)}
        footer={
          <>
            <button className="btn" onClick={() => { setDrawerKind(null); setDraft(null); }}>Cancel</button>
            <button className="btn btn--accent" disabled={!canEdit} onClick={saveDetailDrawer}>Save</button>
          </>
        }
      >
        {drawerKind === "address" && draft && <AddressFields draft={draft} setDraft={setDraft} />}
        {drawerKind === "registration" && draft && <RegistrationFields draft={draft} setDraft={setDraft} documents={evidenceDocuments ?? []} />}
        {drawerKind === "identifier" && draft && <IdentifierFields draft={draft} setDraft={setDraft} />}
      </Drawer>
    </div>
  );
}

function AddressSummary({ label, row, fallback, hint }: { label: string; row?: any; fallback?: string; hint?: string }) {
  const line = row ? addressLine(row) : fallback;
  return (
    <div className="society-address-item">
      <div className="society-address-item__head">
        <strong>{label}</strong>
        {row ? (
          <Badge tone={row.status === "current" ? "success" : "neutral"}>{optionLabel("addressStatuses", row.status)}</Badge>
        ) : fallback ? (
          <Badge tone="warn">Legacy</Badge>
        ) : (
          <Badge>Missing</Badge>
        )}
      </div>
      <div className={line ? "society-address-item__line" : "society-address-item__line muted"}>
        {line || "No address on file"}
      </div>
      {row?.effectiveFrom && (
        <div className="field__hint">Effective {formatDate(row.effectiveFrom)}</div>
      )}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

function DocTableRow({ label, present }: { label: string; present: boolean }) {
  return (
    <tr>
      <td>
        <strong>{label}</strong>
      </td>
      <td>
        <Badge tone={present ? "success" : "warn"}>{present ? "On file" : "Missing"}</Badge>
      </td>
      <td className={present ? "table__cell--muted" : undefined}>
        {present ? "—" : "No linked document"}
      </td>
    </tr>
  );
}

function findCurrentAddress(addresses: any[], type: string) {
  return addresses.find((row) => row.type === type && row.status === "current")
    ?? addresses.find((row) => row.type === type);
}

function addressLine(row: any) {
  return [row.unit, row.street, row.city, row.provinceState, row.postalCode, row.country]
    .filter(isAddressPart)
    .join(", ");
}

function guidedAddressText(row: Record<string, any>) {
  return formatAddressText(Object.fromEntries(["unit", "street", "city", "provinceState", "postalCode", "country"].map((key) => [key, isAddressPart(row[key]) ? row[key] : ""])));
}

function isAddressPart(value: unknown) {
  if (!value) return false;
  const text = String(value).trim();
  return Boolean(text) && text.toLowerCase() !== "needs review";
}

function DetailSection({ icon, title, count, action, children }: any) {
  return (
    <div className="card org-detail-section">
      <div className="card__head">
        <div className="row" style={{ gap: 8 }}>
          {icon}
          <h2 className="card__title">{title}</h2>
          <Badge>{count}</Badge>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SimpleTable({ rows, columns, render, empty, tableClassName }: any) {
  if (rows.length === 0) return <div className="card__body muted">{empty}</div>;
  const className = ["table", tableClassName].filter(Boolean).join(" ");
  return (
    <table className={className}>
      <thead><tr>{columns.map((column: string) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>
        {rows.map((row: any) => (
          <tr key={row._id}>{render(row).map((cell: any, index: number) => <td key={index}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function RowActions({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button className="btn btn--ghost btn--sm" onClick={onEdit}>Edit</button>
      <button className="btn btn--ghost btn--sm btn--icon" aria-label="Remove" onClick={onRemove}><Trash2 size={12} /></button>
    </div>
  );
}

function AddressFields({ draft, setDraft }: any) {
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Type" setName="addressTypes" value={draft.type ?? ""} onChange={(value) => setDraft({ ...draft, type: value })} />
        <OptionSelect label="Status" setName="addressStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <StructuredAddressFields value={draft} onChange={(value) => setDraft({ ...draft, ...value })} />
      <div className="row" style={{ gap: 12 }}>
        <Field label="Effective from"><DatePicker value={draft.effectiveFrom ?? ""} onChange={(value) => setDraft({ ...draft, effectiveFrom: value })} /></Field>
        <Field label="Effective to"><DatePicker value={draft.effectiveTo ?? ""} onChange={(value) => setDraft({ ...draft, effectiveTo: value })} /></Field>
      </div>
      <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
    </>
  );
}

function RegistrationFields({ draft, setDraft, documents }: any) {
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Registration type" setName="registrationTypes" value={draft.registrationType ?? ""} onChange={(value) => setDraft({ ...draft, registrationType: value })} emptyLabel="No type" />
        <OptionSelect label="Registration jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, jurisdiction: value })} emptyLabel="No jurisdiction" />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Home jurisdiction" setName="entityJurisdictions" value={draft.homeJurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, homeJurisdiction: value })} emptyLabel="No home jurisdiction" />
      </div>
      <Field label="Corporation registration class" hint="Ontario EPCA licence obligations apply to the licensed foreign class; ordinary federal corporations need a separate assessment."><Select value={draft.corporationClass ?? ""} onChange={(value) => setDraft({ ...draft, corporationClass: value })} options={[{ value: "", label: "Unclassified / needs review" }, { value: "federal_corporation", label: "Federal corporation" }, { value: "foreign_epca_licensed", label: "Ontario licensed foreign corporation (EPCA)" }, { value: "other", label: "Other — assess registry obligations" }]} /></Field>
      <Field label="Licence evidence document" hint="Required before selecting Ontario licensed foreign corporation."><Select value={draft.licenceEvidenceDocumentId ?? ""} onChange={(value) => setDraft({ ...draft, licenceEvidenceDocumentId: value })} options={[{ value: "", label: "Select an evidence document" }, ...documents.map((document: any) => ({ value: document._id, label: document.title }))]} /></Field>
      <Field label="Assumed name"><input className="input" value={draft.assumedName ?? ""} onChange={(e) => setDraft({ ...draft, assumedName: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Registration number"><input className="input" value={draft.registrationNumber ?? ""} onChange={(e) => setDraft({ ...draft, registrationNumber: e.target.value })} /></Field>
        <Field label="NUANS number"><input className="input" value={draft.nuansNumber ?? ""} onChange={(e) => setDraft({ ...draft, nuansNumber: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Registration date"><DatePicker value={draft.registrationDate ?? ""} onChange={(value) => setDraft({ ...draft, registrationDate: value })} /></Field>
        <Field label="Activity commenced"><DatePicker value={draft.activityCommencementDate ?? ""} onChange={(value) => setDraft({ ...draft, activityCommencementDate: value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="De-registration date"><DatePicker value={draft.deRegistrationDate ?? ""} onChange={(value) => setDraft({ ...draft, deRegistrationDate: value })} /></Field>
        <OptionSelect label="Status" setName="registrationStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Annual return due"><DatePicker value={draft.annualReturnDueDate ?? ""} onChange={(value) => setDraft({ ...draft, annualReturnDueDate: value })} /></Field>
        <Field label="Last annual return filed"><DatePicker value={draft.lastAnnualReturnFiledDate ?? ""} onChange={(value) => setDraft({ ...draft, lastAnnualReturnFiledDate: value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Profile report date"><DatePicker value={draft.registryProfileReportDate ?? ""} onChange={(value) => setDraft({ ...draft, registryProfileReportDate: value })} /></Field>
        <Field label="Registry portal key"><input className="input" value={draft.registryPortalKey ?? ""} onChange={(e) => setDraft({ ...draft, registryPortalKey: e.target.value })} /></Field>
      </div>
      <Field label="Principal office"><input className="input" value={draft.principalOfficeAddress ?? ""} onChange={(e) => setDraft({ ...draft, principalOfficeAddress: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Agent for service"><input className="input" value={draft.agentForServiceName ?? ""} onChange={(e) => setDraft({ ...draft, agentForServiceName: e.target.value })} /></Field>
        <Field label="Agent address"><input className="input" value={draft.agentForServiceAddress ?? ""} onChange={(e) => setDraft({ ...draft, agentForServiceAddress: e.target.value })} /></Field>
      </div>
      <Field label="Official email"><input className="input" value={draft.officialEmail ?? ""} onChange={(e) => setDraft({ ...draft, officialEmail: e.target.value })} /></Field>
      <Field label="Representatives"><input className="input" value={draft.representativeIdsText ?? (draft.representativeIds ?? []).join(", ")} onChange={(e) => setDraft({ ...draft, representativeIdsText: e.target.value })} placeholder="Name or record IDs, comma separated" /></Field>
      <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
    </>
  );
}

function IdentifierFields({ draft, setDraft }: any) {
  return (
    <>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Kind" setName="taxNumberTypes" value={draft.kind ?? ""} onChange={(value) => setDraft({ ...draft, kind: value })} />
        <OptionSelect label="Status" setName="identifierStatuses" value={draft.status ?? ""} onChange={(value) => setDraft({ ...draft, status: value })} />
      </div>
      <Field label="Number"><input className="input mono" value={draft.number ?? ""} onChange={(e) => setDraft({ ...draft, number: e.target.value })} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <OptionSelect label="Jurisdiction" setName="entityJurisdictions" value={draft.jurisdiction ?? ""} onChange={(value) => setDraft({ ...draft, jurisdiction: value })} emptyLabel="No jurisdiction" />
        <Field label="Foreign jurisdiction"><input className="input" value={draft.foreignJurisdiction ?? ""} onChange={(e) => setDraft({ ...draft, foreignJurisdiction: e.target.value })} /></Field>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Registered at"><DatePicker value={draft.registeredAt ?? ""} onChange={(value) => setDraft({ ...draft, registeredAt: value })} /></Field>
        <OptionSelect label="Access level" setName="accessLevels" value={draft.accessLevel ?? ""} onChange={(value) => setDraft({ ...draft, accessLevel: value })} />
      </div>
      <Field label="Notes"><MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(markdown) => setDraft({ ...draft, notes: markdown })} /></Field>
    </>
  );
}

function drawerTitle(kind: DrawerKind | null, draft: any) {
  if (!kind) return "Organization detail";
  const prefix = draft?._id ? "Edit" : "New";
  return `${prefix} ${kind}`;
}

function csv(value: any) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function dateRange(start?: string, end?: string) {
  if (!start && !end) return "-";
  return `${start ? formatDate(start) : "?"} - ${end ? formatDate(end) : "current"}`;
}

function mask(value?: string) {
  const text = String(value ?? "");
  if (text.length <= 4) return "restricted";
  return `**** ${text.slice(-4)}`;
}

import { GuidedOrganizationSetup } from "../components/GuidedOrganizationSetup";
import { organizationStatusForFormation, validateArticlesProvisions, validateEntitySetup } from "../../shared/entitySetup";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { FileUp, Upload } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { setStoredSocietyId } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Tabs } from "../components/primitives";
import { ORGANIZATION_SETUP_PATH } from "../../shared/organizationSetup/types";
import { ENTITY_KIND_ENTITY_TYPES, entityKindForType, type IncorporationAct } from "../../shared/incorporationActs";
import { isCorporation, isPreparingIncorporation } from "../../shared/organizationDomain";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { useAuth } from "../auth/AuthProvider";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";
import {
  localWorkspaceRestoreSupported,
  restoreLocalWorkspaceBackup,
  readWorkspaceBackupFile,
  summarizeWorkspaceBackup,
  type WorkspaceBackupSummary,
} from "../lib/localWorkspaceExport";
import { OverviewTab, ProfileHeaderFacts } from "../features/organizationProfile/OverviewTab";
import { LegalProfileTab } from "../features/organizationProfile/LegalProfileTab";
import { RegistrationsTab } from "../features/organizationProfile/RegistrationsTab";
import { OfficesTab } from "../features/organizationProfile/OfficesTab";
import { TaxTab } from "../features/organizationProfile/TaxTab";
import { DocumentsTab } from "../features/organizationProfile/DocumentsTab";
import { useDetailDrawer } from "../features/organizationProfile/useDetailDrawer";
import { profileUpsertArgs } from "../features/organizationProfile/saveProfile";
import { useProfileTab } from "../features/organizationProfile/useProfileTab";
import { unsavedProfileTabs } from "../features/organizationProfile/tabFields";
import { ArticlesCard } from "../features/organizationProfile/ArticlesCard";
import { RegistryPackageCard } from "../features/organizationProfile/RegistryPackageCard";
import { useRegistryDrawers } from "../features/organizationProfile/useRegistryDrawers";
import "../features/organizationProfile/organization-profile.scss";
import { PROFILE_TABS, type OrganizationDetail, type OrganizationRecord, type ProfileDocument, type ProfileForm, type ProfileTab, type SetProfileField } from "../features/organizationProfile/types";

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
      // Land on the setup view. Its one-time welcome confirms the new
      // workspace, so no toast covers the steps on arrival (phones).
      navigate(`${ORGANIZATION_SETUP_PATH}?welcome=1`);
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

/* ------------------------------------------------------ organization profile */

const TAB_LABELS: Record<ProfileTab, string> = {
  overview: "Overview",
  legal: "Legal profile",
  registrations: "Registrations",
  offices: "Offices & contacts",
  tax: "Tax accounts",
  documents: "Documents",
};

/**
 * The organization profile, in six tabs. This page owns the profile form and
 * its one "Save changes"; each tab edits part of the form, and a tab with
 * unsaved edits shows a dot. Register rows (addresses, registrations,
 * identifiers) save through their own drawers.
 */
export function SocietyPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("society:write");
  const detail = useQuery(api.organizationDetails.overview, society ? { societyId: society._id } : "skip") as OrganizationDetail | undefined;
  const evidenceDocuments = useQuery(api.documents.list, society ? { societyId: society._id } : "skip") as ProfileDocument[] | undefined;
  const toast = useToast();
  const upsert = useMutation(api.society.upsert);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const drawer = useDetailDrawer(society, canEdit, evidenceDocuments);
  const { tab, setTab, showTab } = useProfileTab();
  const backfillExistingRecords = useRecordBackfills(society, detail, canEdit);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const registry = useRegistryDrawers({ society, form, setForm, detail, documents: evidenceDocuments, canEdit });

  const formReady = Boolean(form);
  // ?intent=address opens the new-address form over the addresses register.
  useEffect(() => {
    if (!formReady || !permissions.loaded) return;
    if (searchParams.get("intent") !== "address") return;
    if (canEdit) drawer.openAddress();
    const params = new URLSearchParams(searchParams);
    params.delete("intent");
    params.set("tab", "offices");
    navigate({ pathname: location.pathname, search: `?${params.toString()}`, hash: "#registered-office" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formReady, permissions.loaded, searchParams]);

  // Re-seed whenever the workspace itself changes, not just the first time a
  // society arrives. A local workspace answers from its seed until IndexedDB is
  // read back, so the first `society` can be a different organization entirely —
  // and holding onto it left the form showing (and ready to save) one org's
  // details under another org's name.
  useEffect(() => {
    if (!society) return;
    setForm((current) => (current && current._id === society._id ? current : { ...society }));
  }, [society]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!form) return null;

  const set: SetProfileField = (key, value) => setForm((current) => current && withProfileField(current, key, value));
  const setGoverningAct = (value: string | undefined, act?: IncorporationAct) => setForm((current) => current && withGoverningAct(current, value, act));
  // The form decides the status the header shows, so a status change reads
  // back immediately, before it is saved.
  const preparing = isPreparingIncorporation(form);
  const unsaved = unsavedProfileTabs(form, society);
  // Articles and the registry package are a corporation's.
  const corporation = isCorporation(form);
  const articlesCard = corporation ? <ArticlesCard society={society} form={form} set={set} documents={evidenceDocuments ?? []} /> : undefined;
  const registryPackage = corporation ? <RegistryPackageCard society={society} detail={detail} documents={evidenceDocuments} canEdit={canEdit} onImport={registry.openImport} /> : undefined;

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      validateEntitySetup(form);
      validateArticlesProvisions(form);
      await upsert(profileUpsertArgs(form, society, detail?.addresses ?? []));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      toast.success("Organization profile saved");
    } catch (error) {
      toast.error("Could not save organization", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const tabItems = PROFILE_TABS.map((id) => ({
    id,
    label: TAB_LABELS[id],
    count: id === "registrations" ? detail?.registrations.length || null : null,
    // Tabs draw the icon slot before the label; CSS moves the dot after it.
    icon: unsaved.has(id) ? <span className="org-profile-tab-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes" /> : undefined,
  }));
  const updated = saved ? "Saved" : `Last updated ${formatDate(society.updatedAt)}`;

  return (
    <div className="page page--wide">
      <PageHeader
        routeKey="/app/society"
        title="Organization profile"
        subtitle={preparing
          ? form.formationStatus === "submitted"
            ? "Filed with the registry. The registry number and date come from the certificate of incorporation."
            : "Preparing incorporation. The registry number and date come from the certificate of incorporation."
          : "Legal identity, registrations, offices, tax accounts and governing documents."}
        actions={
          <>
            <span className="muted society-header__updated" style={{ fontSize: "var(--fs-sm)" }}>{updated}</span>
            <Link className="btn btn--sm" to="/app/business-records">Business records</Link>
            {canEdit && corporation && <button className="btn btn--sm" type="button" onClick={registry.openImport}><FileUp size={14} /> Import from registry documents</button>}
            <button className="btn btn--accent" type="button" onClick={save} disabled={saving || !canEdit} title={updated}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      />

      <ProfileHeaderFacts form={form} detail={detail} />

      <div className="org-profile-tabs">
        <Tabs<ProfileTab> value={tab} onChange={setTab} tabRoles ariaLabel="Organization profile sections" items={tabItems} />
      </div>

      <div role="tabpanel" aria-label={TAB_LABELS[tab]}>
        {tab === "overview" ? (
          <OverviewTab
            society={society}
            form={form}
            detail={detail}
            canEdit={canEdit}
            onRecordIncorporation={() => registry.openRecordIncorporation()}
            onOpenTab={showTab}
            onAction={(action) => { if (action === "registry-import") registry.openImport(); }}
          />
        ) : (
          <fieldset disabled={!canEdit} className="society-fieldset">
            {tab === "legal" && <LegalProfileTab society={society} form={form} set={set} setGoverningAct={setGoverningAct} canEdit={canEdit} documents={evidenceDocuments ?? []} articlesCard={articlesCard} onRecordIncorporation={() => registry.openRecordIncorporation()} />}
            {tab === "registrations" && (
              <RegistrationsTab
                society={society}
                form={form}
                detail={detail}
                documents={evidenceDocuments}
                canEdit={canEdit}
                onAdd={() => drawer.openRegistration()}
                onAddHome={drawer.openHomeRegistration}
                onEdit={(row) => drawer.openRegistration(row)}
                onRemove={(row) => { void drawer.remove("registration", row); }}
              />
            )}
            {tab === "offices" && (
              <OfficesTab
                form={form}
                set={set}
                detail={detail}
                onAddAddress={() => drawer.openAddress()}
                onEditAddress={drawer.openAddress}
                onRemoveAddress={(row) => { void drawer.remove("address", row); }}
                onBackfill={() => { void backfillExistingRecords(); }}
              />
            )}
            {tab === "tax" && (
              <TaxTab
                form={form}
                set={set}
                detail={detail}
                canEdit={canEdit}
                onNewIdentifier={drawer.openIdentifier}
                onEditIdentifier={drawer.openIdentifier}
                onRemoveIdentifier={(row) => { void drawer.remove("identifier", row); }}
              />
            )}
            {tab === "documents" && <DocumentsTab society={society} form={form} canEdit={canEdit} documents={evidenceDocuments} registryPackage={registryPackage} />}
          </fieldset>
        )}
      </div>

      {drawer.element}
      {registry.element}
    </div>
  );
}

/**
 * Older profiles kept addresses and minute-book items as plain fields. For an
 * editor, copy them into the registers once per workspace when the profile
 * opens; "Backfill records" (the returned function) runs it again on demand.
 */
function useRecordBackfills(society: OrganizationRecord | null | undefined, detail: OrganizationDetail | undefined, canEdit: boolean) {
  const toast = useToast();
  const seedStructuredAddresses = useMutation(api.organizationDetails.seedFromSocietyAddresses);
  const backfillRecords = useMutation(api.organizationDetails.backfillFromExistingRecords);
  const [seededAddressSocietyId, setSeededAddressSocietyId] = useState<string | null>(null);
  const [autoBackfilledSocietyId, setAutoBackfilledSocietyId] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit || !society || detail === undefined || seededAddressSocietyId === society._id) return;
    setSeededAddressSocietyId(society._id);
    const addresses = detail?.addresses ?? [];
    const hasStructuredRegisteredOffice = addresses.some((row) => row.type === "registered_office");
    const hasStructuredMailing = addresses.some((row) => row.type === "mailing");
    const hasLegacyAddress = Boolean(society.registeredOfficeAddress || society.mailingAddress);
    if (hasLegacyAddress && (!hasStructuredRegisteredOffice || !hasStructuredMailing)) {
      void seedStructuredAddresses({ societyId: society._id }).catch((error: unknown) => {
        console.error("Society address backfill failed", error);
      });
    }
  }, [canEdit, detail, seededAddressSocietyId, seedStructuredAddresses, society]);

  useEffect(() => {
    if (!canEdit || !society || detail === undefined || autoBackfilledSocietyId === society._id) return;
    setAutoBackfilledSocietyId(society._id);
    void backfillRecords({ societyId: society._id }).catch((error: unknown) => {
      console.error("Organization detail backfill failed", error);
    });
  }, [canEdit, autoBackfilledSocietyId, backfillRecords, detail, society]);

  return async () => {
    if (!society) return;
    try {
      const result = await backfillRecords({ societyId: society._id });
      const total = result.addressesCreated + result.minuteBookItemsCreated;
      toast.success(
        total ? "Backfill complete" : "No records added",
        `${result.addressesCreated} addresses, ${result.minuteBookItemsCreated} minute-book records`,
      );
    } catch (error) {
      toast.error("Could not backfill records", error instanceof Error ? error.message : String(error));
    }
  };
}

/** Set one profile field, with the fields that move with it. */
function withProfileField(current: ProfileForm, key: string, value: unknown): ProfileForm {
  return {
    ...current,
    [key]: value,
    ...(key === "isCharity" ? { charityStatus: value ? "registered" : "not_applied" }
      : key === "isMemberFunded" ? { legalSubtype: value ? "member_funded_society" : "ordinary_society" }
      : key === "legalSubtype" ? { isMemberFunded: value === "member_funded_society" }
      : key === "formationStatus" ? { organizationStatus: organizationStatusForFormation(typeof value === "string" ? value : undefined, current.organizationStatus) }
      : {}),
  };
}

/** A catalogued Act belongs to one jurisdiction and incorporates listed entity kinds; keep the identity consistent with it. */
function withGoverningAct(current: ProfileForm, value: string | undefined, act?: IncorporationAct): ProfileForm {
  if (!act || act.actFormedUnder === current.actFormedUnder) return { ...current, actFormedUnder: value };
  const kind = entityKindForType(current.entityType);
  const keepsEntity = kind !== undefined && act.entityKinds.includes(kind);
  return {
    ...current, actFormedUnder: value, jurisdictionCode: act.jurisdictionCode, legalSubtype: act.legalSubtype,
    ...(keepsEntity ? {} : { entityType: ENTITY_KIND_ENTITY_TYPES[act.entityKinds[0]], isMemberFunded: false }),
  };
}

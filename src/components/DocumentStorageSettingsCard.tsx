import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { getDocumentStorageProvider } from "../lib/runtimeMode";
import { Badge, Field } from "./ui";
import { Select } from "./Select";
import { StorageCostForecast } from "./StorageCostForecast";
import { Toggle } from "./Controls";
import { useToast } from "./Toast";
import { DOCUMENT_STORAGE_CAPABILITIES } from "../../shared/storage/providerCapabilities";
import { defaultIntegrationSettings, sharePointReadiness, validateIntegrationSettings, type IntegrationSettings } from "../../shared/integrationSettings";

const evidenceOptions = [
  { value: "unknown" as const, label: "Not recorded" },
  { value: "recorded" as const, label: "Administrator evidence recorded" },
  { value: "revoked" as const, label: "Revoked" },
];

export function DocumentStorageSettingsCard() {
  const society = useSociety();
  const user = useCurrentUser();
  const toast = useToast();
  const update = useMutation(api.society.updateIntegrationSettings);
  const [settings, setSettings] = useState<IntegrationSettings>(defaultIntegrationSettings);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const local = isLocalDataRuntime();
  const canManage = local || user?.role === "Owner";
  const deployment = useQuery(api.documentVersions.storageCapabilities, !local && society ? { societyId: society._id } : "skip");
  const activeProvider = local ? getDocumentStorageProvider() : deployment?.activeProvider ?? "Not checked";
  const capability = DOCUMENT_STORAGE_CAPABILITIES.find((item) => item.provider === settings.preferredProvider);

  useEffect(() => {
    setSettings({ ...defaultIntegrationSettings(), ...society?.integrationSettings });
    setDirty(false);
  }, [society?._id, society?.integrationSettings]);

  const change = <K extends keyof IntegrationSettings>(key: K, value: IntegrationSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const textField = (key: keyof Pick<IntegrationSettings, "tenantId" | "siteId" | "libraryId" | "permissionEvidence" | "storageRegion" | "residencyEvidence" | "custodianContact" | "offboardingPlan">, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className="input" value={settings[key]} maxLength={4000} disabled={!canManage || saving} onChange={(event) => change(key, event.target.value)} />
    </Field>
  );
  const save = async () => {
    if (!society || !canManage) return;
    setSaving(true);
    try {
      const validated = validateIntegrationSettings(settings);
      await update({ societyId: society._id, integrationSettings: validated });
      setSettings(validated);
      setDirty(false);
      toast.success("Document storage policy saved", "Provider preferences and evidence do not establish a connection or migrate existing files.");
    } catch (error) {
      toast.error("Couldn't save document storage policy", error instanceof Error ? error.message : undefined);
    } finally { setSaving(false); }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Document storage &amp; custody</h2>
        <Badge tone="neutral">Policy and evidence</Badge>
      </div>
      <div className="card__body col" style={{ gap: 16 }}>
        <p className="muted">Deployment provider: <strong>{activeProvider}</strong>. Connection readiness has not been tested. Records and document bytes have separate storage settings.</p>
        {!local && deployment && <p className="muted">Deployment credentials: {deployment.deploymentConfigured ? "configured; live verification required" : "not configured"}.</p>}
        {!canManage && <div className="notice">The workspace Owner can change document storage policy.</div>}
        <Field label="Preferred document provider" hint="One workspace preference. Saving does not switch the deployment adapter or move existing versions.">
          <Select value={settings.preferredProvider} disabled={!canManage || saving} onChange={(value) => change("preferredProvider", value)} options={[
            { value: "existing", label: "Keep current deployment" },
            ...DOCUMENT_STORAGE_CAPABILITIES.map((item) => ({ value: item.provider, label: `${item.label}${item.implemented ? "" : " — planned"}` })),
          ]} />
        </Field>
        {capability && <div className="notice">
          <strong>{capability.implemented ? "Adapter available; deployment verification required." : "Deployment integration unavailable."}</strong> {capability.requirement}
          <div className="muted" style={{ marginTop: 6 }}>Upload: {capability.upload ? "supported" : "unavailable"}; download: {capability.download ? "supported" : "unavailable"}; checksum: {capability.checksum ? "supported" : "unavailable"}; immutable version references: {capability.immutableVersions ? "supported" : "unavailable"}.</div>
        </div>}
        {settings.preferredProvider === "sharepoint" && <>
          <div className="notice">Use the organization's SharePoint tenant and document library. Societyer sign-in does not grant Microsoft Graph storage access.</div>
          <div className="settings-pair">
            {textField("tenantId", "Microsoft tenant ID")}
            {textField("siteId", "Selected SharePoint site ID")}
            {textField("libraryId", "Document library / drive ID")}
            <Field label="Graph authorization mode">
              <Select value={settings.authorizationMode} disabled={!canManage || saving} onChange={(value) => change("authorizationMode", value)} options={[
                { value: "delegated", label: "Delegated — signed-in user's access" },
                { value: "application", label: "App-only — administrator-approved service" },
              ]} />
            </Field>
          </div>
          <p className="muted">{settings.authorizationMode === "delegated"
            ? "Delegated Graph access is bounded by the signed-in user's permissions and separately granted Graph scopes. A Societyer session token is not a Graph token."
            : "App-only access needs administrator consent and an explicit selected-resource grant to the site/library. Consent alone does not give the app access to documents."}</p>
          <div className="settings-pair">
            <Field label="Graph permission consent evidence"><Select value={settings.consentStatus} disabled={!canManage || saving} onChange={(value) => change("consentStatus", value)} options={evidenceOptions} /></Field>
            <Field label="Selected-resource grant evidence"><Select value={settings.resourceGrantStatus} disabled={!canManage || saving} onChange={(value) => change("resourceGrantStatus", value)} options={evidenceOptions} /></Field>
          </div>
          {textField("permissionEvidence", "Permission evidence reference", "Record an audit reference or document ID. Do not enter tokens, passwords, or application secrets.")}
          <div className="notice" role="status"><strong>Storage readiness: blocked</strong><ul>{sharePointReadiness(settings).map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
        </>}
        <Toggle checked={settings.canadianResidencyRequired} disabled={!canManage || saving} onChange={(value) => change("canadianResidencyRequired", value)} label="Require verified Canadian storage residency" hint="A provider preference or region name does not verify residency of files, metadata, backups, or processing." />
        <div className="settings-pair">
          {textField("storageRegion", "Declared storage region")}
          {textField("residencyEvidence", "Residency evidence reference")}
        </div>
        {settings.canadianResidencyRequired && <div className="notice notice--warning">Canadian residency is unverified. Cloudflare R2's documented location controls do not establish a Canada-only placement guarantee. Review the provider contract and actual tenant, backups, metadata and processing before using it for this requirement.</div>}
        <div className="settings-pair">
          <Field label="Records custodian"><Select value={settings.custodian} disabled={!canManage || saving} onChange={(value) => change("custodian", value)} options={[{ value: "organization", label: "Organization controls custody" }, { value: "operator", label: "Operator holds custody under agreement" }]} /></Field>
          {textField("custodianContact", "Custodian / administrator contact")}
        </div>
        {textField("offboardingPlan", "Offboarding and retention plan", "Record export format, originals and version history, transfer responsibilities, retention, consent revocation and deletion verification.")}
        <StorageCostForecast />
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-primary" disabled={!canManage || saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save storage policy"}</button>
          {dirty && <span className="muted">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}

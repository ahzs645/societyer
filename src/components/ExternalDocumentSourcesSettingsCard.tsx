import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Link2, Plus } from "lucide-react";
import { api } from "../lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { useModuleEnabled } from "../hooks/useModules";
import { appRouteAbsoluteHref } from "../lib/appRouteHref";
import { Badge, Field } from "./ui";
import { useToast } from "./Toast";
import { forgetDocumentSourceAccounts } from "../features/externalDocuments/microsoftAccess";
import { useExternalDocumentAvailability } from "../features/externalDocuments/useExternalDocumentActions";
import { documentSourceId, documentSourceLabel, type DocumentSource, type DocumentSourceConfig } from "../features/externalDocuments/types";
import "../features/externalDocuments/externalDocuments.css";

const emptyConfig = (): DocumentSourceConfig => ({ tenantId: "", clientId: "", siteId: "", driveId: "", siteUrl: "" });

export function ExternalDocumentSourcesSettingsCard() {
  const society = useSociety();
  const permissions = usePermissions();
  const moduleEnabled = useModuleEnabled("externalDocuments");
  const unavailable = useExternalDocumentAvailability();
  const canManage = permissions.loaded && permissions.can("settings:write") && (permissions.role === "Owner" || permissions.role === "Admin");
  const canRead = permissions.loaded && permissions.can("documents:read");
  const sources = useQuery(api.documentSources.list, society && canRead ? { societyId: society._id } : "skip") as DocumentSource[] | undefined;
  const saveSource = useMutation(api.documentSources.save);
  const setEnabled = useMutation(api.documentSources.setEnabled);
  const toast = useToast();
  const [editing, setEditing] = useState<DocumentSource | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<DocumentSourceConfig>(emptyConfig);
  const [saving, setSaving] = useState(false);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const callbackUrl = typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)
    ? appRouteAbsoluteHref("/document-source-auth.html", { demo: false, runtimeMode: "convex-cloud" })
    : "/document-source-auth.html";

  useEffect(() => {
    setFormOpen(false); setEditing(null); setLabel(""); setConfig(emptyConfig()); setError("");
  }, [society?._id]);

  const openForm = (source?: DocumentSource) => {
    setEditing(source ?? null);
    setLabel(source?.label ?? "");
    setConfig(source ? { ...source.config } : emptyConfig());
    setError("");
    setFormOpen(true);
  };

  const save = async () => {
    if (!society || !canManage || saving) return;
    if (!label.trim() || Object.values(config).some(value => !value.trim())) {
      setError("Enter a source name and all Microsoft library identifiers.");
      return;
    }
    setSaving(true); setError("");
    try {
      await saveSource({ societyId: society._id, ...(editing ? { sourceId: documentSourceId(editing) } : {}), label: label.trim(), config });
      setFormOpen(false);
      toast.success(editing ? "Source name saved" : "Document source saved", editing ? undefined : "The new source is disabled. Enable it when the Microsoft setup is complete.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the document source.");
    } finally { setSaving(false); }
  };

  const toggleSource = async (source: DocumentSource) => {
    if (!society || !canManage || busySourceId) return;
    setBusySourceId(documentSourceId(source));
    try {
      await setEnabled({ societyId: society._id, sourceId: documentSourceId(source), enabled: !source.enabled });
      toast.success(source.enabled ? "Document source disabled" : "Document source enabled", source.enabled ? undefined : "Microsoft access is checked when a reader browses or opens a document.");
    } catch (caught) {
      toast.error("Could not update document source", caught instanceof Error ? caught.message : undefined);
    } finally { setBusySourceId(null); }
  };

  const textField = (key: keyof DocumentSourceConfig, title: string, hint?: string) => (
    <Field key={key} label={title} hint={hint} required>
      <input className="input" value={config[key]} maxLength={key === "siteUrl" ? 2000 : 1000} autoComplete="off" spellCheck={false}
        disabled={!canManage || saving || Boolean(editing)} onChange={event => setConfig(current => ({ ...current, [key]: event.target.value }))} />
    </Field>
  );

  return (
    <section className="card external-documents" style={{ marginBottom: 16 }} aria-labelledby="external-document-sources-heading">
      <div className="card__head">
        <h2 className="card__title" id="external-document-sources-heading"><Link2 size={14} /> External document sources</h2>
        <Badge tone={moduleEnabled ? "info" : "neutral"}>{moduleEnabled ? "Module enabled" : "Module off"}</Badge>
      </div>
      <div className="card__body external-documents__stack">
        <p className="muted">Link files kept in approved external libraries. Societyer keeps a stable reference and the record title you choose. Each reader signs into the source service to access the file.</p>
        {!moduleEnabled && <p className="notice">External documents are off for this workspace. <Link to="/app/settings?tab=modules">Enable External documents in Modules</Link> to add and open links.</p>}
        {unavailable && <p className="notice" role="status">{unavailable}</p>}
        {!canManage && <p className="muted">A workspace settings administrator manages document sources.</p>}
        {canRead && sources === undefined && <p className="muted" role="status">Loading document sources…</p>}
        {sources?.length === 0 && <p className="muted">No document sources configured.</p>}
        {!!sources?.length && <ul className="external-documents__sources" aria-label="Configured document sources">
          {sources.map(source => <li key={documentSourceId(source)} className="external-documents__source">
            <div className="external-documents__source-info">
              <strong>{source.label}</strong>
              <span className="muted">{documentSourceLabel(source.providerId)} · {source.enabled ? "Enabled; access checked when used" : "Disabled"}</span>
              <div className="muted">{source.config.siteUrl}</div>
            </div>
            {canManage && <div className="external-documents__actions">
              <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busySourceId) || saving} onClick={() => openForm(source)} aria-label={`Rename ${source.label}`}>Rename</button>
              <button type="button" className="btn btn--sm" disabled={Boolean(busySourceId) || saving} onClick={() => void toggleSource(source)} aria-label={`${source.enabled ? "Disable" : "Enable"} ${source.label}`}>
                {busySourceId === documentSourceId(source) ? "Saving…" : source.enabled ? "Disable source" : "Enable source"}
              </button>
            </div>}
          </li>)}
        </ul>}
        {canManage && !formOpen && <div><button type="button" className="btn" onClick={() => openForm()}><Plus size={14} /> Add document source</button></div>}
        {formOpen && <form className="external-documents__stack external-documents__form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <h3 className="card__title">{editing ? "Rename document source" : "Add Microsoft SharePoint source"}</h3>
          <p className="muted">Choose one organizational SharePoint document library. Employee OneDrive locations are not supported. Links follow the latest source file.</p>
          <Field label="Source name" required hint="A name your workspace readers can recognize, such as Board records.">
            <input className="input" value={label} maxLength={120} disabled={saving} onChange={event => setLabel(event.target.value)} />
          </Field>
          <div className="settings-pair">
            {textField("tenantId", "Microsoft tenant ID")}
            {textField("clientId", "Application (client) ID")}
          </div>
          {textField("siteUrl", "SharePoint site URL", "For example, https://your-organization.sharepoint.com/sites/records")}
          {textField("siteId", "SharePoint site ID", "The Graph site ID: hostname, site collection GUID, and web GUID, separated by commas.")}
          {textField("driveId", "Document library (drive) ID")}
          {editing && <p className="muted">The tenant and library are fixed for this source. Add another source to connect a different library.</p>}
          {error && <div className="notice notice--danger" role="alert">{error}</div>}
          <div className="external-documents__actions">
            <button className="btn btn--accent" type="submit" disabled={saving || !canManage}>{saving ? "Saving…" : "Save document source"}</button>
            <button className="btn btn--ghost" type="button" disabled={saving} onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </form>}
        <details className="external-documents__setup">
          <summary>Microsoft administrator setup</summary>
          <ol>
            <li>Register the application for the source tenant and configure a single-page application (SPA) redirect for the hosted deployment: <code>{callbackUrl}</code>.</li>
            <li>Configure delegated Microsoft Graph permissions <code>User.Read</code> and <code>Sites.Selected</code>. An administrator must consent and give the application an explicit read grant for the selected SharePoint site.</li>
            <li>Each reader must have Microsoft access to the selected file. Societyer sign-in and source configuration do not grant that access.</li>
            <li>Enable the source and the External documents module, then use <strong>Link existing document</strong> on the Documents page. The first Browse or Open action prompts for Microsoft sign-in.</li>
          </ol>
          <p className="muted">Enter identifiers here; this connector uses reader sign-in and does not ask for application secrets. Moving a file within its library preserves its identity; moving it to a different library may require a new link. Source retention and version history remain managed in SharePoint.</p>
        </details>
        <div><button type="button" className="btn btn--ghost btn--sm" onClick={() => {
          void forgetDocumentSourceAccounts().then(() => {
            toast.success("Microsoft sign-in forgotten", "The next document source action will ask you to sign in again.");
          }).catch(caught => toast.error("Could not forget Microsoft sign-in", caught instanceof Error ? caught.message : undefined));
        }}>Forget Microsoft sign-in on this page</button></div>
      </div>
    </section>
  );
}

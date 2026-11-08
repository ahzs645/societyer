import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useConvex } from "convex/react";
import { Download, ExternalLink, Palette, Upload } from "lucide-react";
import { api } from "../lib/convexApi";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useUndoableAction } from "../hooks/useUndoableAction";
import { useToast } from "./Toast";
import { Toggle } from "./Controls";
import { WorkspaceLogo } from "./WorkspaceLogo";
import { importBrandkitFile } from "../features/invoicing/importBrandkit";
import { triggerBlobDownload } from "../lib/zip";
import { cleanWorkspaceBrand } from "../../shared/workspaceBrandValidation";
import { workspaceAccentPalette, type WorkspaceBrandSource } from "../../shared/workspaceBranding";
import type { InvoiceBrand } from "../../shared/invoiceBranding";

type Props = { organization: WorkspaceBrandSource & { _id: string }; canEdit: boolean; canReadTemplates: boolean };
type Draft = { brand: InvoiceBrand; useAccent: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : "The workspace brand could not be updated.";

/** Remount the editor when switching workspaces so an unfinished import cannot
 * be applied to another organization. In-flight reads also have a lifetime. */
export function WorkspaceBrandSettings(props: Props) {
  return <WorkspaceBrandEditor key={props.organization._id} {...props} />;
}

function WorkspaceBrandEditor({ organization, canEdit, canReadTemplates }: Props) {
  const client = useConvex();
  const save = usePermissionedMutation(api.society.setWorkspaceBrand, canEdit);
  const toast = useToast();
  const undoable = useUndoableAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const brand = draft?.brand ?? organization.workspaceBrand;
  const useAccent = draft?.useAccent ?? Boolean(organization.workspaceBrandUseAccent);
  const previewOrganization = { ...organization, workspaceBrand: brand };

  const preview = async (read: () => Promise<InvoiceBrand>) => {
    if (!canEdit || busy) return;
    const current = ++request.current;
    setBusy(true); setError("");
    try {
      const imported = cleanWorkspaceBrand(await read());
      if (request.current === current) setDraft({ brand: imported, useAccent: organization.workspaceBrand ? Boolean(organization.workspaceBrandUseAccent) : true });
    } catch (error) { if (request.current === current) setError(message(error)); }
    finally { if (request.current === current) setBusy(false); }
  };

  const useTemplateBrand = () => preview(async () => {
    const result = await client.query(api.invoices.documentTemplates, { societyId: organization._id });
    const template = result?.templates?.find((item: any) => item.active && item._id === result.defaultTemplateId);
    if (!template?.config?.brand) throw new Error("Your default document template has no Brandkit. Import a Brandkit file here, or choose a branded default in Document templates.");
    return template.config.brand;
  });

  const apply = async () => {
    if (!draft || !canEdit || busy) return;
    const current = ++request.current;
    setBusy(true); setError("");
    try {
      await save({ societyId: organization._id, brand: draft.brand, useAccent: draft.useAccent });
      if (request.current === current) { setDraft(null); toast.success("Workspace brand applied"); }
    } catch (error) { if (request.current === current) setError(message(error)); }
    finally { if (request.current === current) setBusy(false); }
  };

  const remove = async () => {
    if (!organization.workspaceBrand || !canEdit || busy) return;
    const saved = { societyId: organization._id, brand: organization.workspaceBrand, useAccent: Boolean(organization.workspaceBrandUseAccent) };
    setBusy(true); setError("");
    try {
      await undoable({
        message: "Workspace brand removed",
        description: "The uploaded workspace logo and app colors are restored.",
        run: () => save({ societyId: organization._id, brand: null, useAccent: false }),
        undo: () => save(saved),
      });
      setDraft(null);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  };

  return <section className="card workspace-brand-settings" id="workspace-brandkit" aria-label="Workspace Brandkit">
    <div className="card__head"><div><h2 className="card__title"><Palette size={16} aria-hidden="true" /> Workspace Brandkit</h2>
      <p className="card__subtitle">Use your organization’s identity across navigation, workspace selection and new document designs.</p></div></div>
    <div className="card__body col">
      <div className="workspace-brand-settings__tools">
        <label className={`btn btn--accent workspace-brand-settings__upload${!canEdit || busy ? " is-disabled" : ""}`}>
          <Upload size={14} aria-hidden="true" /> {busy ? "Working…" : "Import Brandkit"}
          <input type="file" aria-label="Import workspace Brandkit" accept=".json,.zip,application/json,application/zip" disabled={!canEdit || busy}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void preview(() => importBrandkitFile(file)); }} />
        </label>
        {canReadTemplates && <button type="button" className="btn" disabled={!canEdit || busy} onClick={() => void useTemplateBrand()}>Use document template brand</button>}
        <a className="btn btn--ghost" href="https://projects.ahmadjalil.com/brandkit/" target="_blank" rel="noreferrer">Open Brandkit <ExternalLink size={13} aria-hidden="true" /></a>
      </div>
      {!canEdit && <p className="muted">An owner or administrator can change the workspace brand.</p>}
      {error && <p className="workspace-brand-settings__error" role="alert">{error}</p>}
      {draft && <p className="workspace-brand-settings__notice" role="status">Preview only — apply this brand to update the workspace.</p>}
      <div className="workspace-brand-settings__previews">
        {(["light", "dark"] as const).map(theme => {
          const palette = workspaceAccentPalette(brand && useAccent ? brand.primary : "#3B82F6", theme === "dark");
          const style = { "--brand-preview-accent": palette.accent, "--brand-preview-on": palette.on } as CSSProperties;
          return <div key={theme} className={`workspace-brand-preview workspace-brand-preview--${theme}`} style={style} aria-label={`${theme === "light" ? "Light" : "Dark"} workspace brand preview`}>
            <span className="workspace-brand-preview__caption">{theme === "light" ? "Light appearance" : "Dark appearance"}</span>
            <WorkspaceLogo organization={previewOrganization} presentation="full" theme={theme} label={`${theme} workspace logo`} />
            <strong>{organization.name}</strong>
            <span className="workspace-brand-preview__action" aria-hidden="true">Continue</span>
          </div>;
        })}
      </div>
      {brand ? <>
        <div className="workspace-brand-settings__details"><strong>{brand.name}</strong><span className="muted">Version {brand.version}</span>
          {brand.sourceUrl && <a href={brand.sourceUrl} target="_blank" rel="noreferrer">View brand source <ExternalLink size={12} aria-hidden="true" /></a>}</div>
        <Toggle checked={useAccent} disabled={!canEdit || busy} label="Use brand accent in the interface"
          hint="Apply the brand color to actions, links and focus indicators. Light and dark shades adjust for readable contrast."
          onChange={checked => setDraft({ brand, useAccent: checked })} />
        <p className="muted">Logo lettering stays as designed. Workspace names come from organization records, and interface text keeps the app’s readable font.</p>
      </> : <p className="muted">Import a Brandkit ZIP or JSON profile to preview its logo and colors. Until then, the workspace uses the uploaded logo below or its initial.</p>}
      <div className="workspace-brand-settings__footer">
        {draft && <><button type="button" className="btn btn--accent" disabled={!canEdit || busy} onClick={() => void apply()}>Apply workspace brand</button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>Cancel brand preview</button></>}
        {!draft && organization.workspaceBrand && <>
          <button type="button" className="btn" onClick={() => {
            const file = `${organization.workspaceBrand!.id.replace(/[^a-z0-9_-]/gi, "_") || "workspace"}.workspace-brand.json`;
            triggerBlobDownload(new Blob([JSON.stringify(organization.workspaceBrand, null, 2)], { type: "application/json" }), file);
          }}><Download size={14} aria-hidden="true" /> Export workspace brand</button>
          <button type="button" className="btn btn--ghost" disabled={!canEdit || busy} onClick={() => void remove()}>Remove workspace brand</button>
        </>}
        {canReadTemplates && <Link className="btn btn--ghost" to="/app/invoices?tab=templates">Document templates</Link>}
      </div>
      <p className="muted">New document designs can use this brand. Saved templates and issued documents keep their saved appearance; customize them in Document templates.</p>
    </div>
  </section>;
}

import ddcnorthBrand from "../../../shared/brandKits/ddcnorth.json";
import { importInvoiceBrand } from "../../../shared/invoiceBranding";
import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Archive, Copy, Download, Plus, Upload } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { useToast } from "../../components/Toast";
import { triggerBlobDownload } from "../../lib/zip";
import { DEFAULT_INVOICE_TEMPLATE, cleanInvoiceTemplate, resolveDocumentDesign, type InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { DocumentTemplateDesigner } from "./DocumentTemplateDesigner";
import { DocumentTemplateGallery } from "./DocumentTemplateGallery";
import { DocumentTemplatePreview, type TemplatePreviewChoice } from "./DocumentTemplatePreview";
import { SavedTemplateThumbnail } from "./SavedTemplateThumbnail";
import type { InvoiceWorkspace } from "./types";

type Draft = { id?: string; config: InvoiceTemplate; makeDefault: boolean };
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function exportTemplate(config: InvoiceTemplate) {
  const template = cleanInvoiceTemplate({ ...config, design: resolveDocumentDesign(config) });
  const filename = `${template.name.replace(/[^a-z0-9_-]/gi, "_") || "document-template"}.template.json`;
  triggerBlobDownload(new Blob([JSON.stringify({ format: "societyer-document-template", version: 1, template }, null, 2)], { type: "application/json" }), filename);
}

export function InvoiceTemplatesPanel({ workspace: sourceWorkspace, societyId, canWrite, logoUrl }: { workspace: InvoiceWorkspace; societyId: string; canWrite: boolean; logoUrl?: string | null }) {
  const workspace = useMemo(() => ({ ...sourceWorkspace, organization: { ...sourceWorkspace.organization, logoUrl: logoUrl ?? sourceWorkspace.organization.logoUrl } }), [sourceWorkspace, logoUrl]);
  const save = useMutation(api.invoices.upsertTemplate);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [preview, setPreview] = useState<TemplatePreviewChoice | null>(null);
  const open = (next: Draft) => {
    try { setDraft({ ...next, config: cleanInvoiceTemplate({ ...next.config, design: resolveDocumentDesign(next.config) }) }); setError(""); }
    catch (error) { setError(errorMessage(error, "Could not open template.")); }
  };
  const applyBrand = () => {
    try {
      const brand = importInvoiceBrand(ddcnorthBrand, "https://projects.ahmadjalil.com/brandkit/?brand=ddcnorth");
      open({ config: { ...DEFAULT_INVOICE_TEMPLATE, name: `${brand.name} invoice`, brand, accentColor: brand.primary }, makeDefault: false });
    } catch (error) { setError(errorMessage(error, "Could not apply brand kit.")); }
  };
  const importTemplate = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Choose a template JSON smaller than 2 MB.");
      const value: unknown = JSON.parse(await file.text());
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a document template JSON object.");
      const envelope = value as Record<string, unknown>;
      if ("format" in envelope && (envelope.format !== "societyer-document-template" || envelope.version !== 1)) throw new Error("This template file format or version is not supported.");
      if ("format" in envelope && (!envelope.template || typeof envelope.template !== "object" || Array.isArray(envelope.template))) throw new Error("This template file is missing its document template.");
      const config = cleanInvoiceTemplate(("format" in envelope ? envelope.template : value) as InvoiceTemplate);
      open({ config, makeDefault: false });
      toast.success("Template imported. Review and save it to your workspace.");
    } catch (error) { setError(errorMessage(error, "Could not import template.")); }
  };
  const change = (patch: Partial<InvoiceTemplate>) => {
    if (!draft) return;
    try {
      const config = { ...draft.config, ...patch };
      cleanInvoiceTemplate(config);
      setDraft({ ...draft, config }); setError("");
    } catch (error) { setError(errorMessage(error, "Choose valid template settings.")); }
  };
  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try { await save({ societyId, id: draft.id, config: cleanInvoiceTemplate(draft.config), makeDefault: draft.makeDefault }); setDraft(null); toast.success("Document template saved"); }
    catch (error) { setError(errorMessage(error, "Could not save template.")); }
    finally { setBusy(false); }
  };
  const setActive = async (id: string, config: InvoiceTemplate, active: boolean) => {
    setBusy(true);
    try { await save({ societyId, id, config, active }); setError(""); toast.success(active ? "Template restored" : "Template archived"); }
    catch (error) { setError(errorMessage(error, "Could not update template.")); }
    finally { setBusy(false); }
  };
  const templates = (workspace.templates ?? []).filter((template) => template.active || showArchived);
  return <div className="card invoice-card">
    <div className="card__head"><div><h2 className="card__title">Document templates</h2><span className="card__subtitle">Design invoices, payment receipts, work orders and report PDFs. Issued invoices retain their saved design.</span></div><div className="document-designer__template-tools">
      <label className={`btn btn--sm document-designer__import${!canWrite ? " is-disabled" : ""}`}><Upload size={14} /> Import template JSON<input aria-label="Import template JSON" type="file" accept=".json,application/json" disabled={!canWrite || busy} onChange={(e) => { void importTemplate(e.target.files?.[0]); e.target.value = ""; }} /></label>
      <button className="btn btn--sm" disabled={!canWrite || busy} onClick={applyBrand}>Use ddcnorth brand</button>
      <button className="btn btn--sm btn--accent" disabled={!canWrite || busy} onClick={() => open({ config: { ...DEFAULT_INVOICE_TEMPLATE }, makeDefault: false })}><Plus size={14} /> New template</button></div></div>
    {!draft && error && <p className="field__error" role="alert">{error}</p>}
    <DocumentTemplateGallery canWrite={canWrite && !busy} onPreview={setPreview} onUse={(config) => open({ config, makeDefault: false })} />
    <h3>Your saved templates</h3>
    <Checkbox label="Show archived templates" checked={showArchived} onChange={setShowArchived} />
    <div className="invoice-commerce-grid">{templates.map((template) => <div className="invoice-template-card" key={template._id} style={{ borderTopColor: template.config.accentColor }}>
      <SavedTemplateThumbnail config={template.config} workspace={workspace} onPreview={() => setPreview({ savedId: template._id, active: template.active, name: template.config.name, config: template.config })} />
      <h3>{template.config.name}</h3><p className="muted">{template.config.layout} · {template.config.paperSize.toUpperCase()}{workspace.settings.defaultTemplateId === template._id ? " · Default" : ""}{!template.active ? " · Archived" : ""}</p>
      <div className="invoice-commerce-actions"><button className="btn btn--sm" disabled={!canWrite || busy || !template.active} onClick={() => open({ id: template._id, config: template.config, makeDefault: workspace.settings.defaultTemplateId === template._id })}>Customize</button>
        <button className="btn btn--sm" disabled={!canWrite || busy} onClick={() => open({ config: { ...template.config, name: `${template.config.name} copy` }, makeDefault: false })}><Copy size={14} /> Duplicate</button>
        <button className="btn btn--sm" onClick={() => { try { exportTemplate(template.config); } catch (error) { setError(errorMessage(error, "Could not export template.")); } }}><Download size={14} /> Export JSON</button>
        <button className="btn btn--sm" disabled={!canWrite || busy} onClick={() => void setActive(template._id, template.config, !template.active)}><Archive size={14} />{template.active ? "Archive" : "Restore"}</button></div>
    </div>)}{!templates.length && <p className="muted">Choose a design above and save it to add your first template.</p>}</div>
    {preview && <DocumentTemplatePreview template={preview} workspace={workspace} canWrite={canWrite && !busy && preview.active !== false} onClose={() => setPreview(null)} onUse={(config) => { open({ id: preview.savedId, config: structuredClone(config), makeDefault: preview.savedId === workspace.settings.defaultTemplateId }); setPreview(null); }} />}
    <Drawer open={Boolean(draft)} size="wide" className="document-designer-drawer" title={draft?.id ? "Customize document template" : "New document template"} onClose={() => !busy && setDraft(null)} footer={<><button className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>{draft && <button className="btn" disabled={busy} onClick={() => { try { exportTemplate(draft.config); } catch (error) { setError(errorMessage(error, "Could not export template.")); } }}>Export template JSON</button>}<button className="btn btn--accent" disabled={!canWrite || busy} onClick={() => void submit()}>Save template</button></>}>
      {error && <p className="field__error document-designer__error" role="alert">{error}</p>}
      {draft && <DocumentTemplateDesigner config={draft.config} workspace={workspace} onChange={change} makeDefault={draft.makeDefault} onDefaultChange={(makeDefault) => setDraft({ ...draft, makeDefault })} onError={setError} />}
    </Drawer>
  </div>;
}

import { useMemo, useState } from "react";
import { Eye, Search } from "lucide-react";
import { DOCUMENT_TEMPLATE_PRESETS, freshDocumentTemplatePreset } from "../../../shared/documentTemplatePresets";
import { type DocumentKind, type InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { TEMPLATE_KIND_LABELS } from "./documentTemplateSamples";
import type { TemplatePreviewChoice } from "./DocumentTemplatePreview";
import "../../styles/_document-template-gallery.scss";

const thumbnails = Object.fromEntries(Object.entries(import.meta.glob("../../assets/document-templates/*.png", { eager: true, query: "?url", import: "default" })).map(([path, url]) => [path.split("/").at(-1)!.replace(/\.png$/, ""), url as string]));
const FILTERS = [{ value: "all", label: "All templates" }, { value: "invoice", label: "Invoices" }, { value: "receipt", label: "Receipts" }, { value: "work_order", label: "Work orders" }, { value: "quote", label: "Quotes" }, { value: "statement", label: "Statements" }, { value: "report", label: "Reports" }] as const;
type Props = { canWrite: boolean; onUse: (config: InvoiceTemplate) => void; onPreview: (choice: TemplatePreviewChoice) => void };

export function DocumentTemplateGallery({ canWrite, onUse, onPreview }: Props) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<DocumentKind | "all">("all");
  const matches = useMemo(() => DOCUMENT_TEMPLATE_PRESETS.filter((preset) => (kind === "all" || preset.recommendedDocumentKind === kind) && [preset.name, preset.description, ...preset.tags].join(" ").toLowerCase().includes(search.trim().toLowerCase())), [search, kind]);
  return <section className="document-template-gallery" aria-label="Template gallery">
    <div className="document-template-gallery__head"><div><h3>Choose a starting design</h3><p className="muted">12 ready-made styles. Every design can be customized and used across document types.</p></div><label className="document-template-gallery__search"><Search size={16} aria-hidden="true" /><input className="input" aria-label="Search templates" placeholder="Search designs, styles or branding" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <div className="document-template-gallery__filters" role="group" aria-label="Template type">{FILTERS.map((filter) => <button key={filter.value} type="button" className={`btn btn--sm${kind === filter.value ? " btn--accent" : ""}`} aria-pressed={kind === filter.value} onClick={() => setKind(filter.value)}>{filter.label}</button>)}</div>
    <p className="document-template-gallery__count muted" role="status">{matches.length} {matches.length === 1 ? "design" : "designs"} · PDF previews use sample data</p>
    <div className="document-template-gallery__grid">{matches.map((preset) => <article key={preset.id} className="document-template-gallery__card" aria-label={preset.name}>
      <button className="document-template-gallery__thumbnail" type="button" aria-label={`Preview ${preset.name}`} onClick={() => onPreview({ ...preset, kind: preset.recommendedDocumentKind })}>
        {thumbnails[preset.id] ? <img src={thumbnails[preset.id]} alt={`${preset.name} ${TEMPLATE_KIND_LABELS[preset.recommendedDocumentKind].toLowerCase()} sample`} loading="lazy" width="400" height="520" /> : <span>Open PDF preview</span>}
        <span className="document-template-gallery__preview-hint"><Eye size={14} /> Preview</span>
      </button>
      <div className="document-template-gallery__details"><div className="document-template-gallery__tags"><span>{TEMPLATE_KIND_LABELS[preset.recommendedDocumentKind]}</span><span>{preset.config.brand ? "ddcnorth" : "Your branding"}</span></div><h4>{preset.name}</h4><p>{preset.description}</p><button className="btn btn--sm btn--accent" type="button" disabled={!canWrite} aria-label={`Use ${preset.name}`} onClick={() => onUse(freshDocumentTemplatePreset(preset.id))}>Use this design</button></div>
    </article>)}</div>
    {!matches.length && <div className="document-template-gallery__empty"><p>No designs match these filters.</p><button className="btn btn--sm" onClick={() => { setSearch(""); setKind("all"); }}>Show all designs</button></div>}
  </section>;
}

import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Field } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { Select } from "../../components/Select";
import { DOCUMENT_FONT_OPTIONS } from "./documentFontOptions";
import {
  DOCUMENT_LABEL_KEYS, DOCUMENT_TYPOGRAPHY_KEYS, resolveDocumentAdvanced,
  type DocumentDesign, type DocumentSectionKey, type DocumentTypography, type InvoiceTemplate,
} from "../../../shared/invoiceCommerce";

export const DESIGN_SECTIONS = [
  ["page", "Page"], ["branding", "Branding"], ["typography", "Typography"],
  ["fields", "Fields & labels"], ["columns", "Item table"], ["layout", "Section order"],
  ["header", "Header"], ["totals", "Totals"], ["footer", "Footer & signatures"],
  ["geometry", "Advanced geometry"], ["addresses", "Address blocks"], ["artwork", "Artwork & colors"],
  ["elements", "Element typography"], ["visibility", "Additional fields & stamps"],
  ["rich", "Rich headers & footers"], ["payments", "Terms, bank & payment blocks"],
  ["taxdisplay", "Tax & currency display"], ["signatures", "Signature artwork & placement"], ["annexures", "Appendices & inventory annexures"],
] as const;

export function DesignSection({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return <section id={`document-design-${id}`} className="document-designer__section" aria-label={title}>
    <h3>{title}</h3>{hint && <p className="muted">{hint}</p>}<div className="form-stack">{children}</div>
  </section>;
}

/** Invalid intermediate typing stays local; persisted designs always receive bounded numbers. */
export function DesignNumber({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);
  return <Field label={label}><input className="input" type="number" min={min} max={max} step={step} value={raw}
    onChange={(event) => { const next = event.target.value; setRaw(next); const number = Number(next); if (next !== "" && Number.isFinite(number) && number >= min && number <= max) onChange(number); }}
    onBlur={() => { const number = Number(raw); const next = raw === "" || !Number.isFinite(number) ? value : Math.max(min, Math.min(max, number)); setRaw(String(next)); if (next !== value) onChange(next); }} /></Field>;
}

const humanize = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
function move<T>(values: T[], from: number, to: number): T[] {
  const result = [...values]; const [value] = result.splice(from, 1); result.splice(to, 0, value); return result;
}

type Props = { config: InvoiceTemplate; design: DocumentDesign; change: (patch: Partial<InvoiceTemplate>) => void; update: (patch: Partial<DocumentDesign>) => void };

export function PageDesignControls({ config, design, change, update }: Props) {
  return <DesignSection id="page" title="Page" hint="Margins and logo sizes are in points (72 points = 1 inch).">
    <Field label="Template name"><input className="input" value={config.name} maxLength={100} onChange={(e) => change({ name: e.target.value })} /></Field>
    <div className="document-designer__grid">
      <Field label="Layout"><Select value={config.layout} onChange={(layout) => change({ layout: layout as InvoiceTemplate["layout"] })} options={[{ value: "classic", label: "Classic" }, { value: "modern", label: "Modern" }, { value: "compact", label: "Compact" }]} /></Field>
      <Field label="Paper size"><Select value={config.paperSize} onChange={(paperSize) => change({ paperSize: paperSize as InvoiceTemplate["paperSize"] })} options={[{ value: "letter", label: "Letter" }, { value: "a4", label: "A4" }]} /></Field>
      <Field label="Orientation"><Select value={design.page.orientation} onChange={(orientation) => update({ page: { ...design.page, orientation: orientation as DocumentDesign["page"]["orientation"] } })} options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} /></Field>
    </div>
    <div className="document-designer__grid">{(["top", "right", "bottom", "left"] as const).map((side) => <DesignNumber key={side} label={`${humanize(side)} margin (pt)`} value={design.page.margins[side]} min={12} max={144} onChange={(value) => update({ page: { ...design.page, margins: { ...design.page.margins, [side]: value } } })} />)}</div>
    <Field label="Document title"><input className="input" value={design.titles.invoice} maxLength={80} onChange={(e) => { change({ title: e.target.value, design: { ...design, titles: { ...design.titles, invoice: e.target.value } } }); }} /></Field>
    <div className="document-designer__grid">{(["receipt", "work_order", "report", "quote", "statement"] as const).map((kind) => <Field key={kind} label={`${humanize(kind)} title`}><input className="input" value={design.titles[kind]} maxLength={80} onChange={(e) => update({ titles: { ...design.titles, [kind]: e.target.value } })} /></Field>)}</div>
  </DesignSection>;
}

export function TypographyDesignControls({ design, update }: Props) {
  const setType = (key: keyof DocumentDesign["typography"], patch: Partial<DocumentTypography>) => {
    const old = design.typography[key], advanced = design.advanced ?? resolveDocumentAdvanced(design);
    const typography = { ...advanced.typography };
    for (const element of Object.keys(typography) as Array<keyof typeof typography>) {
      const group = element === "title" ? "header" : ["itemDescription", "columnHeader"].includes(element) ? "table" : element === "balance" ? "totals" : ["organizationName", "organizationAddress", "customerName", "customerAddress"].includes(element) ? "customer" : "body";
      if (group !== key) continue;
      const next = { ...typography[element] };
      if (patch.fontFamily !== undefined && next.fontFamily === old.fontFamily) next.fontFamily = patch.fontFamily;
      if (patch.fontSize !== undefined && next.fontSize === old.fontSize) next.fontSize = patch.fontSize;
      if (patch.color !== undefined && next.color === old.color) next.color = patch.color;
      typography[element] = next;
    }
    update({ typography: { ...design.typography, [key]: { ...old, ...patch } }, advanced: { ...advanced, typography } });
  };
  return <DesignSection id="typography" title="Typography" hint="Choose fonts, size and text color independently for each section.">
    {DOCUMENT_TYPOGRAPHY_KEYS.map((key) => <fieldset className="document-designer__fieldset" key={key}><legend>{humanize(key)}</legend><div className="document-designer__grid">
      <Field label={`${humanize(key)} font`}><Select value={design.typography[key].fontFamily} onChange={(fontFamily) => setType(key, { fontFamily: fontFamily as DocumentTypography["fontFamily"] })} options={DOCUMENT_FONT_OPTIONS} /></Field>
      <DesignNumber label={`${humanize(key)} font size (pt)`} value={design.typography[key].fontSize} min={6} max={36} onChange={(fontSize) => setType(key, { fontSize })} />
      <Field label={`${humanize(key)} text color`}><input className="input document-designer__color" type="color" value={design.typography[key].color} onChange={(e) => setType(key, { color: e.target.value })} /></Field>
    </div></fieldset>)}
  </DesignSection>;
}

export function FieldDesignControls({ config, design, change, update }: Props) {
  return <DesignSection id="fields" title="Fields & labels" hint="Visibility changes the document, while saved customer and invoice data are retained.">
    <div className="document-designer__grid">{Object.entries(design.fields).map(([key, checked]) => <Checkbox key={key} label={`Show ${humanize(key).toLowerCase()}`} checked={checked} onChange={(value) => update({ fields: { ...design.fields, [key]: value } })} />)}</div>
    <Checkbox label="Show payment instructions" checked={config.showPaymentInstructions} onChange={(showPaymentInstructions) => change({ showPaymentInstructions })} />
    <div className="document-designer__grid">{DOCUMENT_LABEL_KEYS.filter((key) => !design.table.columns.some((column) => column.key === key)).map((key) => <Field key={key} label={`${humanize(key)} label`}><input className="input" value={design.labels[key]} maxLength={80} onChange={(e) => update({ labels: { ...design.labels, [key]: e.target.value } })} /></Field>)}</div>
  </DesignSection>;
}

export function ColumnDesignControls({ config, design, change, update }: Props) {
  const columns = design.table.columns;
  return <DesignSection id="columns" title="Item table" hint="Widths are relative shares of the available table width. Use the arrows to reorder columns.">
    <Checkbox label="Show item descriptions" checked={config.showDescription} onChange={(showDescription) => change({ showDescription, design: { ...design, table: { ...design.table, columns: columns.map((column) => column.key === "description" ? { ...column, visible: showDescription } : column) } } })} />
    {columns.map((column, index) => <fieldset key={column.key} className="document-designer__column"><legend>{humanize(column.key)} column</legend>
      <Checkbox label={`Show ${humanize(column.key).toLowerCase()} column`} checked={column.visible} onChange={(visible) => change({ ...(column.key === "description" ? { showDescription: visible } : {}), design: { ...design, table: { ...design.table, columns: columns.map((entry) => entry.key === column.key ? { ...entry, visible } : entry) } } })} />
      <div className="document-designer__grid"><Field label={`${humanize(column.key)} column label`}><input className="input" value={column.label} maxLength={80} onChange={(e) => update({ table: { ...design.table, columns: columns.map((entry) => entry.key === column.key ? { ...entry, label: e.target.value } : entry) } })} /></Field>
        <DesignNumber label={`${humanize(column.key)} column width`} value={column.width} min={1} max={1000} onChange={(width) => update({ table: { ...design.table, columns: columns.map((entry) => entry.key === column.key ? { ...entry, width } : entry) } })} /></div>
      <div className="document-designer__reorder"><button className="btn btn--sm" type="button" aria-label={`Move ${column.key} column left`} disabled={index === 0} onClick={() => update({ table: { ...design.table, columns: move(columns, index, index - 1) } })}><ArrowUp size={13} /> Earlier</button><button className="btn btn--sm" type="button" aria-label={`Move ${column.key} column right`} disabled={index === columns.length - 1} onClick={() => update({ table: { ...design.table, columns: move(columns, index, index + 1) } })}><ArrowDown size={13} /> Later</button></div>
    </fieldset>)}
    <Checkbox label="Alternate row shading" checked={design.table.striped} onChange={(striped) => update({ table: { ...design.table, striped } })} />
    <DesignNumber label="Row padding (pt)" value={design.table.rowPadding} min={2} max={20} onChange={(rowPadding) => update({ table: { ...design.table, rowPadding } })} />
  </DesignSection>;
}

const SECTION_LABELS: Record<DocumentSectionKey, string> = { header: "Header", customer: "Customer", items: "Items", totals: "Totals", notes: "Notes", paymentInstructions: "Payment instructions", signature: "Signature" };
export function SectionOrderControls({ design, update }: Props) {
  return <DesignSection id="layout" title="Section order" hint="Arrange the document's content. Continuation-page headers and footers remain at the page edge."><ol className="document-designer__order">{design.sections.map((section, index) => <li key={section}><span>{SECTION_LABELS[section]}</span><button className="btn btn--sm" type="button" disabled={index === 0} aria-label={`Move ${SECTION_LABELS[section]} section up`} onClick={() => update({ sections: move(design.sections, index, index - 1) })}><ArrowUp size={13} /></button><button className="btn btn--sm" type="button" disabled={index === design.sections.length - 1} aria-label={`Move ${SECTION_LABELS[section]} section down`} onClick={() => update({ sections: move(design.sections, index, index + 1) })}><ArrowDown size={13} /></button></li>)}</ol></DesignSection>;
}

export function HeaderDesignControls({ design, update }: Props) {
  return <DesignSection id="header" title="Header"><Field label="First page header text"><textarea className="input textarea" value={design.header.text} maxLength={1000} onChange={(e) => update({ header: { ...design.header, text: e.target.value } })} /></Field><Checkbox label="Repeat header on continuation pages" checked={design.header.repeat} onChange={(repeat) => update({ header: { ...design.header, repeat } })} /><Field label="Continuation header text"><textarea className="input textarea" value={design.header.continuationText} maxLength={1000} onChange={(e) => update({ header: { ...design.header, continuationText: e.target.value } })} /></Field></DesignSection>;
}

export function TotalsDesignControls({ design, update }: Props) {
  return <DesignSection id="totals" title="Totals" hint="Supporting total rows can be shown independently. Final-total visibility is in Additional fields & stamps.">{Object.entries(design.totals).map(([key, value]) => <Checkbox key={key} label={humanize(key)} checked={value} onChange={(checked) => update({ totals: { ...design.totals, [key]: checked } })} />)}</DesignSection>;
}

export function FooterDesignControls({ design, change, update }: Props) {
  return <DesignSection id="footer" title="Footer & signatures">
    <Field label="Footer"><textarea className="input textarea" value={design.footer.text} maxLength={1000} onChange={(e) => change({ footer: e.target.value, design: { ...design, footer: { ...design.footer, text: e.target.value } } })} /></Field>
    <Checkbox label="Repeat footer on continuation pages" checked={design.footer.repeat} onChange={(repeat) => update({ footer: { ...design.footer, repeat } })} />
    <Field label="Continuation footer text"><textarea className="input textarea" value={design.footer.continuationText} maxLength={1000} onChange={(e) => update({ footer: { ...design.footer, continuationText: e.target.value } })} /></Field>
    <Checkbox label="Show page numbers" checked={design.footer.pageNumbers} onChange={(pageNumbers) => update({ footer: { ...design.footer, pageNumbers } })} />
    <Field label="Page number format"><Select value={design.footer.pageNumberFormat} onChange={(pageNumberFormat) => update({ footer: { ...design.footer, pageNumberFormat: pageNumberFormat as DocumentDesign["footer"]["pageNumberFormat"] } })} options={[{ value: "number", label: "1" }, { value: "page_of_total", label: "Page 1 of 3" }]} /></Field>
    <Checkbox label="Show signature block" checked={design.signature.enabled} onChange={(enabled) => update({ signature: { ...design.signature, enabled } })} />
    <Field label="Signature label"><input className="input" value={design.signature.label} maxLength={80} onChange={(e) => update({ signature: { ...design.signature, label: e.target.value } })} /></Field>
    <Field label="Signature name"><input className="input" value={design.signature.name} maxLength={120} onChange={(e) => update({ signature: { ...design.signature, name: e.target.value } })} /></Field>
  </DesignSection>;
}

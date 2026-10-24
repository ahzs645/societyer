import ddcnorthBrand from "../../../shared/brandKits/ddcnorth.json";
import { useEffect, useRef, useState } from "react";
import { Download, FileSearch } from "lucide-react";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { Checkbox } from "../../components/Controls";
import { triggerBlobDownload } from "../../lib/zip";
import { importInvoiceBrand, type InvoiceBrand } from "../../../shared/invoiceBranding";
import { resolveDocumentDesign, resolveDocumentAdvanced, type DocumentDesign, type InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { InvoiceDocument, type InvoiceDocumentData } from "./InvoiceDocument";
import {
  DESIGN_SECTIONS, DesignNumber, DesignSection, PageDesignControls, TypographyDesignControls,
  FieldDesignControls, ColumnDesignControls, SectionOrderControls, HeaderDesignControls,
  TotalsDesignControls, FooterDesignControls,
} from "./DocumentDesignControls";
import { DocumentGeometryControls, DocumentAddressControls, DocumentArtworkControls, DocumentElementControls, DocumentVisibilityControls, DocumentRichBandControls, DocumentPaymentControls, DocumentTaxDisplayControls, DocumentSignatureControls, DocumentAnnexControls } from "./DocumentAdvancedControls";
import type { InvoiceWorkspace } from "./types";
import "../../styles/_document-designer.scss";

type PreviewKind = "invoice" | "receipt" | "work_order" | "quote" | "statement";
type Props = {
  config: InvoiceTemplate;
  onChange: (patch: Partial<InvoiceTemplate>) => void;
  workspace: InvoiceWorkspace;
  makeDefault: boolean;
  onDefaultChange: (value: boolean) => void;
  onError: (error: string) => void;
};

export function DocumentTemplateDesigner({ config, onChange, workspace, makeDefault, onDefaultChange, onError }: Props) {
  // Saved/opened drafts are normalized once. Keep in-progress text intact while typing.
  const design = config.design ?? resolveDocumentDesign(config);
  const [kind, setKind] = useState<PreviewKind>("invoice");
  const [longPreview, setLongPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [rendering, setRendering] = useState(false);
  const renderRevision = useRef(0);
  const update = (patch: Partial<DocumentDesign>) => onChange({ design: { ...design, ...patch } });
  const controls = { config, design, change: onChange, update };

  useEffect(() => { renderRevision.current++; setPdfUrl(""); }, [config, kind, longPreview]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  useEffect(() => () => { renderRevision.current++; }, []);

  const preview: InvoiceDocumentData = {
    documentKind: kind,
    number: kind === "receipt" ? "REC-PREVIEW" : kind === "work_order" ? "WO-PREVIEW" : kind === "quote" ? "QT-PREVIEW" : kind === "statement" ? "STMT-PREVIEW" : "INV-PREVIEW",
    issueDate: workspace.today, dueDate: workspace.today, terms: "due_on_receipt", currency: workspace.ledger.workspaceCurrency,
    reference: "PO-1024", billToName: "Sample customer", billToEmail: "customer@example.test", billToAddress: "100 Main Street\nVancouver, BC", shipToName: "Sample customer — receiving", shipToAddress: "200 Warehouse Road\nVancouver, BC",
    documentTemplate: config,
    lines: Array.from({ length: longPreview ? 75 : 3 }, (_, index) => ({ key: `sample-${index}`, item: index % 2 ? "Replacement component" : "Repair labour", description: "Inspection, testing and service", quantity: index % 2 ? 1 : 2, unit: index % 2 ? "each" : "hour", unitPriceCents: index % 2 ? 12500 : 8500, taxRatePercent: 5, taxLabel: "GST", sku: `SERVICE-${index + 1}` })),
    memo: "Please contact us with any questions about this work.",
    ...(kind === "receipt" ? { lines: [{ key: "sample-payment", item: "Payment for INV-PREVIEW", quantity: 1, unit: "payment", unitPriceCents: 17000 }], documentDetails: [{ label: "Payment date", value: workspace.today }, { label: "Payment method", value: "E-transfer" }, { label: "Payment reference", value: "PAY-1024" }], status: "received" } : {}),
    ...(kind === "work_order" ? { documentDetails: [{ label: "Equipment", value: "Bicycle" }, { label: "Serial number", value: "FRAME-001" }, { label: "Reported problem", value: "Brake adjustment and safety inspection" }] } : {}),
    ...(kind === "quote" ? { documentDetails: [{ label: "Revision", value: "1" }, { label: "Valid until", value: workspace.today }], status: "draft" } : {}),
    ...(kind === "statement" ? { documentFinancials: { totalCents: 12000, balanceCents: 12000 }, documentTable: { columns: [{ label: "Date" }, { label: "Movement", width: 2 }, { label: "Charges", align: "right" as const }, { label: "Payments", align: "right" as const }], rows: [[workspace.today, "Sample invoice", "170.00", ""], [workspace.today, "Sample payment", "", "50.00"]] }, documentSummary: [{ label: "Closing balance", value: `${workspace.ledger.workspaceCurrency} 120.00`, strong: true }] } : {}),
  };

  const renderPdf = async (download: boolean) => {
    const revision = renderRevision.current;
    setRendering(true); onError("");
    try {
      const { buildInvoicePdf } = await import("./invoicePdf");
      const bytes = await buildInvoicePdf({ invoice: preview, organization: workspace.organization, paymentInstructions: workspace.settings.paymentInstructions });
      if (revision !== renderRevision.current) return;
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
      if (download) triggerBlobDownload(blob, `${preview.number}.pdf`);
      else setPdfUrl(URL.createObjectURL(blob));
    } catch (error) { onError(error instanceof Error ? error.message : "Could not render sample PDF."); }
    finally { setRendering(false); }
  };
  const applyBrand = (brand: InvoiceBrand) => {
    const advanced = design.advanced ?? resolveDocumentAdvanced(design);
    onChange({ brand, accentColor: brand.primary, showLogo: true, design: { ...design, typography: { ...design.typography, header: { ...design.typography.header, color: brand.primary } }, advanced: { ...advanced, colors: { ...advanced.colors, tableHeaderBackground: brand.primary }, typography: { ...advanced.typography, title: { ...advanced.typography.title, color: brand.primary } } } } });
  };
  const importBrand = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Choose a brand.json smaller than 2 MB.");
      applyBrand(importInvoiceBrand(JSON.parse(await file.text()))); onError("");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not import brand.json."); }
  };

  return <div className="document-designer">
    <div className="document-designer__settings">
      <nav className="document-designer__nav" aria-label="Document designer sections">{DESIGN_SECTIONS.map(([id, title]) => <button type="button" className="btn btn--sm" key={id} onClick={() => document.getElementById(`document-design-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}>{title}</button>)}</nav>
      <PageDesignControls {...controls} />
      <DocumentGeometryControls {...controls} />
      <DesignSection id="branding" title="Branding">
        <div className="invoice-brand-controls"><strong>Brand kit</strong><button className="btn btn--sm" type="button" onClick={() => { try { applyBrand(importInvoiceBrand(ddcnorthBrand, "https://projects.ahmadjalil.com/brandkit/?brand=ddcnorth")); onError(""); } catch (error) { onError(error instanceof Error ? error.message : "Could not apply brand."); } }}>Apply ddcnorth</button>
          <Field label="Import brand.json" hint="Supports brandkit logo geometry, palette and supported font families."><input className="input" type="file" accept=".json,application/json" onChange={(e) => { void importBrand(e.target.files?.[0]); e.target.value = ""; }} /></Field>
          {config.brand && <div><p>{config.brand.name} · {config.brand.version}</p><p className="muted">Font: {config.brand.font === "inter" ? "Inter / Inter Display / Space Mono" : config.brand.font}. Legal and contact details come from your organization.</p><div className="invoice-brand-swatches">{[config.brand.primary, config.brand.ink, config.brand.paper, config.brand.light].map((color, index) => <span key={`${color}-${index}`} style={{ backgroundColor: color }} title={color} />)}</div><button type="button" className="btn btn--sm" onClick={() => onChange({ brand: undefined })}>Use organization branding</button></div>}
        </div>
        <Checkbox label="Show logo" checked={config.showLogo} onChange={(showLogo) => onChange({ showLogo })} />
        {config.brand && <Field label="Logo color"><Select value={config.logoVariant ?? "primary"} onChange={(logoVariant) => onChange({ logoVariant: logoVariant as InvoiceTemplate["logoVariant"] })} options={[{ value: "primary", label: "Brand primary" }, { value: "black", label: "Black" }, { value: "reverse", label: "White on brand color" }]} /></Field>}
        <div className="document-designer__grid"><DesignNumber label="Logo width (pt)" value={design.logo.width} min={24} max={280} onChange={(width) => update({ logo: { ...design.logo, width } })} /><Field label="Logo alignment"><Select value={design.logo.alignment} onChange={(alignment) => update({ logo: { ...design.logo, alignment: alignment as DocumentDesign["logo"]["alignment"] } })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} /></Field></div>
        <Field label="Accent color"><input className="input document-designer__color" type="color" value={config.accentColor} onChange={(e) => onChange({ accentColor: e.target.value })} /></Field>
      </DesignSection>
      <TypographyDesignControls {...controls} />
      <DocumentElementControls {...controls} />
      <FieldDesignControls {...controls} />
      <DocumentVisibilityControls {...controls} />
      <DocumentAddressControls {...controls} />
      <DocumentArtworkControls {...controls} />
      <ColumnDesignControls {...controls} />
      <SectionOrderControls {...controls} />
      <HeaderDesignControls {...controls} />
      <DocumentRichBandControls {...controls} />
      <TotalsDesignControls {...controls} />
      <DocumentTaxDisplayControls {...controls} />
      <DocumentPaymentControls {...controls} />
      <FooterDesignControls {...controls} />
      <DocumentSignatureControls {...controls} />
      <DocumentAnnexControls {...controls} />
      <div className="document-designer__default"><Checkbox label="Use for new invoices by default" checked={makeDefault} onChange={onDefaultChange} /><p className="muted">The same design is available for receipts, repair work orders and report PDFs.</p></div>
    </div>
    <aside className="document-designer__preview" aria-label="Document preview">
      <div className="document-designer__preview-toolbar"><Field label="Preview document"><Select value={kind} onChange={(value) => setKind(value as PreviewKind)} options={[{ value: "invoice", label: "Invoice" }, { value: "receipt", label: "Payment receipt" }, { value: "work_order", label: "Work order" }, { value: "quote", label: "Quote" }, { value: "statement", label: "Customer statement" }]} /></Field><Checkbox label="Multi-page sample" checked={longPreview} onChange={setLongPreview} /><div className="invoice-commerce-actions"><button type="button" className="btn btn--sm" disabled={rendering} onClick={() => void renderPdf(false)}><FileSearch size={14} />{rendering ? "Rendering…" : "Preview PDF"}</button><button type="button" className="btn btn--sm" disabled={rendering} onClick={() => void renderPdf(true)}><Download size={14} /> Download sample PDF</button>{pdfUrl && <button type="button" className="btn btn--sm" onClick={() => setPdfUrl("")}>Live preview</button>}</div><p className="muted">{pdfUrl ? "Actual generated PDF, including pagination and continuation headers/footers." : "Live content preview. Preview PDF shows the exact page breaks, fonts and page numbers."}</p></div>
      {pdfUrl ? <iframe className="document-designer__pdf" title="Generated document PDF preview" src={pdfUrl} /> : <div className="document-designer__paper"><InvoiceDocument invoice={preview} organization={workspace.organization} paymentInstructions={workspace.settings.paymentInstructions} /></div>}
    </aside>
  </div>;
}

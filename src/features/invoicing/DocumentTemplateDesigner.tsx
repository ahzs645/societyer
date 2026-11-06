import { defaultInvoicePayments } from "../../../shared/invoicePaymentMethods";
import { cleanDocumentImage } from "../../../shared/documentRichContent";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, FileSearch } from "lucide-react";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { Checkbox } from "../../components/Controls";
import { triggerBlobDownload } from "../../lib/zip";
import { invoiceBrandFontDescription, type InvoiceBrand } from "../../../shared/invoiceBranding";
import { applyDocumentBrand, resolveDocumentDesign, resolveDocumentAdvanced, type DocumentDesign, type InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { InvoiceDocument, type InvoiceDocumentData } from "./InvoiceDocument";
import {
  DESIGN_SECTIONS, DesignNumber, DesignSection, PageDesignControls, TypographyDesignControls,
  FieldDesignControls, ColumnDesignControls, SectionOrderControls, HeaderDesignControls,
  TotalsDesignControls, FooterDesignControls,
} from "./DocumentDesignControls";
import { DocumentGeometryControls, DocumentAddressControls, DocumentArtworkControls, DocumentElementControls, DocumentVisibilityControls, DocumentRichBandControls, DocumentPaymentControls, DocumentTaxDisplayControls, DocumentSignatureControls, DocumentAnnexControls } from "./DocumentAdvancedControls";
import type { InvoiceWorkspace } from "./types";
import { importBrandkitFile } from "./importBrandkit";
import { DocumentPdfViewer } from "./InvoicePdfPreview";
import "../../styles/_document-designer.scss";

type PreviewKind = "invoice" | "receipt" | "work_order" | "quote" | "statement";
type Props = {
  config: InvoiceTemplate;
  onChange: (patch: Partial<InvoiceTemplate>) => void;
  workspace: InvoiceWorkspace;
  workspaceBrand?: InvoiceBrand;
  makeDefault: boolean;
  onDefaultChange: (value: boolean) => void;
  onError: (error: string) => void;
};

/** The sample keeps its real page width and scales down, so narrow screens see the page, not a reflowed one. */
function FittedPaper({ width, children }: { width: number; children: ReactNode }) {
  const paper = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = paper.current;
    if (!element) return;
    const measure = () => setScale(Math.min(1, element.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return <div ref={paper} className="document-designer__paper"><div style={{ width, zoom: scale }}>{children}</div></div>;
}

export function DocumentTemplateDesigner({ config, onChange, workspace, workspaceBrand, makeDefault, onDefaultChange, onError }: Props) {
  // Saved/opened drafts are normalized once. Keep in-progress text intact while typing.
  const design = config.design ?? resolveDocumentDesign(config);
  const [kind, setKind] = useState<PreviewKind>("invoice");
  const [longPreview, setLongPreview] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [currentSection, setCurrentSection] = useState<string>("page");
  const navRef = useRef<HTMLElement>(null);
  const [rendering, setRendering] = useState(false);
  const renderRevision = useRef(0);
  const update = (patch: Partial<DocumentDesign>) => onChange({ design: { ...design, ...patch } });
  const controls = { config, design, change: onChange, update };

  useEffect(() => { renderRevision.current++; setPdfBlob(null); }, [config, kind, longPreview]);
  useEffect(() => () => { renderRevision.current++; }, []);

  const preview: InvoiceDocumentData = {
    documentKind: kind,
    ...defaultInvoicePayments(workspace.settings),
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
      else setPdfBlob(blob);
    } catch (error) { onError(error instanceof Error ? error.message : "Could not render sample PDF."); }
    finally { setRendering(false); }
  };
  const applyBrand = (brand: InvoiceBrand) => {
    onChange(applyDocumentBrand(config, brand));
  };
  const changeAccent = (accentColor: string) => {
    const advanced = design.advanced ?? resolveDocumentAdvanced(design);
    onChange({ accentColor, design: { ...design,
      typography: { ...design.typography, header: { ...design.typography.header, color: accentColor } },
      advanced: { ...advanced, colors: { ...advanced.colors, tableHeaderBackground: accentColor },
        typography: { ...advanced.typography, title: { ...advanced.typography.title, color: accentColor } } },
    } });
  };
  const importBrand = async (file?: File) => {
    if (!file) return;
    try {
      applyBrand(await importBrandkitFile(file));
    } catch (error) { onError(error instanceof Error ? error.message : "Could not import the Brandkit profile."); }
  };

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 175000) throw new Error("Choose a PNG or JPEG logo smaller than 175 KB.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the logo."));
        reader.readAsDataURL(file);
      });
      onChange({ customLogo: cleanDocumentImage(data), showLogo: true }); onError("");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not upload the logo."); }
  };

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setCurrentSection(entry.target.id.replace("document-design-", ""));
    }, { rootMargin: "-130px 0px -65% 0px" });
    for (const [id] of DESIGN_SECTIONS) {
      const section = document.getElementById(`document-design-${id}`);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const nav = navRef.current, chip = nav?.querySelector<HTMLElement>(".is-current");
    if (nav && chip) nav.scrollTo({ left: chip.offsetLeft - nav.offsetLeft - 16 });
  }, [currentSection]);
  const pageWidth = design.page.orientation === "landscape" ? (config.paperSize === "a4" ? 1123 : 1056) : (config.paperSize === "a4" ? 794 : 816);
  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

  return <div className="document-designer">
    <div className="document-designer__settings" id="document-design-settings">
      <nav ref={navRef} className="document-designer__nav" aria-label="Document designer sections">{DESIGN_SECTIONS.map(([id, title]) => <button type="button" className={`btn btn--sm${currentSection === id ? " is-current" : ""}`} aria-current={currentSection === id ? "true" : undefined} key={id} onClick={() => jumpTo(`document-design-${id}`)}>{title}</button>)}<button type="button" className="btn btn--sm btn--accent document-designer__narrow-only" onClick={() => jumpTo("document-design-preview")}>Preview</button></nav>
      <PageDesignControls {...controls} />
      <DesignSection id="branding" title="Branding">
        <div className="invoice-brand-controls"><strong>Brandkit</strong>{workspaceBrand && <button className="btn btn--sm" type="button" onClick={() => applyBrand(workspaceBrand)}>Use workspace Brandkit</button>}
          <Field label="Import Brandkit profile" hint="Choose a Brandkit ZIP or a JSON profile. Save this design as the default to use its Brandkit in the gallery."><input className="input" type="file" accept=".zip,.json,application/zip,application/json" onChange={(e) => { void importBrand(e.target.files?.[0]); e.target.value = ""; }} /></Field>
          {config.brand && <div><p>{config.brand.name} · {config.brand.version}</p><p className="muted">Document body font: {invoiceBrandFontDescription(config.brand)}. Legal and contact details come from your organization.</p>{config.brand.sourceTypography && <p className="muted">Logo lettering is preserved as vector artwork. Heading and label fonts use the document typography controls; source font files are not imported.</p>}<div className="invoice-brand-swatches">{[config.brand.primary, config.brand.ink, config.brand.paper, config.brand.light].map((color, index) => <span key={`${color}-${index}`} style={{ backgroundColor: color }} title={color} />)}</div><button type="button" className="btn btn--sm" onClick={() => onChange({ brand: undefined, customLogo: undefined })}>Use organization branding</button></div>}
        </div>
        <Field label="Upload custom logo" hint="PNG or JPEG, up to 175 KB and 4096 pixels per side. Saved with this template and its invoices."><input className="input" type="file" accept="image/png,image/jpeg" onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.target.value = ""; }} /></Field>
        {config.customLogo && <div><p className="muted">Custom logo uploaded.</p><button type="button" className="btn btn--sm" onClick={() => onChange({ customLogo: undefined })}>Remove custom logo</button></div>}
        <Checkbox label="Show logo" checked={config.showLogo} onChange={(showLogo) => onChange({ showLogo })} />
        {config.brand && !config.customLogo && <Field label="Logo color"><Select value={config.logoVariant ?? "primary"} onChange={(logoVariant) => onChange({ logoVariant: logoVariant as InvoiceTemplate["logoVariant"] })} options={[{ value: "primary", label: "Brand colors" }, { value: "black", label: "Black" }, { value: "reverse", label: "Reverse on brand color" }]} /></Field>}
        <div className="document-designer__grid"><DesignNumber label="Logo width (pt)" value={design.logo.width} min={24} max={280} onChange={(width) => update({ logo: { ...design.logo, width } })} /><Field label="Logo alignment"><Select value={design.logo.alignment} onChange={(alignment) => update({ logo: { ...design.logo, alignment: alignment as DocumentDesign["logo"]["alignment"] } })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} /></Field></div>
        <Field label="Accent color"><input className="input document-designer__color" type="color" value={config.accentColor} onChange={(e) => changeAccent(e.target.value)} /></Field>
      </DesignSection>
      <TypographyDesignControls {...controls} />
      <FieldDesignControls {...controls} />
      <ColumnDesignControls {...controls} />
      <SectionOrderControls {...controls} />
      <HeaderDesignControls {...controls} />
      <TotalsDesignControls {...controls} />
      <FooterDesignControls {...controls} />
      <DocumentGeometryControls {...controls} />
      <DocumentAddressControls {...controls} />
      <DocumentArtworkControls {...controls} />
      <DocumentElementControls {...controls} />
      <DocumentVisibilityControls {...controls} />
      <DocumentRichBandControls {...controls} />
      <DocumentPaymentControls {...controls} />
      <DocumentTaxDisplayControls {...controls} />
      <DocumentSignatureControls {...controls} />
      <DocumentAnnexControls {...controls} />
      <div className="document-designer__default"><Checkbox label="Use for new invoices by default" checked={makeDefault} onChange={onDefaultChange} /><p className="muted">The same design is available for receipts, repair work orders and report PDFs.</p></div>
    </div>
    <aside className="document-designer__preview" id="document-design-preview" aria-label="Document preview">
      <button type="button" className="btn btn--sm document-designer__narrow-only" onClick={() => jumpTo("document-design-settings")}>Back to settings</button>
      <div className="document-designer__preview-toolbar"><Field label="Preview document"><Select value={kind} onChange={(value) => setKind(value as PreviewKind)} options={[{ value: "invoice", label: "Invoice" }, { value: "receipt", label: "Payment receipt" }, { value: "work_order", label: "Work order" }, { value: "quote", label: "Quote" }, { value: "statement", label: "Customer statement" }]} /></Field><Checkbox label="Multi-page sample" checked={longPreview} onChange={setLongPreview} /><div className="invoice-commerce-actions"><button type="button" className="btn btn--sm" disabled={rendering} onClick={() => void renderPdf(false)}><FileSearch size={14} />{rendering ? "Rendering…" : "Preview PDF"}</button><button type="button" className="btn btn--sm" disabled={rendering} onClick={() => void renderPdf(true)}><Download size={14} /> Download sample PDF</button>{pdfBlob && <button type="button" className="btn btn--sm" onClick={() => setPdfBlob(null)}>Live preview</button>}</div><p className="muted">{pdfBlob ? "Actual generated PDF, including pagination and continuation headers/footers." : "Live content preview. Preview PDF shows the exact page breaks, fonts and page numbers."}</p></div>
      {pdfBlob ? <DocumentPdfViewer blob={pdfBlob} testId="designer-pdf-preview" /> : <FittedPaper width={pageWidth}><InvoiceDocument invoice={preview} organization={workspace.organization} paymentInstructions={workspace.settings.paymentInstructions} /></FittedPaper>}
    </aside>
  </div>;
}

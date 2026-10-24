import { useEffect, useMemo, useState } from "react";
import { Download, Pencil, RefreshCw } from "lucide-react";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { Field } from "../../components/ui";
import { triggerBlobDownload } from "../../lib/zip";
import { DOCUMENT_KINDS, type DocumentKind, type InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { documentTemplateSample, TEMPLATE_KIND_LABELS } from "./documentTemplateSamples";
import type { InvoiceWorkspace } from "./types";

export type TemplatePreviewChoice = { name: string; description?: string; config: InvoiceTemplate; kind?: DocumentKind; savedId?: string; active?: boolean };
type Props = { template: TemplatePreviewChoice; workspace: InvoiceWorkspace; canWrite: boolean; onClose: () => void; onUse: (config: InvoiceTemplate) => void };

/** The full-size preview is the actual PDF, including fonts, page breaks and graphics. */
export function DocumentTemplatePreview({ template, workspace, canWrite, onClose, onUse }: Props) {
  const [kind, setKind] = useState<DocumentKind>(template.kind ?? "invoice");
  const [revision, setRevision] = useState(0);
  const [pdf, setPdf] = useState<{ url: string; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState("");
  const sample = useMemo(() => documentTemplateSample(template.config, kind, { today: workspace.today, currency: workspace.ledger.workspaceCurrency }), [template.config, kind, workspace.today, workspace.ledger.workspaceCurrency]);
  useEffect(() => {
    let cancelled = false, url = "";
    setPdf(null); setError("");
    const render = async () => {
      try {
        const bytes = sample.kind === "report"
          ? await (await import("../financials/reports/reportPdf")).buildBrandedReportPdf({ report: sample.report, template: template.config, organization: workspace.organization })
          : await (await import("./invoicePdf")).buildInvoicePdf({ invoice: sample.invoice, organization: workspace.organization, paymentInstructions: workspace.settings.paymentInstructions || "Example: pay by bank transfer using the document number as reference." });
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }));
        setPdf({ url, bytes });
      } catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not generate the preview."); }
    };
    void render();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [sample, template.config, workspace.organization, workspace.settings.paymentInstructions, revision]);
  const download = () => {
    if (!pdf) return;
    const filename = `SAMPLE-${template.name}-${kind}`.replace(/[^a-z0-9_-]/gi, "_");
    triggerBlobDownload(new Blob([pdf.bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }), `${filename}.pdf`);
  };
  return <Modal open size="xl" width={1180} title={`Preview ${template.name}`} onClose={onClose} className="document-template-preview" footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn" disabled={!pdf} onClick={download}><Download size={14} /> Download sample PDF</button><button className="btn btn--accent" disabled={!canWrite} onClick={() => onUse(template.config)}><Pencil size={14} /> Customize template</button></>}>
    <div className="document-template-preview__toolbar">
      <div><p>{template.description || "Preview this design with your organization's details."}</p><span className="document-template-gallery__sample">Sample data</span><p className="muted">The customer, transactions and amounts shown are examples. Viewing this sample creates no records.</p></div>
      <Field label="Preview document"><Select value={kind} onChange={setKind} options={DOCUMENT_KINDS.map((value) => ({ value, label: TEMPLATE_KIND_LABELS[value] }))} /></Field>
    </div>
    {error ? <div className="document-template-preview__state"><p className="field__error" role="alert">{error}</p><button className="btn" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} /> Retry preview</button></div>
      : pdf ? <iframe className="document-template-preview__pdf" src={pdf.url} title="Template PDF preview" />
      : <div className="document-template-preview__state" role="status">Generating your sample PDF…</div>}
  </Modal>;
}

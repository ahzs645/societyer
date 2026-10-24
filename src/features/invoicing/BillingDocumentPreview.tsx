import { useEffect, useState, type ReactNode } from "react";
import { Download, Eye } from "lucide-react";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { InvoiceDocument, type InvoiceDocumentData } from "./InvoiceDocument";
import type { InvoiceOrganization } from "./types";

type Props = {
  title: string;
  document: InvoiceDocumentData;
  organization: InvoiceOrganization & { logoUrl?: string | null };
  downloadLabel: string;
  canExport: boolean;
  onClose: () => void;
  controls?: ReactNode;
};

/** Both previews and downloads use the same invoice/receipt/work-order document renderer. */
export function BillingDocumentPreview({ title, document, organization, downloadLabel, canExport, onClose, controls }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<{ key: string; url: string } | null>(null);
  const documentKey = JSON.stringify({ document, organization });
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);
  const previewPdf = async () => {
    if (!canExport || busy) return;
    setBusy(true); setError("");
    try {
      const { buildInvoicePdf } = await import("./invoicePdf");
      const bytes = await buildInvoicePdf({ invoice: document, organization });
      setPdf({ key: documentKey, url: URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" })) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not preview this document."); }
    finally { setBusy(false); }
  };
  const download = async () => {
    if (!canExport || busy) return;
    setBusy(true); setError("");
    try {
      const { downloadInvoicePdf } = await import("./invoicePdf");
      await downloadInvoicePdf(document, organization);
      toast.success("PDF downloaded");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not generate this document."); }
    finally { setBusy(false); }
  };
  return <Modal open title={title} onClose={() => !busy && onClose()} size="xl" resizeKey="billing-document-preview" footer={<><button className="btn" disabled={busy} onClick={onClose}>Close</button><button className="btn" disabled={!canExport || busy} onClick={() => void previewPdf()}><Eye size={14} aria-hidden="true" />Preview PDF</button><button className="btn btn--accent" disabled={!canExport || busy} onClick={() => void download()}><Download size={14} aria-hidden="true" />{busy ? "Generating PDF…" : downloadLabel}</button></>}>
    {controls}
    {error && <p className="field__error" role="alert">{error}</p>}
    {pdf?.key === documentKey ? <><button className="btn btn--sm" onClick={() => setPdf(null)}>Show document layout</button><iframe title={`${title} PDF preview`} src={pdf.url} style={{ width: "100%", height: "65vh", border: 0 }} /></> : <div className="invoice-paper" style={{ overflowX: "auto" }}><InvoiceDocument invoice={document} organization={organization} /></div>}
  </Modal>;
}

import "./invoicePdfExport.css";
import { useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "../../components/Modal";
import { Field } from "../../components/ui";
import { Checkbox } from "../../components/Controls";
import { Select } from "../../components/Select";
import { InvoicePdfPreview } from "./InvoicePdfPreview";
import type { InvoiceDocumentProps } from "./InvoiceDocument";
import { SIMPLIFIED_PDF_EXPORT, TEMPLATE_PDF_EXPORT, type InvoicePdfExportOptions, type PdfColumnChoice } from "./invoicePdfExportOptions";

const columnOptions = [
  { value: "template", label: "Use saved template" }, { value: "auto", label: "Automatic" },
  { value: "show", label: "Show" }, { value: "hide", label: "Hide" },
];

/** Export choices are local to this dialog and never saved into an issued invoice. */
export function InvoicePdfExportDialog({ invoice, organization, paymentInstructions, filenameSuffix = "", onClose }: InvoiceDocumentProps & { filenameSuffix?: string; onClose: () => void }) {
  const [options, setOptions] = useState<InvoicePdfExportOptions>({ ...TEMPLATE_PDF_EXPORT });
  const [preset, setPreset] = useState("template");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (next: Partial<InvoicePdfExportOptions>) => { setPreset("custom"); setOptions(previous => ({ ...previous, ...next })); };
  const download = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { downloadInvoicePdf } = await import("./invoicePdf");
      await downloadInvoicePdf(invoice, organization, paymentInstructions, filenameSuffix, options);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not export this PDF."); }
    finally { setBusy(false); }
  };
  return <Modal open title={`PDF export · ${invoice.number}`} size="xl" resizeKey="invoice-pdf-export" className="invoice-pdf-export" onClose={() => !busy && onClose()} footer={<><button className="btn" disabled={busy} onClick={onClose}>Close</button><button className="btn btn--accent" disabled={busy} onClick={() => void download()}><Download size={14} aria-hidden="true" />{busy ? "Generating PDF…" : "Download selected PDF"}</button></>}>
    <p className="muted">Choose the PDF layout. Invoice amounts, tax records and the saved template stay unchanged.</p>
    <Field label="PDF preset"><Select value={preset} options={[{ value: "template", label: "Saved template" }, { value: "simplified", label: "Simplified" }, { value: "custom", label: "Custom" }]} onChange={value => { setPreset(value); if (value !== "custom") setOptions({ ...(value === "simplified" ? SIMPLIFIED_PDF_EXPORT : TEMPLATE_PDF_EXPORT) }); }} /></Field>
    <div className="invoice-pdf-export__layout">
      <div className="invoice-pdf-export__controls">
        <fieldset><legend>Item table</legend>{(["quantity", "rate", "tax"] as const).map(key => <Field key={key} label={`${key === "quantity" ? "Quantity" : key === "rate" ? "Rate" : "Tax"} column`}><Select value={options[key]} options={columnOptions} onChange={value => patch({ [key]: value as PdfColumnChoice })} /></Field>)}<p className="small muted">Automatic hides quantity and rate when every line is one fixed amount with no unit. Tax appears for mixed rates or treatments.</p></fieldset>
        <Field label="Page numbers"><Select value={options.pageNumbers} options={[{ value: "template", label: "Use saved template" }, { value: "multiple_pages", label: "Only on multi-page PDFs" }, { value: "always", label: "Every page" }, { value: "off", label: "Off" }]} onChange={value => patch({ pageNumbers: value as InvoicePdfExportOptions["pageNumbers"] })} /></Field>
        <Checkbox label="Show tax treatment notes" checked={options.taxTreatmentNotes} onChange={taxTreatmentNotes => patch({ taxTreatmentNotes })} />
        <Checkbox label="Repeat invoice currency in EFT instructions" checked={options.eftCurrency} onChange={eftCurrency => patch({ eftCurrency })} />
        <p className="small muted">GST/PST amounts and required registration numbers remain visible. EFT instructions for a different currency are always retained.</p>
        {error && <p className="field__error" role="alert">{error}</p>}
      </div>
      <div className="invoice-pdf-export__preview"><InvoicePdfPreview invoice={invoice} organization={organization} paymentInstructions={paymentInstructions} exportOptions={options} /></div>
    </div>
  </Modal>;
}

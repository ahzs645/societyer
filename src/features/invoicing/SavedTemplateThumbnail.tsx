import { defaultInvoicePayments } from "../../../shared/invoicePaymentMethods";
import { useLayoutEffect, useRef, useState } from "react";
import { resolveDocumentAdvanced, resolveDocumentDesign, type DocumentKind, type InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { InvoiceDocument, type InvoiceDocumentData } from "./InvoiceDocument";
import { documentTemplateSample } from "./documentTemplateSamples";
import { documentPresentation } from "./documentPresentation";
import type { InvoiceWorkspace } from "./types";

/** Saved designs render their current settings rather than a generic placeholder logo. */
export function SavedTemplateThumbnail({ config, workspace, onPreview }: { config: InvoiceTemplate; workspace: InvoiceWorkspace; onPreview: () => void }) {
  return <button type="button" className="document-template-saved-thumbnail" aria-label={`Preview saved ${config.name}`} onClick={onPreview}>
    <DocumentTemplateThumbnail config={config} workspace={workspace} kind="invoice" />
    <span className="document-template-gallery__preview-hint">Preview saved design</span>
  </button>;
}

function thumbnailInvoice(config: InvoiceTemplate, kind: DocumentKind, today: string, currency: string): InvoiceDocumentData {
  const sample = documentTemplateSample(config, kind, { today, currency });
  if (sample.kind !== "report") return sample.invoice;
  const design = resolveDocumentDesign(config);
  const advanced = resolveDocumentAdvanced(design);
  return {
    documentKind: "statement", number: "REPORT-SAMPLE", issueDate: today, dueDate: today, terms: "custom", currency,
    billToName: "", lines: [], documentSummary: [],
    documentTemplate: { ...config, design: { ...design, titles: { ...design.titles, statement: sample.report.title },
      advanced: { ...advanced, visibility: { ...advanced.visibility, billTo: false } } } },
    documentTable: { columns: sample.report.columns ?? [], rows: (sample.report.rows ?? []).map(row => row.cells) },
  };
}

export function DocumentTemplateThumbnail({ config, workspace, kind, fit = false }: {
  config: InvoiceTemplate; workspace: InvoiceWorkspace; kind: DocumentKind; fit?: boolean;
}) {
  const { today, ledger, organization, settings } = workspace;
  const invoice = thumbnailInvoice(config, kind, today, ledger.workspaceCurrency);
  const frame = useRef<HTMLSpanElement>(null);
  const [available, setAvailable] = useState({ width: 240, height: 270 });
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { page } = documentPresentation(invoice);
  const width = page.width * 96 / 72, height = page.height * 96 / 72;
  const scale = fit ? Math.min(available.width / width, available.height / height) : available.width / width;
  return <span ref={frame} aria-hidden="true" className={`document-template-thumbnail${fit ? " document-template-thumbnail--fit" : ""}`} style={fit ? undefined : { aspectRatio: `${width} / ${height}` }}>
    <span className="document-template-thumbnail__paper" style={{ width: width * scale, height: height * scale }}>
      <span className="document-template-thumbnail__canvas" style={{ width, minHeight: height, transform: `scale(${scale})` }}>
        <InvoiceDocument invoice={{ ...invoice, ...defaultInvoicePayments(settings) }} organization={organization} paymentInstructions={settings.paymentInstructions} />
      </span>
    </span>
  </span>;
}

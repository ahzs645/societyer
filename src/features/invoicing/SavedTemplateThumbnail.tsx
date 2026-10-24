import { useLayoutEffect, useRef, useState } from "react";
import type { InvoiceTemplate } from "../../../shared/invoiceCommerce";
import { InvoiceDocument } from "./InvoiceDocument";
import { documentTemplateSample } from "./documentTemplateSamples";
import { documentPresentation } from "./documentPresentation";
import type { InvoiceWorkspace } from "./types";

/** Saved designs render their current settings rather than a generic placeholder logo. */
export function SavedTemplateThumbnail({ config, workspace, onPreview }: { config: InvoiceTemplate; workspace: InvoiceWorkspace; onPreview: () => void }) {
  const sample = documentTemplateSample(config, "invoice", { today: workspace.today, currency: workspace.ledger.workspaceCurrency });
  const frame = useRef<HTMLSpanElement>(null);
  const [availableWidth, setAvailableWidth] = useState(240);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (sample.kind === "report") return null;
  const { page } = documentPresentation(sample.invoice);
  const width = page.width * 96 / 72, height = page.height * 96 / 72;
  const scale = availableWidth / width;
  return <button type="button" className="document-template-saved-thumbnail" aria-label={`Preview saved ${config.name}`} onClick={onPreview}>
    <span ref={frame} className="document-template-saved-thumbnail__frame" style={{ aspectRatio: `${width} / ${height}` }}><span className="document-template-saved-thumbnail__canvas" aria-hidden="true" style={{ width, minHeight: height, transform: `scale(${scale})` }}><InvoiceDocument invoice={sample.invoice} organization={workspace.organization} paymentInstructions={workspace.settings.paymentInstructions} /></span></span>
    <span className="document-template-gallery__preview-hint">Preview saved design</span>
  </button>;
}

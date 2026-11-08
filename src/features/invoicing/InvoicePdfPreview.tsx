import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InvoiceDocumentProps } from "./InvoiceDocument";

const PdfPreview = lazy(() => import("../../components/PdfPreview").then((module) => ({ default: module.PdfPreview })));

/** A finished PDF in the shared viewer, with its page and zoom controls. */
export function DocumentPdfViewer({ blob, testId }: { blob: Blob; testId: string }) {
  return <div className="invoice-pdf-preview">
    <Suspense fallback={<p className="invoice-pdf-preview__state" role="status">Loading PDF viewer…</p>}><PdfPreview blob={blob} testId={testId} /></Suspense>
  </div>;
}

/** Render the exported PDF at its original page geometry on every screen size. */
export function InvoicePdfPreview(props: InvoiceDocumentProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pdf, setPdf] = useState<{ key: string; blob: Blob } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const documentKey = JSON.stringify(props);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const drawerBody = element.closest(".drawer__body");
    const measure = () => {
      setVisible(element.clientWidth > 0);
      const spaceBelow = window.innerHeight - Math.max(0, element.getBoundingClientRect().top);
      // The detail preview can open below the fold. Size it to the drawer's reading area.
      const available = (drawerBody?.clientHeight ?? Math.max(window.innerHeight / 2, spaceBelow)) - 8;
      element.style.setProperty("--invoice-preview-max-height", `${available}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (drawerBody) observer.observe(drawerBody);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError("");
    // Wait for a pause in typing, and do not render a hidden mobile preview.
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { buildInvoicePdf } = await import("./invoicePdf");
          const bytes = await buildInvoicePdf(JSON.parse(documentKey));
          if (!cancelled) setPdf({ key: documentKey, blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }) });
        } catch (failure) {
          if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not generate the PDF preview.");
        }
      })();
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [documentKey, visible, revision]);

  const updating = visible && !error && pdf?.key !== documentKey;
  return <div ref={host} className="invoice-pdf-preview" aria-busy={updating}>
    {error ? <div className="invoice-pdf-preview__state"><p className="field__error" role="alert">{error}</p><button className="btn btn--sm" type="button" onClick={() => setRevision((value) => value + 1)}>Retry PDF preview</button></div>
      : <>
        {updating && <p className="invoice-pdf-preview__state" role="status">{pdf ? "Updating PDF preview…" : "Generating PDF preview…"}</p>}
        {pdf && <Suspense fallback={<p className="invoice-pdf-preview__state" role="status">Loading PDF viewer…</p>}><PdfPreview blob={pdf.blob} fitToPage testId="invoice-pdf-preview" /></Suspense>}
      </>}
  </div>;
}

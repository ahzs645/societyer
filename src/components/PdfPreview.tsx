import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type PdfDoc = { numPages: number; getPage(n: number): Promise<any>; destroy(): Promise<void> };
let pdfJsModule: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined;
function loadPdfJs() {
  pdfJsModule ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfJsModule;
}

/** A single PDF page at a time, with selectable text, fit-to-width and bounded canvas memory. */
export function PdfPreview({ blob, pageNumber, focusKey, onTextLayerReady, testId = "file-pdf-preview" }: {
  blob: Blob;
  pageNumber?: number;
  /** A new locator on the same page can request focus again after manual paging. */
  focusKey?: string;
  onTextLayerReady?: (elements: HTMLElement[], text: string[]) => void;
  testId?: string;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true; let task: ReturnType<Awaited<ReturnType<typeof loadPdfJs>>["getDocument"]> | undefined;
    setDoc(null); setPage(1); setZoom(1); setError(null); setRendering(true);
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        task = pdfjs.getDocument({ data });
        const loaded = await task.promise;
        if (alive) setDoc(loaded);
      } catch (cause) { if (alive) { setRendering(false); setError(cause instanceof Error ? cause.message : "This PDF could not be rendered."); } }
    })();
    return () => { alive = false; void task?.destroy(); };
  }, [blob]);
  useEffect(() => {
    if (pageNumber !== undefined && Number.isFinite(pageNumber)) {
      setPage(Math.min(Math.max(1, Math.floor(pageNumber)), doc?.numPages ?? Number.MAX_SAFE_INTEGER));
    } else if (doc) setPage(value => Math.min(Math.max(1, value), doc.numPages));
  }, [doc, pageNumber, focusKey]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!doc || !host.current || !width) return;
    let alive = true; let renderTask: { cancel(): void } | undefined; let textTask: { cancel(): void } | undefined;
    const target = host.current;
    setError(null); setRendering(true);
    void (async () => {
      const pdfjs = await loadPdfJs();
      const pdfPage = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
      if (!alive) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.max(120, Math.min(width, 900)) * zoom / base.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
      const wrapper = document.createElement("div"); wrapper.className = "pdf-preview__page";
      wrapper.style.width = `${viewport.width}px`; wrapper.style.height = `${viewport.height}px`;
      for (const [name, value] of [["--scale-factor", String(viewport.scale)], ["--user-unit", "1"], ["--total-scale-factor", String(viewport.scale)], ["--scale-round-x", "1px"], ["--scale-round-y", "1px"]]) wrapper.style.setProperty(name, value);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("aria-label", `PDF page ${page}`); wrapper.appendChild(canvas);
      const textDiv = document.createElement("div"); textDiv.className = "textLayer"; wrapper.appendChild(textDiv);
      target.replaceChildren(wrapper);
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("Canvas rendering is unavailable.");
      const rendered = pdfPage.render({ canvasContext, canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      renderTask = rendered; await rendered.promise;
      if (!alive) return;
      const textLayer = new pdfjs.TextLayer({ textContentSource: await pdfPage.getTextContent(), container: textDiv, viewport });
      textTask = textLayer; await textLayer.render();
      if (!alive) return;
      onTextLayerReady?.(textLayer.textDivs, textLayer.textContentItemsStr);
      setRendering(false);
    })().catch(cause => { if (alive) { setRendering(false); setError(cause instanceof Error ? cause.message : "This PDF could not be rendered."); } });
    return () => { alive = false; renderTask?.cancel(); textTask?.cancel(); target.replaceChildren(); };
  }, [doc, page, zoom, width, onTextLayerReady]);
  return <div className="pdf-preview">
    {doc && <div className="pdf-preview__nav" aria-label="PDF page controls">
      <button type="button" className="btn btn--sm btn--icon" disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
      <span>Page {page} of {doc.numPages}</span>
      <button type="button" className="btn btn--sm btn--icon" disabled={page >= doc.numPages} onClick={() => setPage(value => value + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      <button type="button" className="btn btn--sm" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))} aria-label="Zoom out">−</button>
      <span>{zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
      <button type="button" className="btn btn--sm" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .5))} aria-label="Zoom in">+</button>
    </div>}
    {rendering && !error && <p role="status">Rendering PDF…</p>}
    {error && <p role="alert">Could not render this PDF: {error}</p>}
    <div ref={host} data-testid={testId} className="pdf-preview__viewport" style={{ justifyContent: zoom > 1 ? "flex-start" : "center" }} />
  </div>;
}

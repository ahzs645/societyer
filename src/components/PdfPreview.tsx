import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "./ScrollArea";
import { canvasPixelRatio, clampZoom, parsePageInput, planPdfPages } from "./previewViewport";
import { captureZoomAnchor, observerRoot, PreviewZoomControls, restoreZoomAnchor, usePinchZoom, verticalScroller, visibleCentre, type ZoomAnchor } from "./PreviewZoom";

let pdfJsModule: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | undefined;
function loadPdfJs() {
  pdfJsModule ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfJsModule;
}
type PdfJs = Awaited<ReturnType<typeof loadPdfJs>>;
type PdfDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
type PageSize = { width: number; height: number };
/** Passed with each page's text layer; `focus` is true once, for the page a `pageNumber`/`focusKey` request asked for. */
export type PdfTextLayerInfo = { page: number; focus: boolean };
type DrawnPage = { canvas: HTMLCanvasElement; textLayer: HTMLDivElement; scale: number; ratio: number; textDivs: HTMLElement[]; text: string[] };
type DrawParams = { pdfjs: PdfJs; doc: PdfDoc; scaleOf: (page: number) => number; ratioOf: (page: number) => number; pixelsOf: (page: number) => number };

/** Fit-width is capped so a desktop dialog shows a readable page, not a poster. */
const FIT_MIN = 120, FIT_MAX = 900, GUTTER = 8;
const VISIBLE_THRESHOLDS = Array.from({ length: 11 }, (_, index) => index / 10);

function freeCanvas(canvas: HTMLCanvasElement) {
  // Zero the backing store first: Safari keeps detached canvases' memory otherwise.
  canvas.width = 0; canvas.height = 0; canvas.remove();
}

/**
 * Every page in one vertical scroll, drawn lazily: placeholders are sized from
 * each page's viewport, pages near the view get a canvas and a selectable text
 * layer, and canvases far from it are released, so a 100+ page PDF on a phone
 * holds only a handful (see `planPdfPages`). Zoom runs from 25% of fit-width
 * to 400%, by buttons or pinch; canvases cap their pixel ratio and size.
 * The bytes are already verified in memory, so "streaming" here is drawing
 * pages as they are reached rather than fetching byte ranges.
 */
export function PdfPreview({ blob, pageNumber, focusKey, onTextLayerReady, testId = "file-pdf-preview" }: {
  blob: Blob;
  /** Scrolls to this page (1-based) when it or `focusKey` changes. */
  pageNumber?: number;
  /** A new locator on the same page can request focus again after manual scrolling. */
  focusKey?: string;
  /** Called for each page's text layer as it is drawn (and again when it is redrawn). */
  onTextLayerReady?: (elements: HTMLElement[], text: string[], info: PdfTextLayerInfo) => void;
  testId?: string;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [sizesReady, setSizesReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawnAny, setDrawnAny] = useState(false);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const nav = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const drawn = useRef(new Map<number, DrawnPage>());
  const failed = useRef(new Set<number>());
  const near = useRef<[number, number] | null>(null);
  const currentRef = useRef(1);
  const pendingFocus = useRef<number | null>(null);
  const pendingAnchor = useRef<ZoomAnchor | null>(null);
  const params = useRef<DrawParams | null>(null);
  const pdfjsRef = useRef<PdfJs | null>(null);
  const scheduler = useRef<{ running: boolean; cancel?: () => void }>({ running: false });
  const textLayerReady = useRef(onTextLayerReady);
  useLayoutEffect(() => { textLayerReady.current = onTextLayerReady; });
  const slotList = useCallback(() => Array.from({ length: params.current?.doc.numPages ?? 0 }, (_, index) => slots.current.get(index + 1)).filter((slot): slot is HTMLDivElement => Boolean(slot)), []);

  const notify = useCallback((page: number) => {
    const entry = drawn.current.get(page);
    const callback = textLayerReady.current;
    if (!entry || !callback) return;
    const focus = pendingFocus.current === page;
    if (focus) pendingFocus.current = null;
    callback(entry.textDivs, entry.text, { page, focus });
  }, []);
  const release = useCallback((page: number) => {
    failed.current.delete(page);
    const entry = drawn.current.get(page);
    if (!entry) return;
    freeCanvas(entry.canvas); entry.textLayer.remove();
    drawn.current.delete(page);
    void params.current?.doc.getPage(page).then(pdfPage => pdfPage.cleanup()).catch(() => undefined);
  }, []);
  const draw = useCallback(async (run: DrawParams, page: number) => {
    const slot = slots.current.get(page);
    if (!slot) { failed.current.add(page); return; }
    const scale = run.scaleOf(page), ratio = run.ratioOf(page);
    let canvas: HTMLCanvasElement | undefined;
    try {
      const pdfPage = await run.doc.getPage(page);
      const viewport = pdfPage.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
      canvas.setAttribute("aria-label", `PDF page ${page}`);
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("Canvas rendering is unavailable.");
      const rendered = pdfPage.render({ canvasContext, canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      scheduler.current.cancel = () => rendered.cancel();
      await rendered.promise;
      const textLayer = document.createElement("div"); textLayer.className = "textLayer";
      for (const [name, value] of [["--scale-factor", String(viewport.scale)], ["--user-unit", "1"], ["--total-scale-factor", String(viewport.scale)], ["--scale-round-x", "1px"], ["--scale-round-y", "1px"]]) textLayer.style.setProperty(name, value);
      const text = new run.pdfjs.TextLayer({ textContentSource: await pdfPage.getTextContent(), container: textLayer, viewport });
      scheduler.current.cancel = () => text.cancel();
      await text.render();
      if (params.current?.doc !== run.doc) { freeCanvas(canvas); return; }
      if (!slot.isConnected) { freeCanvas(canvas); failed.current.add(page); return; }
      // Swap only once drawn: a stale (zoomed) canvas stays stretched in place until then.
      const previous = drawn.current.get(page);
      if (previous) { freeCanvas(previous.canvas); previous.textLayer.remove(); }
      slot.replaceChildren(canvas, textLayer);
      drawn.current.set(page, { canvas, textLayer, scale, ratio, textDivs: text.textDivs, text: text.textContentItemsStr });
      setDrawnAny(true);
      notify(page);
    } catch (cause) {
      if (canvas) freeCanvas(canvas);
      if (cause instanceof Error && (cause.name === "RenderingCancelledException" || cause.name === "AbortException")) return;
      failed.current.add(page);
      if (page === currentRef.current) setError(cause instanceof Error ? cause.message : "This page could not be rendered.");
    } finally { scheduler.current.cancel = undefined; }
  }, [notify]);
  /** One page at a time, nearest the view first; re-plans after each so fast scrolling skips pages. */
  const pump = useCallback(async () => {
    const state = scheduler.current;
    if (state.running) return;
    state.running = true;
    try {
      for (;;) {
        const run = params.current;
        if (!run) break;
        const freshness = new Map<number, boolean>();
        for (const [page, entry] of drawn.current) freshness.set(page, entry.scale === run.scaleOf(page) && entry.ratio === run.ratioOf(page));
        for (const page of failed.current) freshness.set(page, true);
        const plan = planPdfPages({ pageCount: run.doc.numPages, near: near.current, current: currentRef.current, rendered: freshness, pixelsOf: run.pixelsOf });
        plan.release.forEach(release);
        const next = plan.render[0];
        if (next === undefined) break;
        await draw(run, next);
      }
    } finally { state.running = false; }
  }, [draw, release]);

  // Load the document, then every page's size (page 1 first, so it shows at once).
  useEffect(() => {
    let alive = true; let task: ReturnType<PdfJs["getDocument"]> | undefined;
    const state = scheduler.current, drawnPages = drawn.current, failedPages = failed.current;
    setDoc(null); setSizes([]); setSizesReady(false); setZoom(1); setError(null); setDrawnAny(false); setCurrent(1);
    currentRef.current = 1; near.current = null; pendingFocus.current = null;
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        task = pdfjs.getDocument({ data });
        const loaded = await task.promise;
        if (!alive) return;
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
        const measured: PageSize[] = Array.from({ length: loaded.numPages }, () => ({ width: first.width, height: first.height }));
        if (!alive) return;
        params.current = null; pdfjsRef.current = pdfjs;
        setSizes(measured.slice()); setDoc(loaded);
        for (let page = 2; page <= loaded.numPages; page++) {
          const viewport = (await loaded.getPage(page)).getViewport({ scale: 1 });
          if (!alive) return;
          measured[page - 1] = { width: viewport.width, height: viewport.height };
          if (page % 50 === 0 || page === loaded.numPages) setSizes(measured.slice());
        }
        setSizesReady(true);
      } catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : "This PDF could not be rendered."); }
    })();
    return () => {
      alive = false;
      state.cancel?.();
      params.current = null;
      for (const page of [...drawnPages.keys()]) release(page);
      failedPages.clear();
      void task?.destroy();
    };
  }, [blob, release]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const boxes = useMemo(() => {
    const fit = Math.max(FIT_MIN, Math.min(width - GUTTER * 2, FIT_MAX));
    return sizes.map(size => {
      const scale = fit * zoom / size.width;
      const box = { scale, width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) };
      return { ...box, ratio: canvasPixelRatio(box.width, box.height, window.devicePixelRatio) };
    });
  }, [sizes, width, zoom]);

  // Publish the current geometry to the drawing loop and restart it.
  useLayoutEffect(() => {
    const pdfjs = pdfjsRef.current;
    if (!doc || !pdfjs || !width || !boxes.length) return;
    const box = (page: number) => boxes[page - 1] ?? boxes[0];
    params.current = {
      pdfjs, doc,
      scaleOf: page => box(page).scale,
      ratioOf: page => box(page).ratio,
      pixelsOf: page => box(page).width * box(page).height * box(page).ratio ** 2,
    };
    // A stretched canvas reads fine for a moment; its text layer would sit at the old scale.
    for (const [page, entry] of drawn.current) entry.textLayer.hidden = entry.scale !== box(page).scale;
    void pump();
  }, [doc, width, boxes, pump]);

  // Keep the same point under the pointer (or the view's centre) across a zoom.
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (anchor && host.current) restoreZoomAnchor(anchor, slotList(), host.current, verticalScroller(host.current));
  }, [boxes, slotList]);

  // Which element scrolls the pages: this viewport inside a dialog, otherwise the pane or page around it.
  useLayoutEffect(() => {
    if (!host.current || !sizes.length) return;
    setScroller(verticalScroller(host.current));
  }, [sizes.length, width]);

  useEffect(() => {
    if (!doc || !scroller || !sizes.length) return;
    const root = observerRoot(scroller);
    const nearPages = new Set<number>();
    const visible = new Map<number, number>();
    const pageOf = (entry: IntersectionObserverEntry) => Number((entry.target as HTMLElement).dataset.page);
    const nearObserver = new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) nearPages.add(pageOf(entry)); else nearPages.delete(pageOf(entry)); }
      near.current = nearPages.size ? [Math.min(...nearPages), Math.max(...nearPages)] : null;
      void pump();
    }, { root, rootMargin: "100% 0px" });
    const visibleObserver = new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) visible.set(pageOf(entry), entry.intersectionRect.height); else visible.delete(pageOf(entry)); }
      let best = 0, bestHeight = -1;
      for (const [page, height] of visible) if (height > bestHeight || (height === bestHeight && page < best)) { best = page; bestHeight = height; }
      if (!best) return;
      currentRef.current = best; setCurrent(best);
      void pump();
    }, { root, threshold: VISIBLE_THRESHOLDS });
    for (const slot of slots.current.values()) { nearObserver.observe(slot); visibleObserver.observe(slot); }
    return () => { nearObserver.disconnect(); visibleObserver.disconnect(); };
  }, [doc, scroller, sizes.length, pump]);

  const scrollToPage = useCallback((page: number) => {
    const slot = slots.current.get(page);
    if (!slot || !host.current) return;
    const target = verticalScroller(host.current);
    const root = observerRoot(target);
    // A sticky toolbar covers the top of an outer scroller; the dialog's own viewport sits below it.
    const offset = (root ? root.getBoundingClientRect().top : 0) + (target === host.current ? 0 : nav.current?.offsetHeight ?? 0) + GUTTER;
    target.scrollTop += slot.getBoundingClientRect().top - offset;
    currentRef.current = page; setCurrent(page);
  }, []);

  useEffect(() => {
    for (const page of drawn.current.keys()) notify(page);
  }, [onTextLayerReady, notify]);
  useEffect(() => {
    if (!doc || !sizesReady) return;
    if (pageNumber === undefined || !Number.isFinite(pageNumber)) {
      if (focusKey !== undefined) pendingFocus.current = currentRef.current;
    } else {
      const page = Math.min(Math.max(1, Math.floor(pageNumber)), doc.numPages);
      pendingFocus.current = page;
      scrollToPage(page);
    }
    if (pendingFocus.current !== null && drawn.current.has(pendingFocus.current)) notify(pendingFocus.current);
  }, [doc, sizesReady, pageNumber, focusKey, scrollToPage, notify]);

  const zoomTo = useCallback((next: number, at?: { x: number; y: number }) => {
    if (host.current) {
      const point = at ?? visibleCentre(host.current);
      pendingAnchor.current = captureZoomAnchor(slotList(), point.x, point.y);
    }
    setZoom(clampZoom(next));
  }, [slotList]);
  usePinchZoom({
    surface: host, content: pages, zoom,
    onPinchStart: centre => { if (host.current) pendingAnchor.current = captureZoomAnchor(slotList(), centre.x, centre.y); },
    onPinchEnd: next => setZoom(next),
  });

  const pageCount = doc?.numPages ?? 0;
  const commitPage = () => {
    if (pageDraft === null) return;
    const page = parsePageInput(pageDraft, pageCount);
    setPageDraft(null);
    if (page) scrollToPage(page);
  };
  return <div className="pdf-preview">
    {doc && <div ref={nav} className="pdf-preview__nav" role="toolbar" aria-label="PDF page controls">
      <button type="button" className="btn btn--sm btn--icon" disabled={current <= 1} onClick={() => scrollToPage(current - 1)} aria-label="Previous page" title="Previous page"><ChevronLeft size={14} /></button>
      <label className="pdf-preview__page-field">
        <span>Page</span>
        <input
          className="pdf-preview__page-input"
          inputMode="numeric"
          enterKeyHint="go"
          aria-label={`Page number, of ${pageCount}`}
          value={pageDraft ?? String(current)}
          style={{ width: `${Math.max(2, String(pageCount).length) + 1.5}ch` }}
          onFocus={event => { setPageDraft(String(current)); event.currentTarget.select(); }}
          onChange={event => setPageDraft(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitPage(); event.currentTarget.blur(); } }}
          onBlur={commitPage}
        />
        <span>of {pageCount}</span>
      </label>
      <button type="button" className="btn btn--sm btn--icon" disabled={current >= pageCount} onClick={() => scrollToPage(current + 1)} aria-label="Next page" title="Next page"><ChevronRight size={14} /></button>
      <span className="pdf-preview__nav-gap" aria-hidden="true" />
      <PreviewZoomControls zoom={zoom} onZoom={next => zoomTo(next)} />
    </div>}
    {!drawnAny && !error && <p role="status" className="pdf-preview__status">Rendering PDF…</p>}
    {error && <p role="alert" className="pdf-preview__status">Could not render this PDF: {error}</p>}
    <ScrollArea ref={host} data-testid={testId} viewportClassName="pdf-preview__viewport" tabIndex={0} role="region" aria-label={pageCount ? `PDF, ${pageCount} pages` : "PDF"}>
      <div ref={pages} className="pdf-preview__pages">
        {boxes.map((box, index) => <div
          key={index}
          ref={element => { if (element) slots.current.set(index + 1, element); else slots.current.delete(index + 1); }}
          className="pdf-preview__page"
          data-page={index + 1}
          style={{ width: box.width, height: box.height }}
        />)}
      </div>
    </ScrollArea>
  </div>;
}

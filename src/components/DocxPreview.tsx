import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { clampZoom } from "./previewViewport";
import { captureZoomAnchor, PreviewZoomControls, restoreZoomAnchor, usePinchZoom, verticalScroller, visibleCentre, type ZoomAnchor } from "./PreviewZoom";

const GUTTER = 8;

/**
 * A Word document through docx-preview, fitted to the available width.
 * docx-preview lays pages out at their real size (612pt Letter is 816px), which
 * is wider than a phone, so the whole render is scaled with CSS `zoom`: unlike
 * a transform it reflows the scroll box and keeps text selectable. Zoom is
 * relative to that fit (25%–400%), by buttons or pinch, as in `PdfPreview`.
 */
export function DocxPreview({ blob, onError }: { blob: Blob; onError?: (error: unknown) => void }) {
  const [ready, setReady] = useState(false);
  const [pageWidth, setPageWidth] = useState(0);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const host = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const render = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<ZoomAnchor | null>(null);
  const failed = useRef(onError);
  useLayoutEffect(() => { failed.current = onError; });
  const sections = useCallback(() => Array.from(render.current?.querySelectorAll<HTMLElement>("section.docx") ?? []), []);

  useEffect(() => {
    const container = render.current;
    if (!container) return;
    let alive = true;
    setReady(false); setZoom(1); setPageWidth(0);
    container.replaceChildren();
    container.style.setProperty("--docx-scale", "1");
    renderAsync(blob, container).then(() => {
      if (!alive) return;
      // Measured unscaled: the widest page (landscape sections can be wider).
      setPageWidth(Math.max(0, ...sections().map(section => section.offsetWidth)));
      setReady(true);
    }).catch(error => { if (alive) failed.current?.(error); });
    return () => { alive = false; container.replaceChildren(); };
  }, [blob, sections]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = pageWidth && width ? Math.min(1, Math.max(0.1, (width - GUTTER * 2) / pageWidth)) : 1;
  useLayoutEffect(() => {
    if (!ready || !render.current) return;
    render.current.style.setProperty("--docx-scale", String(fit * zoom));
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (anchor && host.current) restoreZoomAnchor(anchor, sections(), host.current, verticalScroller(host.current));
  }, [ready, fit, zoom, sections]);

  const anchorAt = useCallback((point: { x: number; y: number }) => { pendingAnchor.current = captureZoomAnchor(sections(), point.x, point.y); }, [sections]);
  const zoomTo = (next: number) => {
    if (host.current) anchorAt(visibleCentre(host.current));
    setZoom(clampZoom(next));
  };
  usePinchZoom({ surface: host, content, zoom, onPinchStart: anchorAt, onPinchEnd: setZoom });

  return <div className="docx-preview">
    {ready && <div className="docx-preview__toolbar" role="toolbar" aria-label="Document zoom">
      <PreviewZoomControls zoom={zoom} onZoom={zoomTo} />
    </div>}
    {!ready && <p role="status" className="pdf-preview__status">Rendering document…</p>}
    <div ref={host} className="docx-preview__viewport" tabIndex={0} role="region" aria-label="Word document" data-testid="file-docx-preview">
      <div ref={content} className="docx-preview__content">
        <div ref={render} className="minutes-docx-preview__render docx-preview__render" />
      </div>
    </div>
  </div>;
}

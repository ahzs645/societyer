import { useEffect, useRef, type RefObject } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { clampZoom, MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM, stepZoom, zoomLabel } from "./previewViewport";

/**
 * Zoom controls, pinch-to-zoom and scroll anchoring shared by the PDF and Word
 * previews. Zoom is relative to fit-width (see previewViewport.ts); the middle
 * button shows the level and resets to fit.
 */
export function PreviewZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const label = zoomLabel(zoom);
  return <>
    <button type="button" className="btn btn--sm btn--icon" disabled={zoom <= MIN_PREVIEW_ZOOM + 0.005} onClick={() => onZoom(stepZoom(zoom, -1))} aria-label="Zoom out" title="Zoom out"><ZoomOut size={14} /></button>
    <button type="button" className="btn btn--sm preview-zoom__level" onClick={() => onZoom(1)} aria-label={label === "Fit" ? "Fit to width" : `${label}, fit to width`} title="Fit to width">{label}</button>
    <button type="button" className="btn btn--sm btn--icon" disabled={zoom >= MAX_PREVIEW_ZOOM - 0.005} onClick={() => onZoom(stepZoom(zoom, 1))} aria-label="Zoom in" title="Zoom in"><ZoomIn size={14} /></button>
  </>;
}

/** The ancestor (or `start` itself) that scrolls vertically: the dialog body, a pane, or the page. */
export function verticalScroller(start: HTMLElement | null): HTMLElement {
  let fallback: HTMLElement | null = null;
  for (let element = start; element; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY;
    if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") continue;
    if (element.scrollHeight > element.clientHeight + 1) return element;
    fallback ??= element;
  }
  return fallback ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** IntersectionObserver root for a scroller: `null` for the page itself. */
export function observerRoot(scroller: HTMLElement): HTMLElement | null {
  return scroller === document.scrollingElement || scroller === document.documentElement ? null : scroller;
}

/** Client coordinates of the middle of what `element` currently shows. */
export function visibleCentre(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, window.innerHeight);
  const left = Math.max(rect.left, 0), right = Math.min(rect.right, window.innerWidth);
  return { x: (left + right) / 2, y: (top + Math.max(top, bottom)) / 2 };
}

/** A point on a page (index + fraction of its box) kept under the same screen position across a zoom. */
export type ZoomAnchor = { index: number; relX: number; relY: number; x: number; y: number };

export function captureZoomAnchor(items: readonly HTMLElement[], x: number, y: number): ZoomAnchor | null {
  if (!items.length) return null;
  // Items are stacked vertically: binary-search the one at (or nearest above) y.
  let low = 0, high = items.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (items[middle].getBoundingClientRect().top <= y) low = middle; else high = middle - 1;
  }
  const rect = items[low].getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { index: low, relX: (x - rect.left) / rect.width, relY: (y - rect.top) / rect.height, x, y };
}

export function restoreZoomAnchor(anchor: ZoomAnchor, items: readonly HTMLElement[], horizontal: HTMLElement, vertical: HTMLElement) {
  const item = items[anchor.index];
  if (!item) return;
  const rect = item.getBoundingClientRect();
  horizontal.scrollLeft += rect.left + anchor.relX * rect.width - anchor.x;
  vertical.scrollTop += rect.top + anchor.relY * rect.height - anchor.y;
}

/**
 * Two-finger pinch on `surface` previews the zoom as a transform of `content`
 * (cheap: no re-render per frame), then commits it once on release. One-finger
 * pans stay native scrolling, and the sheet's drag-to-dismiss only starts from
 * its header, so the two never compete.
 */
export function usePinchZoom({ surface, content, zoom, onPinchStart, onPinchEnd }: {
  surface: RefObject<HTMLElement | null>;
  content: RefObject<HTMLElement | null>;
  zoom: number;
  onPinchStart: (centre: { x: number; y: number }) => void;
  onPinchEnd: (zoom: number) => void;
}) {
  const latest = useRef({ zoom, onPinchStart, onPinchEnd });
  useEffect(() => { latest.current = { zoom, onPinchStart, onPinchEnd }; });
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let start: { distance: number; zoom: number } | null = null;
    let ratio = 1;
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const reset = () => {
      const target = content.current;
      if (target) { target.style.transform = ""; target.style.transformOrigin = ""; }
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const target = content.current;
      if (!target) return;
      const centre = { x: (event.touches[0].clientX + event.touches[1].clientX) / 2, y: (event.touches[0].clientY + event.touches[1].clientY) / 2 };
      const rect = target.getBoundingClientRect();
      start = { distance: Math.max(1, distance(event.touches)), zoom: latest.current.zoom };
      ratio = 1;
      target.style.transformOrigin = `${centre.x - rect.left}px ${centre.y - rect.top}px`;
      latest.current.onPinchStart(centre);
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 2) return;
      event.preventDefault();
      ratio = clampZoom(start.zoom * distance(event.touches) / start.distance) / start.zoom;
      if (content.current) content.current.style.transform = `scale(${ratio})`;
    };
    const onEnd = (event: TouchEvent) => {
      if (!start || event.touches.length >= 2) return;
      const from = start.zoom;
      start = null;
      reset();
      if (Math.abs(ratio - 1) > 0.02) latest.current.onPinchEnd(clampZoom(from * ratio));
    };
    const onCancel = () => { start = null; reset(); };
    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onCancel);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onCancel);
      reset();
    };
  }, [surface, content]);
}

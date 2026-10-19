/**
 * Pure zoom, page-window and title rules shared by the PDF and Word previews.
 * DOM-free so `scripts/check-file-preview.ts` can check them directly.
 *
 * Zoom is relative to fit-width: 1 is "Fit", 0.5 shows the page at half the
 * available width, 2 at twice it.
 */
export const PREVIEW_ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4] as const;
export const MIN_PREVIEW_ZOOM = PREVIEW_ZOOM_STEPS[0];
export const MAX_PREVIEW_ZOOM = PREVIEW_ZOOM_STEPS[PREVIEW_ZOOM_STEPS.length - 1];

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, zoom));
}

/** The next preset strictly beyond `zoom`, so a pinched 1.37 steps to 1.5 or 1.25. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const current = clampZoom(zoom);
  const steps = direction > 0 ? PREVIEW_ZOOM_STEPS : [...PREVIEW_ZOOM_STEPS].reverse();
  return steps.find(step => direction > 0 ? step > current + 0.005 : step < current - 0.005) ?? current;
}

export function zoomLabel(zoom: number): string {
  return Math.abs(zoom - 1) < 0.005 ? "Fit" : `${Math.round(zoom * 100)}%`;
}

/**
 * Canvas backing-store ratio: sharp on high-density screens, but never more
 * than `maxRatio` and never more than `maxPixels` per canvas, so a zoomed page
 * on a 3x phone does not allocate tens of megabytes.
 */
export function canvasPixelRatio(cssWidth: number, cssHeight: number, devicePixelRatio: number, { maxRatio = 2, maxPixels = 4_000_000 } = {}): number {
  const area = Math.max(1, cssWidth * cssHeight);
  return Math.max(0.25, Math.min(devicePixelRatio || 1, maxRatio, Math.sqrt(maxPixels / area)));
}

/**
 * Which PDF pages to draw next and which canvases to free. `near` is the range
 * of placeholders inside the observer margin; `rendered` maps drawn pages to
 * whether they match the current scale. Pages near the view are drawn first,
 * closest to `current` first; a few already-drawn neighbours are kept so
 * scrolling back does not flash; everything else, and anything beyond the
 * pixel budget, is released. Visible pages are never dropped for the budget.
 */
export function planPdfPages({ pageCount, near, current, rendered, pixelsOf, overscan = 1, keep = 2, pixelBudget = 16_000_000 }: {
  pageCount: number;
  near: readonly [number, number] | null;
  current: number;
  rendered: ReadonlyMap<number, boolean>;
  pixelsOf: (page: number) => number;
  overscan?: number;
  keep?: number;
  pixelBudget?: number;
}): { render: number[]; release: number[] } {
  if (pageCount < 1) return { render: [], release: [...rendered.keys()] };
  const clamp = (page: number) => Math.min(pageCount, Math.max(1, Math.floor(page)));
  const focus = clamp(current);
  const first = Math.min(clamp(near?.[0] ?? focus), focus);
  const last = Math.max(clamp(near?.[1] ?? focus), focus);
  const renderFrom = clamp(first - overscan), renderTo = clamp(last + overscan);
  const keepFrom = clamp(renderFrom - keep), keepTo = clamp(renderTo + keep);
  const candidates: number[] = [];
  for (let page = keepFrom; page <= keepTo; page++) candidates.push(page);
  // Pages in view first, then overscan; nearest the current page first within each.
  const outside = (page: number) => page < first || page > last ? 1 : 0;
  candidates.sort((a, b) => outside(a) - outside(b) || Math.abs(a - focus) - Math.abs(b - focus) || a - b);
  const kept = new Set<number>();
  const render: number[] = [];
  let total = 0;
  for (const page of candidates) {
    const inRender = page >= renderFrom && page <= renderTo;
    const fresh = rendered.get(page) === true;
    // Outside the render range only an up-to-date canvas is worth keeping.
    if (!inRender && !fresh) continue;
    const pixels = pixelsOf(page);
    const visible = page >= first && page <= last;
    if (!visible && total + pixels > pixelBudget) continue;
    total += pixels;
    kept.add(page);
    if (!fresh) render.push(page);
  }
  return { render, release: [...rendered.keys()].filter(page => !kept.has(page)).sort((a, b) => a - b) };
}

/** 1-based page from a typed value, or null when it is not a page of this document. */
export function parsePageInput(value: string, pageCount: number): number | null {
  const page = Number(value.trim());
  if (!Number.isInteger(page) || page < 1 || page > pageCount) return null;
  return page;
}

/**
 * Splits a file name for a middle ellipsis: `head` may be cut by CSS, `tail`
 * (the last word or so plus the extension) always stays visible, so
 * "Forestry Digital … Product Design.docx" reads "Forestry Digital…Design.docx".
 * Short names come back whole in `head`.
 */
export function splitFileName(name: string, tailChars = 12): { head: string; tail: string } {
  const extension = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? "";
  const stem = name.slice(0, name.length - extension.length);
  if (stem.length <= tailChars + 8) return { head: name, tail: "" };
  const slice = stem.slice(-tailChars);
  // Start the tail at a word boundary when one is in reach: "Design", not "oduct Design".
  const boundary = slice.search(/[\s_\-.]/);
  const tailStem = boundary >= 0 && boundary < slice.length - 3 ? slice.slice(boundary + 1) : slice;
  return { head: stem.slice(0, stem.length - tailStem.length), tail: `${tailStem}${extension}` };
}

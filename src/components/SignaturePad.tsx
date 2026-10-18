import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Eraser, Undo2 } from "lucide-react";

/**
 * x and y are in "pad units": CSS px at the scale the pad had when the point
 * was drawn. Redraws scale every stroke by one factor (see `fitScale`), so a
 * resize never stretches the signature out of shape.
 */
type InkPoint = { x: number; y: number; t: number; pressure: number };
type Stroke = { pen: boolean; points: InkPoint[] };

/** Running width state for the stroke being drawn. */
type InkState = { width: number; speed: number };

const MIN_WIDTH = 1.2;
const MAX_WIDTH = 3.2;
/** CSS px per ms at which the line reaches its thinnest. */
const FAST_SPEED = 2.4;
/** Ignore jitter closer than this to the previous point (CSS px). */
const MIN_STEP = 0.6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function startInk(stroke: Stroke): InkState {
  const pressure = stroke.points[0]?.pressure ?? 0.5;
  const width = stroke.pen ? MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * pressure : (MIN_WIDTH + MAX_WIDTH) / 2;
  return { width: clamp(width, MIN_WIDTH, MAX_WIDTH), speed: 0 };
}

/** Faster is thinner; a pen's pressure dominates. Both are smoothed so the edge doesn't jitter. */
function nextInk(prev: InkState, a: InkPoint, b: InkPoint, stroke: Stroke): InkState {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const instant = distance / Math.max(1, b.t - a.t);
  const speed = prev.speed * 0.7 + instant * 0.3;
  const speedWidth = MAX_WIDTH - (MAX_WIDTH - MIN_WIDTH) * clamp(speed / FAST_SPEED, 0, 1);
  const target = stroke.pen ? 0.75 * (MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * b.pressure) + 0.25 * speedWidth : speedWidth;
  return { width: clamp(prev.width * 0.6 + target * 0.4, MIN_WIDTH, MAX_WIDTH), speed };
}

const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Draw the piece of the stroke that point `i` completes: a quadratic curve
 * through segment midpoints, controlled by the previous point. Live drawing
 * and full redraws call this with the same inputs, so they render identically.
 */
function drawSegment(ctx: CanvasRenderingContext2D, stroke: Stroke, i: number, width: number) {
  const pts = stroke.points;
  ctx.lineWidth = width;
  ctx.beginPath();
  if (i === 0) {
    const p = pts[0];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (i === 1) {
    const from = pts[0];
    const to = mid(pts[0], pts[1]);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  } else {
    const from = mid(pts[i - 2], pts[i - 1]);
    const control = pts[i - 1];
    const to = mid(pts[i - 1], pts[i]);
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  }
  ctx.stroke();
}

/** Close the stroke from the last midpoint to the final point. */
function drawTail(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number) {
  const pts = stroke.points;
  if (pts.length < 2) return;
  const from = mid(pts[pts.length - 2], pts[pts.length - 1]);
  const to = pts[pts.length - 1];
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, finished: boolean) {
  let ink = startInk(stroke);
  drawSegment(ctx, stroke, 0, ink.width);
  for (let i = 1; i < stroke.points.length; i += 1) {
    ink = nextInk(ink, stroke.points[i - 1], stroke.points[i], stroke);
    drawSegment(ctx, stroke, i, ink.width);
  }
  if (finished) drawTail(ctx, stroke, ink.width);
  return ink;
}

/**
 * One scale for every stroke: 1 while the ink fits the box, smaller once the
 * box gets narrower (or shorter) than the ink. Never above 1, so widening the
 * pad leaves the signature its drawn size instead of stretching it.
 */
function fitScale(strokes: Stroke[], w: number, h: number) {
  let maxX = 0;
  let maxY = 0;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  // Shrinking also keeps room for the round cap, so the last stroke isn't
  // sliced at the edge; ink that already fits stays exactly where it was.
  const fit = (extent: number, box: number) => (extent <= box ? 1 : box / (extent + MAX_WIDTH));
  return Math.min(fit(maxX, w), fit(maxY, h));
}

// Resolve the ink colour from the canvas's CSS `color` (var(--text-primary) in
// _forms.scss) so strokes follow the active theme.
const inkColor = (canvas: HTMLCanvasElement) => getComputedStyle(canvas).color || "#111827";
/** The saved PNG is always dark ink: a signature drawn in the dark theme would
 * otherwise be saved white and vanish on light pages and printed minutes. */
const EXPORT_INK = "#1c2024";

/** The strokes at the pad's current size, redrawn off-screen in EXPORT_INK. */
function exportPng(canvas: HTMLCanvasElement, strokes: Stroke[], scale: number) {
  if (strokes.length === 0) return null;
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  const ratio = (window.devicePixelRatio || 1) * scale;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = EXPORT_INK;
  for (const stroke of strokes) drawStroke(ctx, stroke, true);
  return out.toDataURL("image/png");
}

/**
 * Size the backing store to the CSS box x devicePixelRatio, then let the
 * caller repaint. Setting canvas.width wipes the bitmap, which used to erase
 * the signature when a phone rotated or its toolbar collapsed, so the pad
 * redraws from its stored strokes every time this fires.
 */
function useCanvasFit(canvasRef: RefObject<HTMLCanvasElement | null>, onFit: (rect: DOMRect) => void) {
  const latest = useRef(onFit);
  useEffect(() => {
    latest.current = onFit;
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let ratioQuery: MediaQueryList | null = null;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ratio = window.devicePixelRatio || 1;
      const pixelW = Math.max(1, Math.round(rect.width * ratio));
      const pixelH = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      latest.current(rect);
    };
    // Moving the window to a screen with a different pixel ratio doesn't resize the box.
    const watchRatio = () => {
      ratioQuery?.removeEventListener("change", onRatio);
      ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      ratioQuery.addEventListener("change", onRatio);
    };
    function onRatio() {
      fit();
      watchRatio();
    }
    fit();
    watchRatio();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (observer) observer.observe(canvas);
    else window.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      ratioQuery?.removeEventListener("change", onRatio);
    };
  }, [canvasRef]);
}

/**
 * A small canvas signature pad. Captures pointer strokes and reports a PNG
 * data URL of the canvas (or null when empty) via onChange after each stroke,
 * undo or clear. Works with mouse, touch and pen via Pointer Events.
 */
export function SignaturePad({
  onChange,
  height = 120,
  ariaLabel = "Signature pad",
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<{ pointerId: number; stroke: Stroke; ink: InkState; rect: DOMRect } | null>(null);
  const size = useRef({ w: 0, h: 0 });
  /** Pad units to CSS px; fixed while a stroke is being drawn. */
  const scale = useRef(1);
  const [count, setCount] = useState(0);

  const context = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const ratio = (window.devicePixelRatio || 1) * scale.current;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = inkColor(canvas);
    return ctx;
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = size.current;
    // Mid-stroke the scale stays put, or the points already taken would move.
    if (!active.current) scale.current = fitScale(strokes.current, w, h);
    const ctx = context();
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    for (const stroke of strokes.current) {
      drawStroke(ctx, stroke, stroke !== active.current?.stroke);
    }
  };

  useCanvasFit(canvasRef, (rect) => {
    size.current = { w: rect.width, h: rect.height };
    if (active.current) active.current.rect = rect;
    redraw();
  });

  const emit = () => {
    setCount(strokes.current.length);
    onChange(canvasRef.current ? exportPng(canvasRef.current, strokes.current, scale.current) : null);
  };

  // Held to the box: ink dragged past the edge would otherwise shrink the
  // whole signature on the next redraw to bring it back into view.
  const pointFrom = (event: PointerEvent, rect: DOMRect, pen: boolean): InkPoint => ({
    x: clamp(event.clientX - rect.left, 0, rect.width) / scale.current,
    y: clamp(event.clientY - rect.top, 0, rect.height) / scale.current,
    t: event.timeStamp,
    pressure: pen ? clamp(event.pressure || 0.5, 0, 1) : 0.5,
  });

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (active.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pen = event.pointerType === "pen";
    const stroke: Stroke = { pen, points: [pointFrom(event.nativeEvent, rect, pen)] };
    const ink = startInk(stroke);
    active.current = { pointerId: event.pointerId, stroke, ink, rect };
    strokes.current.push(stroke);
    const ctx = context();
    if (ctx) drawSegment(ctx, stroke, 0, ink.width);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = active.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const ctx = context();
    if (!ctx) return;
    const native = event.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [native];
    const { stroke } = current;
    for (const sample of samples) {
      const point = pointFrom(sample, current.rect, stroke.pen);
      const prev = stroke.points[stroke.points.length - 1];
      if (Math.hypot(point.x - prev.x, point.y - prev.y) * scale.current < MIN_STEP) continue;
      stroke.points.push(point);
      current.ink = nextInk(current.ink, prev, point, stroke);
      drawSegment(ctx, stroke, stroke.points.length - 1, current.ink.width);
    }
  };

  // pointerup, pointercancel and lostpointercapture all land here; keep the ink
  // drawn so far and report it once.
  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = active.current;
    if (!current || event.pointerId !== current.pointerId) return;
    active.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const ctx = context();
    if (ctx) drawTail(ctx, current.stroke, current.ink.width);
    emit();
  };

  const undo = () => {
    if (active.current || strokes.current.length === 0) return;
    strokes.current.pop();
    redraw();
    emit();
  };

  const clear = () => {
    if (active.current) return;
    strokes.current = [];
    redraw();
    emit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
      if (strokes.current.length === 0) return;
      event.preventDefault();
      undo();
    }
  };

  const empty = count === 0;

  return (
    <div className="signature-pad" onKeyDown={onKeyDown}>
      <canvas
        ref={canvasRef}
        className="signature-pad__canvas"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        aria-keyshortcuts="Control+Z Meta+Z"
        tabIndex={0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      />
      <div className="signature-pad__footer">
        <span className="muted">{empty ? "Draw your signature above" : "Signature captured"}</span>
        <span className="signature-pad__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={undo} disabled={empty} aria-keyshortcuts="Control+Z Meta+Z">
            <Undo2 size={12} /> Undo
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={clear} disabled={empty}>
            <Eraser size={12} /> Clear
          </button>
        </span>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/**
 * A small canvas signature pad. Captures pointer strokes and reports the
 * trimmed PNG data URL (or null when empty) via onChange. Works with mouse,
 * touch, and pen via Pointer Events.
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
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Resolve the current ink colour from the canvas's CSS `color` (set to
  // var(--text-primary) in _forms.scss) so the stroke follows the active theme.
  const inkColor = (canvas: HTMLCanvasElement) =>
    getComputedStyle(canvas).color || "#111827";

  // Size the backing store to the element's CSS size × devicePixelRatio so the
  // stroke stays crisp on high-DPI screens. Re-runs on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = inkColor(canvas);
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = pointFromEvent(event);
    const ctx = event.currentTarget.getContext("2d");
    if (ctx) ctx.strokeStyle = inkColor(event.currentTarget);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !last.current) return;
    const point = pointFromEvent(event);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last.current = point;
    if (!hasInk.current) {
      hasInk.current = true;
      setEmpty(false);
    }
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas && hasInk.current) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        className="signature-pad__canvas"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="signature-pad__footer">
        <span className="muted">{empty ? "Draw your signature above" : "Signature captured"}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={clear} disabled={empty}>
          <Eraser size={12} /> Clear
        </button>
      </div>
    </div>
  );
}

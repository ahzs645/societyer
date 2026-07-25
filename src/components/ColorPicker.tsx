import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

type Props = {
  value: string;
  onChange: (color: string) => void;
  /** Palette of hex colors. Defaults to a Twenty-esque 16-swatch palette. */
  palette?: string[];
  /** Show a free-form hex input at the bottom. Default true. */
  customInput?: boolean;
  disabled?: boolean;
  size?: "md" | "sm";
  /** Render as a compact swatch trigger vs a full select-style trigger. Default "swatch". */
  variant?: "swatch" | "select";
};

const DEFAULT_PALETTE = [
  "#3b5bdb", "#1e6fd9", "#0a8f4e", "#a86400", "#c9264a",
  "#7c3aed", "#db2777", "#059669", "#d97706", "#dc2626",
  "#475569", "#1f2937", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SAFE_HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Only let validated hex strings through to inline style.background so
 * untrusted color values can't inject arbitrary CSS. */
function safeBg(color: string | undefined | null): string {
  return color && SAFE_HEX_RE.test(color) ? color : "transparent";
}

export function ColorPicker({
  value,
  onChange,
  palette = DEFAULT_PALETTE,
  customInput = true,
  disabled,
  size = "md",
  variant = "swatch",
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open]);

  // Once the portal has rendered we know its real size — flip above the anchor
  // when it doesn't fit below, and clamp inside the viewport so the popover
  // never hangs off the phone's right/bottom edge (matches Select/DatePicker).
  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current || !triggerRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const rect = popRef.current.getBoundingClientRect();
    const below = anchor.bottom + 4;
    const top =
      below + rect.height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchor.top - rect.height - 4);
    const left = Math.min(
      Math.max(8, anchor.left),
      Math.max(8, window.innerWidth - rect.width - 8),
    );
    if (Math.abs(top - pos.top) > 0.5 || Math.abs(left - pos.left) > 0.5) {
      setPos({ top, left });
    }
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      // Scrolling inside the popover must not dismiss it.
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (c: string) => {
    onChange(c);
    setOpen(false);
  };

  return (
    <>
      {variant === "swatch" ? (
        <button
          ref={triggerRef}
          type="button"
          className={`color-swatch-trigger${open ? " is-open" : ""}${size === "sm" ? " color-swatch-trigger--sm" : ""}`}
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          aria-label="Pick color"
        >
          <span className="color-swatch-trigger__chip" style={{ background: safeBg(value) }} />
          <span className="color-swatch-trigger__value">{value || "—"}</span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={`select-trigger${size === "sm" ? " select-trigger--sm" : ""}${open ? " is-open" : ""}`}
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
        >
          <span className="select-trigger__label">
            <span className="color-chip" style={{ background: safeBg(value) }} />
            {value || <span className="select-trigger__placeholder">Pick color</span>}
          </span>
        </button>
      )}
      {open && pos
        ? createPortal(
            <div ref={popRef} className="color-pop" style={{ top: pos.top, left: pos.left }}>
              <div className="color-pop__grid">
                {palette.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`color-pop__cell${c.toLowerCase() === value.toLowerCase() ? " is-selected" : ""}`}
                    style={{ background: safeBg(c) }}
                    title={c}
                    onClick={() => apply(c)}
                    aria-label={c}
                  >
                    {c.toLowerCase() === value.toLowerCase() && <Check size={12} />}
                  </button>
                ))}
              </div>
              {customInput && (
                <div className="color-pop__custom">
                  <span className="color-chip" style={{ background: safeBg(draft) }} />
                  <input
                    className="color-pop__hex"
                    value={draft}
                    placeholder="#000000"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => {
                      const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                      setDraft(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && HEX_RE.test(draft)) apply(draft);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--sm btn--accent"
                    disabled={!HEX_RE.test(draft)}
                    onClick={() => apply(draft)}
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

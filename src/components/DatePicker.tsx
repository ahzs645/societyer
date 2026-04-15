import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, X } from "lucide-react";

type Props = {
  value: string; // "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  size?: "md" | "sm";
  className?: string;
  style?: React.CSSProperties;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parseISO(v: string): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDisplay(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  disabled,
  clearable = true,
  size = "md",
  className,
  style,
}: Props) {
  const selected = parseISO(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = selected ?? today;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const minD = useMemo(() => parseISO(min ?? ""), [min]);
  const maxD = useMemo(() => parseISO(max ?? ""), [max]);

  useEffect(() => {
    if (selected) setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [value]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
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

  const cells = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    // Monday-start: JS day 0 = Sun → pad 6; day 1 = Mon → pad 0; etc.
    const pad = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - pad);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [viewMonth]);

  const shiftMonth = (delta: number) =>
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const pick = (d: Date) => {
    if (minD && d < minD) return;
    if (maxD && d > maxD) return;
    onChange(toISO(d));
    setOpen(false);
    triggerRef.current?.focus();
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const triggerClass = [
    "select-trigger",
    "date-trigger",
    size === "sm" ? "select-trigger--sm" : "",
    open ? "is-open" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={style}
      >
        <CalIcon size={size === "sm" ? 12 : 14} className="select-trigger__icon" />
        <span className="select-trigger__label">
          {selected ? formatDisplay(selected) : <span className="select-trigger__placeholder">{placeholder}</span>}
        </span>
        {selected && clearable && !disabled && (
          <span
            role="button"
            aria-label="Clear date"
            className="date-trigger__clear"
            onClick={clear}
          >
            <X size={12} />
          </span>
        )}
      </button>
      {open && pos
        ? createPortal(
            <div ref={popRef} className="calendar" style={{ top: pos.top, left: pos.left }}>
              <div className="calendar__head">
                <button
                  type="button"
                  className="calendar__nav"
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="calendar__title">
                  {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
                </div>
                <button
                  type="button"
                  className="calendar__nav"
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="calendar__grid">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="calendar__wd">
                    {w}
                  </div>
                ))}
                {cells.map((d, i) => {
                  const inMonth = d.getMonth() === viewMonth.getMonth();
                  const isSel = selected && sameDay(d, selected);
                  const isToday = sameDay(d, today);
                  const disabled =
                    (minD && d < minD) || (maxD && d > maxD);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`calendar__cell${!inMonth ? " is-out" : ""}${
                        isSel ? " is-selected" : ""
                      }${isToday ? " is-today" : ""}${disabled ? " is-disabled" : ""}`}
                      onClick={() => !disabled && pick(d)}
                      disabled={!!disabled}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="calendar__foot">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => pick(today)}>
                  Today
                </button>
                {clearable && value && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

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
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const YEAR_RANGE = 6; // show ±6 years around the viewed year in the quick-year grid

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
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: Props) {
  const selected = parseISO(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = selected ?? today;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [quick, setQuick] = useState<"month" | "year" | null>(null);
  const [focusDate, setFocusDate] = useState<Date | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const minD = useMemo(() => parseISO(min ?? ""), [min]);
  const maxD = useMemo(() => parseISO(max ?? ""), [max]);

  useEffect(() => {
    if (selected) setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [value]);

  // Reset transient UI state whenever the popover closes.
  useEffect(() => {
    if (!open) {
      setQuick(null);
      setFocusDate(null);
    } else {
      setFocusDate(selected ?? new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1));
    }
  }, [open]);

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

  const moveFocus = (delta: number) => {
    setFocusDate((prev) => {
      const base = prev ?? selected ?? new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      const next = new Date(base);
      next.setDate(base.getDate() + delta);
      if (next.getMonth() !== viewMonth.getMonth() || next.getFullYear() !== viewMonth.getFullYear()) {
        setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
      }
      return next;
    });
  };

  const onPopoverKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (quick) return; // the quick-grid handles its own keys
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(-1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-7);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(7);
        break;
      case "PageUp":
        e.preventDefault();
        shiftMonth(e.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        e.preventDefault();
        shiftMonth(e.shiftKey ? 12 : 1);
        break;
      case "Home":
        e.preventDefault();
        setFocusDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1));
        break;
      case "End":
        e.preventDefault();
        setFocusDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0));
        break;
      case "Enter":
        if (focusDate) {
          e.preventDefault();
          pick(focusDate);
        }
        break;
      case "t":
      case "T":
        e.preventDefault();
        setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
        setFocusDate(today);
        break;
    }
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
      <span
        className={`date-trigger-wrap${selected && clearable && !disabled ? " has-clear" : ""}`}
        style={style}
      >
        <button
          ref={triggerRef}
          type="button"
          id={id}
          className={triggerClass}
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
        >
          <CalIcon size={size === "sm" ? 12 : 14} className="select-trigger__icon" />
          <span className="select-trigger__label">
            {selected ? formatDisplay(selected) : <span className="select-trigger__placeholder">{placeholder}</span>}
          </span>
        </button>
        {selected && clearable && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            className="date-trigger__clear"
            onClick={clear}
          >
            <X size={12} />
          </button>
        )}
      </span>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="calendar"
              role="dialog"
              aria-label="Date picker"
              tabIndex={-1}
              onKeyDown={onPopoverKey}
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="calendar__head">
                <button
                  type="button"
                  className="calendar__nav"
                  onClick={() => shiftMonth(-1)}
                  aria-label={quick === "year" ? "Previous year range" : "Previous month"}
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="calendar__title">
                  <button
                    type="button"
                    className={`calendar__title-btn${quick === "month" ? " is-open" : ""}`}
                    onClick={() => setQuick((q) => (q === "month" ? null : "month"))}
                    aria-label="Choose month"
                  >
                    {MONTHS[viewMonth.getMonth()]}
                  </button>
                  <button
                    type="button"
                    className={`calendar__title-btn${quick === "year" ? " is-open" : ""}`}
                    onClick={() => setQuick((q) => (q === "year" ? null : "year"))}
                    aria-label="Choose year"
                  >
                    {viewMonth.getFullYear()}
                  </button>
                </div>
                <button
                  type="button"
                  className="calendar__nav"
                  onClick={() => shiftMonth(1)}
                  aria-label={quick === "year" ? "Next year range" : "Next month"}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              {quick === "month" ? (
                <div className="calendar__quick calendar__quick--months" role="grid" aria-label="Month">
                  {MONTHS_SHORT.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      className={`calendar__quick-cell${i === viewMonth.getMonth() ? " is-current" : ""}`}
                      onClick={() => {
                        setViewMonth((m) => new Date(m.getFullYear(), i, 1));
                        setQuick(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : quick === "year" ? (
                <div className="calendar__quick calendar__quick--years" role="grid" aria-label="Year">
                  {Array.from({ length: YEAR_RANGE * 2 + 1 }, (_, i) => viewMonth.getFullYear() - YEAR_RANGE + i).map(
                    (y) => (
                      <button
                        key={y}
                        type="button"
                        className={`calendar__quick-cell${y === viewMonth.getFullYear() ? " is-current" : ""}`}
                        onClick={() => {
                          setViewMonth((m) => new Date(y, m.getMonth(), 1));
                          setQuick(null);
                        }}
                      >
                        {y}
                      </button>
                    ),
                  )}
                </div>
              ) : (
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
                    const isFocused = focusDate && sameDay(d, focusDate);
                    const disabled = (minD && d < minD) || (maxD && d > maxD);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`calendar__cell${!inMonth ? " is-out" : ""}${
                          isSel ? " is-selected" : ""
                        }${isToday ? " is-today" : ""}${isFocused ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
                        onClick={() => !disabled && pick(d)}
                        disabled={!!disabled}
                        aria-current={isToday ? "date" : undefined}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="calendar__foot">
                <span className="muted" style={{ fontSize: "var(--fs-xxs)", marginRight: "auto" }}>
                  ← → · PgUp/PgDn · T = today
                </span>
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

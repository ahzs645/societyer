import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";

type Props = {
  /** ISO-ish "YYYY-MM-DDTHH:mm" (matches native datetime-local). Empty string for no value. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  size?: "md" | "sm";
  /** 12 or 24-hour clock. Default 24. */
  clock?: 12 | 24;
  step?: 1 | 5 | 10 | 15 | 30; // minute step
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parse(v: string): { date: Date | null; hh: number; mm: number } {
  if (!v) return { date: null, hh: 9, mm: 0 };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v);
  if (!m) return { date: null, hh: 9, mm: 0 };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return { date: d, hh: m[4] ? Number(m[4]) : 9, mm: m[5] ? Number(m[5]) : 0 };
}

function toISO(d: Date, hh: number, mm: number): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function DateTimeInput({
  value,
  onChange,
  placeholder = "Pick date & time",
  disabled,
  clearable = true,
  size = "md",
  clock = 24,
  step = 5,
}: Props) {
  const parsed = parse(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = parsed.date ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [hh, setHH] = useState(parsed.hh);
  const [mm, setMM] = useState(parsed.mm);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const p = parse(value);
    setHH(p.hh);
    setMM(p.mm);
    if (p.date) setView(new Date(p.date.getFullYear(), p.date.getMonth(), 1));
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
      if (e.key === "Escape") setOpen(false);
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
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const pad = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - pad);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const pickDay = (d: Date) => onChange(toISO(d, hh, mm));
  const setTime = (nextHH: number, nextMM: number) => {
    setHH(nextHH);
    setMM(nextMM);
    const base = parsed.date ?? d(view.getFullYear(), view.getMonth(), 1);
    if (parsed.date) onChange(toISO(parsed.date, nextHH, nextMM));
    else onChange(toISO(base, nextHH, nextMM));
  };

  const display = parsed.date
    ? parsed.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " · " +
      formatTime(hh, mm, clock)
    : null;

  const minuteOptions = useMemo(() => {
    const out: number[] = [];
    for (let m = 0; m < 60; m += step) out.push(m);
    return out;
  }, [step]);

  const hourOptions = useMemo(() => {
    if (clock === 24) return Array.from({ length: 24 }, (_, i) => i);
    return Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
  }, [clock]);

  const currentHourDisplay = clock === 24 ? hh : ((hh % 12) || 12);
  const isPM = hh >= 12;

  const handleHourChange = (h: number) => {
    if (clock === 24) setTime(h, mm);
    else {
      const base = h % 12;
      setTime(isPM ? base + 12 : base, mm);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select-trigger date-trigger${size === "sm" ? " select-trigger--sm" : ""}${open ? " is-open" : ""}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <CalIcon size={size === "sm" ? 12 : 14} className="select-trigger__icon" />
        <span className="select-trigger__label">
          {display ?? <span className="select-trigger__placeholder">{placeholder}</span>}
        </span>
        {parsed.date && clearable && !disabled && (
          <span
            role="button"
            aria-label="Clear"
            className="date-trigger__clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          >
            <X size={12} />
          </span>
        )}
      </button>
      {open && pos
        ? createPortal(
            <div ref={popRef} className="calendar calendar--with-time" style={{ top: pos.top, left: pos.left }}>
              <div className="calendar__head">
                <button type="button" className="calendar__nav" onClick={() => setView((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
                  <ChevronLeft size={14} />
                </button>
                <div className="calendar__title">
                  {MONTHS[view.getMonth()]} {view.getFullYear()}
                </div>
                <button type="button" className="calendar__nav" onClick={() => setView((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="calendar__grid">
                {WEEKDAYS.map((w) => <div key={w} className="calendar__wd">{w}</div>)}
                {cells.map((d2, i) => {
                  const inMonth = d2.getMonth() === view.getMonth();
                  const isSel = parsed.date && sameDay(d2, parsed.date);
                  const isToday = sameDay(d2, today);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`calendar__cell${!inMonth ? " is-out" : ""}${isSel ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                      onClick={() => pickDay(d2)}
                    >
                      {d2.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="calendar__time">
                <Clock size={12} />
                <select
                  className="calendar__time-select"
                  value={currentHourDisplay}
                  onChange={(e) => handleHourChange(Number(e.target.value))}
                >
                  {hourOptions.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
                </select>
                <span>:</span>
                <select
                  className="calendar__time-select"
                  value={mm}
                  onChange={(e) => setTime(hh, Number(e.target.value))}
                >
                  {minuteOptions.map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                </select>
                {clock === 12 && (
                  <select
                    className="calendar__time-select"
                    value={isPM ? "PM" : "AM"}
                    onChange={(e) => {
                      const base = hh % 12;
                      setTime(e.target.value === "PM" ? base + 12 : base, mm);
                    }}
                  >
                    <option>AM</option>
                    <option>PM</option>
                  </select>
                )}
              </div>
              <div className="calendar__foot">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    const now = new Date();
                    setView(new Date(now.getFullYear(), now.getMonth(), 1));
                    onChange(toISO(now, now.getHours(), Math.floor(now.getMinutes() / step) * step));
                  }}
                >
                  Now
                </button>
                {clearable && value && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => { onChange(""); setOpen(false); }}
                  >
                    Clear
                  </button>
                )}
                <button type="button" className="btn btn--accent btn--sm" onClick={() => setOpen(false)}>
                  Done
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function d(y: number, m: number, day: number) {
  return new Date(y, m, day);
}

function formatTime(hh: number, mm: number, clock: 12 | 24) {
  const mmStr = String(mm).padStart(2, "0");
  if (clock === 24) return `${String(hh).padStart(2, "0")}:${mmStr}`;
  const h = hh % 12 || 12;
  return `${h}:${mmStr} ${hh >= 12 ? "PM" : "AM"}`;
}

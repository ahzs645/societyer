import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ToneVariant } from "./ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function gridDays(month: Date): Date[] {
  const first = startOfMonth(month);
  // Start grid on Monday.
  const weekday = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - weekday);
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type CalendarEvent = {
  id: string;
  label: string;
  tone?: ToneVariant;
  date: string; // ISO-ish; first 10 chars used
};

/** Month grid calendar. Purely presentational — caller owns data + onSelect. */
export function CalendarView<T>({
  items,
  getDate,
  getLabel,
  getTone,
  getId,
  onSelect,
  initialMonth,
}: {
  items: T[];
  getDate: (item: T) => string | null | undefined;
  getLabel: (item: T) => string;
  getTone?: (item: T) => ToneVariant | undefined;
  getId: (item: T) => string;
  onSelect?: (item: T) => void;
  initialMonth?: Date;
}) {
  const [month, setMonth] = useState(() => startOfMonth(initialMonth ?? new Date()));
  const today = new Date();

  const byDay = useMemo(() => {
    const map = new Map<string, { item: T; label: string; tone?: ToneVariant; id: string }[]>();
    for (const item of items) {
      const iso = getDate(item);
      if (!iso) continue;
      const key = iso.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push({
        item,
        label: getLabel(item),
        tone: getTone?.(item),
        id: getId(item),
      });
      map.set(key, list);
    }
    return map;
  }, [items, getDate, getLabel, getTone, getId]);

  const days = gridDays(month);
  const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="calendar-view">
      <div className="calendar-view__head">
        <div className="calendar-view__title">{monthLabel}</div>
        <div className="calendar-view__nav">
          <button className="btn btn--ghost btn--sm btn--icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft size={14} />
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</button>
          <button className="btn btn--ghost btn--sm btn--icon" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="calendar-view__weekdays">
        {WEEKDAYS.map((w) => <div key={w} className="calendar-view__weekday">{w}</div>)}
      </div>
      <div className="calendar-view__grid">
        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const events = byDay.get(dateKey(day)) ?? [];
          const visible = events.slice(0, 3);
          const extra = events.length - visible.length;
          return (
            <div
              key={day.toISOString()}
              className={`calendar-view__cell${inMonth ? "" : " is-outside"}${sameDay(day, today) ? " is-today" : ""}`}
            >
              <div className="calendar-view__date">{day.getDate()}</div>
              <div className="calendar-view__events">
                {visible.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`calendar-view__event${e.tone ? ` calendar-view__event--${e.tone}` : ""}`}
                    title={e.label}
                    onClick={() => onSelect?.(e.item)}
                  >
                    {e.label}
                  </button>
                ))}
                {extra > 0 && <div className="calendar-view__more">+{extra} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

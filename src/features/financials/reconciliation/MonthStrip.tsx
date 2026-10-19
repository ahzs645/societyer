import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Circle, Sparkles } from "lucide-react";
import type { MonthStatusRow } from "./types";

const ICONS = {
  reconciled: CheckCircle2,
  in_progress: CircleDashed,
  not_started: Circle,
  difference: AlertTriangle,
  upcoming: Circle,
} as const;

const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-CA", { month: "short" }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));

/**
 * The year as twelve months, each with its reconciliation status. The current
 * month reads "Now"; months that haven't started can't be chosen. A tablist
 * like the shared Tabs: one tab stop (the selected month), and the arrow
 * keys, Home and End select among the months that can be chosen.
 */
export function MonthStrip({
  months,
  selected,
  currentMonth,
  onSelect,
}: {
  months: MonthStatusRow[];
  selected?: string;
  currentMonth: string;
  onSelect: (month: string) => void;
}) {
  const choosable = months.filter((row) => row.kind !== "upcoming");
  const tabStop = choosable.some((row) => row.month === selected) ? selected : choosable[0]?.month;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    if (choosable.length === 0) return;
    event.preventDefault();
    const current = choosable.findIndex((row) => row.month === selected);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? choosable.length - 1
      : current < 0 ? 0
      : Math.min(choosable.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)));
    const month = choosable[next].month;
    onSelect(month);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-month="${month}"]`)?.focus();
  };
  return (
    <div className="recon-month-strip" role="tablist" aria-label="Months" onKeyDown={onKeyDown}>
      {months.map((row) => {
        const Icon = row.kind === "reconciled" && row.auto ? Sparkles : ICONS[row.kind];
        const isSelected = row.month === selected;
        const upcoming = row.kind === "upcoming";
        return (
          <button
            key={row.month}
            type="button"
            role="tab"
            data-month={row.month}
            className={`recon-month recon-month--${row.kind.replace(/_/g, "-")}${isSelected ? " is-selected" : ""}`}
            aria-selected={isSelected}
            tabIndex={row.month === tabStop ? 0 : -1}
            disabled={upcoming}
            onClick={() => onSelect(row.month)}
            title={row.transactionCount ? `${row.transactionCount} transaction${row.transactionCount === 1 ? "" : "s"}` : "No transactions"}
          >
            <span className="recon-month__name">{monthName(row.month)}{row.month === currentMonth ? " – Now" : ""}</span>
            <span className="recon-month__status">
              <Icon size={12} aria-hidden="true" />
              {upcoming ? "—" : row.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

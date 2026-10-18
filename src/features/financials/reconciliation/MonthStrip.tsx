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
 * month reads "Now"; months that haven't started can't be chosen.
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
  return (
    <div className="recon-month-strip" role="list" aria-label="Months">
      {months.map((row) => {
        const Icon = row.kind === "reconciled" && row.auto ? Sparkles : ICONS[row.kind];
        const isSelected = row.month === selected;
        const upcoming = row.kind === "upcoming";
        return (
          <button
            key={row.month}
            type="button"
            role="listitem"
            className={`recon-month recon-month--${row.kind.replace(/_/g, "-")}${isSelected ? " is-selected" : ""}`}
            aria-current={isSelected ? "true" : undefined}
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

import { AlertTriangle, CheckCircle2, CircleDashed, Sparkles } from "lucide-react";
import { PERIOD_STATUS_LABELS, type PeriodStatus } from "../../../../shared/reconciliationPeriods";

const ICONS = {
  in_progress: CircleDashed,
  completed: CheckCircle2,
  auto_reconciled: Sparkles,
  out_of_balance: AlertTriangle,
} as const;

export function PeriodStatusPill({ status }: { status: PeriodStatus }) {
  const Icon = ICONS[status] ?? CircleDashed;
  return (
    <span className={`period-pill period-pill--${status.replace(/_/g, "-")}`}>
      <Icon size={12} aria-hidden="true" />
      {PERIOD_STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** "Mar 1 – Mar 31, 2026" (or across years: "Dec 1, 2025 – Jan 31, 2026"). */
export function formatPeriodRange(startDate: string, endDate: string): string {
  const parse = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const start = parse(startDate);
  const end = parse(endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const short = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" });
  const long = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" });
  return `${sameYear ? short.format(start) : long.format(start)} – ${long.format(end)}`;
}

import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock3, PieChart } from "lucide-react";
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from "../../../shared/invoicing";

const ICONS = {
  draft: CircleDashed,
  sent: Clock3,
  partially_paid: PieChart,
  paid: CheckCircle2,
  overdue: AlertTriangle,
  void: Ban,
} as const;

/** Status pill. Overdue reads in the warning tone with the days past due. */
export function InvoiceStatusPill({ status, daysOverdue, partial }: { status: InvoiceStatus; daysOverdue?: number; partial?: boolean }) {
  const Icon = ICONS[status] ?? CircleDashed;
  const label = status === "overdue" && daysOverdue
    ? `Overdue ${daysOverdue}d`
    : INVOICE_STATUS_LABEL[status] ?? status;
  return (
    <span
      className={`invoice-pill invoice-pill--${status.replace(/_/g, "-")}`}
      title={status === "overdue" && daysOverdue ? `${daysOverdue} days past due${partial ? ", partially paid" : ""}` : undefined}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
      {status === "overdue" && partial ? <span className="sr-only">, partially paid</span> : null}
    </span>
  );
}

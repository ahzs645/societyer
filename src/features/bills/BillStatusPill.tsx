import { AlertTriangle, Ban, CalendarCheck, CheckCircle2, CircleDashed, Clock3, PieChart, UserCheck } from "lucide-react";
import { Badge, type ToneVariant } from "../../components/ui";
import { BILL_STATUS_LABEL, type BillStatus } from "../../../shared/bills";

const ICONS = {
  draft: CircleDashed,
  awaiting_approval: UserCheck,
  open: Clock3,
  scheduled: CalendarCheck,
  partially_paid: PieChart,
  paid: CheckCircle2,
  overdue: AlertTriangle,
  canceled: Ban,
} as const;

export const BILL_STATUS_TONE: Record<BillStatus, ToneVariant> = {
  draft: "neutral",
  awaiting_approval: "purple",
  open: "info",
  scheduled: "turquoise",
  partially_paid: "orange",
  paid: "success",
  overdue: "danger",
  canceled: "gray",
};

/** Status pill. Overdue reads with the days past due. */
export function BillStatusPill({ status, daysOverdue }: { status: BillStatus; daysOverdue?: number }) {
  const Icon = ICONS[status] ?? CircleDashed;
  const label = status === "overdue" && daysOverdue ? `Overdue ${daysOverdue}d` : BILL_STATUS_LABEL[status] ?? status;
  return (
    <span className="bill-pill" title={status === "overdue" && daysOverdue ? `${daysOverdue} days past due` : undefined}>
      <Badge tone={BILL_STATUS_TONE[status] ?? "neutral"}>
        <Icon size={12} aria-hidden="true" /> {label}
      </Badge>
    </span>
  );
}

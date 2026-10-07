import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { useSociety } from "../../hooks/useSociety";
import { isModuleEnabled } from "../../lib/modules";
import { formatDate, relative } from "../../lib/format";

/**
 * Dashboard card: agreements whose current term ends within 90 days, with the
 * renewal-notice date and whether a renewal decision has been recorded.
 * Hidden with the Agreements module or without agreements:read.
 */
export function AgreementsExpiringCard({ societyId }: { societyId: string }) {
  const { can } = usePermissions();
  const society = useSociety();
  const enabled = can("agreements:read") && isModuleEnabled(society as any, "agreements");
  const data = useQuery(api.agreements.summary, enabled ? { societyId, windowDays: 90 } : "skip") as any;
  if (!enabled) return null;
  if (data && !data.total) return null;
  const rows: any[] = data?.expiring ?? [];
  return (
    <div className="card" data-testid="agreements-expiring-card">
      <div className="card__head">
        <h2 className="card__title">Agreements expiring in 90 days</h2>
        <Link to="/app/agreements?filter=expiring" className="card__subtitle row" style={{ marginLeft: "auto" }}>
          Agreements <ArrowRight size={12} />
        </Link>
      </div>
      <div className="card__body col" style={{ gap: 8 }}>
        {!data && <div className="muted">Checking agreements…</div>}
        {data && !rows.length && <div className="muted">No agreement ends in the next 90 days.{data.overdueObligations ? ` ${data.overdueObligations} deliverable or report obligation(s) are overdue.` : ""}</div>}
        {rows.slice(0, 6).map((row) => (
          <div key={row._id} className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div>
              <Link to={`/app/agreements/${row._id}`}><strong>{row.title}</strong></Link>
              {row.counterparties?.length > 0 && <span className="muted"> · {row.counterparties.join("; ")}</span>}
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Ends {formatDate(row.endDate)} ({relative(row.endDate)}){row.renewalDue && row.renewalDue !== row.endDate ? ` · notice by ${formatDate(row.renewalDue)}` : ""}
              </div>
            </div>
            {row.autoRenew ? <Badge tone="info">Renews automatically</Badge> : row.renewalDecided ? <Badge tone="success">Decision recorded</Badge> : <Badge tone="warn">No renewal decision</Badge>}
          </div>
        ))}
        {rows.length > 6 && <Link to="/app/agreements?filter=expiring" className="muted">+{rows.length - 6} more</Link>}
      </div>
    </div>
  );
}

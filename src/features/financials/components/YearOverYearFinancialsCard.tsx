import { ChevronRight } from "lucide-react";
import { Badge } from "../../../components/ui";
import { formatDate, money } from "../../../lib/format";

function auditStatusTone(status: string) {
  if (status === "Audited") return "success";
  if (["ReviewEngagement", "Review engagement", "Compilation", "Compiled", "T2/GIFI"].includes(status)) return "info";
  return "warn";
}

function auditStatusLabel(status: string) {
  if (status === "ReviewEngagement") return "Review engagement";
  return status;
}

export function YearOverYearFinancialsCard({
  rows,
  onOpenFinancialYear,
}: {
  rows: any[];
  onOpenFinancialYear: (fiscalYear: string) => void;
}) {
  return (
    <div className="card">
      <div className="card__head"><h2 className="card__title">Year-over-year</h2></div>
      <table className="table">
        <thead>
          <tr>
            <th>Fiscal year</th>
            <th>Period end</th>
            <th>Revenue</th>
            <th>Expenses</th>
            <th>Net assets</th>
            <th>Restricted</th>
            <th>Audit</th>
            <th>Board approval</th>
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr
              key={f._id}
              role="button"
              tabIndex={0}
              aria-label={`Open FY ${f.fiscalYear} financial detail`}
              onClick={() => onOpenFinancialYear(f.fiscalYear)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpenFinancialYear(f.fiscalYear);
              }}
              style={{ cursor: "pointer" }}
              onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = ""; }}
            >
              <td><strong>{f.fiscalYear}</strong></td>
              <td className="table__cell--mono">{formatDate(f.periodEnd)}</td>
              <td className="table__cell--mono">{money(f.revenueCents)}</td>
              <td className="table__cell--mono">{money(f.expensesCents)}</td>
              <td className="table__cell--mono">{money(f.netAssetsCents)}</td>
              <td className="table__cell--mono">{money(f.restrictedFundsCents)}</td>
              <td>
                <Badge tone={auditStatusTone(f.auditStatus)}>
                  {auditStatusLabel(f.auditStatus)}
                </Badge>
                {f.auditorName && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{f.auditorName}</div>}
              </td>
              <td className="table__cell--mono">{f.approvedByBoardAt ? formatDate(f.approvedByBoardAt) : "—"}</td>
              <td className="muted" style={{ width: 20, padding: "0 8px" }}>
                <ChevronRight size={16} aria-hidden="true" />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>No financial statements yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

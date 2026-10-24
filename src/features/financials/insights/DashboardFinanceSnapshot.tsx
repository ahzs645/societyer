import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Sparkline, addMonths, endOfMonth, formatMonthLong, startOfMonth } from "../../../components/charts";
import { usePermissions } from "../../../hooks/usePermissions";
import { todayDateOnly } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import { balanceLookup, flowTotals } from "./series";
import { useFinanceInsightsData } from "./useFinanceInsightsData";

/**
 * Compact finance snapshot for the dashboard: bank balance, a 12-month
 * month-end sparkline and money in / out this month. Renders nothing unless
 * the viewer can read financials and the workspace has bank data.
 */
export function DashboardFinanceSnapshot({ society }: { society: { _id: string } }) {
  const { loaded, can } = usePermissions();
  const allowed = loaded && can("financials:read");
  const data = useFinanceInsightsData(society._id, allowed);
  const today = todayDateOnly();

  const view = useMemo(() => {
    const balanceAt = balanceLookup(data.txns, data.currentBalance);
    const monthStart = startOfMonth(today);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(monthStart, i - 11));
    const values = months.map((m, i) => (i === 11 ? data.currentBalance : balanceAt(endOfMonth(m))));
    const firstKnown = values.findIndex((v) => v != null);
    const thisMonth = flowTotals(data.txns, { start: monthStart, end: today });
    const trend = firstKnown >= 0 && firstKnown < 11
      ? `Month-end bank balance from ${formatMonthLong(months[firstKnown])} (${formatMoney(values[firstKnown]!, { currency: data.currency, trimWholeCents: true })}) to today (${formatMoney(data.currentBalance, { currency: data.currency, trimWholeCents: true })})`
      : undefined;
    return { values, thisMonth, trend };
  }, [data.currency, data.currentBalance, data.txns, today]);

  if (!allowed || data.loading || data.bankAccountCount === 0) return null;

  return (
    <section className="card finance-snapshot" aria-labelledby="finance-snapshot-title">
      <div className="card__head">
        <h2 className="card__title" id="finance-snapshot-title">Finances · {data.currency}</h2>
        <Link to="/app/financials" className="card__subtitle row" style={{ marginLeft: "auto" }}>
          Open financials <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>
      <div className="card__body finance-snapshot__body">
        <div className="finance-snapshot__balance">
          <div>
            <div className="finance-snapshot__label">Bank balance</div>
            <div className="finance-snapshot__value">{formatMoney(data.currentBalance, { currency: data.currency, trimWholeCents: true })}</div>
          </div>
          <div className="finance-snapshot__spark">
            <Sparkline values={view.values} curve="step" ariaLabel={view.trend} />
          </div>
        </div>
        <dl className="finance-snapshot__flows" aria-label="This month">
          <div className="finance-snapshot__flow">
            <dt><span className="chart-swatch chart-swatch--bar" style={{ "--swatch": "var(--dv-in)" } as React.CSSProperties} aria-hidden="true" />In this month</dt>
            <dd>{formatMoney(view.thisMonth.inflow, { currency: data.currency, trimWholeCents: true })}</dd>
          </div>
          <div className="finance-snapshot__flow">
            <dt><span className="chart-swatch chart-swatch--bar" style={{ "--swatch": "var(--dv-out)" } as React.CSSProperties} aria-hidden="true" />Out this month</dt>
            <dd>{formatMoney(view.thisMonth.outflow, { currency: data.currency, trimWholeCents: true })}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

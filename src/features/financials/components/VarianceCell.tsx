import type { ReactNode } from "react";
import { Money } from "../../../components/Money";
import { formatPercentChange } from "../../../components/ReportTable";
import type { budgetVariance } from "../../../lib/money";

type Variance = ReturnType<typeof budgetVariance>;

/** One budget-variance convention for every finance screen. */
export const VARIANCE_HELP: ReactNode = (
  <>
    <p>
      Variance is shown so that <strong>positive is favourable</strong>: budget − actual for expenses (spent less than
      planned) and actual − budget for revenue (raised more than planned).
    </p>
    <p>Green means favourable, red means unfavourable. The percentage is the variance relative to the budget.</p>
  </>
);

/** Favourable/unfavourable variance with its % of budget underneath. */
export function VarianceCell({ variance, currency }: { variance: Variance; currency?: string }) {
  const tone = variance.cents === 0 ? "auto" : variance.favourable ? "favourable" : "unfavourable";
  return (
    <span className="finance-table__variance">
      <Money cents={variance.cents} currency={currency} tone={tone} signDisplay="exceptZero" />
      {variance.percent != null && (
        <span className={`finance-table__sub${tone === "auto" ? "" : ` money--${tone}`}`}>{formatPercentChange(variance.percent)}</span>
      )}
    </span>
  );
}

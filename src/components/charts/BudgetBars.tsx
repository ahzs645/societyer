import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { budgetVariance, formatMoney } from "../../lib/money";
import type { ValueFormatter } from "./types";

export type BudgetBarRow = {
  key: string;
  label: string;
  planned: number;
  actual: number;
  /** Expense lines are favourable under plan; revenue lines over plan. */
  kind?: "expense" | "revenue";
};

export type BudgetBarLabels = {
  planned?: string;
  actual?: string;
  /** Variance wording, e.g. "under budget" / "over budget". */
  favourable?: string;
  unfavourable?: string;
};

const percent = (value: number, max: number) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100)));

/**
 * Horizontal budget-vs-actual bullet bars. The track spans the plan, the fill
 * is the actual, a tick marks the target, and any overspend runs past the tick
 * in the unfavourable colour. Every value is printed, so nothing depends on
 * hover or colour alone (variance carries an icon and words).
 */
export function BudgetBars({
  rows,
  ariaLabel,
  labels,
  formatValue = (v) => formatMoney(v, { trimWholeCents: true }),
}: {
  rows: BudgetBarRow[];
  ariaLabel: string;
  labels?: BudgetBarLabels;
  formatValue?: ValueFormatter;
}) {
  const max = Math.max(1, ...rows.map((row) => Math.max(row.planned, row.actual)));
  const plannedLabel = labels?.planned ?? "Budget";
  return (
    <ul className="budget-bars" aria-label={ariaLabel}>
      {rows.map((row) => {
        const kind = row.kind ?? "expense";
        const variance = budgetVariance(row.planned, row.actual, kind);
        const planPct = percent(row.planned, max);
        const actualPct = percent(row.actual, max);
        const overspend = kind === "expense" && row.actual > row.planned;
        const used = row.planned > 0 ? Math.round((row.actual / row.planned) * 100) : null;
        const words = variance.favourable ? labels?.favourable ?? (kind === "expense" ? "under budget" : "above plan") : labels?.unfavourable ?? (kind === "expense" ? "over budget" : "below plan");
        const Icon = variance.favourable ? CheckCircle2 : AlertTriangle;
        return (
          <li key={row.key} className="budget-bar">
            <div className="budget-bar__head">
              <span className="budget-bar__label">{row.label}</span>
              <span className="budget-bar__values">
                <strong>{formatValue(row.actual)}</strong>
                <span className="budget-bar__of"> of {formatValue(row.planned)} {plannedLabel.toLowerCase()}</span>
              </span>
            </div>
            <div className="budget-bar__track" aria-hidden="true">
              <span className="budget-bar__plan" style={{ width: `${planPct}%` }} />
              <span className="budget-bar__fill chart-grow-x" style={{ width: `${overspend ? planPct : actualPct}%` }} />
              {overspend && <span className="budget-bar__over chart-grow-x" style={{ left: `${planPct}%`, width: `${actualPct - planPct}%` }} />}
              {row.planned > 0 && <span className="budget-bar__target" style={{ left: `${planPct}%` }} />}
            </div>
            <div className={`budget-bar__variance ${variance.favourable ? "is-favourable" : "is-unfavourable"}`}>
              <Icon size={13} aria-hidden="true" />
              <span>
                {formatValue(Math.abs(variance.cents))} {words}
                {used != null && <span className="budget-bar__used"> · {used}% used</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

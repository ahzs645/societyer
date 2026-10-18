import { useMemo, type ReactNode } from "react";
import { formatRange, type DateRange } from "../../../components/charts";
import { InfoPopover } from "../../../components/InfoPopover";
import { MobileFold } from "../../../components/MobileFold";
import {
  RUNWAY_WINDOW_MONTHS,
  comparisonRange,
  moneyOutTrend,
  runway,
  topMoneyInSources,
  type CompareMode,
  type Runway,
  type MoneyOutTrend,
} from "../../../../shared/financeNarrative";
import type { FinanceTxn } from "./series";

type Item = { key: string; label: string; context?: string; sentence: string; infoLabel: string; info: ReactNode };

/**
 * Written insights for the Financials overview: cash position and runway,
 * money out against the comparison period, and the top sources of money in.
 * The sentences come from shared/financeNarrative.ts (fixed rules, no model),
 * so the same transactions always read the same way.
 *
 * Phones: folded behind a one-line summary, like the page's other sections.
 */
export function NarrativeInsights({
  txns,
  balanceCents,
  range,
  mode,
  today,
}: {
  txns: FinanceTxn[];
  /** Today's bank and card balance. */
  balanceCents: number;
  /** The focused range (preset or dragged selection). */
  range: DateRange;
  /** Comparison for the money-out trend; the previous period when comparison is off. */
  mode: CompareMode;
  today: string;
}) {
  const insights = useMemo(
    () => ({
      cash: runway(txns, balanceCents, today),
      trend: moneyOutTrend(txns, range, mode),
      sources: topMoneyInSources(txns, range),
    }),
    [balanceCents, mode, range, today, txns],
  );
  const rangeLabel = formatRange(range.start, range.end);
  const prior = comparisonRange(range, mode);
  const items: Item[] = [
    {
      key: "runway",
      label: "Cash and runway",
      sentence: insights.cash.sentence,
      infoLabel: "How runway is worked out",
      info: (
        <>
          <p><strong>Bank and card balance ÷ average monthly net burn.</strong></p>
          <p>
            Net burn is money out less money in, averaged over the last {RUNWAY_WINDOW_MONTHS} fully completed months. The current month is left out
            because it isn't over yet. It doesn't follow the range selector.
          </p>
          <p>When money in kept up with money out there is no burn, so runway isn't applicable rather than endless.</p>
        </>
      ),
    },
    {
      key: "out",
      label: "Money out",
      context: rangeLabel,
      sentence: insights.trend.sentence,
      infoLabel: "How the money-out trend is worked out",
      info: (
        <>
          <p>
            Payments from {rangeLabel} against {mode === "lastYear" ? "the same dates a year earlier" : "the equally long period just before"} ({formatRange(prior.start, prior.end)}).
          </p>
          <p>It follows the Compare to choice above, and uses the previous period when comparison is off. There is no comparison when the imported transactions don't reach back that far.</p>
        </>
      ),
    },
    {
      key: "in",
      label: "Money in",
      context: rangeLabel,
      sentence: insights.sources.sentence,
      infoLabel: "How money-in sources are grouped",
      info: (
        <p>
          Deposits from {rangeLabel}, grouped by category, or by payer when a deposit has no category. Each percentage is that source's share of all money in for the range.
        </p>
      ),
    },
  ];

  return (
    <MobileFold title="Insights" summary={foldSummary(insights.cash, insights.trend)}>
      <section className="card narrative-insights" aria-label="Insights">
        <div className="card__head">
          <h2 className="card__title">Insights</h2>
          <span className="card__subtitle">Written from bank and card transactions. Transfers between your own accounts are left out.</span>
        </div>
        <ul className="narrative-insights__list">
          {items.map((item) => (
            <li key={item.key} className="narrative-insights__item">
              <div className="narrative-insights__label">
                <span>{item.label}</span>
                {item.context && <span className="narrative-insights__context">{item.context}</span>}
                <InfoPopover label={item.infoLabel}>{item.info}</InfoPopover>
              </div>
              <p className="narrative-insights__sentence">{item.sentence}</p>
            </li>
          ))}
        </ul>
      </section>
    </MobileFold>
  );
}

/** "About 8.2 months of runway · money out up 12.4%" for the phone fold. */
function foldSummary(cash: Runway, trend: MoneyOutTrend): string {
  const runwayPart = cash.status === "burning" && cash.runwayMonths != null
    ? cash.balanceCents <= 0
      ? "No cash to cover the burn"
      : cash.runwayMonths >= 24
        ? "Runway over two years"
        : `About ${cash.runwayMonths >= 10 ? Math.round(cash.runwayMonths) : (Math.round(cash.runwayMonths * 10) / 10).toFixed(1)} months of runway`
    : cash.status === "not_burning"
      ? "No net burn"
      : "Runway needs more history";
  if (!trend.covered || trend.change == null) return runwayPart;
  const percent = Math.abs(Math.round(trend.change * 1000) / 10).toFixed(1);
  const trendPart = Math.abs(trend.change) < 0.005 ? "money out level" : `money out ${trend.change > 0 ? "up" : "down"} ${percent}%`;
  return `${runwayPart} · ${trendPart}`;
}

import { useMemo, useState } from "react";
import { ChartCard, RankedBars, formatRange, type DateRange, type RankedBarRow } from "../../../components/charts";
import { formatMoney } from "../../../lib/money";
import type { FinanceTxn } from "./series";
import { topFlows, type FlowDirection, type FlowGrouping } from "./topFlows";
import { transactionFilterHref } from "./transactionFilterLink";

const DIRECTIONS: Array<{ id: FlowDirection; label: string }> = [
  { id: "out", label: "Money out" },
  { id: "in", label: "Money in" },
];

const COPY: Record<FlowGrouping, { title: string; noun: string; plural: string }> = {
  payee: { title: "Top payees", noun: "payee", plural: "payees" },
  category: { title: "Top categories", noun: "category", plural: "categories" },
};

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-CA")} ${n === 1 ? one : many}`;

/**
 * The five largest payees or categories for money out (or in) in the range
 * chosen above the charts. Each row opens the Transactions tab filtered to
 * it, with the same dates and direction.
 */
export function TopFlowsCard({ grouping, txns, range, loading }: { grouping: FlowGrouping; txns: FinanceTxn[]; range: DateRange; loading: boolean }) {
  const [direction, setDirection] = useState<FlowDirection>("out");
  const copy = COPY[grouping];
  const flows = useMemo(() => topFlows(txns, range, grouping, direction), [direction, grouping, range, txns]);
  const verb = direction === "out" ? "payment" : "deposit";
  const rows: RankedBarRow[] = flows.rows.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.cents,
    share: row.share,
    detail: count(row.count, verb, `${verb}s`),
    href: transactionFilterHref({ field: row.filter.field, value: row.filter.value, flow: direction, from: range.start, to: range.end }),
  }));
  const directionWords = direction === "out" ? "money out" : "money in";
  const others = flows.groupCount - flows.rows.length;

  return (
    <ChartCard
      title={copy.title}
      subtitle={`Largest ${directionWords} by ${copy.noun} in this range, not counting transfers between your own accounts.`}
      loading={loading}
      height={200}
      empty={!loading && flows.rows.length === 0}
      emptyMessage={`No ${directionWords} in this range.`}
      actions={
        <div className="segmented segmented--compact" role="group" aria-label={`${copy.title}: direction`}>
          {DIRECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`segmented__btn${direction === item.id ? " is-active" : ""}`}
              aria-pressed={direction === item.id}
              onClick={() => setDirection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      }
      table={{
        caption: `${copy.title}, ${directionWords}, ${formatRange(range.start, range.end)}`,
        columns: [
          { key: "label", label: grouping === "payee" ? "Payee" : "Category" },
          { key: "count", label: direction === "out" ? "Payments" : "Deposits", numeric: true },
          { key: "amount", label: "Amount", numeric: true },
          { key: "share", label: "Share", numeric: true },
        ],
        rows: flows.rows.map((row) => ({
          label: row.label,
          count: row.count,
          amount: formatMoney(row.cents),
          share: `${Math.round(row.share * 100)}%`,
        })),
      }}
      footer={others > 0 ? (
        <span className="muted">
          {count(others, `other ${copy.noun}`, `other ${copy.plural}`)}: {formatMoney(flows.otherCents, { trimWholeCents: true })} of {formatMoney(flows.total, { trimWholeCents: true })}
        </span>
      ) : undefined}
    >
      <RankedBars
        rows={rows}
        tone={direction}
        ariaLabel={`${copy.title} by ${directionWords}`}
        linkLabel={(row) => `${row.label}: ${formatMoney(row.value, { trimWholeCents: true })}. Show these transactions`}
      />
    </ChartCard>
  );
}

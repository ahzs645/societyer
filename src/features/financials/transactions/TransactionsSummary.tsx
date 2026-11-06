import { Money } from "../../../components/Money";
import { pluralize } from "../../../lib/format";
import { useRecordTableRowModel } from "../../../platform/record-engine/record-table/hooks/useRecordTableRowModel";
import { moneyFlowSummary } from "../../../../shared/transactionLines";

/**
 * Money in, money out and net change across exactly the rows the table
 * shows (queue, filters and search applied). Mount inside the table scope.
 */
export function TransactionsSummary() {
  const { ordered } = useRecordTableRowModel();
  const rows = ordered as Array<{ amountCents: number; currency?: string }>;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const currency = row.currency ?? "CAD";
    const group = groups.get(currency);
    if (group) group.push(row);
    else groups.set(currency, [row]);
  }
  if (!groups.size) groups.set("CAD", []);
  return (
    <>{[...groups].map(([currency, group]) => {
      const summary = moneyFlowSummary(group);
      return <dl key={currency} className="txn-summary" aria-label={`Totals for transactions shown in ${currency}`}>
      <div className="txn-summary__item">
        <dt>Money in{groups.size > 1 ? ` (${currency})` : ""}</dt>
        <dd><Money cents={summary.inCents} currency={currency} tone="in" /></dd>
      </div>
      <div className="txn-summary__item">
        <dt>Money out</dt>
        <dd><Money cents={summary.outCents} currency={currency} tone="out" /></dd>
      </div>
      <div className="txn-summary__item">
        <dt>Net change</dt>
        <dd><Money cents={summary.netCents} currency={currency} tone={summary.netCents < 0 ? "out" : "in"} signDisplay="exceptZero" /></dd>
      </div>
      <div className="txn-summary__item txn-summary__item--count">
        <dt>Shown</dt>
        <dd>{pluralize(summary.count, "transaction")}</dd>
      </div>
    </dl>;
    })}</>
  );
}

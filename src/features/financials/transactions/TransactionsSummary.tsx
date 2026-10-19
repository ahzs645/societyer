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
  const summary = moneyFlowSummary(ordered as Array<{ amountCents: number }>);
  return (
    <dl className="txn-summary" aria-label="Totals for the transactions shown">
      <div className="txn-summary__item">
        <dt>Money in</dt>
        <dd><Money cents={summary.inCents} tone="in" /></dd>
      </div>
      <div className="txn-summary__item">
        <dt>Money out</dt>
        <dd><Money cents={summary.outCents} tone="out" /></dd>
      </div>
      <div className="txn-summary__item">
        <dt>Net change</dt>
        <dd><Money cents={summary.netCents} tone={summary.netCents < 0 ? "out" : "in"} signDisplay="exceptZero" /></dd>
      </div>
      <div className="txn-summary__item txn-summary__item--count">
        <dt>Shown</dt>
        <dd>{pluralize(summary.count, "transaction")}</dd>
      </div>
    </dl>
  );
}

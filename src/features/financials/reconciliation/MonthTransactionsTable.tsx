import { CheckCircle2, GitCompareArrows, Paperclip } from "lucide-react";
import { EmptyState } from "../../../components/ui";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";
import type { MonthDetail } from "./types";

/**
 * A month's bank lines in date order with the running balance after each.
 * Choosing a line opens it in the match panel.
 */
export function MonthTransactionsTable({
  detail,
  selectedId,
  onSelect,
}: {
  /** undefined while loading. */
  detail: Pick<MonthDetail, "lines" | "openingBalanceCents"> | null | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!detail) {
    return (
      <div className="record-table__loading">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}
      </div>
    );
  }
  const { lines, openingBalanceCents } = detail;
  if (!lines.length) {
    return (
      <div className="card">
        <div className="card__body">
          <EmptyState icon={<GitCompareArrows size={20} />} title="No transactions this month" description="Nothing posted to this account in the month. Its balance carries over unchanged." />
        </div>
      </div>
    );
  }
  return (
    <div className="card recon-month-table">
      <table className="table recon-month-table__table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Ledger account</th>
            <th className="num">Amount</th>
            <th className="num">Balance</th>
            <th><span className="sr-only">Match</span></th>
          </tr>
        </thead>
        <tbody>
          <tr className="recon-month-table__opening">
            <td colSpan={4}>Opening balance</td>
            <td className="num"><Money cents={openingBalanceCents} /></td>
            <td />
          </tr>
          {lines.map((line) => (
            <tr key={line._id} className={selectedId === line._id ? "is-selected" : undefined} onClick={() => onSelect(line._id)}>
              <td data-label="Date" className="recon-month-table__date">{formatDate(line.date, "MMM d")}</td>
              <td data-label="Description">
                <span className="recon-month-table__description">{line.counterparty || line.description}</span>
                {line.hasReceipt && <Paperclip size={12} aria-label="Receipt attached" className="recon-month-table__receipt" />}
              </td>
              <td data-label="Ledger account">{line.ledgerLabel ?? <span className="muted">Uncategorised</span>}</td>
              <td data-label="Amount" className="num"><Money cents={line.amountCents} tone={line.amountCents > 0 ? "in" : "auto"} /></td>
              <td data-label="Balance" className="num"><Money cents={line.balanceCents} /></td>
              <td className="recon-month-table__match">
                {line.reconciled ? (
                  <span className="recon-month-table__cleared" title={line.reconciliationNote}><CheckCircle2 size={12} aria-hidden="true" /> Cleared</span>
                ) : (
                  <button
                    type="button"
                    className={`btn btn--sm ${selectedId === line._id ? "btn--accent" : "btn--ghost"}`}
                    aria-pressed={selectedId === line._id}
                    aria-label={`Match ${line.counterparty || line.description}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(line._id);
                    }}
                  >
                    <GitCompareArrows size={12} aria-hidden="true" /> Match
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

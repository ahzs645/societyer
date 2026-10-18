import { memo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Money } from "../../../components/Money";
import { Badge } from "../../../components/ui";
import { formatDate } from "../../../lib/format";
import type { GeneralLedgerReport, GeneralLedgerRow } from "../../../../shared/booksReports";
import { accountLabel, contraLabel, lineDescription } from "./generalLedgerExport";
import { TagChips } from "../transactions/TagPicker";
import type { FinanceTagsApi } from "../transactions/useFinanceTags";

const entryHref = (entryId: string) => `/app/financials/journal-entries?entry=${encodeURIComponent(entryId)}`;
const transactionHref = (transactionId: string) => `/app/financials?tab=transactions&transaction=${encodeURIComponent(transactionId)}`;

/** Debit or credit cell: blank for zero so the side that moved stands out. */
function SideAmount({ cents, currency }: { cents: number; currency: string }) {
  return cents ? <Money cents={cents} currency={currency} /> : null;
}

const LedgerRow = memo(function LedgerRow({ row, currency, withBalance, tags }: { row: GeneralLedgerRow; currency: string; withBalance: boolean; tags: FinanceTagsApi }) {
  const description = lineDescription(row);
  const contra = contraLabel(row);
  const entryName = row.entryNumber ? `entry ${row.entryNumber}` : "journal entry";
  return (
    <tr>
      <td className="books-ledger__date">
        <Link to={entryHref(row.entryId)} aria-label={`${formatDate(row.date)}, open ${entryName}`}>
          {formatDate(row.date)}
        </Link>
      </td>
      <td className="books-ledger__account">{accountLabel(row.account)}</td>
      <td className="books-ledger__contra" title={contra || undefined}>
        {row.contraAccounts.length > 2 && <Badge tone="info">Split</Badge>}
        <span className="books-ledger__truncate">{contra || "—"}</span>
      </td>
      <td className="books-ledger__memo">
        <span className="books-ledger__truncate">{row.memo || description || "—"}</span>
        {row.memo && description && <span className="books-ledger__truncate finance-table__sub">{description}</span>}
        {row.tagIds?.length ? <TagChips tagIds={row.tagIds} tags={tags} /> : null}
      </td>
      <td className="books-ledger__party">{row.counterparty ?? <span className="muted">—</span>}</td>
      <td className="num"><SideAmount cents={row.debitCents} currency={currency} /></td>
      <td className="num"><SideAmount cents={row.creditCents} currency={currency} /></td>
      {withBalance && <td className="num"><Money cents={row.balanceCents ?? null} currency={currency} negativeStyle="parentheses" /></td>}
      <td className="books-ledger__links">
        {row.financialTransactionId && (
          <Link className="btn btn--ghost btn--sm btn--icon" to={transactionHref(row.financialTransactionId)} aria-label={`Open the bank transaction for ${entryName} on ${formatDate(row.date)}`} title="Open bank transaction">
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        )}
      </td>
    </tr>
  );
});

/** Opening or closing balance row: only the balance column carries an amount. */
function BalanceRow({ label, date, cents, currency }: { label: string; date: string; cents: number; currency: string }) {
  return (
    <tr className="books-ledger__balance-row">
      <td className="books-ledger__date">{formatDate(date)}</td>
      <th scope="row" colSpan={6}>{label}</th>
      <td className="num"><Money cents={cents} currency={currency} negativeStyle="parentheses" /></td>
      <td />
    </tr>
  );
}

/**
 * General ledger table: one row per posted line with its contra accounts,
 * memo, counterparty and debit / credit. Filtered to one account it adds the
 * opening balance, a running balance and the closing balance.
 */
export function GeneralLedgerTable({ report, caption, tags }: { report: GeneralLedgerReport; caption: string; tags: FinanceTagsApi }) {
  const { account, currency } = report;
  const withBalance = Boolean(account);
  return (
    <div className="finance-table-wrap books-ledger" role="region" aria-label={caption} tabIndex={0}>
      <table className="table finance-table books-ledger__table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Ledger account</th>
            <th scope="col">Contra account(s)</th>
            <th scope="col">Memo / description</th>
            <th scope="col">Vendor / customer</th>
            <th scope="col" className="num">Debit</th>
            <th scope="col" className="num">Credit</th>
            {withBalance && <th scope="col" className="num">Balance</th>}
            <th scope="col"><span className="sr-only">Links</span></th>
          </tr>
        </thead>
        <tbody>
          {account && <BalanceRow label="Opening balance" date={report.from} cents={account.openingBalanceCents} currency={currency} />}
          {report.rows.map((row) => (
            <LedgerRow key={row.lineId} row={row} currency={currency} withBalance={withBalance} tags={tags} />
          ))}
          {report.rows.length === 0 && (
            <tr className="finance-empty-row">
              <td colSpan={withBalance ? 9 : 8} className="muted">No posted lines in this range.</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={5}>Totals</th>
            <td className="num"><Money cents={report.totals.debitCents} currency={currency} /></td>
            <td className="num"><Money cents={report.totals.creditCents} currency={currency} /></td>
            {withBalance && <td />}
            <td />
          </tr>
          {account && (
            <tr className="books-ledger__balance-row">
              <td>{formatDate(report.to)}</td>
              <th scope="row" colSpan={6}>Closing balance</th>
              <td className="num"><Money cents={account.closingBalanceCents} currency={currency} negativeStyle="parentheses" /></td>
              <td />
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

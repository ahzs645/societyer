import { MoreHorizontal } from "lucide-react";
import { Badge } from "../../../components/ui";
import { Menu, type MenuSection } from "../../../components/Menu";
import { Money } from "../../../components/Money";
import { formatDate, formatDateTime, pluralize } from "../../../lib/format";
import type { BankAccountRow } from "./types";

const STATUS_TONE = { synced: "success", needs_attention: "warn", not_connected: "neutral" } as const;

/** The Accounts page table: account, source, feed status, last activity, ledger account and balance. */
export function BankAccountsTable({
  rows,
  canWrite,
  showTotal,
  onLink,
  menuFor,
}: {
  rows: BankAccountRow[];
  canWrite: boolean;
  showTotal: boolean;
  onLink: (row: BankAccountRow) => void;
  menuFor: (row: BankAccountRow) => MenuSection[];
}) {
  const shownTotal = rows.filter((row) => row.currency === "CAD").reduce((sum, row) => sum + row.balanceCents, 0);
  return (
    <table className="table table--comfortable bank-accounts-table">
      <thead>
        <tr>
          <th>Account</th>
          <th>Source</th>
          <th>Status</th>
          <th>Last activity</th>
          <th>Ledger account</th>
          <th className="num">Balance</th>
          <th className="bank-accounts-table__actions"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row._id} className={row.archived ? "is-archived" : undefined}>
            <td data-label="Account">
              <span className="bank-accounts-table__name">{row.name}</span>
              <span className="muted bank-accounts-table__meta">
                {[row.institution, row.lastFour ? `••${row.lastFour}` : null, row.kindLabel, row.isRestricted ? "Restricted" : null].filter(Boolean).join(" · ")}
              </span>
            </td>
            <td data-label="Source">{row.sourceLabel}</td>
            <td data-label="Status">
              <span title={row.statusReasons.join(" ") || undefined}><Badge tone={STATUS_TONE[row.status]}>{row.statusLabel}</Badge></span>
              {row.statusReasons.length > 0 && <span className="bank-accounts-table__reason">{row.statusReasons[0]}</span>}
            </td>
            <td data-label="Last activity">
              {row.lastSyncAtISO ? <span title={`Last synced ${formatDateTime(row.lastSyncAtISO)}`}>Synced {formatDate(row.lastSyncAtISO)}</span>
                : row.lastActivityDate ? formatDate(row.lastActivityDate)
                : row.openingDate ? <span className="muted">Opened {formatDate(row.openingDate)}</span>
                : <span className="muted">—</span>}
              <span className="muted bank-accounts-table__meta">{pluralize(row.transactionCount, "transaction")}{row.reconciledThrough ? ` · reconciled to ${formatDate(row.reconciledThrough)}` : ""}</span>
            </td>
            <td data-label="Ledger account">
              {row.ledgerAccount ? row.ledgerAccount.label : (
                <button type="button" className="link-button" disabled={!canWrite} onClick={() => onLink(row)}>Link a ledger account</button>
              )}
            </td>
            <td data-label="Balance" className="num"><Money cents={row.balanceCents} currency={row.currency} /></td>
            <td className="bank-accounts-table__actions">
              <Menu
                align="right"
                label={`Actions for ${row.name}`}
                trigger={<button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${row.name}`}><MoreHorizontal size={14} /></button>}
                sections={menuFor(row)}
              />
            </td>
          </tr>
        ))}
      </tbody>
      {showTotal && (
        <tfoot>
          <tr>
            <td colSpan={5}>Total ({pluralize(rows.length, "account")})</td>
            <td className="num"><Money cents={shownTotal} /></td>
            <td />
          </tr>
        </tfoot>
      )}
    </table>
  );
}

import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Landmark } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { Badge } from "../../../components/ui";
import type { MenuSection } from "../../../components/Menu";
import { Money } from "../../../components/Money";
import { formatDate, formatDateTime, pluralize } from "../../../lib/format";
import type { BankAccountRow } from "./types";

const STATUS_TONE = { synced: "success", needs_attention: "warn", not_connected: "neutral" } as const;

const BANK_ACCOUNTS_TABLE = staticRecordTable({
  id: "bank-accounts",
  nameSingular: "bankAccount",
  namePlural: "bankAccounts",
  labelSingular: "Account",
  labelPlural: "Accounts",
  labelIdentifierFieldName: "name",
  viewName: "All accounts",
  density: "comfortable",
  fields: [
    { name: "name", label: "Account", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "kindLabel", label: "Type", fieldType: FIELD_TYPES.TEXT, size: 130, isVisible: false },
    { name: "institution", label: "Institution", fieldType: FIELD_TYPES.TEXT, size: 150, isVisible: false },
    { name: "sourceLabel", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 130 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 200,
      config: {
        options: [
          { value: "synced", label: "Synced", color: "green" },
          { value: "needs_attention", label: "Needs attention", color: "amber" },
          { value: "not_connected", label: "Not connected", color: "gray" },
        ],
      },
    },
    { name: "lastActivity", label: "Last activity", fieldType: FIELD_TYPES.DATE, size: 200 },
    { name: "transactionCount", label: "Transactions", fieldType: FIELD_TYPES.NUMBER, size: 120, isVisible: false },
    { name: "reconciledThrough", label: "Reconciled to", fieldType: FIELD_TYPES.DATE, size: 130, isVisible: false },
    { name: "ledgerAccount", label: "Ledger account", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "isRestricted", label: "Restricted", fieldType: FIELD_TYPES.BOOLEAN, size: 110, isVisible: false },
    { name: "currency", label: "Currency", fieldType: FIELD_TYPES.TEXT, size: 100, isVisible: false },
    { name: "balanceCents", label: "Balance", fieldType: FIELD_TYPES.CURRENCY, size: 140, config: { isCents: true } },
  ],
});

type BankAccountRecord = {
  _id: string;
  name: string;
  kindLabel: string;
  institution: string;
  sourceLabel: string;
  status: BankAccountRow["status"];
  /** Last sync, else last transaction, else the opening date. */
  lastActivity: string | null;
  transactionCount: number;
  reconciledThrough: string | null;
  ledgerAccount: string;
  isRestricted: boolean;
  currency: string;
  balanceCents: number;
  account: BankAccountRow;
};

function bankAccountRecord(row: BankAccountRow): BankAccountRecord {
  return {
    _id: row._id,
    name: row.name,
    kindLabel: row.kindLabel,
    institution: row.institution ?? "",
    sourceLabel: row.sourceLabel,
    status: row.status,
    lastActivity: row.lastSyncAtISO ?? row.lastActivityDate ?? row.openingDate ?? null,
    transactionCount: row.transactionCount,
    reconciledThrough: row.reconciledThrough ?? null,
    ledgerAccount: row.ledgerAccount?.label ?? "",
    isRestricted: row.isRestricted,
    currency: row.currency,
    balanceCents: row.balanceCents,
    account: row,
  };
}

/** Where the books show an account's posted lines. */
function generalLedgerHref(ledgerAccountId: string) {
  return `/app/financials/reports/general-ledger?account=${encodeURIComponent(ledgerAccountId)}`;
}

/**
 * The Accounts page list: account, source, feed status, last activity, ledger
 * account and balance, with the account's actions behind its "…". The ledger
 * account opens its general ledger.
 */
export function BankAccountsTable({
  rows,
  label,
  loading,
  canWrite,
  onLink,
  menuFor,
  emptyState,
}: {
  rows: BankAccountRow[];
  /** The tab's name, for the list's search ("Search accounts…"). */
  label: string;
  loading: boolean;
  canWrite: boolean;
  onLink: (row: BankAccountRow) => void;
  menuFor: (row: BankAccountRow) => MenuSection[];
  emptyState: ReactNode;
}) {
  const records = useMemo(() => rows.map(bankAccountRecord), [rows]);
  return (
    <RecordListTable<BankAccountRecord>
      variant="card"
      showTitle
      table={BANK_ACCOUNTS_TABLE}
      tableId="bank-accounts"
      label={label}
      icon={<Landmark size={14} />}
      records={records}
      loading={loading}
      renderCell={({ record, field }) => {
        const row = record.account;
        if (field.name === "name")
          return (
            <>
              <span className="bank-accounts-table__name">{row.name}</span>
              <span className="muted bank-accounts-table__meta">
                {[row.institution, row.lastFour ? `••${row.lastFour}` : null, row.kindLabel, row.isRestricted ? "Restricted" : null, row.archived ? "Archived" : null].filter(Boolean).join(" · ")}
              </span>
            </>
          );
        if (field.name === "status")
          return (
            <>
              <span title={row.statusReasons.join(" ") || undefined}><Badge tone={STATUS_TONE[row.status]}>{row.statusLabel}</Badge></span>
              {row.statusReasons.length > 0 && <span className="bank-accounts-table__reason">{row.statusReasons[0]}</span>}
            </>
          );
        if (field.name === "lastActivity")
          return (
            <>
              {row.lastSyncAtISO ? <span title={`Last synced ${formatDateTime(row.lastSyncAtISO)}`}>Synced {formatDate(row.lastSyncAtISO)}</span>
                : row.lastActivityDate ? formatDate(row.lastActivityDate)
                : row.openingDate ? <span className="muted">Opened {formatDate(row.openingDate)}</span>
                : <span className="muted">—</span>}
              <span className="muted bank-accounts-table__meta">{pluralize(row.transactionCount, "transaction")}{row.reconciledThrough ? ` · reconciled to ${formatDate(row.reconciledThrough)}` : ""}</span>
            </>
          );
        if (field.name === "ledgerAccount")
          return row.ledgerAccount ? (
            <Link to={generalLedgerHref(row.ledgerAccount._id)}>{row.ledgerAccount.label}</Link>
          ) : (
            <button type="button" className="link-button" disabled={!canWrite} onClick={() => onLink(row)}>Link a ledger account</button>
          );
        if (field.name === "balanceCents") return <Money cents={row.balanceCents} currency={row.currency} />;
        return undefined;
      }}
      rowMenuSections={(record) => menuFor(record.account)}
      renderPhoneCard={(record, { selecting }) => (
        <RecordTablePhoneCard
          title={record.name}
          badge={<Badge tone={STATUS_TONE[record.status]}>{record.account.statusLabel}</Badge>}
          meta={[<Money key="balance" cents={record.balanceCents} currency={record.currency} />, record.sourceLabel]}
          detail={[record.ledgerAccount || "No ledger account", pluralize(record.transactionCount, "transaction")]}
          recordName={record.name}
          selecting={selecting}
        />
      )}
      emptyState={emptyState}
    />
  );
}

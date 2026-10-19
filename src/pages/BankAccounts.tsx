import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Archive, Landmark, Plus, Scale, Unplug } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useCreateIntent } from "../hooks/useCreateIntent";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { EmptyState } from "../components/ui";
import { Tabs } from "../components/primitives";
import { BANK_ACCOUNT_TABS, bankAccountMatchesTab, type BankAccountTab } from "../../shared/bankAccounts";
import { AddAccountDrawer } from "../features/financials/banking/AddAccountDrawer";
import { AccountCsvImportDrawer } from "../features/financials/banking/AccountCsvImportDrawer";
import { LinkLedgerDrawer } from "../features/financials/banking/LinkLedgerDrawer";
import { BankAccountsTable } from "../features/financials/banking/BankAccountsTable";
import { useAccountMenu } from "../features/financials/banking/useAccountMenu";
import type { BankAccountRow, BankAccountsOverview } from "../features/financials/banking/types";

const EMPTY_TAB: Record<BankAccountTab, string> = {
  all: "Connect Wave from Financials, import a bank CSV, or add an account by hand.",
  bank: "No bank or cash accounts yet.",
  credit: "No credit cards yet. Add one to track and reconcile card spending.",
  payments: "No payment processor balances yet, such as Stripe, Square or PayPal.",
  manual: "Accounts you add by hand appear here.",
};

/**
 * Money accounts: where each account's transactions come from, whether its
 * feed is healthy, its balance and ledger account, with rename, ledger link,
 * CSV import, Wave sync or reconnect, and archive. "Add account" creates a
 * manual account that is its own ledger account.
 */
export function BankAccountsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const data = useQuery(api.bankAccounts.overview, society ? { societyId: society._id } : "skip") as BankAccountsOverview | undefined;
  const [tab, setTab] = useState<BankAccountTab>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState<BankAccountRow | null>(null);
  const [linking, setLinking] = useState<BankAccountRow | null>(null);
  const menuFor = useAccountMenu({ canWrite, onLink: setLinking, onImport: setImporting });
  // The finance Create menu's "Add → Bank account".
  useCreateIntent("new-account", "financials:write", () => setAdding(true));

  const rows = useMemo(
    () => (data?.rows ?? []).filter((row) => (showArchived ? row.archived : !row.archived) && (showArchived || bankAccountMatchesTab(row, tab))),
    [data, tab, showArchived],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const wave = data?.waveConnection;
  return (
    <div className="page bank-accounts-page">
      <PageHeader
        title="Accounts"
        icon={<Landmark size={16} />}
        iconColor="green"
        subtitle="Bank accounts, cards and payment balances, and where their transactions come from."
        info={
          <p>
            Each account is a ledger account in your chart of accounts. Synced accounts follow their Wave connection;
            CSV and manual accounts are kept up to date by importing statements.
          </p>
        }
        actions={
          <>
            <Link className="btn-action" to="/app/reconciliation"><Scale size={12} aria-hidden="true" /> Reconciliation</Link>
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite} onClick={() => setAdding(true)}>
              <Plus size={12} aria-hidden="true" /> Add account
            </button>
          </>
        }
      />

      {wave && wave.status !== "connected" && (
        <div className="callout callout--warn bank-accounts-page__callout">
          <Unplug size={16} aria-hidden="true" />
          <div className="callout__body">
            <strong className="callout__title">Wave is {wave.status === "error" ? "reporting an error" : "not connected"}</strong>
            <div className="callout__note muted">{wave.lastError ?? "Synced accounts won't receive new transactions until you reconnect."}</div>
          </div>
          <Link className="btn btn--sm" to="/app/financials">Reconnect</Link>
        </div>
      )}

      <Tabs<BankAccountTab>
        value={tab}
        onChange={(next) => { setTab(next); setShowArchived(false); }}
        tabRoles
        ariaLabel="Account types"
        items={BANK_ACCOUNT_TABS.map((item) => ({ id: item.id, label: item.label, count: data?.counts[item.id] ?? null }))}
        trailing={
          data && data.archivedCount > 0 ? (
            <button type="button" className={`btn btn--ghost btn--sm${showArchived ? " is-active" : ""}`} aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>
              <Archive size={12} aria-hidden="true" /> Archived ({data.archivedCount})
            </button>
          ) : undefined
        }
      />

      <div className="card bank-accounts-card">
        {data === undefined ? (
          <div className="card__body"><div className="record-table__loading">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div>
        ) : rows.length === 0 ? (
          <div className="card__body">
            <EmptyState
              icon={<Landmark size={20} />}
              title={showArchived ? "No archived accounts" : "No accounts here"}
              description={showArchived ? "Archived accounts can be restored from here." : EMPTY_TAB[tab]}
              action={!showArchived && canWrite ? <button type="button" className="btn btn--sm btn--accent" onClick={() => setAdding(true)}><Plus size={12} aria-hidden="true" /> Add account</button> : undefined}
            />
          </div>
        ) : (
          <BankAccountsTable rows={rows} canWrite={canWrite} showTotal={!showArchived && rows.length > 1} onLink={setLinking} menuFor={menuFor} />
        )}
      </div>

      <AddAccountDrawer open={adding} societyId={society._id} usedCodes={data?.usedCodes ?? []} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); setTab("manual"); }} />
      <AccountCsvImportDrawer account={importing} societyId={society._id} onClose={() => setImporting(null)} />
      <LinkLedgerDrawer account={linking} ledgerOptions={data?.ledgerOptions ?? []} onClose={() => setLinking(null)} />
    </div>
  );
}

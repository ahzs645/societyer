import { Landmark } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";
import { MonthStrip } from "./MonthStrip";
import { MonthSummary } from "./MonthSummary";
import { Tabs } from "../../../components/primitives";
import type { useReconciliationMonthView, ReconciliationView } from "./useReconciliationMonthView";
import type { AccountMonthsData, ReconAccount } from "./types";

/**
 * Reconciliation by account and month: the view tabs, then the source
 * account, the year's month strip with each month's status, and the chosen
 * month's header. The page shows the month's transactions and the match
 * panel below it.
 */
export function ReconciliationMonthView({
  state,
  canWrite,
  onStart,
  onOpenPeriod,
}: {
  state: ReturnType<typeof useReconciliationMonthView>;
  canWrite: boolean;
  onStart: (accountId: string, endDate: string, suggestedEndingCents: number) => void;
  onOpenPeriod: (periodId: string) => void;
}) {
  const tabs = (
    <div className="recon-view-tabs">
      <Tabs<ReconciliationView>
        value={state.view}
        onChange={(view) => state.setMonthView({ view })}
        tabRoles
        ariaLabel="Reconciliation views"
        items={[{ id: "month", label: "By month" }, { id: "statements", label: "Statements & transactions" }]}
      />
    </div>
  );
  if (state.view !== "month") return tabs;
  return (
    <>
      {tabs}
      <MonthCard
        accounts={state.monthAccounts}
        accountId={state.monthAccountId}
        year={state.year}
        month={state.month}
        currentMonth={state.currentMonth}
        data={state.monthData}
        canWrite={canWrite}
        onChange={state.setMonthView}
        onStart={onStart}
        onOpenPeriod={onOpenPeriod}
      />
    </>
  );
}

function MonthCard({
  accounts,
  accountId,
  year,
  month,
  currentMonth,
  data,
  canWrite,
  onChange,
  onStart,
  onOpenPeriod,
}: {
  accounts: ReconAccount[];
  accountId?: string;
  year: number;
  month: string;
  currentMonth: string;
  data: AccountMonthsData | undefined;
  canWrite: boolean;
  onChange: (next: { account?: string; year?: number; month?: string }) => void;
  onStart: (accountId: string, endDate: string, suggestedEndingCents: number) => void;
  onOpenPeriod: (periodId: string) => void;
}) {
  if (!accounts.length) {
    return (
      <div className="card recon-statements">
        <div className="card__body">
          <EmptyState
            icon={<Landmark size={20} />}
            title="No bank accounts to reconcile yet"
            description={<>Connect Wave or import a bank CSV from Financials, or <Link to="/app/financials/accounts">add an account</Link>, then reconcile it month by month here.</>}
          />
        </div>
      </div>
    );
  }
  const years = data?.years ?? [year];
  const status = data?.months.find((row) => row.month === month);
  return (
    <section className="card recon-month-view" aria-label="Reconciliation by month">
      <div className="recon-month-view__toolbar">
        <div className="recon-month-view__account">
          <Select
            aria-label="Source account"
            value={accountId ?? ""}
            onChange={(account) => onChange({ account })}
            options={accounts.map((row) => ({ value: row._id, label: row.code ? `${row.code} · ${row.name}` : row.name, hint: row.lastReconciledThrough ? `Reconciled to ${formatDate(row.lastReconciledThrough)}` : undefined }))}
          />
        </div>
        <div className="recon-month-view__year">
          <Select
            size="sm"
            aria-label="Year"
            value={String(year)}
            onChange={(value) => onChange({ year: Number(value), month: `${value}-${value === currentMonth.slice(0, 4) ? currentMonth.slice(5, 7) : "01"}` })}
            options={years.map((value) => ({ value: String(value), label: String(value) }))}
          />
        </div>
        {data && (
          <span className="recon-month-view__balance">
            <span className="muted">Current balance</span> <Money cents={data.currentBalanceCents} currency={data.account.currency} />
          </span>
        )}
      </div>
      {data ? (
        <MonthStrip months={data.months} selected={month} currentMonth={currentMonth} onSelect={(next) => onChange({ month: next })} />
      ) : (
        <div className="recon-month-strip recon-month-strip--loading" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => <span key={index} className="recon-month" />)}
        </div>
      )}
      {data?.detail && accountId && (
        <MonthSummary
          detail={data.detail}
          status={status}
          accountName={data.account.name}
          canWrite={canWrite}
          onStart={(endDate, suggested) => onStart(accountId, endDate, suggested)}
          onOpenPeriod={onOpenPeriod}
        />
      )}
      <p className="muted recon-month-view__note">
        Each account here is a ledger account in your chart of accounts; accounts you link or add on the Accounts page get
        theirs automatically.
      </p>
    </section>
  );
}

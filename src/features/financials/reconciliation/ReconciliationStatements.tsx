import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Landmark, Plus } from "lucide-react";
import { EmptyState } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Money } from "../../../components/Money";
import { formatDate, pluralize } from "../../../lib/format";
import { PeriodStatusPill, formatPeriodRange } from "./PeriodStatusPill";
import type { ReconAccount, ReconPeriod, ReconPeriodsData } from "./types";

/**
 * Bank accounts and their statement periods: pick an account, filter its
 * statements by year and open one to reconcile it.
 */
export function ReconciliationStatements({
  data,
  accountId,
  canWrite,
  onSelectAccount,
  onOpenPeriod,
  onStart,
}: {
  data: ReconPeriodsData;
  accountId?: string;
  canWrite: boolean;
  onSelectAccount: (accountId: string) => void;
  onOpenPeriod: (periodId: string) => void;
  onStart: (accountId?: string) => void;
}) {
  const accounts = data.accounts;
  const account: ReconAccount | undefined = accounts.find((row) => row._id === accountId) ?? accounts.find((row) => row.periodCount > 0) ?? accounts[0];
  const periods = useMemo(() => data.periods.filter((period) => period.accountId === account?._id), [data.periods, account?._id]);
  const years = useMemo(() => [...new Set(periods.map((period) => period.endDate.slice(0, 4)))].sort().reverse(), [periods]);
  const [yearChoice, setYearChoice] = useState<string>("");
  const year = yearChoice && (yearChoice === "all" || years.includes(yearChoice)) ? yearChoice : years[0] ?? "all";
  const shown = year === "all" ? periods : periods.filter((period) => period.endDate.startsWith(year));

  if (accounts.length === 0) {
    return (
      <div className="card recon-statements">
        <div className="card__body">
          <EmptyState
            icon={<Landmark size={20} />}
            title="No bank accounts to reconcile yet"
            description="Connect a bookkeeping source or import a bank CSV from Financials, then reconcile each statement here."
          />
        </div>
      </div>
    );
  }

  return (
    <section className="card recon-statements" aria-labelledby="recon-statements-title">
      <div className="card__head">
        <div>
          <h2 className="card__title" id="recon-statements-title">Statements</h2>
          <span className="card__subtitle">Reconcile each bank statement until the difference is $0.00.</span>
        </div>
        <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => onStart(account?._id)}>
          <Plus size={12} aria-hidden="true" /> Start reconciliation
        </button>
      </div>
      <div className="recon-accounts" role="list" aria-label="Bank accounts">
        {accounts.map((row) => {
          const selected = row._id === account?._id;
          return (
            <button
              key={row._id}
              type="button"
              role="listitem"
              className={`recon-account${selected ? " is-selected" : ""}`}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelectAccount(row._id)}
            >
              <span className="recon-account__name">{row.name}</span>
              <span className="recon-account__meta">
                {row.code ? `${row.code} · ` : ""}
                {row.lastReconciledThrough ? `Reconciled through ${formatDate(row.lastReconciledThrough)}` : row.periodCount ? "Not completed yet" : "Never reconciled"}
              </span>
              <span className="recon-account__status">
                {row.latestStatus ? <PeriodStatusPill status={row.latestStatus} /> : <span className="muted">{pluralize(row.transactionCount, "transaction")}</span>}
                {row.outOfBalanceCount > 0 && row.latestStatus !== "out_of_balance" && (
                  <span className="recon-account__warn"><AlertTriangle size={12} aria-hidden="true" /> {row.outOfBalanceCount} no longer match</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {account && (
        <div className="recon-periods">
          <div className="recon-periods__toolbar">
            <h3 className="recon-periods__title">{account.name}</h3>
            {years.length > 0 && (
              <div className="recon-periods__year">
                <Select
                  size="sm"
                  aria-label="Statement year"
                  value={year}
                  onChange={setYearChoice}
                  options={[...years.map((value) => ({ value, label: value })), { value: "all", label: "All years" }]}
                />
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="muted recon-periods__empty">
              No statements reconciled for this account yet.{" "}
              {canWrite && <button type="button" className="link-button" onClick={() => onStart(account._id)}>Start the first one</button>}
            </p>
          ) : (
            <ul className="recon-period-list">
              {shown.map((period: ReconPeriod) => (
                <li key={period._id}>
                  <button type="button" className="recon-period" onClick={() => onOpenPeriod(period._id)}>
                    <span className="recon-period__range">{formatPeriodRange(period.startDate, period.endDate)}</span>
                    <span className="recon-period__cleared muted">{period.clearedCount} of {period.transactionCount} cleared</span>
                    <span className="recon-period__balance">
                      <span className="recon-period__label">Ending</span> <Money cents={period.endingBalanceCents} />
                    </span>
                    <PeriodStatusPill status={period.effectiveStatus} />
                    <ChevronRight size={14} aria-hidden="true" className="recon-period__chevron" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

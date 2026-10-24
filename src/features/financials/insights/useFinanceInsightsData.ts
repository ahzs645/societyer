import { useMemo } from "react";
import { useCompleteFinanceSummary } from "../reports/useCompleteFinanceSummary";
import { bankTransactions, type FinanceAccount, type FinanceTxn } from "./series";
import { inferBudgetKind, type BudgetKind } from "../lib/budgetKind";

type BudgetRow = { _id: string; category: string; accountId?: string; fiscalYear: string; plannedCents: number; actualCents: number; currency?: string };


/**
 * Read-only finance data for the chart placements. Reuses the existing
 * financialHub queries (summary, accounts, transactions) — no new endpoints.
 */
export function useFinanceInsightsData(societyId: string | undefined, enabled = true, selectedCurrency?: string, fiscalYearEnd?: string) {
  const complete = useCompleteFinanceSummary(societyId, fiscalYearEnd, selectedCurrency, enabled);
  const summary = complete.summary;
  const accounts = summary?.accounts as FinanceAccount[] | undefined;
  const transactions = summary?.transactions as FinanceTxn[] | undefined;

  return useMemo(() => {
    const loading = summary === undefined || accounts === undefined || transactions === undefined;
    const txns = bankTransactions(transactions ?? [], accounts ?? []);
    const bankAccountCount = Number(summary?.bankAccountCount ?? 0);
    const sourceCurrencies = [complete.currency];
    return {
      loading,
      txns,
      currentBalance: Number(summary?.totalBalance ?? 0),
      // Bank and card balances outside restricted accounts.
      unrestrictedBalance: Number(summary?.unrestricted ?? summary?.totalBalance ?? 0),
      bankAccountCount,
      sourceCurrencies,
      currency: complete.currency, availableCurrencies: complete.currencies,
      // Revenue lines are favourable above plan, so the bars need each line's
      // kind (the same inference the budget table on this page uses).
      budgetRows: ((summary?.budgetRows ?? []) as BudgetRow[]).map((row): BudgetRow & { kind: BudgetKind } => ({
        ...row,
        kind: inferBudgetKind(row, { accounts: (accounts ?? []) as any[], transactions: (transactions ?? []) as any[] }),
      })),
      earliest: txns[0]?.date ?? null,
      hasAnyFinance: bankAccountCount > 0 || txns.length > 0,
      truncated: false,
      sourceError: complete.error, sourceProgress: complete.progress, refreshSource: complete.refresh,
    };
  }, [accounts, summary, transactions, complete.error, complete.progress, complete.currency, complete.currencies, complete.refresh]);
}

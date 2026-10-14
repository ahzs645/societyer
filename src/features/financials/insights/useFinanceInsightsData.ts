import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { bankTransactions, type FinanceAccount, type FinanceTxn } from "./series";
import { inferBudgetKind, type BudgetKind } from "../lib/budgetKind";

type BudgetRow = { _id: string; category: string; accountId?: string; fiscalYear: string; plannedCents: number; actualCents: number; currency?: string };

/** Enough history for multi-year trends without paging. */
const HISTORY_LIMIT = 5000;

/**
 * Read-only finance data for the chart placements. Reuses the existing
 * financialHub queries (summary, accounts, transactions) — no new endpoints.
 */
export function useFinanceInsightsData(societyId: string | undefined, enabled = true) {
  const args = societyId && enabled ? { societyId: societyId as any } : "skip";
  const summary = useQuery(api.financialHub.summary, args) as any;
  const accounts = useQuery(api.financialHub.accounts, args) as FinanceAccount[] | undefined;
  const transactions = useQuery(api.financialHub.transactions, societyId && enabled ? { societyId: societyId as any, limit: HISTORY_LIMIT } : "skip") as FinanceTxn[] | undefined;

  return useMemo(() => {
    const loading = summary === undefined || accounts === undefined || transactions === undefined;
    const txns = bankTransactions(transactions ?? [], accounts ?? []);
    const bankAccountCount = Number(summary?.bankAccountCount ?? 0);
    return {
      loading,
      txns,
      currentBalance: Number(summary?.totalBalance ?? 0),
      // Bank and card balances outside restricted accounts.
      unrestrictedBalance: Number(summary?.unrestricted ?? summary?.totalBalance ?? 0),
      bankAccountCount,
      // Revenue lines are favourable above plan, so the bars need each line's
      // kind (the same inference the budget table on this page uses).
      budgetRows: ((summary?.budgetRows ?? []) as BudgetRow[]).map((row): BudgetRow & { kind: BudgetKind } => ({
        ...row,
        kind: inferBudgetKind(row, { accounts: (accounts ?? []) as any[], transactions: (transactions ?? []) as any[] }),
      })),
      earliest: txns[0]?.date ?? null,
      hasAnyFinance: bankAccountCount > 0 || txns.length > 0,
      truncated: (transactions?.length ?? 0) >= HISTORY_LIMIT,
    };
  }, [accounts, summary, transactions]);
}

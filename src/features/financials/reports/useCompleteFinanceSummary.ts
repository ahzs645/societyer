import { useMemo, useCallback } from "react";
import { useCompleteBooks } from "./useCompleteBooks";
import { useCompleteBankTransactions } from "./useCompleteBankTransactions";
import { financeSourceSummary } from "../../../../shared/financeSourceSummary";
import { todayDateOnly } from "../../../lib/format";
export function useCompleteFinanceSummary(societyId: string | undefined, fiscalYearEnd?: string, selectedCurrency?: string, enabled = true) {
  const books = useCompleteBooks(societyId ?? "", enabled), bank = useCompleteBankTransactions(societyId, enabled);
  const currencies = useMemo(() => [...new Set(books.books?.accounts.map((account) => account.currency).filter((value): value is string => Boolean(value)) ?? [])].sort(), [books.books]);
  const currency = selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency : currencies.includes("CAD") ? "CAD" : currencies[0] ?? "CAD";
  const summary = useMemo(() => books.books && bank.transactions ? financeSourceSummary({ ...books.books, accounts: books.books.accounts as Record<string, any>[], entries: books.books.entries as Record<string, any>[], lines: books.books.lines as Record<string, any>[], transactions: bank.transactions, budgets: books.books.budgets, currency, fiscalYearEnd, today: todayDateOnly() }) : undefined, [books.books, bank.transactions, currency, fiscalYearEnd]);
  const refresh = useCallback(() => { books.refresh(); bank.refresh(); }, [books.refresh, bank.refresh]);
  return { summary, currencies, currency, allAccounts: books.books?.accounts as any[] | undefined, allTransactions: bank.transactions, progress: books.progress + bank.progress, error: books.error || bank.error, refresh };
}

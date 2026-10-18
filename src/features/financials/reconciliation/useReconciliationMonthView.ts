import { useQuery } from "convex/react";
import type { SetURLSearchParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { todayDateOnly } from "../../../../shared/dateOnly";
import type { AccountMonthsData, ReconPeriodsData } from "./types";

export type ReconciliationView = "month" | "statements";

/**
 * URL state for reconciliation by month (?view, ?account, ?month) and the
 * chosen account's year. "By month" is the default view: one account's month
 * strip, the chosen month's lines and the match panel. "Statements" keeps the
 * statement list and the full transaction register.
 */
export function useReconciliationMonthView({
  societyId,
  periodsData,
  searchParams,
  setSearchParams,
  periodId,
  accountParam,
}: {
  societyId?: string;
  periodsData: ReconPeriodsData | undefined;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  periodId?: string;
  accountParam?: string;
}) {
  const view: ReconciliationView = searchParams.get("view") === "statements" ? "statements" : "month";
  const currentMonth = todayDateOnly().slice(0, 7);
  const monthAccounts = (periodsData?.accounts ?? []).filter((account) => !account.archived);
  const monthAccountId = monthAccounts.find((account) => account._id === accountParam)?._id ?? monthAccounts.find((account) => account.hasActivity)?._id ?? monthAccounts[0]?._id;
  const monthParam = searchParams.get("month");
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth;
  const year = Number(month.slice(0, 4));
  const monthData = useQuery(
    api.reconciliation.accountMonths,
    societyId && monthAccountId && view === "month" && !periodId ? { societyId, accountId: monthAccountId, year, month } : "skip",
  ) as AccountMonthsData | undefined;
  const setMonthView = (next: { view?: ReconciliationView; account?: string; year?: number; month?: string }) => {
    const params = new URLSearchParams(searchParams);
    params.delete("period");
    if (next.view) {
      if (next.view === "statements") params.set("view", "statements");
      else params.delete("view");
    }
    if (next.account) params.set("account", next.account);
    if (next.month) params.set("month", next.month);
    else if (next.year) params.set("month", `${next.year}-01`);
    setSearchParams(params);
  };
  return { view, currentMonth, monthAccounts, monthAccountId, month, year, monthData, setMonthView };
}

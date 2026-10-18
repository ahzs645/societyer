import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SelectOption } from "../../../components/Select";
import { formatMoney } from "../../../lib/money";

type SpendBudgetListRow = { _id: string; name: string; status: string; archived: boolean; spend: { remainingCents: number } };

/**
 * Spend budgets a money-out bank transaction can be charged to: active,
 * unarchived budgets, each with what is left this cycle. `nameOf` also names
 * budgets that ended or were archived, for lines already charged to them.
 */
export function useSpendBudgetOptions(societyId: string | undefined) {
  const list = useQuery(api.spendBudgets.list, societyId ? { societyId: societyId as Id<"societies"> } : "skip") as { rows: SpendBudgetListRow[] } | undefined;
  return useMemo(() => {
    const rows = list?.rows ?? [];
    const options: SelectOption[] = rows
      .filter((row) => row.status === "active" && !row.archived)
      .map((row) => ({ value: row._id, label: row.name, hint: `${formatMoney(Math.max(0, row.spend.remainingCents))} left` }));
    const names = new Map(rows.map((row) => [row._id, row.name]));
    return { loaded: list !== undefined, options, nameOf: (id: string | undefined) => (id ? names.get(id) : undefined) };
  }, [list]);
}

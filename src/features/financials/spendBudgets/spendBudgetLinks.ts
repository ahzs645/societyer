/** `/app/spend-budgets?budget=<id>` opens one spend budget's detail. */
export const SPEND_BUDGET_PARAM = "budget";

export function spendBudgetHref(budgetId: string) {
  return `/app/spend-budgets?${SPEND_BUDGET_PARAM}=${encodeURIComponent(budgetId)}`;
}

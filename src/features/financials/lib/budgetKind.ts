/**
 * Decide whether a category budget line is revenue or expense so variance can
 * follow the one convention (positive = favourable). Evidence, strongest first:
 * a linked chart account, a same-named chart account, the category's own
 * income totals, then the sign of its transactions. Defaults to expense.
 */
export type BudgetKind = "revenue" | "expense";

export function inferBudgetKind(
  line: { category?: string; accountId?: string },
  evidence: {
    accounts?: Array<{ _id?: string; name?: string; accountType?: string }>;
    incomeCategories?: Iterable<string>;
    expenseCategories?: Iterable<string>;
    transactions?: Array<{ category?: string; amountCents?: number }>;
  } = {},
): BudgetKind {
  const category = String(line.category ?? "").trim();
  const accounts = evidence.accounts ?? [];
  const typeToKind = (type?: string): BudgetKind | null =>
    type === "Income" ? "revenue" : type === "Expense" ? "expense" : null;

  if (line.accountId) {
    const linked = accounts.find((account) => String(account._id) === String(line.accountId));
    const kind = typeToKind(linked?.accountType);
    if (kind) return kind;
  }
  const named = accounts.find((account) => String(account.name ?? "").trim().toLowerCase() === category.toLowerCase());
  const namedKind = typeToKind(named?.accountType);
  if (namedKind) return namedKind;

  const income = new Set(evidence.incomeCategories ?? []);
  const expense = new Set(evidence.expenseCategories ?? []);
  if (income.has(category) && !expense.has(category)) return "revenue";
  if (expense.has(category) && !income.has(category)) return "expense";

  const net = (evidence.transactions ?? [])
    .filter((txn) => String(txn.category ?? "") === category)
    .reduce((sum, txn) => sum + (txn.amountCents ?? 0), 0);
  if (net > 0) return "revenue";
  return "expense";
}

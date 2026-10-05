/** Accrual statements use posted journal lines, never bank inflow/outflow signs. */
export type StatementLedgerLine = {
  amountCents: number;
  side: string;
  entry: { date: string; status: string };
  account: { _id: string; code?: string; name: string; accountType: string; currency: string } | null;
};
export type StatementRow = { accountId: string; code: string; name: string; amountCents: number };
export type CurrencyStatement = {
  currency: string; assets: StatementRow[]; liabilities: StatementRow[]; equity: StatementRow[];
  income: StatementRow[]; expenses: StatementRow[];
  totalAssetsCents: number; totalLiabilitiesCents: number; totalEquityCents: number;
  unclosedEarningsCents: number; totalIncomeCents: number; totalExpenseCents: number;
  netIncomeCents: number; balanceDifferenceCents: number;
};

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function buildAccountingStatements(lines: StatementLedgerLine[], from: string, to: string) {
  if (!validDate(from) || !validDate(to) || from > to) throw new Error("Choose a valid report date range.");
  const warnings = new Set<string>();
  const totals = new Map<string, Map<string, { account: NonNullable<StatementLedgerLine['account']>; balance: number; period: number }>>();
  for (const line of lines) {
    if (line.entry.status !== "posted" || line.entry.date > to) continue;
    if (!validDate(line.entry.date)) { warnings.add("A posted line has an invalid date and was excluded."); continue; }
    const account = line.account;
    if (!account || !["Asset", "Bank", "Credit", "Liability", "Equity", "Income", "Expense"].includes(account.accountType)) {
      warnings.add("Some posted lines lack a supported account classification and were excluded."); continue;
    }
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents < 0 || !["debit", "credit"].includes(line.side)) {
      warnings.add("Some posted lines contain invalid cents or sides and were excluded."); continue;
    }
    if (!account.currency) { warnings.add("Some posted lines lack an account currency and were excluded."); continue; }
    const accounts = totals.get(account.currency) ?? new Map(); totals.set(account.currency, accounts);
    const row = accounts.get(account._id) ?? { account, balance: 0, period: 0 };
    const signed = line.amountCents * (line.side === "debit" ? 1 : -1);
    row.balance += signed;
    if (line.entry.date >= from) row.period += signed;
    accounts.set(account._id, row);
  }
  const statements: CurrencyStatement[] = [];
  for (const [currency, accounts] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    const statement: CurrencyStatement = { currency, assets: [], liabilities: [], equity: [], income: [], expenses: [], totalAssetsCents: 0, totalLiabilitiesCents: 0, totalEquityCents: 0, unclosedEarningsCents: 0, totalIncomeCents: 0, totalExpenseCents: 0, netIncomeCents: 0, balanceDifferenceCents: 0 };
    for (const { account, balance, period } of accounts.values()) {
      const row = (amountCents: number): StatementRow => ({ accountId: account._id, code: account.code ?? "", name: account.name, amountCents });
      switch (account.accountType) {
        case "Asset": case "Bank": statement.assets.push(row(balance)); statement.totalAssetsCents += balance; break;
        case "Liability": case "Credit": statement.liabilities.push(row(-balance)); statement.totalLiabilitiesCents -= balance; break;
        case "Equity": statement.equity.push(row(-balance)); statement.totalEquityCents -= balance; break;
        case "Income": statement.income.push(row(-period)); statement.totalIncomeCents -= period; statement.unclosedEarningsCents -= balance; break;
        case "Expense": statement.expenses.push(row(period)); statement.totalExpenseCents += period; statement.unclosedEarningsCents -= balance; break;
      }
    }
    for (const rows of [statement.assets, statement.liabilities, statement.equity, statement.income, statement.expenses]) rows.sort((a, b) => `${a.code}:${a.name}`.localeCompare(`${b.code}:${b.name}`));
    statement.netIncomeCents = statement.totalIncomeCents - statement.totalExpenseCents;
    statement.balanceDifferenceCents = statement.totalAssetsCents - statement.totalLiabilitiesCents - statement.totalEquityCents - statement.unclosedEarningsCents;
    statements.push(statement);
  }
  return { from, to, statements, warnings: [...warnings] };
}

export type ProgramBudget = { fiscalYear: string; programCode?: string; accountId?: string; currency?: string; plannedCents: number };
export function buildProgramSummary(lines: (StatementLedgerLine & { programCode?: string })[], budgets: ProgramBudget[], from: string, to: string, fiscalYear: string, chartAccounts: NonNullable<StatementLedgerLine["account"]>[] = []) {
  buildAccountingStatements([], from, to); // Reuse strict date-range validation.
  const rows = new Map<string, StatementRow & { programCode: string; currency: string; accountType: string; actualCents: number; budgetCents: number }>();
  const accounts = new Map([...chartAccounts.map(account => [account._id, account] as const), ...lines.filter(line => line.account).map(line => [line.account!._id, line.account!] as const)]);
  const ensure = (account: NonNullable<StatementLedgerLine['account']>, programCode?: string) => {
    const program = programCode?.trim() || "Unallocated";
    const key = JSON.stringify([account.currency, program, account._id]);
    const row = rows.get(key) ?? { accountId: account._id, code: account.code ?? "", name: account.name, amountCents: 0, programCode: program, currency: account.currency, accountType: account.accountType, actualCents: 0, budgetCents: 0 };
    rows.set(key, row); return row;
  };
  for (const line of lines) {
    const account = line.account;
    if (line.entry.status !== "posted" || !validDate(line.entry.date) || line.entry.date < from || line.entry.date > to || !account || !["Income", "Expense"].includes(account.accountType) || !account.currency) continue;
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents < 0 || !["debit", "credit"].includes(line.side)) continue;
    const row = ensure(account, line.programCode);
    row.actualCents += line.amountCents * ((account.accountType === "Income" ? line.side === "credit" : line.side === "debit") ? 1 : -1);
  }
  for (const budget of budgets) {
    if (budget.fiscalYear !== fiscalYear || !budget.accountId || !Number.isSafeInteger(budget.plannedCents)) continue;
    const account = accounts.get(budget.accountId);
    if (!account || !["Income", "Expense"].includes(account.accountType) || (budget.currency && budget.currency !== account.currency)) continue;
    ensure(account, budget.programCode).budgetCents += budget.plannedCents;
  }
  return [...rows.values()].map(row => ({ ...row, varianceCents: row.actualCents - row.budgetCents }))
    .sort((a, b) => `${a.currency}:${a.programCode}:${a.accountType}:${a.code}`.localeCompare(`${b.currency}:${b.programCode}:${b.accountType}:${b.code}`));
}

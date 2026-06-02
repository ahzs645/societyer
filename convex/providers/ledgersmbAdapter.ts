type LedgerSmbAccountLike = {
  id?: string | number;
  chart_id?: string | number;
  accno?: string | number;
  account_number?: string | number;
  description?: string;
  label?: string;
  category?: string;
  type?: string;
  normal_balance?: string;
};

type LedgerSmbJournalEntryLike = {
  id?: string | number;
  reference?: string;
  description?: string;
  memo?: string;
  transdate?: string;
  transaction_date?: string;
  approved?: boolean;
  lines?: LedgerSmbJournalLineLike[];
};

type LedgerSmbJournalLineLike = {
  id?: string | number;
  account_id?: string | number;
  chart_id?: string | number;
  accno?: string | number;
  description?: string;
  debit?: string | number;
  credit?: string | number;
  amount?: string | number;
};

export function normalizeLedgerSmbAccount(row: LedgerSmbAccountLike) {
  const category = String(row.category ?? row.type ?? "").toUpperCase();
  const accountType =
    category.includes("A") || category.includes("ASSET")
      ? "Asset"
      : category.includes("L") || category.includes("LIAB")
        ? "Liability"
        : category.includes("Q") || category.includes("EQUITY")
          ? "Equity"
          : category.includes("I") || category.includes("INCOME")
            ? "Income"
            : category.includes("E") || category.includes("EXPENSE")
              ? "Expense"
              : "Asset";
  return {
    externalId: String(row.id ?? row.chart_id ?? row.accno ?? row.account_number ?? ""),
    code: String(row.accno ?? row.account_number ?? ""),
    name: String(row.description ?? row.label ?? row.accno ?? "LedgerSMB account"),
    accountType,
    subtype: category.toLowerCase() || undefined,
    normalBalance: normalizeNormalBalance(row.normal_balance, accountType),
    sourceSystem: "ledgersmb",
  };
}

export function normalizeLedgerSmbJournalEntry(row: LedgerSmbJournalEntryLike) {
  return {
    sourceExternalId: String(row.id ?? row.reference ?? ""),
    reference: row.reference ? String(row.reference) : undefined,
    date: String(row.transdate ?? row.transaction_date ?? ""),
    memo: String(row.description ?? row.memo ?? row.reference ?? "LedgerSMB journal entry"),
    source: "ledgersmb",
    status: row.approved === false ? "draft" : "posted",
    rawJson: JSON.stringify(row),
    lines: (row.lines ?? []).map(normalizeLedgerSmbJournalLine),
  };
}

export function normalizeLedgerSmbJournalLine(row: LedgerSmbJournalLineLike) {
  const debitCents = moneyToCents(row.debit);
  const creditCents = moneyToCents(row.credit);
  const amountCents = debitCents || creditCents || Math.abs(moneyToCents(row.amount));
  return {
    sourceExternalId: row.id != null ? String(row.id) : undefined,
    accountExternalId: String(row.account_id ?? row.chart_id ?? row.accno ?? ""),
    accountCode: row.accno != null ? String(row.accno) : undefined,
    description: row.description ? String(row.description) : undefined,
    side: debitCents > 0 ? "debit" : "credit",
    amountCents,
    rawJson: JSON.stringify(row),
  };
}

function normalizeNormalBalance(value: unknown, accountType: string) {
  const text = String(value ?? "").toLowerCase();
  if (text === "debit" || text === "credit") return text;
  return accountType === "Asset" || accountType === "Expense" ? "debit" : "credit";
}

function moneyToCents(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}

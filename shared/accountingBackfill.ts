/**
 * Planner for "Backfill imports": posting imported bank/feed transactions
 * (`financialTransactions`) into the double-entry journal.
 *
 * The previous backfill silently posted every unmapped transaction to the
 * first Income or Expense account and posted transactions dated before the
 * opening-balance entry, which double-counts them (the opening balances
 * already include their effect). This planner makes both decisions explicit:
 *
 *  - the offset account comes from an active account mapping (by category or
 *    external account), or from a category choice made in the review step;
 *  - anything still unmapped goes to an explicit suspense account (or is held
 *    back when the caller turns suspense off) and is reported as such;
 *  - transactions dated on or before the opening-balance date are skipped
 *    unless the caller explicitly includes them, in which case they are
 *    flagged on the journal entry.
 *
 * Pure and dependency-free so the preview query, the posting mutation and the
 * gate script (scripts/check-accounting-backfill.ts) share one rule.
 */

export const SUSPENSE_ACCOUNT_TEMPLATE = {
  code: "2999",
  name: "Suspense - unmapped imports",
  accountType: "Liability",
  subtype: "suspense",
  normalBalance: "credit",
} as const;

export const BEFORE_OPENING_FLAG = "before_opening_balance";
export const SUSPENSE_FLAG = "unmapped_suspense";

export type BackfillTransaction = {
  _id: string;
  date: string;
  description?: string;
  amountCents: number;
  accountId: string;
  category?: string;
  categoryAccountExternalId?: string;
};

export type BackfillAccount = {
  _id: string;
  code?: string;
  name: string;
  accountType: string;
  subtype?: string;
};

export type BackfillMapping = {
  _id: string;
  status: string;
  externalAccountId?: string;
  externalAccountCode?: string;
  externalAccountName?: string;
  externalCategory?: string;
  financialAccountId: string;
};

export type CategoryChoice = { category: string; accountId: string };

export type BackfillRowStatus =
  | "post"
  | "already_posted"
  | "before_opening"
  | "no_cash_account"
  | "needs_mapping"
  | "zero_amount";

export type BackfillPlanRow = {
  transactionId: string;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  direction: "income" | "expense";
  cashAccountId: string;
  offsetAccountId?: string;
  /** Where the offset account came from. */
  offsetSource?: "mapping" | "choice" | "suspense";
  status: BackfillRowStatus;
  beforeOpening: boolean;
  mappingId?: string;
};

export type BackfillCategorySummary = {
  category: string;
  direction: "income" | "expense";
  count: number;
  totalCents: number;
  offsetAccountId?: string;
  offsetSource?: "mapping" | "choice" | "suspense";
};

export type BackfillPlan = {
  openingBalanceDate: string | null;
  suspenseAccountId: string | null;
  rows: BackfillPlanRow[];
  categories: BackfillCategorySummary[];
  summary: {
    scanned: number;
    toPost: number;
    mapped: number;
    toSuspense: number;
    needsMapping: number;
    alreadyPosted: number;
    beforeOpening: number;
    beforeOpeningIncluded: number;
    noCashAccount: number;
    netCents: number;
  };
};

export function normalizeCategory(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function findSuspenseAccount<T extends BackfillAccount>(accounts: T[]): T | undefined {
  return (
    accounts.find((account) => account.subtype === SUSPENSE_ACCOUNT_TEMPLATE.subtype) ??
    accounts.find((account) => account.code === SUSPENSE_ACCOUNT_TEMPLATE.code && /suspense/i.test(account.name)) ??
    accounts.find((account) => /\bsuspense\b/i.test(account.name))
  );
}

/** Earliest posted opening-balance entry date, or null when none exists. */
export function openingBalanceDate(entries: Array<{ source?: string; status?: string; date?: string }>): string | null {
  const dates = entries
    .filter((entry) => entry.source === "opening_balance" && entry.status === "posted" && typeof entry.date === "string")
    .map((entry) => String(entry.date).slice(0, 10))
    .sort();
  return dates[0] ?? null;
}

function matchMapping(transaction: BackfillTransaction, mappings: BackfillMapping[]): BackfillMapping | undefined {
  const category = normalizeCategory(transaction.category);
  const external = transaction.categoryAccountExternalId;
  return mappings.find((mapping) =>
    mapping.status === "active" &&
    (
      (external && mapping.externalAccountId === external) ||
      (external && mapping.externalAccountCode === external) ||
      (category && normalizeCategory(mapping.externalCategory) === category) ||
      (category && normalizeCategory(mapping.externalAccountName) === category)
    ),
  );
}

export function planTransactionBackfill(input: {
  transactions: BackfillTransaction[];
  accounts: BackfillAccount[];
  mappings: BackfillMapping[];
  /** financialTransaction ids that already have journal lines. */
  postedTransactionIds: Iterable<string>;
  openingBalanceDate: string | null;
  categoryChoices?: CategoryChoice[];
  includeBeforeOpening?: boolean;
  /** Post unmapped rows to the suspense account (default true). */
  useSuspense?: boolean;
  /** Restrict the plan to these transactions (the reviewed selection). */
  transactionIds?: string[];
}): BackfillPlan {
  const accountsById = new Map(input.accounts.map((account) => [String(account._id), account]));
  const posted = new Set([...input.postedTransactionIds].map(String));
  const choices = new Map(
    (input.categoryChoices ?? [])
      .filter((choice) => choice.accountId && accountsById.has(String(choice.accountId)))
      .map((choice) => [normalizeCategory(choice.category), String(choice.accountId)]),
  );
  const suspense = findSuspenseAccount(input.accounts);
  const useSuspense = input.useSuspense !== false;
  const only = input.transactionIds ? new Set(input.transactionIds.map(String)) : null;
  const opening = input.openingBalanceDate;
  const rows: BackfillPlanRow[] = [];
  const sorted = [...input.transactions]
    .filter((transaction) => !only || only.has(String(transaction._id)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a._id).localeCompare(String(b._id)));

  for (const transaction of sorted) {
    const amountCents = Number(transaction.amountCents) || 0;
    const direction: "income" | "expense" = amountCents >= 0 ? "income" : "expense";
    const beforeOpening = Boolean(opening && String(transaction.date).slice(0, 10) <= opening);
    const base = {
      transactionId: String(transaction._id),
      date: String(transaction.date),
      description: String(transaction.description ?? ""),
      amountCents,
      category: String(transaction.category ?? "").trim(),
      direction,
      cashAccountId: String(transaction.accountId),
      beforeOpening,
    };
    if (posted.has(String(transaction._id))) {
      rows.push({ ...base, status: "already_posted" });
      continue;
    }
    if (amountCents === 0) {
      rows.push({ ...base, status: "zero_amount" });
      continue;
    }
    if (!accountsById.has(String(transaction.accountId))) {
      rows.push({ ...base, status: "no_cash_account" });
      continue;
    }
    const mapping = matchMapping(transaction, input.mappings);
    const mappedAccount = mapping && accountsById.has(String(mapping.financialAccountId)) ? String(mapping.financialAccountId) : undefined;
    const choice = choices.get(normalizeCategory(transaction.category));
    let offsetAccountId: string | undefined;
    let offsetSource: BackfillPlanRow["offsetSource"];
    if (choice) {
      offsetAccountId = choice;
      offsetSource = "choice";
    } else if (mappedAccount) {
      offsetAccountId = mappedAccount;
      offsetSource = "mapping";
    } else if (useSuspense) {
      offsetAccountId = suspense ? String(suspense._id) : undefined;
      offsetSource = "suspense";
    }
    const status: BackfillRowStatus = beforeOpening && !input.includeBeforeOpening
      ? "before_opening"
      : offsetSource
        ? "post"
        : "needs_mapping";
    rows.push({ ...base, status, offsetAccountId, offsetSource, mappingId: offsetSource === "mapping" ? mapping?._id : undefined });
  }

  const categories = new Map<string, BackfillCategorySummary>();
  for (const row of rows) {
    // Only rows that would post (or need a mapping to post) are mapped; rows
    // held back before the opening balances join once they are included.
    if (row.status !== "post" && row.status !== "needs_mapping") continue;
    const key = `${row.direction}|${normalizeCategory(row.category)}`;
    const existing = categories.get(key) ?? {
      category: row.category || "(uncategorized)",
      direction: row.direction,
      count: 0,
      totalCents: 0,
      offsetAccountId: row.offsetAccountId,
      offsetSource: row.offsetSource,
    };
    existing.count += 1;
    existing.totalCents += row.amountCents;
    categories.set(key, existing);
  }

  const toPost = rows.filter((row) => row.status === "post");
  return {
    openingBalanceDate: opening,
    suspenseAccountId: suspense ? String(suspense._id) : null,
    rows,
    categories: [...categories.values()].sort((a, b) => a.direction.localeCompare(b.direction) || a.category.localeCompare(b.category)),
    summary: {
      scanned: rows.length,
      toPost: toPost.length,
      mapped: toPost.filter((row) => row.offsetSource === "mapping" || row.offsetSource === "choice").length,
      toSuspense: toPost.filter((row) => row.offsetSource === "suspense").length,
      needsMapping: rows.filter((row) => row.status === "needs_mapping").length,
      alreadyPosted: rows.filter((row) => row.status === "already_posted").length,
      beforeOpening: rows.filter((row) => row.beforeOpening && row.status !== "already_posted").length,
      beforeOpeningIncluded: toPost.filter((row) => row.beforeOpening).length,
      noCashAccount: rows.filter((row) => row.status === "no_cash_account").length,
      netCents: toPost.reduce((sum, row) => sum + row.amountCents, 0),
    },
  };
}

/**
 * Money accounts (bank, credit card, payment processor, cash) as the Accounts
 * page shows them: where each one's transactions come from, whether its feed
 * is healthy, its current balance, and the chart-of-accounts code a new
 * account gets. Shared by the portable handlers and the Accounts screen.
 *
 * A money account is a `financialAccounts` row of type Bank or Credit. It is
 * its own ledger account when it has a chart code; an account without one can
 * be linked to another ledger account instead (bankAccountProfiles.ledgerAccountId).
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */

export type BankAccountKind = "bank" | "credit" | "payments" | "cash";
export type BankAccountSource = "wave" | "demo" | "csv" | "manual";
export type BankAccountStatus = "synced" | "needs_attention" | "not_connected";
export type BankAccountTab = "all" | "bank" | "credit" | "payments" | "manual";

export const BANK_ACCOUNT_TABS: ReadonlyArray<{ id: BankAccountTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "bank", label: "Bank" },
  { id: "credit", label: "Credit card" },
  { id: "payments", label: "Payments" },
  { id: "manual", label: "Manual" },
];

export const BANK_ACCOUNT_KIND_LABELS: Record<BankAccountKind, string> = {
  bank: "Bank account",
  credit: "Credit card",
  payments: "Payment processor",
  cash: "Cash",
};

export const BANK_ACCOUNT_SOURCE_LABELS: Record<BankAccountSource, string> = {
  wave: "Synced via Wave",
  demo: "Synced (demo feed)",
  csv: "CSV import",
  manual: "Manual account",
};

export const BANK_ACCOUNT_STATUS_LABELS: Record<BankAccountStatus, string> = {
  synced: "Synced",
  needs_attention: "Needs attention",
  not_connected: "Not connected",
};

type AccountLike = { accountType?: string | null; subtype?: string | null; name?: string | null; sourceSystem?: string | null };

const PAYMENT_PROCESSOR = /\b(stripe|square|paypal|donorloop|canadahelps|zeffy|tapline|helcim|moneris)\b/i;

export function isMoneyAccount(account: Pick<AccountLike, "accountType">): boolean {
  const type = String(account.accountType ?? "").toLowerCase();
  return type === "bank" || type === "credit" || type === "cash";
}

export function bankAccountKind(account: AccountLike): BankAccountKind {
  const type = String(account.accountType ?? "").toLowerCase();
  const subtype = String(account.subtype ?? "").toLowerCase();
  if (type === "credit") return "credit";
  if (subtype === "payments" || subtype === "payment_processor" || PAYMENT_PROCESSOR.test(String(account.name ?? ""))) return "payments";
  if (type === "cash" || subtype === "cash" || subtype === "petty_cash") return "cash";
  return "bank";
}

/**
 * Where an account's lines come from. An account added by hand stays manual
 * even when lines are later imported into it; otherwise a Wave connection
 * means synced, and CSV-imported lines (or a csv source) mean CSV import.
 */
export function bankAccountSource(input: {
  profileOrigin?: string | null;
  connectionProvider?: string | null;
  sourceSystem?: string | null;
  hasCsvLines?: boolean;
}): BankAccountSource {
  if (input.profileOrigin === "manual" || input.connectionProvider === "manual") return "manual";
  if (input.connectionProvider === "wave" || input.sourceSystem === "wave") return "wave";
  if (input.connectionProvider === "demo") return "demo";
  if (input.sourceSystem === "csv" || input.hasCsvLines) return "csv";
  return "manual";
}

export type BankAccountHealth = { status: BankAccountStatus; label: string; reasons: string[] };

/**
 * Feed health. Wave (and demo feed) accounts follow their connection
 * (connected → synced, error → needs attention, disconnected → not
 * connected). CSV and manual
 * accounts have no live feed, so they read "Not connected". Any account whose
 * reconciled statements no longer balance needs attention.
 */
export function bankAccountHealth(input: {
  source: BankAccountSource;
  connectionStatus?: string | null;
  connectionError?: string | null;
  outOfBalanceCount?: number;
}): BankAccountHealth {
  const reasons: string[] = [];
  let status: BankAccountStatus = "not_connected";
  if (input.source === "wave" || input.source === "demo") {
    if (input.connectionStatus === "connected") status = "synced";
    else if (input.connectionStatus === "error") {
      status = "needs_attention";
      reasons.push(input.connectionError ? `The last sync failed: ${input.connectionError}` : "The last sync failed.");
    }
  }
  if (input.outOfBalanceCount) {
    status = "needs_attention";
    reasons.push(`${input.outOfBalanceCount} reconciled statement${input.outOfBalanceCount === 1 ? " no longer balances" : "s no longer balance"}.`);
  }
  return { status, label: BANK_ACCOUNT_STATUS_LABELS[status], reasons };
}

export function bankAccountMatchesTab(row: { kind: BankAccountKind; source: BankAccountSource }, tab: BankAccountTab): boolean {
  switch (tab) {
    case "all": return true;
    case "bank": return row.kind === "bank" || row.kind === "cash";
    case "credit": return row.kind === "credit";
    case "payments": return row.kind === "payments";
    case "manual": return row.source === "manual";
  }
}

/**
 * The chart code for a new money account: the first free code counting by 10
 * in its range (bank and cash 1000–1090, payment processors 1050–1090 first,
 * credit cards 2110–2190), then any free code in the range.
 */
export function nextLedgerCode(existingCodes: Iterable<string | null | undefined>, kind: BankAccountKind): string {
  const used = new Set([...existingCodes].filter(Boolean).map(String));
  const [from, to, preferred] =
    kind === "credit" ? [2110, 2199, 2110] : kind === "payments" ? [1000, 1099, 1050] : [1000, 1099, 1000];
  for (let code = preferred; code <= to; code += 10) if (!used.has(String(code))) return String(code);
  for (let code = from; code <= to; code += 10) if (!used.has(String(code))) return String(code);
  for (let code = from; code <= to; code += 1) if (!used.has(String(code))) return String(code);
  throw new Error("Every chart code in this range is in use. Link the account to an existing ledger account instead.");
}

/**
 * Current balance. With an opening balance recorded on the account's profile,
 * it is the opening balance plus every line on or after the opening date;
 * otherwise the synced or imported balance stored on the account.
 */
export function bankAccountBalanceCents(
  account: { balanceCents?: number | null },
  profile: { openingBalanceCents?: number | null; openingDate?: string | null } | null | undefined,
  lines: ReadonlyArray<{ date: string; amountCents: number }>,
): number {
  if (profile && typeof profile.openingBalanceCents === "number") {
    const from = profile.openingDate ?? "";
    return profile.openingBalanceCents + lines.filter((line) => line.date >= from).reduce((sum, line) => sum + line.amountCents, 0);
  }
  return Math.round(account.balanceCents ?? 0);
}

/** Problems with a new manual account. */
export function validateNewBankAccount(input: { name?: string; kind?: string; openingBalanceCents?: number; openingDate?: string; lastFour?: string }): string[] {
  const errors: string[] = [];
  if (!String(input.name ?? "").trim()) errors.push("Name the account.");
  if (!["bank", "credit", "payments", "cash"].includes(String(input.kind))) errors.push("Choose the account type.");
  if (typeof input.openingBalanceCents !== "number" || !Number.isSafeInteger(input.openingBalanceCents)) errors.push("Enter the opening balance.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.openingDate ?? ""))) errors.push("Enter the opening balance date.");
  if (input.lastFour && !/^\d{4}$/.test(input.lastFour)) errors.push("Enter the last four digits of the account number.");
  return errors;
}

/** Source denomination for year-end reports. No exchange conversion is implied. */
export type YearEndCurrencyAccount = { _id?: string; currency?: string; accountType?: string; subtype?: string; code?: string; name?: string };

export function yearEndCurrency(value: unknown, fallback = "CAD"): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : fallback;
}

export function yearEndCurrencyScope(accounts: YearEndCurrencyAccount[], options: { requested?: string; receivableAccountId?: string; organizationCurrency?: string } = {}) {
  if (options.requested != null && !/^[A-Z]{3}$/.test(options.requested.trim().toUpperCase())) throw new Error("Choose a three-letter report currency.");
  const receivable = accounts.find((account) => String(account._id) === options.receivableAccountId)
    ?? accounts.find((account) => account.accountType === "Asset" && account.subtype === "receivable" && account.code === "1100")
    ?? accounts.find((account) => account.accountType === "Asset" && account.subtype === "receivable")
    ?? accounts.find((account) => account.accountType === "Asset" && /accounts receivable/i.test(account.name ?? ""));
  const bank = accounts.find((account) => account.accountType === "Bank");
  const baseCurrency = yearEndCurrency(receivable?.currency ?? bank?.currency ?? options.organizationCurrency);
  return { currency: options.requested ? yearEndCurrency(options.requested) : baseCurrency, baseCurrency, currencies: [...new Set([baseCurrency, ...accounts.map((account) => yearEndCurrency(account.currency, baseCurrency))])].sort() };
}

/** Account denomination governs linked transactions; unlabelled standalone rows use the workspace base. */
export function yearEndRowCurrency(row: { currency?: string; accountId?: string } | Record<string, unknown>, accounts: ReadonlyMap<string, YearEndCurrencyAccount>, baseCurrency: string): string {
  return yearEndCurrency(accounts.get(String(row.accountId))?.currency ?? row.currency, baseCurrency);
}

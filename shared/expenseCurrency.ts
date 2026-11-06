/** The transaction ledger stores integer hundredths of a currency unit. */
export function expenseCurrency(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Enter a three-letter currency code, such as USD or CAD.");
  return code;
}

export function parseExpenseAmount(value: string): number | undefined {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

export type ExpenseConversion = { currency: string; rate: string };
export type OriginalExpense = { amountCents: number; currency: string; rate: string };

/** Rate is destination units per source unit. Round the signed result once. */
export function convertExpense(amountCents: number, currency: string, conversion?: ExpenseConversion) {
  const source = expenseCurrency(currency);
  if (!Number.isSafeInteger(amountCents) || !amountCents) throw new Error("Enter a non-zero amount with up to two decimal places.");
  if (!conversion) return { amountCents, currency: source };
  const target = expenseCurrency(conversion.currency);
  if (target === source) throw new Error("Choose a different currency to convert to.");
  const rate = conversion.rate.trim();
  const match = /^(\d{1,12})(?:\.(\d{1,12}))?$/.exec(rate);
  if (!match) throw new Error("Enter a positive exchange rate with up to 12 decimal places (for example 1.375).");
  const fraction = match[2] ?? "";
  const numerator = BigInt(match[1] + fraction);
  if (numerator === 0n) throw new Error("The exchange rate must be greater than zero.");
  const denominator = 10n ** BigInt(fraction.length);
  const absolute = (BigInt(Math.abs(amountCents)) * numerator + denominator / 2n) / denominator;
  const converted = Number(absolute) * Math.sign(amountCents);
  if (!Number.isSafeInteger(converted) || !converted) throw new Error("The converted amount is outside the range supported by the ledger.");
  return { amountCents: converted, currency: target, originalExpense: { amountCents, currency: source, rate } satisfies OriginalExpense };
}

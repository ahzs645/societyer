/**
 * One money convention for the app.
 *
 * Amounts are integer cents. Every jurisdiction Societyer supports is
 * Canadian, so CAD is the default; pass `currency` for foreign-currency rows
 * (Wave imports, grants paid in USD, …) instead of hard-coding it per screen.
 *
 * Use `formatMoney` (fixed decimals) anywhere amounts sit in a column, a
 * statement or a total so digits line up. `money()` in lib/format.ts keeps the
 * compact whole-dollar form for prose and headline stat tiles.
 */

export const DEFAULT_CURRENCY = "CAD";
const DEFAULT_LOCALE = "en-CA";

export type NegativeStyle = "minus" | "parentheses";

export type MoneyFormatOptions = {
  currency?: string;
  /** Drop ".00" on whole amounts (headline stats only, never columns). */
  trimWholeCents?: boolean;
  /** Accounting statements use parentheses; everything else a minus sign. */
  negativeStyle?: NegativeStyle;
  /** "always" prefixes + on positive amounts (variance, net change). */
  signDisplay?: "auto" | "always" | "exceptZero";
  /** Shown for null/undefined. */
  empty?: string;
};

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fractionDigits: number, compact = false) {
  const key = `${currency}:${fractionDigits}:${compact}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency,
      // Home currency shows a bare "$"; anything else stays unambiguous ("US$").
      currencyDisplay: currency === DEFAULT_CURRENCY ? "narrowSymbol" : "symbol",
      minimumFractionDigits: compact ? 0 : fractionDigits,
      maximumFractionDigits: compact ? 1 : fractionDigits,
      ...(compact ? { notation: "compact" as const } : {}),
    });
    formatters.set(key, cached);
  }
  return cached;
}

/** Normalise "-0" so a zero amount never renders as "−$0.00". */
function normaliseCents(cents: number) {
  return Object.is(cents, -0) ? 0 : Math.round(cents);
}

export function formatMoney(cents: number | null | undefined, options: MoneyFormatOptions = {}): string {
  if (cents == null || !Number.isFinite(cents)) return options.empty ?? "—";
  const value = normaliseCents(cents);
  const currency = options.currency ?? DEFAULT_CURRENCY;
  const trim = options.trimWholeCents && value % 100 === 0;
  const body = formatter(currency, trim ? 0 : 2).format(Math.abs(value) / 100);
  if (value < 0) return options.negativeStyle === "parentheses" ? `(${body})` : `−${body}`;
  const sign = options.signDisplay ?? "auto";
  if ((sign === "always" && value >= 0) || (sign === "exceptZero" && value > 0)) return `+${body}`;
  return body;
}

/** "$1.2K" style for chart axes and dense summaries. */
export function formatMoneyCompact(cents: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const value = normaliseCents(cents);
  const body = formatter(currency, 0, true).format(Math.abs(value) / 100);
  return value < 0 ? `−${body}` : body;
}

/** Split an amount into its whole and cents parts so the UI can de-emphasise cents. */
export function splitMoney(cents: number, options: MoneyFormatOptions = {}): { whole: string; fraction: string } {
  const full = formatMoney(cents, { ...options, trimWholeCents: false });
  const match = /^(.*?)([.,]\d{2})(\))?$/.exec(full);
  if (!match) return { whole: full, fraction: "" };
  return { whole: match[1], fraction: `${match[2]}${match[3] ?? ""}` };
}

/**
 * Parse what people type into amount inputs and filters:
 * "1,250.50", "$1250", "1.5k", "2m", "(300)", "-300". Returns cents.
 */
export function parseMoneyInput(raw: string | number | null | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : undefined;
  let text = raw.trim().toLowerCase().replace(/[$,\s]|cad|usd/g, "").replace(/−/g, "-");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  const match = /^(\d*\.?\d*)([km]?)$/.exec(text);
  if (!match || match[1] === "" || match[1] === ".") return undefined;
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1;
  const cents = Math.round(Number(match[1]) * multiplier * 100);
  if (!Number.isFinite(cents)) return undefined;
  return negative ? -cents : cents;
}

export type MoneyDirection = "in" | "out" | "neutral" | "pending";

/**
 * Budget variance with one convention everywhere: variance = budget − actual
 * for expenses and actual − budget for revenue, so a positive number is always
 * favourable. Colour follows favourability, never the raw sign.
 */
export function budgetVariance(plannedCents: number, actualCents: number, kind: "expense" | "revenue" = "expense") {
  const variance = kind === "expense" ? plannedCents - actualCents : actualCents - plannedCents;
  return {
    cents: variance,
    favourable: variance >= 0,
    percent: plannedCents === 0 ? null : variance / Math.abs(plannedCents),
  };
}

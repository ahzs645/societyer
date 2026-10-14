/**
 * Number format codes. Built-in ids are used where Excel's are locale-neutral;
 * everything else is a custom code (ids from 164 up, assigned per workbook).
 */

export const GENERAL_FORMAT = "General";
export const INTEGER_FORMAT = "#,##0";
export const PERCENT_FORMAT = "0.0%";
/** ISO dates read the same in every locale (and match the app's CSV export). */
export const DATE_FORMAT = "yyyy-mm-dd";
export const DATETIME_FORMAT = "yyyy-mm-dd hh:mm";

/** Excel's own ids for the codes above that it ships built in. */
export const BUILTIN_FORMAT_IDS: Record<string, number> = {
  [GENERAL_FORMAT]: 0,
  "0": 1,
  "0.00": 2,
  [INTEGER_FORMAT]: 3,
  "#,##0.00": 4,
  "0%": 9,
  "0.00%": 10,
};

const HOME_CURRENCY = "CAD";
const LOCALE = "en-CA";

type CurrencyInfo = { symbol: string; decimals: number };
const cache = new Map<string, CurrencyInfo>();

/** "$" for CAD (the home currency, as in the app), "US$", "€", "£"; unknown codes fall back to the code itself. */
export function currencyInfo(code: string | undefined): CurrencyInfo {
  const currency = (code || HOME_CURRENCY).toUpperCase();
  const cached = cache.get(currency);
  if (cached) return cached;
  let info: CurrencyInfo = { symbol: `${currency} `, decimals: 2 };
  try {
    const format = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      currencyDisplay: currency === HOME_CURRENCY ? "narrowSymbol" : "symbol",
    });
    const symbol = format.formatToParts(1).find((part) => part.type === "currency")?.value ?? currency;
    const decimals = format.resolvedOptions().maximumFractionDigits ?? 2;
    info = { symbol: symbol === currency ? `${currency} ` : symbol, decimals };
  } catch {
    // Not an ISO 4217 code: keep the code as a prefix.
  }
  cache.set(currency, info);
  return info;
}

function quoted(symbol: string) {
  return `"${symbol.replace(/"/g, "")}"`;
}

function digits(decimals: number) {
  return decimals > 0 ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
}

/** `"$"#,##0.00;[Red]-"$"#,##0.00` — negatives keep a minus sign and turn red. */
export function currencyFormat(code: string | undefined): string {
  const { symbol, decimals } = currencyInfo(code);
  const body = `${quoted(symbol)}${digits(decimals)}`;
  return `${body};[Red]-${body}`;
}

/**
 * Excel's accounting layout (built-in 44 with this currency's symbol): the
 * symbol pinned left, negatives in parentheses, zero as a dash. The cell
 * still holds a plain signed number.
 */
export function accountingFormat(code: string | undefined): string {
  const { symbol, decimals } = currencyInfo(code);
  const number = digits(decimals);
  const sym = quoted(symbol);
  const zero = decimals > 0 ? `"-"${"?".repeat(decimals)}` : `"-"`;
  return `_(${sym}* ${number}_);_(${sym}* \\(${number}\\);_(${sym}* ${zero}_);_(@_)`;
}

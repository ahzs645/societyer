/**
 * DIVIDEND DECLARATION CONTEXT (pure logic).
 *
 * Turns the dividend register rows for a single declaration into the multi-class
 * table the YCN "Doc - Dividends" sheet renders (Class / Amount Per Share /
 * Total Dividends). The packet body (`dividend-declaration`) iterates these via
 * {#each}. Framework-free.
 */

export interface DividendDeclarationInput {
  shareClass: string;
  perShareCents: number;
  sharesOutstanding?: number;
  totalCents: number;
  /** Symbol-coded currency as stored (e.g. "C$", "US$", "EU€"). */
  currency: string;
}

export interface DividendDeclarationView {
  className: string;
  perShare: string;
  total: string;
}

export interface DividendResolutionContext {
  hasDeclarations: boolean;
  declarations: DividendDeclarationView[];
  hasDeclaredDate: boolean;
  declaredDate: string;
}

/** Format integer cents with the stored currency symbol, e.g. (50, "C$") → "C$0.50". */
function formatMoney(cents: number, currency: string): string {
  const symbol = String(currency ?? "").trim();
  const amount = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  return symbol ? `${symbol}${amount}` : amount;
}

export function buildDividendResolutionContext(
  rows: readonly DividendDeclarationInput[],
  options?: { declaredDate?: string | null },
): DividendResolutionContext {
  const declarations = rows.map((r) => ({
    className: String(r.shareClass ?? ""),
    perShare: formatMoney(r.perShareCents, r.currency),
    total: formatMoney(r.totalCents, r.currency),
  }));
  const declaredDate = typeof options?.declaredDate === "string" ? options.declaredDate.trim() : "";
  return {
    hasDeclarations: declarations.length > 0,
    declarations,
    hasDeclaredDate: declaredDate.length > 0,
    declaredDate,
  };
}

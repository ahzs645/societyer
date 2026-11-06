import { computeInvoiceMoneyTotals, type InvoiceMoneyOptions, type InvoiceLineTaxes, type InvoiceTaxMode } from "./invoiceMoney";

type PricedLine = InvoiceLineTaxes & { quantity: number; unitPriceCents: number; taxMode?: InvoiceTaxMode };
type Discount = { kind: "percent" | "amount"; value: number };
export type FinalPriceResult<T> = { lines: T[]; totalCents: number; differenceCents: number; taxes: Array<{ label: string; ratePercent: number; cents: number }>; subtotalCents: number };

/**
 * Line prices that reach a final total, taxes included. The real totals function
 * is the only arithmetic here, so a preview can't disagree with the saved invoice:
 * discounts, shipping and per-rate rounding all count. Prices keep their proportions.
 * Whole-cent prices can't reach every total (three of an item move it in threes),
 * so `differenceCents` reports what was left, and null means it's out of reach.
 */
export function solveFinalTotal<T extends PricedLine>(lines: T[], targetCents: number, discount?: Discount | null, options?: InvoiceMoneyOptions | null): FinalPriceResult<T> | null {
  if (!Number.isFinite(targetCents) || targetCents <= 0) return null;
  const billable = lines.flatMap((line, index) => line.quantity > 0 ? [index] : []);
  if (!billable.length) return null;
  const anyPriced = billable.some((index) => lines[index].unitPriceCents > 0);
  const weights = lines.map((line, index) => !billable.includes(index) ? 0 : anyPriced ? line.unitPriceCents : 100);
  const priced = billable.filter((index) => weights[index] > 0);
  const total = (next: T[]) => computeInvoiceMoneyTotals(next, discount, options).grossTotalCents;
  const scaled = (factor: number) => lines.map((line, index) => weights[index] > 0 ? { ...line, unitPriceCents: Math.round(weights[index] * factor) } : line);
  if (total(scaled(0)) > targetCents) return null;

  let low = 0, high = 1;
  while (total(scaled(high)) < targetCents) { high *= 2; if (high > 1e9) return null; }
  for (let step = 0; step < 80; step++) {
    const middle = (low + high) / 2;
    if (total(scaled(middle)) < targetCents) low = middle; else high = middle;
  }
  let best = [scaled(low), scaled(high)].sort((a, b) => Math.abs(total(a) - targetCents) - Math.abs(total(b) - targetCents))[0];
  // Close the last cents on the lines that move the total least.
  const byQuantity = [...priced].sort((a, b) => lines[a].quantity - lines[b].quantity);
  for (let pass = 0; pass < 200 && total(best) !== targetCents; pass++) {
    const gap = Math.abs(total(best) - targetCents);
    const options_ = byQuantity.flatMap((index) => [-1, 1].map((cents) => best.map((line, at) => at === index ? { ...line, unitPriceCents: Math.max(0, line.unitPriceCents + cents) } : line)));
    const next = options_.sort((a, b) => Math.abs(total(a) - targetCents) - Math.abs(total(b) - targetCents))[0];
    if (Math.abs(total(next) - targetCents) >= gap) break;
    best = next;
  }
  const result = computeInvoiceMoneyTotals(best, discount, options);
  return { lines: best, totalCents: result.grossTotalCents, differenceCents: result.grossTotalCents - targetCents, subtotalCents: result.subtotalCents, taxes: result.taxes.map(({ label, ratePercent, cents }) => ({ label, ratePercent, cents })) };
}

/** Invoice-currency cents and explicit base-currency quotes; no rate is inferred or fetched. */
export type InvoiceTaxMode = "exclusive" | "inclusive";
export type InvoiceFxQuote = { baseCurrency: string; rateMicros: number; asOfDate: string; source: string; reference?: string };
export type InvoiceMoneyOptions = {
  taxMode?: InvoiceTaxMode;
  shipping?: { amountCents: number; taxRatePercent?: number; taxLabel?: string; taxMode?: InvoiceTaxMode };
  withholding?: { kind: "amount" | "percent"; value: number };
  fx?: InvoiceFxQuote;
};
export type InvoiceDocumentExtras = {
  termsAndConditions?: string;
  bankDetails?: Array<{ label: string; value: string }>;
  paymentUrl?: string;
  annexures?: Array<{ title: string; columns: string[]; rows: string[][] }>;
  attachments?: Array<{ name: string; mimeType: "application/pdf" | "image/png" | "image/jpeg"; dataUrl: string }>;
};
type MoneyLine = { quantity: number; unitPriceCents: number; taxRatePercent?: number; taxLabel?: string; taxMode?: InvoiceTaxMode };
type Discount = { kind: "percent" | "amount"; value: number };
const rounded = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
export function integerCents(value: unknown, label: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) throw new Error(`${label} must be integer cents${min === 0 ? " at or above zero" : ""}.`);
  return value;
}
export function explicitFxQuote(value: InvoiceFxQuote | undefined, currency?: string, baseCurrency?: string): InvoiceFxQuote | undefined {
  if (!value) return undefined;
  if (!/^[A-Z]{3}$/.test(value.baseCurrency) || (baseCurrency && value.baseCurrency !== baseCurrency)) throw new Error("The FX quote base currency must match the books.");
  integerCents(value.rateMicros, "FX rate", 1);
  if (value.rateMicros > 1_000_000_000_000) throw new Error("The FX rate is outside the supported range.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.asOfDate) || new Date(`${value.asOfDate}T00:00:00Z`).toISOString().slice(0, 10) !== value.asOfDate) throw new Error("Choose a valid FX quote date.");
  if (!value.source?.trim() || value.source.length > 200 || (value.reference?.length ?? 0) > 200) throw new Error("Record the FX quote source (at most 200 characters).");
  if (currency === value.baseCurrency && value.rateMicros !== 1_000_000) throw new Error("A quote in the books currency must have a rate of 1.");
  return { baseCurrency: value.baseCurrency, rateMicros: value.rateMicros, asOfDate: value.asOfDate, source: value.source.trim(), ...(value.reference?.trim() ? { reference: value.reference.trim() } : {}) };
}
export function convertInvoiceCents(amountCents: number, rateMicros = 1_000_000): number {
  integerCents(amountCents, "Amount", -Number.MAX_SAFE_INTEGER); integerCents(rateMicros, "FX rate", 1);
  const product = BigInt(amountCents) * BigInt(rateMicros), absolute = product < 0n ? -product : product;
  const result = Number((absolute + 500_000n) / 1_000_000n) * (product < 0n ? -1 : 1);
  return integerCents(result, "Converted amount", -Number.MAX_SAFE_INTEGER);
}
/** Allocate a signed target exactly; deterministic rounding remainder goes to the largest residual. */
export function allocateMoney(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const exact = weights.map((weight) => total * weight / sum);
  const shares = exact.map(rounded);
  let remainder = total - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, residual: value - shares[index] })).sort((a, b) => remainder > 0 ? b.residual - a.residual || a.index - b.index : a.residual - b.residual || a.index - b.index);
  for (let i = 0; remainder; i++) { const increment = remainder > 0 ? 1 : -1; shares[order[i % order.length].index] += increment; remainder -= increment; }
  return shares;
}
export function cleanInvoiceMoney(value?: InvoiceMoneyOptions, currency?: string, baseCurrency?: string): InvoiceMoneyOptions | undefined {
  if (!value) return undefined;
  const taxMode = value.taxMode ?? "exclusive";
  if (taxMode !== "exclusive" && taxMode !== "inclusive") throw new Error("Choose tax-inclusive or tax-exclusive rates.");
  let shipping: InvoiceMoneyOptions["shipping"];
  if (value.shipping) {
    const rate = value.shipping.taxRatePercent ?? 0;
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Shipping tax must be between 0 and 100 percent.");
    if (value.shipping.taxMode && !["exclusive", "inclusive"].includes(value.shipping.taxMode)) throw new Error("Choose the shipping tax mode.");
    shipping = { amountCents: integerCents(value.shipping.amountCents, "Shipping"), taxRatePercent: rate, taxLabel: String(value.shipping.taxLabel ?? "Tax").trim().slice(0, 40), taxMode: value.shipping.taxMode ?? taxMode };
  }
  let withholding: InvoiceMoneyOptions["withholding"];
  if (value.withholding) {
    const w = value.withholding;
    if (!["amount", "percent"].includes(w.kind) || !Number.isFinite(w.value) || w.value < 0 || (w.kind === "percent" && w.value > 100) || (w.kind === "amount" && !Number.isSafeInteger(w.value))) throw new Error("Choose a non-negative withholding amount or percentage up to 100.");
    withholding = { kind: w.kind, value: w.value };
  }
  const fx = explicitFxQuote(value.fx, currency, baseCurrency);
  return { taxMode, ...(shipping ? { shipping } : {}), ...(withholding ? { withholding } : {}), ...(fx ? { fx } : {}) };
}
export function computeInvoiceMoneyTotals(lines: MoneyLine[], discount?: Discount | null, options?: InvoiceMoneyOptions | null) {
  const quotedAmounts = lines.map((line) => integerCents(rounded(line.quantity * line.unitPriceCents), "Line amount", -Number.MAX_SAFE_INTEGER));
  const bases = [...quotedAmounts];
  const inclusiveGroups = new Map<string, number[]>();
  lines.forEach((line, index) => {
    if ((line.taxMode ?? options?.taxMode) !== "inclusive" || !(line.taxRatePercent! > 0)) return;
    const key = `${line.taxLabel || "Tax"}|${line.taxRatePercent}`;
    inclusiveGroups.set(key, [...(inclusiveGroups.get(key) ?? []), index]);
  });
  const originalInclusiveTax = new Map<string, number>();
  for (const [key, indices] of inclusiveGroups) {
    const rate = lines[indices[0]].taxRatePercent!, gross = indices.reduce((sum, index) => sum + quotedAmounts[index], 0);
    const tax = rounded(gross * rate / (100 + rate));
    const baseShares = gross ? allocateMoney(gross - tax, indices.map((index) => quotedAmounts[index])) : indices.map((index) => quotedAmounts[index] - rounded(quotedAmounts[index] * rate / (100 + rate)));
    indices.forEach((index, at) => { bases[index] = baseShares[at]; });
    originalInclusiveTax.set(key, tax);
  }
  const subtotalCents = bases.reduce((a, b) => a + b, 0);
  const discountCents = discount && discount.value > 0 && subtotalCents > 0 ? Math.min(subtotalCents, discount.kind === "percent" ? rounded(subtotalCents * Math.min(discount.value, 100) / 100) : rounded(discount.value)) : 0;
  const lineDiscountCents = allocateMoney(discountCents, bases.map((base) => Math.max(0, base)));
  const lineNetCents = bases.map((base, index) => base - lineDiscountCents[index]);
  const lineTaxCents = lines.map(() => 0);
  const groups = new Map<string, { label: string; ratePercent: number; baseCents: number; cents: number }>();
  const byMode = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const rate = line.taxRatePercent ?? 0;
    if (!(rate > 0)) return;
    const key = `${line.taxLabel || "Tax"}|${rate}`, mode = (line.taxMode ?? options?.taxMode) === "inclusive" ? "inclusive" : "exclusive";
    const modeKey = `${mode}:${key}`;
    byMode.set(modeKey, [...(byMode.get(modeKey) ?? []), index]);
  });
  for (const [modeKey, indices] of byMode) {
    const line = lines[indices[0]], label = line.taxLabel || "Tax", rate = line.taxRatePercent!, key = `${label}|${rate}`;
    const base = indices.reduce((sum, index) => sum + lineNetCents[index], 0);
    const tax = modeKey.startsWith("inclusive:") && !discountCents ? originalInclusiveTax.get(key)! : rounded(base * rate / 100);
    const shares = modeKey.startsWith("inclusive:") && !discountCents ? indices.map(index=>quotedAmounts[index]-bases[index]) : base ? allocateMoney(tax, indices.map((index) => lineNetCents[index])) : indices.map(index=>rounded(lineNetCents[index]*rate/100));
    if(shares.length)shares[0]+=tax-shares.reduce((sum,value)=>sum+value,0);
    indices.forEach((index, at) => { lineTaxCents[index] = shares[at]; });
    const group = groups.get(key) ?? { label, ratePercent: rate, baseCents: 0, cents: 0 };
    group.baseCents += base; group.cents += tax; groups.set(key, group);
  }
  const shipping = options?.shipping;
  const shippingQuoted = shipping?.amountCents ?? 0, shippingRate = shipping?.taxRatePercent ?? 0;
  const shippingInclusive = (shipping?.taxMode ?? options?.taxMode) === "inclusive";
  const shippingTaxCents = shippingInclusive ? rounded(shippingQuoted * shippingRate / (100 + shippingRate)) : rounded(shippingQuoted * shippingRate / 100);
  const shippingCents = shippingQuoted - (shippingInclusive ? shippingTaxCents : 0);
  if (shippingRate > 0 && shippingQuoted) {
    const label = shipping?.taxLabel || "Tax", key = `${label}|${shippingRate}`;
    const group = groups.get(key) ?? { label, ratePercent: shippingRate, baseCents: 0, cents: 0 };
    group.baseCents += shippingCents; group.cents += shippingTaxCents; groups.set(key, group);
  }
  const taxes = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label) || a.ratePercent - b.ratePercent);
  const taxCents = taxes.reduce((sum, tax) => sum + tax.cents, 0);
  const grossTotalCents = subtotalCents - discountCents + shippingCents + taxCents;
  const withholdingCents = options?.withholding ? (options.withholding.kind === "percent" ? rounded(grossTotalCents * options.withholding.value / 100) : options.withholding.value) : 0;
  const totalCents = grossTotalCents - withholdingCents;
  integerCents(totalCents, "Invoice total", -Number.MAX_SAFE_INTEGER);
  return { lineAmounts: bases, quotedAmounts, lineNetCents, lineTaxCents, lineDiscountCents, subtotalCents, discountCents, taxCents, taxes, taxableBaseCents: taxes.reduce((sum, tax) => sum + tax.baseCents, 0), shippingCents, shippingTaxCents, grossTotalCents, withholdingCents, totalCents };
}
export type SettlementRecord = { kind?: "payment" | "credit" | "write_off" | "refund"; amountCents: number; reversedDate?: string };
export function settlementTotals(payments: ReadonlyArray<SettlementRecord> = []) {
  const active = payments.filter((payment) => !payment.reversedDate);
  const sum = (kind: string) => active.filter((payment) => (payment.kind ?? "payment") === kind).reduce((amount, payment) => amount + payment.amountCents, 0);
  const cashPaidCents = sum("payment"), creditCents = sum("credit"), writeOffCents = sum("write_off"), refundCents = -sum("refund");
  return { cashPaidCents, creditCents, writeOffCents, refundCents, settledCents: cashPaidCents + creditCents + writeOffCents - refundCents };
}

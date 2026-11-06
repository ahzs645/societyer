import { useState } from "react";
import { Target } from "lucide-react";
import { Field } from "../../components/ui";
import { Money } from "../../components/Money";
import { Select } from "../../components/Select";
import { parseMoneyInput } from "../../lib/money";
import { solveFinalTotal, type FinalPriceResult } from "../../../shared/invoiceFinalPrice";
import { decodeTaxChoice, INVOICE_TAX_CHOICES, type InvoiceLineTaxes, type InvoiceMoneyOptions, type InvoiceTaxMode } from "../../../shared/invoiceMoney";

type Priced = InvoiceLineTaxes & { quantity: number; unitPriceCents: number; taxMode?: InvoiceTaxMode };

function Breakdown<T extends Priced>({ result, currency }: { result: FinalPriceResult<T>; currency: string }) {
  return <>
    <dl className="invoice-builder__totals invoice-final-price__totals" aria-live="polite">
      <div><dt>Before tax</dt><dd><Money cents={result.subtotalCents} currency={currency} /></dd></div>
      {result.taxes.map((tax) => <div key={`${tax.label}-${tax.ratePercent}`}><dt>{tax.label} {tax.ratePercent}%</dt><dd><Money cents={tax.cents} currency={currency} /></dd></div>)}
      <div className="invoice-builder__total"><dt>Customer pays</dt><dd><Money cents={result.totalCents} currency={currency} /></dd></div>
    </dl>
    {result.differenceCents !== 0 && <p className="invoice-builder__hint" role="status">This is the closest whole-cent price, <Money cents={Math.abs(result.differenceCents)} currency={currency} /> {result.differenceCents > 0 ? "over" : "under"} your target. Each tax rounds separately and quantities move the total in steps, so not every total exists. Setting this price to Tax included hits it exactly.</p>}
    {result.taxes.length === 0 && <p className="invoice-builder__hint">No tax applies, so the price is the final price.</p>}
  </>;
}

/** One line or catalog item: type what the customer pays and get the price that produces it. */
export function FinalPriceButton<T extends Priced>({ line, currency, disabled, onApply }: { line: T; currency: string; disabled?: boolean; onApply: (unitPriceCents: number) => void }) {
  const [open, setOpen] = useState(false), [input, setInput] = useState("");
  const target = parseMoneyInput(input);
  const billed = { ...line, quantity: line.quantity > 0 ? line.quantity : 1 };
  const result = target ? solveFinalTotal([billed], target) : null;
  if (!open) return <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => setOpen(true)}><Target size={14} aria-hidden="true" /> Set final price</button>;
  return <div className="invoice-final-price" role="group" aria-label="Set final price">
    <Field label={`Final price with tax (${currency})`} hint={billed.quantity !== 1 ? `For all ${billed.quantity}, taxes included.` : "What the customer pays, taxes included."}>
      <input className="input num" inputMode="decimal" autoFocus value={input} placeholder="0.00" aria-label="Final price with tax" onChange={(event) => setInput(event.target.value)} />
    </Field>
    {result && <Breakdown result={result} currency={currency} />}
    <div className="btn-row">
      <button type="button" className="btn btn--sm" onClick={() => { setOpen(false); setInput(""); }}>Cancel</button>
      <button type="button" className="btn btn--sm btn--accent" disabled={!result} onClick={() => { onApply(result!.lines[0].unitPriceCents); setOpen(false); setInput(""); }}>Use this price</button>
    </div>
  </div>;
}

/** The whole document: choose a final total, optionally one tax for every line, and scale the prices to fit. */
export function FinalTotalPanel<T extends Priced>({ lines, discount, money, currency, disabled, onApply }: { lines: T[]; discount?: { kind: "percent" | "amount"; value: number } | null; money?: InvoiceMoneyOptions; currency: string; disabled?: boolean; onApply: (lines: T[]) => void }) {
  const [open, setOpen] = useState(false), [input, setInput] = useState(""), [tax, setTax] = useState("keep");
  const target = parseMoneyInput(input);
  const taxed = tax === "keep" ? lines : lines.map((line) => ({ ...line, ...decodeTaxChoice(tax) }));
  const result = target ? solveFinalTotal(taxed, target, discount, money) : null;
  const close = () => { setOpen(false); setInput(""); setTax("keep"); };
  if (!open) return <button type="button" className="btn btn--sm invoice-final-price__open" disabled={disabled || !lines.length} onClick={() => setOpen(true)}><Target size={14} aria-hidden="true" /> Set final total</button>;
  return <div className="invoice-final-price invoice-final-price--total" role="group" aria-label="Set final total">
    <div className="invoice-builder__row">
      <Field label={`Final total with tax (${currency})`}><input className="input num" inputMode="decimal" autoFocus value={input} placeholder="0.00" aria-label="Final total with tax" onChange={(event) => setInput(event.target.value)} /></Field>
      <Field label="Tax on all lines"><Select value={tax} onChange={setTax} options={[{ value: "keep", label: "Keep each line's tax" }, ...INVOICE_TAX_CHOICES]} /></Field>
    </div>
    {result ? <Breakdown result={result} currency={currency} /> : target ? <p className="invoice-builder__hint" role="status">This total can't be reached: it's below the shipping or other fixed charges on this document, or there is nothing to price yet.</p> : <p className="invoice-builder__hint">Line prices change in proportion. Shipping and discounts stay as they are.</p>}
    <div className="btn-row">
      <button type="button" className="btn btn--sm" onClick={close}>Cancel</button>
      <button type="button" className="btn btn--sm btn--accent" disabled={!result} onClick={() => { onApply(result!.lines); close(); }}>Adjust line prices</button>
    </div>
  </div>;
}

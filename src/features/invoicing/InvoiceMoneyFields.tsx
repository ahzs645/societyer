import { useEffect, useState } from "react";
import { Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import type { InvoiceMoneyOptions } from "../../../shared/invoiceMoney";
function Decimal({ value, change, disabled, label, scale = 1 }: { value:number;change:(value:number)=>void;disabled?:boolean;label:string;scale?:number }) {
  const [raw,setRaw]=useState(String(value/scale)),[focused,setFocused]=useState(false);
  useEffect(()=>{if(!focused)setRaw(String(value/scale));},[value,scale,focused]);
  return <input className="input" aria-label={label} inputMode="decimal" value={raw} disabled={disabled} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} onChange={event=>{setRaw(event.target.value);const next=Number(event.target.value);if(Number.isFinite(next)&&next>=0)change(scale===1?next:Math.round(next*scale));}}/>;
}
/** Explicit commercial terms shared by invoice and quote editors. No automatic currency conversion. */
export function InvoiceMoneyFields({value,onChange,currency,baseCurrency,date,disabled,fxLocked}:{value?:InvoiceMoneyOptions;onChange:(value:InvoiceMoneyOptions)=>void;currency:string;baseCurrency:string;date:string;disabled?:boolean;fxLocked?:boolean}) {
  const money=value??{},patch=(next:Partial<InvoiceMoneyOptions>)=>onChange({...money,...next});
  const foreign=currency!==baseCurrency,quote=money.fx;
  return <section className="invoice-builder__section" aria-label="Tax, shipping, withholding and exchange rate"><h3>Tax and invoice charges</h3><div className="invoice-builder__row">
    <Field label="Rates include tax"><Select value={money.taxMode??"exclusive"} disabled={disabled} onChange={taxMode=>patch({taxMode:taxMode as "exclusive"|"inclusive"})} options={[{value:"exclusive",label:"Tax exclusive — add tax"},{value:"inclusive",label:"Tax inclusive — extract tax"}]}/></Field>
    <Field label={`Shipping (${currency})`}><Decimal value={money.shipping?.amountCents??0} scale={100} change={amountCents=>patch({shipping:{...money.shipping,amountCents}})} disabled={disabled} label="Shipping amount"/></Field>
    <Field label="Shipping tax percent"><Decimal value={money.shipping?.taxRatePercent??0} change={taxRatePercent=>patch({shipping:{amountCents:money.shipping?.amountCents??0,...money.shipping,taxRatePercent}})} disabled={disabled} label="Shipping tax percent"/></Field>
    <Field label="Shipping tax label"><input className="input" disabled={disabled} value={money.shipping?.taxLabel??"Tax"} onChange={event=>patch({shipping:{amountCents:money.shipping?.amountCents??0,...money.shipping,taxLabel:event.target.value}})}/></Field>
    <Field label="Withholding"><Select value={money.withholding?.kind??"amount"} disabled={disabled} onChange={kind=>patch({withholding:{kind:kind as "amount"|"percent",value:0}})} options={[{value:"amount",label:`Amount (${currency})`},{value:"percent",label:"Percent of gross total"}]}/></Field>
    <Field label="Tax withheld by customer" hint="Reduces the collectible balance and posts to withholding tax receivable."><Decimal value={money.withholding?.value??0} scale={money.withholding?.kind==="percent"?1:100} change={value=>patch({withholding:{kind:money.withholding?.kind??"amount",value}})} disabled={disabled} label="Withholding value"/></Field>
  </div>{foreign&&<fieldset className="form-stack"><legend>Explicit FX quote · {currency} → {baseCurrency}</legend><p className="muted">Enter base-currency units per 1 {currency}. This quote is saved with the invoice and locks when issued. Payments use their actual settlement rate.</p><div className="invoice-builder__row">
    <Field label={`1 ${currency} in ${baseCurrency}`}><Decimal value={quote?.rateMicros??0} scale={1_000_000} change={rateMicros=>patch({fx:{baseCurrency,asOfDate:quote?.asOfDate??date,source:quote?.source??"",...quote,rateMicros}})} disabled={disabled||fxLocked} label="Invoice exchange rate"/></Field>
    <Field label="Quote date"><DatePicker value={quote?.asOfDate??date} disabled={disabled||fxLocked} clearable={false} onChange={asOfDate=>asOfDate&&patch({fx:{baseCurrency,rateMicros:quote?.rateMicros??0,source:quote?.source??"",...quote,asOfDate}})}/></Field>
    <Field label="Rate source"><input className="input" disabled={disabled||fxLocked} value={quote?.source??""} maxLength={200} placeholder="Bank quote or agreed contract rate" onChange={event=>patch({fx:{baseCurrency,rateMicros:quote?.rateMicros??0,asOfDate:quote?.asOfDate??date,...quote,source:event.target.value}})}/></Field>
    <Field label="Quote reference"><input className="input" disabled={disabled||fxLocked} value={quote?.reference??""} maxLength={200} onChange={event=>patch({fx:{baseCurrency,rateMicros:quote?.rateMicros??0,asOfDate:quote?.asOfDate??date,source:quote?.source??"",...quote,reference:event.target.value}})}/></Field>
  </div></fieldset>}</section>;
}

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { Checkbox } from "../../components/Controls";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { parseMoneyInput } from "../../lib/money";
import { INVOICE_CURRENCIES, type InvoicePriceList } from "../../../shared/invoiceCommerce";
import { cleanBillingPriceProfile, type BillingPricingWorkspace } from "../../../shared/billingPricing";
import type { InvoiceWorkspace } from "./types";

type DraftTier = { catalogItemId:string; minimumQuantity:string; rate:string };
type Draft = { id?: string; name: string; currency: string; active: boolean; validFrom:string; validTo:string; rates: Record<string, string>; tiers:DraftTier[] };
export function PriceListsPanel({ workspace, societyId, canWrite }: { workspace: InvoiceWorkspace; societyId: string; canWrite: boolean }) {
  const save = useMutation(api.invoicePreferences.savePriceList), assign = useMutation(api.invoicePreferences.assignCustomer);
  const pricing = useQuery(api.invoicePreferences.workspace, { societyId }) as BillingPricingWorkspace | undefined;
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const open = (list?: InvoicePriceList) => {
    const profile = pricing?.profiles.find(row => row.priceListId === list?._id);
    setError(""); setDraft({ id:list?._id,name:list?.name ?? "",currency:list?.currency ?? workspace.ledger.workspaceCurrency,active:list?.active ?? true,validFrom:profile?.validFrom ?? "",validTo:profile?.validTo ?? "",rates:Object.fromEntries((list?.entries ?? []).map(entry => [entry.catalogItemId,(entry.unitPriceCents/100).toFixed(2)])),tiers:(profile?.tiers ?? []).map(tier => ({catalogItemId:tier.catalogItemId,minimumQuantity:String(tier.minimumQuantity),rate:(tier.unitPriceCents/100).toFixed(2)})) });
  };
  const customers = [...new Map([
    ...workspace.parties.members.map(party => ({ key:`member:${party._id}`, name:party.name })),
    ...workspace.parties.organizations.map(party => ({ key:`organization:${party._id}`, name:party.name })),
    ...workspace.customers.map(customer => ({ key:customer.key, name:customer.name })),
  ].map(customer => [customer.key,customer])).values()].sort((a,b) => a.name.localeCompare(b.name));
  const submit = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const entries = Object.entries(draft.rates).filter(([,value]) => value.trim()).map(([catalogItemId,value]) => ({catalogItemId,unitPriceCents:parseMoneyInput(value)}));
      if (entries.some(entry => entry.unitPriceCents == null || entry.unitPriceCents < 0)) throw new Error("Enter a valid rate of zero or more.");
      const tiers = draft.tiers.map(tier => ({ catalogItemId:tier.catalogItemId,minimumQuantity:Number(tier.minimumQuantity),unitPriceCents:parseMoneyInput(tier.rate) }));
      if (tiers.some(tier => tier.unitPriceCents == null)) throw new Error("Enter a rate for every quantity tier.");
      const profile = cleanBillingPriceProfile({priceListId:draft.id ?? "new",active:draft.active,validFrom:draft.validFrom || undefined,validTo:draft.validTo || undefined,tiers:tiers as any});
      await save({societyId,id:draft.id,name:draft.name,currency:draft.currency,active:draft.active,entries,validFrom:profile.validFrom,validTo:profile.validTo,tiers:profile.tiers});
      setDraft(null); toast.success("Price list saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save price list."); }
    finally { setBusy(false); }
  };
  return <div className="card invoice-card">
    <div className="card__head"><div><h2 className="card__title">Price lists</h2><span className="card__subtitle">Customer rates, effective dates and quantity tiers in each list’s currency.</span></div><button className="btn btn--sm btn--accent" disabled={!canWrite || !pricing} onClick={() => open()}><Plus size={14} /> New price list</button></div>
    <div className="invoice-commerce-grid">{(workspace.priceLists ?? []).map(list => { const profile = pricing?.profiles.find(row => row.priceListId === list._id); return <div className="invoice-template-card" key={list._id}><h3>{list.name}</h3><p className="muted">{list.currency} · {list.entries.length} rates · {profile?.tiers.length ?? 0} quantity tiers{list.active ? "" : " · Inactive"}</p>{(profile?.validFrom || profile?.validTo) && <p>Effective {profile.validFrom || "any date"} through {profile.validTo || "any date"}</p>}
      {list.entries.slice(0,3).map(entry => <p key={entry.catalogItemId}>{workspace.catalog.find(item => item._id === entry.catalogItemId)?.name ?? "Archived item"} · <Money cents={entry.unitPriceCents} currency={list.currency} /></p>)}
      <button className="btn btn--sm" disabled={!canWrite || !pricing} onClick={() => open(list)}>Edit price list</button></div>; })}
      {!workspace.priceLists?.length && <p className="muted">Add catalog items first, then save rates for retail, members, trade customers, or another currency.</p>}</div>
    <div className="card__body"><h3>Customer assignments</h3><p className="muted">The builder selects the assigned list when its dates and currency match. Explicitly entered rates are preserved.</p>{customers.map(customer => <Field key={customer.key} label={customer.name}><Select disabled={!canWrite || !pricing || busy} value={pricing?.assignments.find(row => row.active && row.partyKey === customer.key)?.priceListId ?? ""} options={[{value:"",label:"Catalog rates"},...(workspace.priceLists ?? []).map(list => ({value:list._id,label:`${list.name} (${list.currency})${list.active ? "" : " · Inactive"}`}))]} onChange={async priceListId => { setBusy(true); try { await assign({societyId,partyKey:customer.key,priceListId:priceListId || null}); toast.success("Customer pricing saved"); } catch(e) { toast.error("Could not assign price list",e instanceof Error ? e.message : undefined); } finally { setBusy(false); } }} /></Field>)}{customers.length === 0 && <p className="muted">Create a customer or member, or invoice a one-off customer, to assign pricing here. You can also select a price list directly in the builder.</p>}</div>
    <Drawer open={Boolean(draft)} title="Price list" onClose={() => !busy && setDraft(null)} footer={<><button className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button className="btn btn--accent" disabled={!canWrite || busy} onClick={() => void submit()}>Save price list</button></>}>
      {error && <p className="field__error" role="alert">{error}</p>}{draft && <div className="form-stack">
        <Field label="Name"><input className="input" value={draft.name} onChange={e => setDraft({...draft,name:e.target.value})} placeholder="e.g. Trade customer rates" /></Field>
        <Field label="Currency"><Select value={draft.currency} onChange={currency => setDraft({...draft,currency})} options={INVOICE_CURRENCIES.map(value => ({value,label:value}))} /></Field>
        <Checkbox label="Active" checked={draft.active} onChange={active => setDraft({...draft,active})} />
        <div className="invoice-view-grid"><Field label="Effective from"><input className="input" type="date" value={draft.validFrom} onChange={e => setDraft({...draft,validFrom:e.target.value})} /></Field><Field label="Effective through"><input className="input" type="date" value={draft.validTo} onChange={e => setDraft({...draft,validTo:e.target.value})} /></Field></div>
        <p className="muted">Leave a rate blank to use the catalog rate when its currency matches. The highest quantity threshold reached takes precedence. Saved invoices retain their rates.</p>
        {workspace.catalog.filter(item => item.active || draft.rates[item._id] !== undefined).map(item => <Field key={item._id} label={`${item.name} / ${item.unit ?? "each"} (${draft.currency})`}><input className="input num" inputMode="decimal" value={draft.rates[item._id] ?? ""} placeholder="Use catalog rate" onChange={e => setDraft({...draft,rates:{...draft.rates,[item._id]:e.target.value}})} /></Field>)}
        <h3>Quantity tiers</h3>{draft.tiers.map((tier,index) => <fieldset className="form-stack" key={index}><legend>Tier {index+1}</legend>
          <Field label="Tier item"><Select value={tier.catalogItemId} options={[{value:"",label:"Choose item"},...workspace.catalog.map(item => ({value:item._id,label:item.name}))]} onChange={catalogItemId => setDraft({...draft,tiers:draft.tiers.map((t,i) => i===index ? {...t,catalogItemId} : t)})} /></Field>
          <Field label="Minimum quantity"><input className="input" type="number" min="0.001" step="any" value={tier.minimumQuantity} onChange={e => setDraft({...draft,tiers:draft.tiers.map((t,i) => i===index ? {...t,minimumQuantity:e.target.value} : t)})} /></Field>
          <Field label="Tier rate"><input className="input" inputMode="decimal" value={tier.rate} onChange={e => setDraft({...draft,tiers:draft.tiers.map((t,i) => i===index ? {...t,rate:e.target.value} : t)})} /></Field><button className="btn btn--sm" onClick={() => setDraft({...draft,tiers:draft.tiers.filter((_,i) => i!==index)})}>Remove tier</button>
        </fieldset>)}<button className="btn" onClick={() => setDraft({...draft,tiers:[...draft.tiers,{catalogItemId:"",minimumQuantity:"",rate:""}]})}>Add quantity tier</button>
      </div>}
    </Drawer>
  </div>;
}

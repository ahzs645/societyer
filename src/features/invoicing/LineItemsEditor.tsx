import { ArrowDown, ArrowUp, BookOpen, Plus, Trash2 } from "lucide-react";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { Select } from "../../components/Select";
import { formatMoney, parseMoneyInput } from "../../lib/money";
import { cleanInvoiceLineDetails } from "../../../shared/invoiceLineDetails";
import { lineAmountCents, type InvoiceLine } from "../../../shared/invoicing";
import { TagPicker } from "../financials/transactions/TagPicker";
import type { FinanceTagsApi } from "../financials/transactions/useFinanceTags";
import type { CatalogItem } from "./types";

export type LineDraft = InvoiceLine & { qtyInput: string; priceInput: string };

const TAX_PRESETS: Array<{ label: string; rate: number }> = [
  { label: "GST", rate: 5 },
  { label: "HST", rate: 13 },
  { label: "HST", rate: 14 },
  { label: "HST", rate: 15 },
  { label: "PST", rate: 7 },
  { label: "QST", rate: 9.975 },
];

let lineCounter = 0;
const newKey = () => `line_${Date.now().toString(36)}_${(lineCounter += 1)}`;

export function toLineDraft(line: InvoiceLine): LineDraft {
  return { ...line, key: line.key || newKey(), qtyInput: String(line.quantity), priceInput: (line.unitPriceCents / 100).toFixed(2) };
}

export function lineFromCatalog(item: CatalogItem): LineDraft {
  return toLineDraft({
    ...cleanInvoiceLineDetails(item),
    rateOverridden: false,
    key: newKey(),
    catalogItemId: item._id,
    item: item.name,
    description: item.description,
    sku: item.sku,
    quantity: 1,
    unit: item.unit ?? "each",
    unitPriceCents: item.unitPriceCents,
    taxRatePercent: item.taxRatePercent,
    taxLabel: item.taxLabel,
  });
}

export function blankLine(): LineDraft {
  return { key: newKey(), item: "", quantity: 1, unitPriceCents: 0, qtyInput: "1", priceInput: "" };
}

type Props = {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  catalog: CatalogItem[];
  currency?: string;
  getCatalogRate?: (line: InvoiceLine, quantity: number) => number | null;
  onSaveItem?: (line: LineDraft) => Promise<void>;
  readOnly: boolean;
  /** Show the "add your GST/HST number" hint (taxed lines, no number on file). */
  gstHint: boolean;
  /** Reporting tags; each line's tags go onto its revenue line in the books. */
  tags?: FinanceTagsApi;
};

/** Line items: add from the catalog, quantity × price, per-line tax and tags, reorder and remove. */
export function LineItemsEditor({ lines, onChange, catalog, readOnly, gstHint, tags, currency = "CAD", onSaveItem, getCatalogRate }: Props) {
  const showTags = Boolean(tags?.loaded && (tags.activeGroups.some((group) => group.tags.length > 0) || lines.some((line) => line.tagIds?.length)));
  const updateLine = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const moveLine = (index: number, delta: number) => {
    const next = [...lines];
    const [line] = next.splice(index, 1);
    next.splice(index + delta, 0, line);
    onChange(next);
  };

  const taxOptions = (line: LineDraft) => {
    const options = [{ value: "none", label: "No tax" }, ...TAX_PRESETS.map((tax) => ({ value: `${tax.label}|${tax.rate}`, label: `${tax.label} ${tax.rate}%` }))];
    const current = line.taxRatePercent ? `${line.taxLabel ?? "Tax"}|${line.taxRatePercent}` : "none";
    if (!options.some((option) => option.value === current)) options.push({ value: current, label: `${line.taxLabel ?? "Tax"} ${line.taxRatePercent}%` });
    return { options, current };
  };

  return (
    <section className="invoice-builder__section" aria-labelledby="ib-lines">
      <div className="invoice-builder__heading-row">
        <h2 id="ib-lines" className="invoice-builder__heading">Line items</h2>
        {!readOnly && (
          <div className="invoice-builder__add">
            {catalog.length > 0 && (
              <Menu
                align="right"
                minWidth={260}
                trigger={
                  <button type="button" className="btn btn--sm">
                    <BookOpen size={14} aria-hidden="true" /> From catalog
                  </button>
                }
                sections={[{
                  id: "catalog",
                  items: catalog.map((item) => ({
                    id: item._id,
                    label: item.name,
                    hint: `${formatMoney(item.unitPriceCents, { currency })} / ${item.unit ?? "each"}`,
                    onSelect: () => onChange([...lines.filter((line) => line.item || line.unitPriceCents), lineFromCatalog(item)]),
                  })),
                }]}
              />
            )}
            <button type="button" className="btn btn--sm" onClick={() => onChange([...lines, blankLine()])}>
              <Plus size={14} aria-hidden="true" /> Add line
            </button>
          </div>
        )}
      </div>
      <ol className="line-editor">
        {lines.map((line, index) => {
          const tax = taxOptions(line);
          const priceInvalid = line.priceInput.trim() !== "" && parseMoneyInput(line.priceInput) == null;
          return (
            <li key={line.key} className="line-editor__row">
              <div className="line-editor__main">
                <label className="line-editor__field line-editor__field--item">
                  <span className="field__label">Item</span>
                  <input className="input" value={line.item} disabled={readOnly} placeholder="What you're billing for" onChange={(e) => updateLine(line.key, { item: e.target.value, catalogItemId: undefined })} />
                </label>
                <label className="line-editor__field line-editor__field--desc">
                  <span className="field__label">Description</span>
                  <input className="input" value={line.description ?? ""} disabled={readOnly} placeholder="Optional" onChange={(e) => updateLine(line.key, { description: e.target.value })} />
                </label>
                <label className="line-editor__field"><span className="field__label">SKU</span><input className="input" value={line.sku ?? ""} disabled={readOnly} placeholder="Optional" onChange={(e) => updateLine(line.key, { sku: e.target.value })} /></label>
                <label className="line-editor__field"><span className="field__label">Unit</span><input className="input" value={line.unit ?? "each"} disabled={readOnly} onChange={(e) => updateLine(line.key, { unit: e.target.value })} placeholder="each / hour" /></label>
                <details className="line-editor__field"><summary>Item details and tax mode</summary><div className="form-stack">
                  <label>Tax mode<Select value={line.taxMode??"invoice"} disabled={readOnly} onChange={value=>updateLine(line.key,{taxMode:value==="invoice"?undefined:value as "inclusive"|"exclusive"})} options={[{value:"invoice",label:"Use invoice tax mode"},{value:"exclusive",label:"Tax exclusive"},{value:"inclusive",label:"Tax inclusive"}]}/></label>
                  {(["manufacturer","partNumber","upc","ean","isbn","customField","batchNumber"] as const).map(key=><label key={key}>{({manufacturer:"Manufacturer",partNumber:"Part number",upc:"UPC",ean:"EAN",isbn:"ISBN",customField:"Custom detail",batchNumber:"Batch number"})[key]}<input className="input" disabled={readOnly} value={line[key]??""} onChange={event=>updateLine(line.key,{[key]:event.target.value})}/></label>)}
                  <label>Serial numbers (one per line)<textarea className="input textarea" disabled={readOnly} value={line.serialNumbers?.join("\n")??""} onChange={event=>updateLine(line.key,{serialNumbers:event.target.value.split(/\r?\n/)})}/></label>
                  <label>Item image<input className="input" type="file" accept="image/png,image/jpeg" disabled={readOnly} onChange={async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>100000){window.alert("Choose an item image smaller than 100 KB.");return;}const reader=new FileReader();reader.onload=()=>{try{updateLine(line.key,cleanInvoiceLineDetails({imageUrl:String(reader.result)}));}catch(error){window.alert(error instanceof Error?error.message:"Invalid image");}};reader.readAsDataURL(file);}}/></label>
                  {line.imageUrl&&<><img src={line.imageUrl} width={64} alt="Item"/><button type="button" className="btn btn--sm" disabled={readOnly} onClick={()=>updateLine(line.key,{imageUrl:undefined})}>Remove image</button></>}
                  {line.rateOverridden&&getCatalogRate&&line.catalogItemId&&<button className="btn btn--sm" type="button" disabled={readOnly} onClick={()=>{const rate=getCatalogRate(line,line.quantity);if(rate!==null)updateLine(line.key,{rateOverridden:false,unitPriceCents:rate,priceInput:(rate/100).toFixed(2)});}}>Use current price-list rate</button>}
                </div></details>
                {onSaveItem && !line.catalogItemId && line.item.trim() && !readOnly && <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onSaveItem(line)}><BookOpen size={14} /> Save to catalog</button>}
                {showTags && tags && (
                  <div className="line-editor__field line-editor__field--tags">
                    <span className="field__label">Tags</span>
                    <TagPicker tagIds={line.tagIds} tags={tags} disabled={readOnly} onChange={(next) => updateLine(line.key, { tagIds: next.length ? next : undefined })} />
                  </div>
                )}
              </div>
              <div className="line-editor__nums">
                <label className="line-editor__field line-editor__field--qty">
                  <span className="field__label">Qty</span>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={line.qtyInput}
                    disabled={readOnly}
                    onChange={(e) => {
                      const quantity = Number(e.target.value);
                      const rate = !line.rateOverridden && getCatalogRate ? getCatalogRate(line, quantity) : null;
                      updateLine(line.key, { qtyInput: e.target.value, quantity: Number.isFinite(quantity) ? quantity : 0, ...(rate !== null ? {unitPriceCents:rate,priceInput:(rate/100).toFixed(2)} : {}) });
                    }}
                  />
                </label>
                <label className="line-editor__field line-editor__field--price">
                  <span className="field__label">Rate ({currency})</span>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={line.priceInput}
                    aria-invalid={priceInvalid || undefined}
                    disabled={readOnly}
                    placeholder="0.00"
                    onChange={(e) => updateLine(line.key, { priceInput: e.target.value, unitPriceCents: parseMoneyInput(e.target.value) ?? 0, rateOverridden: true })}
                    onBlur={() => !priceInvalid && line.priceInput && updateLine(line.key, { priceInput: (line.unitPriceCents / 100).toFixed(2) })}
                  />
                </label>
                <div className="line-editor__field line-editor__field--tax">
                  <span className="field__label">Tax</span>
                  <Select
                    value={tax.current}
                    disabled={readOnly}
                    aria-label={`Tax for line ${index + 1}`}
                    onChange={(value) => {
                      if (value === "none") updateLine(line.key, { taxRatePercent: undefined, taxLabel: undefined });
                      else {
                        const [label, rate] = value.split("|");
                        updateLine(line.key, { taxLabel: label, taxRatePercent: Number(rate) });
                      }
                    }}
                    options={tax.options}
                  />
                </div>
                <div className="line-editor__amount">
                  <span className="field__label">Amount</span>
                  <Money cents={lineAmountCents(line)} currency={currency} />
                </div>
              </div>
              {!readOnly && (
                <div className="line-editor__tools">
                  <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Move line ${index + 1} up`} disabled={index === 0} onClick={() => moveLine(index, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Move line ${index + 1} down`} disabled={index === lines.length - 1} onClick={() => moveLine(index, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => onChange(lines.filter((row) => row.key !== line.key))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {gstHint && (
        <p className="invoice-builder__hint">
          Charging GST/HST? Add your registration number under Organization details (identifiers) so it prints on the invoice.
        </p>
      )}
    </section>
  );
}

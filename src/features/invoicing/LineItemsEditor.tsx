import { useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { Select } from "../../components/Select";
import { decodeTaxChoice, encodeTaxChoice, INVOICE_TAX_CHOICES, taxChoiceLabel } from "../../../shared/invoiceMoney";
import { FinalPriceButton } from "./FinalPricePanel";
import { useToast } from "../../components/Toast";
import { formatMoney, parseMoneyInput } from "../../lib/money";
import { INVOICE_LINE_DETAIL_KEYS, INVOICE_LINE_DETAIL_LABELS, cleanInvoiceLineDetails } from "../../../shared/invoiceLineDetails";
import { lineAmountCents, type InvoiceLine } from "../../../shared/invoicing";
import { TagPicker } from "../financials/transactions/TagPicker";
import type { FinanceTagsApi } from "../financials/transactions/useFinanceTags";
import { CatalogItemEditor, type CatalogItemSeed } from "./CatalogItemEditor";
import type { CatalogItem } from "./types";
import type { InvoiceOrganization } from "./types";
import { assessTax, taxAssessmentForTransaction, taxAssessmentProblem } from "../../../shared/tax";
import { TaxAssessmentEditor } from "./TaxAssessmentEditor";

export type LineDraft = InvoiceLine & { qtyInput: string; priceInput: string };

let lineCounter = 0;
const newKey = () => `line_${Date.now().toString(36)}_${(lineCounter += 1)}`;

export function toLineDraft(line: InvoiceLine): LineDraft {
  return { ...line, key: line.key || newKey(), qtyInput: String(line.quantity), priceInput: line.unitPriceCents ? (line.unitPriceCents / 100).toFixed(2) : "" };
}

export function lineFromCatalog(item: CatalogItem): LineDraft {
  return toLineDraft({
    taxAssessment: taxAssessmentForTransaction(item.taxAssessment),
    ...cleanInvoiceLineDetails(item),
    // An open price is the user's to enter, so re-pricing must leave it alone.
    rateOverridden: Boolean(item.openPrice),
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
    additionalTaxes: item.additionalTaxes,
  });
}

export function blankLine(): LineDraft {
  return { key: newKey(), item: "", quantity: 1, unitPriceCents: 0, qtyInput: "1", priceInput: "" };
}

type Props = {
  assessmentDate?: string;
  assessmentContext?: string;
  organization?: InvoiceOrganization;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  catalog: CatalogItem[];
  currency?: string;
  getCatalogRate?: (line: InvoiceLine, quantity: number) => number | null;
  /** Lets items be added to the catalog from here, in the document's currency. */
  catalogEditing?: { societyId: string; canWrite: boolean; asModal?: boolean };
  readOnly: boolean;
  /** Show the "add your GST/HST number" hint (taxed lines, no number on file). */
  gstHint: boolean;
  /** Reporting tags; each line's tags go onto its revenue line in the books. */
  tags?: FinanceTagsApi;
};

/** A line with anything filled in behind "More details" shows it, so nothing is hidden from view. */
const hasLineDetails = (line: LineDraft) => Boolean(line.sku || (line.unit && line.unit !== "each") || line.taxMode || line.serialNumbers?.length || line.imageUrl || line.tagIds?.length || INVOICE_LINE_DETAIL_KEYS.some((key) => line[key]));

/** Line items: add from the catalog, quantity × price, per-line tax and tags, reorder and remove. */
export function LineItemsEditor({ lines, onChange, catalog, readOnly, gstHint, tags, currency = "CAD", catalogEditing, getCatalogRate, assessmentDate = new Date().toISOString().slice(0, 10), assessmentContext, organization }: Props) {
  const toast = useToast();
  const [detailKeys, setDetailKeys] = useState<{ openKeys: Set<string>; closedKeys: Set<string> }>({ openKeys: new Set(), closedKeys: new Set() });
  const showTags = Boolean(tags?.loaded && (tags.activeGroups.some((group) => group.tags.length > 0) || lines.some((line) => line.tagIds?.length)));
  const updateLine = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const [newItem, setNewItem] = useState<{ seed: CatalogItemSeed; lineKey?: string } | null>(null);
  const hasContent = (line: LineDraft) => Boolean(line.item || line.unitPriceCents);
  const addFromCatalog = (item: CatalogItem) => onChange([...lines.filter(hasContent), lineFromCatalog(item)]);
  const saveLineToCatalog = (line: LineDraft) => setNewItem({
    lineKey: line.key,
    seed: { ...cleanInvoiceLineDetails(line), name: line.item, description: line.description, sku: line.sku, unit: line.unit, unitPriceCents: line.unitPriceCents || undefined, taxRatePercent: line.taxRatePercent, taxLabel: line.taxLabel, additionalTaxes: line.additionalTaxes, currency, taxAssessment: line.taxAssessment ? assessTax({ ...line.taxAssessment.answers, scope: "catalog", customerRelief: "none", customerEvidence: "", purchaserPstNumber: "", pstReliefDocumentation: "unknown", pstReliefConditions: "unknown", pstCertificateType: "" }, false) : undefined },
  });
  const onItemSaved = (item: CatalogItem) => {
    if (!newItem?.lineKey) return addFromCatalog(item);
    onChange(lines.map((line) => {
      if (line.key !== newItem.lineKey) return line;
      if (item.openPrice) return { ...lineFromCatalog(item), key: line.key, quantity: line.quantity, qtyInput: line.qtyInput, priceInput: line.priceInput, unitPriceCents: line.unitPriceCents, tagIds: line.tagIds, rateOverridden: true };
      return { ...lineFromCatalog(item), key: line.key, quantity: line.quantity, qtyInput: line.qtyInput, tagIds: line.tagIds };
    }));
  };
  const setPriceFor = (line: LineDraft) => {
    const item = catalog.find((row) => row._id === line.catalogItemId);
    if (!line.catalogItemId || item?.openPrice) return null;
    return getCatalogRate ? getCatalogRate(line, line.quantity) : item?.unitPriceCents ?? null;
  };
  const moveLine = (index: number, delta: number) => {
    const next = [...lines];
    const [line] = next.splice(index, 1);
    next.splice(index + delta, 0, line);
    onChange(next);
  };

  const attachImage = (key: string, file?: File) => {
    if (!file) return;
    if (file.size > 100000) { toast.error("Choose an item image smaller than 100 KB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { updateLine(key, cleanInvoiceLineDetails({ imageUrl: String(reader.result) })); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Invalid image"); }
    };
    reader.readAsDataURL(file);
  };
  const taxOptions = (line: LineDraft) => {
    const options = [...INVOICE_TAX_CHOICES];
    const current = encodeTaxChoice(line);
    if (!options.some((option) => option.value === current)) options.push({ value: current, label: taxChoiceLabel(line) });
    return { options, current };
  };

  return (
    <section className="invoice-builder__section" aria-labelledby="ib-lines">
      <div className="invoice-builder__heading-row">
        <h2 id="ib-lines" className="invoice-builder__heading">Line items</h2>
      </div>
      <ol className="line-editor">
        {lines.map((line, index) => {
          const tax = taxOptions(line);
          const detailsOpen = !detailKeys.closedKeys.has(line.key) && (detailKeys.openKeys.has(line.key) || hasLineDetails(line));
          const priceInvalid = line.priceInput.trim() !== "" && parseMoneyInput(line.priceInput) == null;
          const openPrice = catalog.find((row) => row._id === line.catalogItemId)?.openPrice;
          const setPrice = setPriceFor(line);
          const overridden = setPrice !== null && Boolean(line.rateOverridden) && setPrice !== line.unitPriceCents;
          return (
            <li key={line.key} className="line-editor__row">
              <div className="line-editor__main">
                <label className="line-editor__field line-editor__field--item">
                  <span className="field__label">Item</span>
                  <input className="input" value={line.item} disabled={readOnly} placeholder="What you're billing for" onChange={(e) => updateLine(line.key, { item: e.target.value, catalogItemId: undefined, ...(line.taxAssessment ? { taxAssessment: { ...line.taxAssessment, confirmed: false } } : {}) })} />
                </label>
                <label className="line-editor__field line-editor__field--desc">
                  <span className="field__label">Description</span>
                  <input className="input" value={line.description ?? ""} disabled={readOnly} placeholder="Optional" onChange={(e) => updateLine(line.key, { description: e.target.value })} />
                </label>
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
                  <span className="field__label">Price ({currency})</span>
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
                      updateLine(line.key, { ...decodeTaxChoice(value), taxAssessment: undefined });
                    }}
                    options={tax.options}
                  />
                </div>
                <div className="line-editor__amount">
                  <span className="field__label">Amount</span>
                  <Money cents={lineAmountCents(line)} currency={currency} />
                </div>
              </div>
              <TaxAssessmentEditor value={line.taxAssessment} scope="transaction" date={assessmentDate} contextKey={JSON.stringify([assessmentContext, line.item, line.catalogItemId, currency])} organization={organization} disabled={readOnly} onApply={(taxAssessment, rates) => updateLine(line.key, { taxAssessment, ...rates })} />
              {line.taxAssessment && taxAssessmentProblem(line, assessmentDate) && <p className="line-editor__price-note">{taxAssessmentProblem(line, assessmentDate)}</p>}
              <div className="line-editor__actions">
                <FinalPriceButton line={line} currency={currency} disabled={readOnly} onApply={(unitPriceCents) => updateLine(line.key, { unitPriceCents, priceInput: (unitPriceCents / 100).toFixed(2), rateOverridden: true })} />
                {catalogEditing && !line.catalogItemId && line.item.trim() && !readOnly && <button type="button" className="btn btn--ghost btn--sm" disabled={!catalogEditing.canWrite} onClick={() => saveLineToCatalog(line)}><BookOpen size={14} aria-hidden="true" /> Save to catalog</button>}
                <button type="button" className="btn btn--ghost btn--sm" aria-expanded={detailsOpen} onClick={() => setDetailKeys((current) => { const next = new Set(current.openKeys); const hide = new Set(current.closedKeys); if (detailsOpen) { next.delete(line.key); hide.add(line.key); } else { next.add(line.key); hide.delete(line.key); } return { openKeys: next, closedKeys: hide }; })}>More details <ChevronDown size={14} aria-hidden="true" className={detailsOpen ? "line-editor__chevron is-open" : "line-editor__chevron"} /></button>
                {!readOnly && lines.length > 1 && (
                  <div className="line-editor__tools">
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Move line ${index + 1} up`} disabled={index === 0} onClick={() => moveLine(index, -1)}><ArrowUp size={14} /></button>
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Move line ${index + 1} down`} disabled={index === lines.length - 1} onClick={() => moveLine(index, 1)}><ArrowDown size={14} /></button>
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Remove line ${index + 1}`} onClick={() => onChange(lines.filter((row) => row.key !== line.key))}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              {openPrice && !line.unitPriceCents && <p className="line-editor__price-note">No set price. Enter the amount for this invoice.</p>}
              {setPrice !== null && !overridden && <p className="line-editor__price-note">Set price. Change it here to override it on this invoice only.</p>}
              {overridden && !readOnly && (
                <p className="line-editor__price-note">
                  Overridden on this invoice. The set price is <Money cents={setPrice} currency={currency} />.{" "}
                  <button type="button" className="line-editor__price-reset" onClick={() => updateLine(line.key, { rateOverridden: false, unitPriceCents: setPrice, priceInput: (setPrice / 100).toFixed(2) })}>Use set price</button>
                </p>
              )}
              {detailsOpen && (
                <div className="line-editor__more">
                  <label className="line-editor__field"><span className="field__label">SKU</span><input className="input" value={line.sku ?? ""} disabled={readOnly} placeholder="Optional" onChange={(e) => updateLine(line.key, { sku: e.target.value })} /></label>
                  <label className="line-editor__field"><span className="field__label">Unit</span><input className="input" value={line.unit ?? "each"} disabled={readOnly} onChange={(e) => updateLine(line.key, { unit: e.target.value })} placeholder="each / hour" /></label>
                  <label className="line-editor__field"><span className="field__label">Price entered</span><Select value={line.taxMode ?? "invoice"} disabled={readOnly} onChange={(value) => updateLine(line.key, { taxMode: value === "invoice" ? undefined : value as "inclusive" | "exclusive" })} options={[{ value: "invoice", label: "Same as invoice" }, { value: "exclusive", label: "Before tax" }, { value: "inclusive", label: "Tax included" }]} /></label>
                  {INVOICE_LINE_DETAIL_KEYS.map((key) => <label key={key} className="line-editor__field"><span className="field__label">{INVOICE_LINE_DETAIL_LABELS[key]}</span><input className="input" disabled={readOnly} value={line[key] ?? ""} onChange={(event) => updateLine(line.key, { [key]: event.target.value })} /></label>)}
                  <label className="line-editor__field line-editor__field--wide"><span className="field__label">Serial numbers (one per line)</span><textarea className="input textarea" disabled={readOnly} value={line.serialNumbers?.join("\n") ?? ""} onChange={(event) => updateLine(line.key, { serialNumbers: event.target.value.split(/\r?\n/) })} /></label>
                  <label className="line-editor__field line-editor__field--wide"><span className="field__label">Item image</span><input className="input" type="file" accept="image/png,image/jpeg" disabled={readOnly} onChange={(event) => attachImage(line.key, event.target.files?.[0])} /></label>
                  {line.imageUrl && <div className="line-editor__field--wide btn-row"><img src={line.imageUrl} width={64} alt="Item" /><button type="button" className="btn btn--sm" disabled={readOnly} onClick={() => updateLine(line.key, { imageUrl: undefined })}>Remove image</button></div>}
                  {showTags && tags && (
                    <div className="line-editor__field line-editor__field--tags">
                      <span className="field__label">Tags</span>
                      <TagPicker tagIds={line.tagIds} tags={tags} disabled={readOnly} onChange={(next) => updateLine(line.key, { tagIds: next.length ? next : undefined })} />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <div className="invoice-builder__add">
          {(catalog.length > 0 || catalogEditing) && (
            <Menu
              minWidth={260}
              trigger={
                <button type="button" className="btn btn--sm">
                  <BookOpen size={14} aria-hidden="true" /> From catalog
                </button>
              }
              sections={[
                {
                  id: "catalog",
                  items: catalog.map((item) => ({
                    id: item._id,
                    label: item.name,
                    hint: item.openPrice ? "No set price" : `${formatMoney(item.unitPriceCents, { currency })} / ${item.unit ?? "each"}`,
                    onSelect: () => addFromCatalog(item),
                  })),
                },
                ...(catalogEditing ? [{
                  id: "new",
                  items: [{ id: "new-item", label: "New item or service", icon: <Plus size={14} />, disabled: !catalogEditing.canWrite, onSelect: () => setNewItem({ seed: { currency } }) }],
                }] : []),
              ]}
            />
          )}
          <button type="button" className="btn btn--sm" onClick={() => onChange([...lines, blankLine()])}>
            <Plus size={14} aria-hidden="true" /> Add line
          </button>
        </div>
      )}
      {gstHint && (
        <p className="invoice-builder__hint">
          Charging GST/HST? Add your registration number under Organization details (identifiers) so it prints on the invoice.
        </p>
      )}
      {catalogEditing && (
        <CatalogItemEditor
          item={newItem?.seed ?? null}
          societyId={catalogEditing.societyId}
          canWrite={catalogEditing.canWrite}
          defaultCurrency={currency}
          assessmentDate={assessmentDate}
          organization={organization}
          lockCurrency
          asModal={catalogEditing.asModal}
          onClose={() => setNewItem(null)}
          onSaved={onItemSaved}
        />
      )}
    </section>
  );
}

import { ArrowDown, ArrowUp, BookOpen, Plus, Trash2 } from "lucide-react";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { Select } from "../../components/Select";
import { formatMoney, parseMoneyInput } from "../../lib/money";
import { lineAmountCents, type InvoiceLine } from "../../../shared/invoicing";
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
    key: newKey(),
    catalogItemId: item._id,
    item: item.name,
    description: item.description,
    quantity: 1,
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
  readOnly: boolean;
  /** Show the "add your GST/HST number" hint (taxed lines, no number on file). */
  gstHint: boolean;
};

/** Line items: add from the catalog, quantity × price, per-line tax, reorder and remove. */
export function LineItemsEditor({ lines, onChange, catalog, readOnly, gstHint }: Props) {
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
                    hint: formatMoney(item.unitPriceCents),
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
                      updateLine(line.key, { qtyInput: e.target.value, quantity: Number.isFinite(quantity) ? quantity : 0 });
                    }}
                  />
                </label>
                <label className="line-editor__field line-editor__field--price">
                  <span className="field__label">Price</span>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={line.priceInput}
                    aria-invalid={priceInvalid || undefined}
                    disabled={readOnly}
                    placeholder="0.00"
                    onChange={(e) => updateLine(line.key, { priceInput: e.target.value, unitPriceCents: parseMoneyInput(e.target.value) ?? 0 })}
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
                  <Money cents={lineAmountCents(line)} />
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

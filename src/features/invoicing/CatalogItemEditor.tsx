import { useState } from "react";
import { useMutation } from "convex/react";
import { Checkbox } from "../../components/Controls";
import { Modal } from "../../components/Modal";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { Drawer, Field } from "../../components/ui";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { parseMoneyInput } from "../../lib/money";
import { INVOICE_CURRENCIES } from "../../../shared/invoiceCommerce";
import { INVOICE_LINE_DETAIL_KEYS, INVOICE_LINE_DETAIL_LABELS, cleanInvoiceLineDetails } from "../../../shared/invoiceLineDetails";
import type { CatalogItem } from "./types";

export const TAX_CHOICES = [
  { value: "none", label: "No tax" },
  { value: "GST|5", label: "GST 5%" },
  { value: "HST|13", label: "HST 13%" },
  { value: "HST|14", label: "HST 14%" },
  { value: "HST|15", label: "HST 15%" },
  { value: "PST|7", label: "PST 7%" },
  { value: "QST|9.975", label: "QST 9.975%" },
];

/** A saved item to edit, or the starting values of a new one. */
export type CatalogItemSeed = Partial<Omit<CatalogItem, "unitPriceCents">> & { unitPriceCents?: number };

type Details = ReturnType<typeof cleanInvoiceLineDetails>;
type Draft = Details & { name: string; description: string; priceInput: string; openPrice: boolean; tax: string; category: string; active: boolean; kind: "item" | "service"; sku: string; unit: string; currency: string };

function toDraft(item: CatalogItemSeed, defaultCurrency: string): Draft {
  return {
    ...cleanInvoiceLineDetails(item),
    kind: item.kind ?? "item",
    sku: item.sku ?? "",
    unit: item.unit ?? "each",
    currency: item.currency ?? defaultCurrency,
    name: item.name ?? "",
    description: item.description ?? "",
    openPrice: item.openPrice ?? false,
    priceInput: item.openPrice || item.unitPriceCents == null ? "" : (item.unitPriceCents / 100).toFixed(2),
    tax: item.taxRatePercent ? `${item.taxLabel ?? "Tax"}|${item.taxRatePercent}` : "none",
    category: item.category ?? "",
    active: item.active ?? true,
  };
}

type Props = {
  /** The item to edit or start from; null keeps the editor closed. */
  item: CatalogItemSeed | null;
  societyId: string;
  canWrite: boolean;
  defaultCurrency: string;
  /** Adding from an invoice: the item must be in that invoice's currency. */
  lockCurrency?: boolean;
  /** Opened from inside another drawer, where a second drawer can't stack. */
  asModal?: boolean;
  onClose: () => void;
  onSaved?: (item: CatalogItem) => void;
};

/** The one add and edit form for items and services, on the catalog tab and on invoices, quotes and repairs. */
export function CatalogItemEditor({ item, ...props }: Props) {
  return item ? <CatalogItemForm key={item._id ?? "new"} item={item} {...props} /> : null;
}

function CatalogItemForm({ item, societyId, canWrite, defaultCurrency, lockCurrency, asModal, onClose, onSaved }: Props & { item: CatalogItemSeed }) {
  const upsert = useMutation(api.invoices.upsertCatalogItem);
  const toast = useToast();
  const [draft, setDraft] = useState(() => toDraft(item, defaultCurrency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = async () => {
    const cents = draft.openPrice ? 0 : parseMoneyInput(draft.priceInput);
    if (!draft.name.trim()) return setError("Give the item a name.");
    if (cents == null || cents < 0) return setError("Enter a price of zero or more.");
    const [taxLabel, rate] = draft.tax === "none" ? [undefined, undefined] : draft.tax.split("|");
    const { rateOverridden: _override, ...details } = cleanInvoiceLineDetails(draft);
    const fields = {
      ...details,
      name: draft.name.trim(),
      kind: draft.kind,
      sku: draft.sku || undefined,
      unit: draft.unit,
      currency: draft.currency,
      description: draft.description || undefined,
      unitPriceCents: cents,
      openPrice: draft.openPrice || undefined,
      taxRatePercent: rate ? Number(rate) : undefined,
      taxLabel,
      category: draft.category || undefined,
      active: draft.active,
    };
    setBusy(true);
    try {
      const id: string = await upsert({ ...fields, id: item._id as Id<"invoiceCatalogItems"> | undefined, societyId: societyId as Id<"societies"> });
      toast.success(item._id ? "Item saved" : "Item added to the catalog");
      onSaved?.({ ...fields, _id: id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the item.");
    } finally {
      setBusy(false);
    }
  };

  const attachImage = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 100000) return setError("Choose an image smaller than 100 KB.");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        update(cleanInvoiceLineDetails({ imageUrl: String(reader.result) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid image");
      }
    };
    reader.readAsDataURL(file);
  };

  const title = item._id ? "Edit catalog item" : "New catalog item";
  const footer = (
    <>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn--accent" disabled={!canWrite || busy} onClick={() => void save()}>Save</button>
    </>
  );
  const form = (
    <div>
      {error && <p className="field__error" role="alert">{error}</p>}
      <Field label="Name" required>
        <input className="input" value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="Main hall rental — full day" />
      </Field>
      <Field label="Description" hint="Printed under the item on invoices.">
        <textarea className="input textarea" rows={2} value={draft.description} onChange={(e) => update({ description: e.target.value })} />
      </Field>
      {!draft.openPrice && (
        <Field label={`Unit price (${draft.currency})`} required hint="Fills in on invoices, where it can still be changed.">
          <input className="input num" inputMode="decimal" value={draft.priceInput} placeholder="0.00" onChange={(e) => update({ priceInput: e.target.value })} />
        </Field>
      )}
      <div className="field">
        <Checkbox checked={draft.openPrice} onChange={(openPrice) => update({ openPrice })} label="No set price" hint="For one-time fees: enter the amount on each invoice." />
      </div>
      <Field label="Type"><Select value={draft.kind} onChange={(kind) => update({ kind: kind as "item" | "service" })} options={[{ value: "item", label: "Item / part" }, { value: "service", label: "Service / labour" }]} /></Field>
      <Field label="SKU / code"><input className="input" value={draft.sku} onChange={(e) => update({ sku: e.target.value })} /></Field>
      <Field label="Unit"><input className="input" value={draft.unit} onChange={(e) => update({ unit: e.target.value })} placeholder="each / hour / day" /></Field>
      <Field label="Currency"><Select value={draft.currency} disabled={lockCurrency} onChange={(currency) => update({ currency })} options={INVOICE_CURRENCIES.map((value) => ({ value, label: value }))} /></Field>
      <Field label="Sales tax"><Select value={draft.tax} onChange={(tax) => update({ tax })} options={TAX_CHOICES} /></Field>
      <Field label="Rate tax mode"><Select value={draft.taxMode ?? "exclusive"} onChange={(value) => update({ taxMode: value as "exclusive" | "inclusive" })} options={[{ value: "exclusive", label: "Tax exclusive" }, { value: "inclusive", label: "Tax inclusive" }]} /></Field>
      <details>
        <summary>Manufacturer, identifiers, image and tracking</summary>
        <div className="form-stack">
          {INVOICE_LINE_DETAIL_KEYS.map((key) => <Field key={key} label={INVOICE_LINE_DETAIL_LABELS[key]}><input className="input" value={draft[key] ?? ""} onChange={(e) => update({ [key]: e.target.value })} /></Field>)}
          <Field label="Serial numbers"><textarea className="input textarea" value={draft.serialNumbers?.join("\n") ?? ""} onChange={(e) => update({ serialNumbers: e.target.value.split(/\r?\n/) })} /></Field>
          <Field label="Item image"><input className="input" type="file" accept="image/png,image/jpeg" onChange={(e) => attachImage(e.target.files?.[0])} /></Field>
          {draft.imageUrl && <><img src={draft.imageUrl} width={64} alt="Catalog item" /><button type="button" className="btn btn--sm" onClick={() => update({ imageUrl: undefined })}>Remove image</button></>}
        </div>
      </details>
      <Field label="Category" hint="For your records, e.g. Rental income or Sponsorship.">
        <input className="input" value={draft.category} onChange={(e) => update({ category: e.target.value })} />
      </Field>
    </div>
  );

  return asModal
    ? <Modal open onClose={onClose} title={title} size="md" footer={footer}>{form}</Modal>
    : <Drawer open onClose={onClose} title={title} footer={footer}>{form}</Drawer>;
}

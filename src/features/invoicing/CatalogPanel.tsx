import { useState } from "react";
import { useMutation } from "convex/react";
import { BookOpen, MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, EmptyState, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { parseMoneyInput } from "../../lib/money";
import type { CatalogItem } from "./types";

type Draft = { id?: string; name: string; description: string; priceInput: string; tax: string; category: string; active: boolean };

const TAX_CHOICES = [
  { value: "none", label: "No tax" },
  { value: "GST|5", label: "GST 5%" },
  { value: "HST|13", label: "HST 13%" },
  { value: "HST|14", label: "HST 14%" },
  { value: "HST|15", label: "HST 15%" },
  { value: "PST|7", label: "PST 7%" },
  { value: "QST|9.975", label: "QST 9.975%" },
];

function toDraft(item?: CatalogItem): Draft {
  return {
    id: item?._id,
    name: item?.name ?? "",
    description: item?.description ?? "",
    priceInput: item ? (item.unitPriceCents / 100).toFixed(2) : "",
    tax: item?.taxRatePercent ? `${item.taxLabel ?? "Tax"}|${item.taxRatePercent}` : "none",
    category: item?.category ?? "",
    active: item?.active ?? true,
  };
}

/** Reusable items (dues, rentals, fees, sponsorship levels) for the builder. */
export function CatalogPanel({ items, societyId, canWrite }: { items: CatalogItem[]; societyId: string; canWrite: boolean }) {
  const upsert = useMutation(api.invoices.upsertCatalogItem);
  const setActive = useMutation(api.invoices.setCatalogItemActive);
  const remove = useMutation(api.invoices.removeCatalogItem);
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!draft) return;
    const cents = parseMoneyInput(draft.priceInput);
    if (!draft.name.trim()) return setError("Give the item a name.");
    if (cents == null || cents < 0) return setError("Enter a price of zero or more.");
    const [taxLabel, rate] = draft.tax === "none" ? [undefined, undefined] : draft.tax.split("|");
    try {
      await upsert({
        id: draft.id as any,
        societyId: societyId as any,
        name: draft.name,
        description: draft.description || undefined,
        unitPriceCents: cents,
        taxRatePercent: rate ? Number(rate) : undefined,
        taxLabel,
        category: draft.category || undefined,
        active: draft.active,
      });
      toast.success(draft.id ? "Item saved" : "Item added to the catalog");
      setDraft(null);
    } catch (err: any) {
      setError(err?.message ?? "Could not save the item.");
    }
  };

  return (
    <div className="card invoice-card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Catalog</h2>
          <span className="card__subtitle">Items you bill often. Prices and tax fill in when you add them to an invoice.</span>
        </div>
        <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => { setError(null); setDraft(toDraft()); }}>
          <Plus size={14} aria-hidden="true" /> New item
        </button>
      </div>
      {items.length === 0 ? (
        <div className="card__body">
          <EmptyState icon={<BookOpen size={20} />} title="No catalog items yet" description="Add the fees, rentals and sponsorship levels you bill for, then pick them in the invoice builder." />
        </div>
      ) : (
        <table className="table table--comfortable invoice-table invoice-table--catalog">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th className="num">Price</th>
              <th>Tax</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id} className={item.active ? undefined : "is-muted"}>
                <td data-label="Item" className="invoice-table__primary">
                  <span className="invoice-table__name">{item.name}{!item.active && <> <Badge>Inactive</Badge></>}</span>
                  {item.description && <span className="muted invoice-table__sub">{item.description}</span>}
                </td>
                <td data-label="Category">{item.category ?? <span className="muted">—</span>}</td>
                <td data-label="Price" className="num"><Money cents={item.unitPriceCents} /></td>
                <td data-label="Tax">{item.taxRatePercent ? `${item.taxLabel ?? "Tax"} ${item.taxRatePercent}%` : <span className="muted">None</span>}</td>
                <td className="invoice-table__actions">
                  <Menu
                    align="right"
                    trigger={<button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${item.name}`}><MoreHorizontal size={14} /></button>}
                    sections={[{
                      id: "item",
                      items: [
                        { id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => { setError(null); setDraft(toDraft(item)); } },
                        { id: "active", label: item.active ? "Deactivate" : "Activate", icon: <Power size={14} />, disabled: !canWrite, onSelect: () => void setActive({ id: item._id as any, active: !item.active }).then(() => toast.success(item.active ? "Item deactivated" : "Item activated")) },
                        {
                          id: "delete",
                          label: "Delete",
                          icon: <Trash2 size={14} />,
                          destructive: true,
                          disabled: !canWrite,
                          onSelect: async () => {
                            const ok = await confirm({ title: `Delete ${item.name}?`, message: "Invoices that already use it keep their lines. Deactivate it instead to keep it for reference.", confirmLabel: "Delete item", tone: "danger" });
                            if (ok) await remove({ id: item._id as any }).then(() => toast.success("Item deleted"));
                          },
                        },
                      ],
                    }]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit catalog item" : "New catalog item"}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="btn btn--accent" disabled={!canWrite} onClick={() => void save()}>Save</button>
          </>
        }
      >
        {draft && (
          <div>
            {error && <p className="field__error" role="alert">{error}</p>}
            <Field label="Name" required>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Main hall rental — full day" />
            </Field>
            <Field label="Description" hint="Printed under the item on invoices.">
              <textarea className="input textarea" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <Field label="Unit price (CAD)" required>
              <input className="input num" inputMode="decimal" value={draft.priceInput} placeholder="0.00" onChange={(e) => setDraft({ ...draft, priceInput: e.target.value })} />
            </Field>
            <Field label="Sales tax">
              <Select value={draft.tax} onChange={(tax) => setDraft({ ...draft, tax })} options={TAX_CHOICES} />
            </Field>
            <Field label="Category" hint="For your records, e.g. Rental income or Sponsorship.">
              <input className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

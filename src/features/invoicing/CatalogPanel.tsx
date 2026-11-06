import { taxChoiceLabel } from "../../../shared/invoiceMoney";
import { useState } from "react";
import { useMutation } from "convex/react";
import { BookOpen, MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, EmptyState } from "../../components/ui";
import { Menu } from "../../components/Menu";
import { Money } from "../../components/Money";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { CatalogItemEditor, type CatalogItemSeed } from "./CatalogItemEditor";
import type { CatalogItem } from "./types";

/** Reusable items (dues, rentals, fees, sponsorship levels) for the builder. */
export function CatalogPanel({ items, societyId, canWrite, defaultCurrency }: { items: CatalogItem[]; societyId: string; canWrite: boolean; defaultCurrency: string }) {
  const setActive = useMutation(api.invoices.setCatalogItemActive);
  const remove = useMutation(api.invoices.removeCatalogItem);
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<CatalogItemSeed | null>(null);

  return (
    <div className="card invoice-card">
      <div className="card__head">
        <div>
          <h2 className="card__title">Items &amp; services</h2>
          <span className="card__subtitle">Set a price once and add it to any invoice, or leave the price open for one-time fees.</span>
        </div>
        <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite} onClick={() => setEditing({})}>
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
              <th>Type / SKU</th><th>Category</th>
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
                <td data-label="Type / SKU">{item.kind === "service" ? "Service" : "Item"}{item.sku ? ` · ${item.sku}` : ""}</td>
                <td data-label="Category">{item.category ?? <span className="muted">—</span>}</td>
                <td data-label="Price" className="num">{item.openPrice ? <span className="muted">Set on each invoice</span> : <><Money cents={item.unitPriceCents} currency={item.currency ?? defaultCurrency} /> {item.currency ?? defaultCurrency} / {item.unit ?? "each"}</>}</td>
                <td data-label="Tax">{item.taxRatePercent ? taxChoiceLabel(item) : <span className="muted">None</span>}</td>
                <td className="invoice-table__actions">
                  <Menu
                    align="right"
                    trigger={<button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${item.name}`}><MoreHorizontal size={14} /></button>}
                    sections={[{
                      id: "item",
                      items: [
                        { id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => setEditing(item) },
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

      <CatalogItemEditor item={editing} societyId={societyId} canWrite={canWrite} defaultCurrency={defaultCurrency} onClose={() => setEditing(null)} />
    </div>
  );
}

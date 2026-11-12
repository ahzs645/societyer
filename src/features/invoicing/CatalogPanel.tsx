import { taxChoiceLabel } from "../../../shared/invoiceMoney";
import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { BookOpen, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import { Badge, EmptyState } from "../../components/ui";
import { Money } from "../../components/Money";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { CatalogItemEditor, type CatalogItemSeed } from "./CatalogItemEditor";
import type { CatalogItem } from "./types";
import type { InvoiceOrganization } from "./types";
import { taxAssessmentSummary } from "../../../shared/tax";
import type { Id } from "../../../convex/_generated/dataModel";

const CATALOG_TABLE = staticRecordTable({
  id: "invoice-catalog",
  nameSingular: "catalogItem",
  namePlural: "catalogItems",
  labelSingular: "Item",
  labelPlural: "Items",
  labelIdentifierFieldName: "name",
  density: "comfortable",
  fields: [
    { name: "name", label: "Item", fieldType: FIELD_TYPES.TEXT, size: 260, config: { groupable: false } },
    { name: "kind", label: "Type", fieldType: FIELD_TYPES.SELECT, size: 110, config: { options: [{ value: "item", label: "Item", color: "gray" }, { value: "service", label: "Service", color: "blue" }] } },
    { name: "sku", label: "SKU", fieldType: FIELD_TYPES.TEXT, size: 120 },
    { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, size: 140 },
    // Items can be priced in different currencies, so the cell draws each item's own.
    { name: "unitPriceCents", label: "Price", fieldType: FIELD_TYPES.CURRENCY, size: 190, config: { isCents: true } },
    { name: "tax", label: "Tax", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "active", label: "Active", fieldType: FIELD_TYPES.BOOLEAN, size: 90, isVisible: false },
  ],
});

type CatalogRecord = {
  _id: string;
  name: string;
  kind: "item" | "service";
  sku: string;
  category: string;
  /** Empty for an open price, set on each invoice. */
  unitPriceCents: number | null;
  tax: string;
  active: boolean;
  item: CatalogItem;
};

/** Reusable items (dues, rentals, fees, sponsorship levels) for the builder. */
export function CatalogPanel({ items, societyId, canWrite, defaultCurrency, assessmentDate, organization }: { items: CatalogItem[]; societyId: string; canWrite: boolean; defaultCurrency: string; assessmentDate?: string; organization?: InvoiceOrganization }) {
  const setActive = useMutation(api.invoices.setCatalogItemActive);
  const remove = useMutation(api.invoices.removeCatalogItem);
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<CatalogItemSeed | null>(null);
  const records = useMemo<CatalogRecord[]>(() => items.map((item) => ({
    _id: item._id,
    name: item.name,
    kind: item.kind === "service" ? "service" : "item",
    sku: item.sku ?? "",
    category: item.category ?? "",
    unitPriceCents: item.openPrice ? null : item.unitPriceCents,
    tax: item.taxRatePercent ? taxChoiceLabel(item) : "",
    active: item.active,
    item,
  })), [items]);

  const price = (item: CatalogItem) => item.openPrice
    ? <span className="muted">Set on each invoice</span>
    : <><Money cents={item.unitPriceCents} currency={item.currency ?? defaultCurrency} /> {item.currency ?? defaultCurrency} / {item.unit ?? "each"}</>;

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
      <RecordListTable<CatalogRecord>
        variant="card"
        table={CATALOG_TABLE}
        tableId="invoice-catalog"
        label="Items"
        icon={<BookOpen size={14} />}
        records={records}
        onOpen={(record) => setEditing(record.item)}
        renderCell={({ record, field }) => {
          const item = record.item;
          switch (field.name) {
            case "name":
              return (
                <span>
                  <span className="invoice-table__name">{item.name}{!item.active && <> <Badge>Inactive</Badge></>}</span>
                  {item.description && <span className="muted invoice-table__sub">{item.description}</span>}
                </span>
              );
            case "unitPriceCents":
              return price(item);
            case "tax":
              return (
                <span>
                  {item.taxRatePercent ? taxChoiceLabel(item) : <span className="muted">None</span>}
                  {item.taxAssessment && <span className="muted invoice-table__sub">{taxAssessmentSummary(item.taxAssessment)}</span>}
                </span>
              );
            default:
              return undefined;
          }
        }}
        rowMenuSections={(record) => {
          const item = record.item;
          return [{
            id: "item",
            items: [
              { id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => setEditing(item) },
              { id: "active", label: item.active ? "Deactivate" : "Activate", icon: <Power size={14} />, disabled: !canWrite, onSelect: () => void setActive({ id: item._id as Id<"invoiceCatalogItems">, active: !item.active }).then(() => toast.success(item.active ? "Item deactivated" : "Item activated")) },
              {
                id: "delete",
                label: "Delete",
                icon: <Trash2 size={14} />,
                destructive: true,
                disabled: !canWrite,
                onSelect: async () => {
                  const ok = await confirm({ title: `Delete ${item.name}?`, message: "Invoices that already use it keep their lines. Deactivate it instead to keep it for reference.", confirmLabel: "Delete item", tone: "danger" });
                  if (ok) await remove({ id: item._id as Id<"invoiceCatalogItems"> }).then(() => toast.success("Item deleted"));
                },
              },
            ],
          }];
        }}
        renderPhoneCard={(record, { open, selecting }) => {
          const item = record.item;
          return (
            <RecordTablePhoneCard
              title={item.name}
              badge={item.active ? undefined : <Badge>Inactive</Badge>}
              meta={[<span key="price">{price(item)}</span>, item.kind === "service" ? "Service" : "Item"]}
              detail={[item.category ?? "", item.sku ?? "", item.taxAssessment ? taxAssessmentSummary(item.taxAssessment) : record.tax]}
              onOpen={open}
              selecting={selecting}
            />
          );
        }}
        emptyState={<EmptyState icon={<BookOpen size={20} />} title="No catalog items yet" description="Add the fees, rentals and sponsorship levels you bill for, then pick them in the invoice builder." />}
      />

      <CatalogItemEditor item={editing} societyId={societyId} canWrite={canWrite} defaultCurrency={defaultCurrency} assessmentDate={assessmentDate} organization={organization} onClose={() => setEditing(null)} />
    </div>
  );
}

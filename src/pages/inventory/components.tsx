// Presentational, state-free building blocks for the Inventory module.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileText, Image as ImageIcon, MapPin, Package, Plus, Tag } from "lucide-react";
import { Badge } from "../../components/ui";
import { Select } from "../../components/Select";
import { formatQuantity } from "./helpers";

export function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      className={active ? "btn btn--sm btn--accent" : "btn btn--sm btn--ghost"}
      onClick={onClick}
      style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
    >
      {icon} {label}
    </button>
  );
}

export function LocationGlyph({ type }: { type?: string }) {
  if (type === "bin" || type === "shelf") return <Tag size={14} />;
  if (type === "custody") return <Package size={14} />;
  return <MapPin size={14} />;
}

export function ItemThumb({ item }: { item: any }) {
  if (!item.imageUrl) {
    return (
      <span style={{ width: 36, height: 36, flex: "0 0 auto", borderRadius: 6, background: "var(--surface-muted, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted, #8a8f98)" }}>
        <ImageIcon size={14} />
      </span>
    );
  }
  return <img src={item.imageUrl} alt="" style={{ width: 36, height: 36, flex: "0 0 auto", borderRadius: 6, objectFit: "cover", border: "1px solid var(--border, #d8dadf)" }} />;
}

export function ReceiptEvidence({ links, receiptDocumentId }: { links: any[]; receiptDocumentId?: string }) {
  if (links.length === 0) {
    return receiptDocumentId ? <span className="mono">{receiptDocumentId}</span> : <span className="muted">-</span>;
  }
  return (
    <div className="stack stack--xs">
      {links.slice(0, 2).map((link) => (
        <div key={link._id} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <FileText size={12} />
          {link.receiptDocument ? (
            <Link to={`/app/documents/${link.receiptDocument._id}`}>{link.receiptDocument.title}</Link>
          ) : (
            <span className="mono">{link.receiptDocumentId}</span>
          )}
          {link.receiptLineLabel && <span className="muted">· {link.receiptLineLabel}</span>}
        </div>
      ))}
      {links.length > 2 && <div className="muted">+{links.length - 2} more</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: any; sub: string; tone?: "warn" | "info" }) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      <div className={tone ? `stat-card__sub stat-card__sub--${tone}` : "stat-card__sub"}>{sub}</div>
    </div>
  );
}

// Editable count sheet — local drafts persist a counted quantity on blur, and
// a footer row lets a counter add stock found that wasn't on the expected sheet.
export function CountEntry({
  count,
  items,
  locations,
  itemById,
  locationById,
  onSaveLine,
  onAddLine,
}: {
  count: any;
  items: any[];
  locations: any[];
  itemById: Map<string, any>;
  locationById: Map<string, any>;
  onSaveLine: (lineId: string, countedQuantity: number) => Promise<void>;
  onAddLine: (args: { inventoryItemId: string; locationId: string; countedQuantity: number }) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [add, setAdd] = useState({ inventoryItemId: "", locationId: "", quantity: "" });
  const open = count.status === "open";
  const lines = (count.lines ?? []) as any[];
  const lineKeys = new Set(lines.map((l) => `${l.inventoryItemId}::${l.locationId}`));

  const submitAdd = async () => {
    const qty = Number(add.quantity);
    if (!add.inventoryItemId || !add.locationId || !Number.isFinite(qty)) return;
    await onAddLine({ inventoryItemId: add.inventoryItemId, locationId: add.locationId, countedQuantity: qty });
    setAdd({ inventoryItemId: "", locationId: "", quantity: "" });
  };

  return (
    <div className="stack">
      {lines.length === 0 ? (
        <div className="muted">No expected lines — this scope had no balances on hand. Add found stock below.</div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Item</th><th>Location</th><th style={{ textAlign: "right" }}>Expected</th><th style={{ textAlign: "right" }}>Counted</th><th style={{ textAlign: "right" }}>Δ</th></tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const item = itemById.get(line.inventoryItemId);
              const location = locationById.get(line.locationId);
              const draft = drafts[line._id] ?? (line.countedQuantity != null ? String(line.countedQuantity) : "");
              const counted = draft.trim() === "" ? null : Number(draft);
              const variance = counted != null ? counted - (line.expectedQuantity ?? 0) : null;
              return (
                <tr key={line._id}>
                  <td>{item?.name ?? "Unknown"}<div className="muted mono">{item?.sku ?? ""}</div></td>
                  <td>{location?.name ?? "—"}{location?.code ? <span className="muted"> ({location.code})</span> : null}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{line.expectedQuantity ?? 0}</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      className="input mono"
                      style={{ width: 90, textAlign: "right" }}
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => setDrafts({ ...drafts, [line._id]: e.target.value })}
                      onBlur={async () => {
                        if (draft.trim() === "") return;
                        const n = Number(draft);
                        if (Number.isFinite(n)) await onSaveLine(line._id, n);
                      }}
                      disabled={!open}
                    />
                  </td>
                  <td className="mono" style={{ textAlign: "right", color: variance ? "var(--warn, #b45309)" : undefined }}>{variance == null ? "-" : variance > 0 ? `+${variance}` : variance}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {open && (
        <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="stack stack--xs" style={{ minWidth: 180 }}>
            <span className="field__label">Add found item</span>
            <Select value={add.inventoryItemId} onChange={(value) => setAdd({ ...add, inventoryItemId: value })}
              options={[{ value: "", label: "Select item" }, ...items.map((item) => ({ value: item._id, label: `${item.name}${item.sku ? ` (${item.sku})` : ""}` }))]} />
          </div>
          <Select style={{ minWidth: 150 }} value={add.locationId} onChange={(value) => setAdd({ ...add, locationId: value })}
            options={[{ value: "", label: "Location" }, ...locations.map((location) => ({ value: location._id, label: `${location.name}${location.code ? ` (${location.code})` : ""}` }))]} />
          <input className="input mono" style={{ width: 90 }} inputMode="decimal" placeholder="Qty" value={add.quantity} onChange={(e) => setAdd({ ...add, quantity: e.target.value })} />
          <button
            className="btn btn--sm"
            disabled={!add.inventoryItemId || !add.locationId || add.quantity.trim() === "" || lineKeys.has(`${add.inventoryItemId}::${add.locationId}`)}
            title={lineKeys.has(`${add.inventoryItemId}::${add.locationId}`) ? "That item/location is already on the sheet" : undefined}
            onClick={submitAdd}
          >
            <Plus size={12} /> Add line
          </button>
        </div>
      )}
    </div>
  );
}

// Quantity helper re-exported for table cells that import from this module.
export { formatQuantity };

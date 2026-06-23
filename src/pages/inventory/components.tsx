// Presentational, state-free building blocks for the Inventory module.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileText, Image as ImageIcon, MapPin, Package, Tag } from "lucide-react";
import { Badge } from "../../components/ui";
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

// Editable count sheet — local drafts persist a counted quantity on blur.
export function CountEntry({
  count,
  itemById,
  locationById,
  onSaveLine,
}: {
  count: any;
  itemById: Map<string, any>;
  locationById: Map<string, any>;
  onSaveLine: (lineId: string, countedQuantity: number) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const lines = (count.lines ?? []) as any[];
  if (lines.length === 0) return <div className="muted">No lines to count — this scope had no balances on hand.</div>;
  return (
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
                  disabled={count.status !== "open"}
                />
              </td>
              <td className="mono" style={{ textAlign: "right", color: variance ? "var(--warn, #b45309)" : undefined }}>{variance == null ? "-" : variance > 0 ? `+${variance}` : variance}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Quantity helper re-exported for table cells that import from this module.
export { formatQuantity };

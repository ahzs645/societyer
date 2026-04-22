import { Link2, PlusCircle, Trash2 } from "lucide-react";
import { Badge } from "../../../components/ui";
import { formatDate, money } from "../../../lib/format";
import {
  monthlyEstimateCents,
  operatingSubscriptionIntervalLabel,
  operatingSubscriptionStatusTone,
} from "../lib/operatingSubscriptions";

export function OperatingSubscriptionsCard({
  rows,
  loading,
  activeMonthlyCents,
  plannedMonthlyCents,
  projectedMonthlyCents,
  onNew,
  onEdit,
  onRemove,
}: {
  rows: any[];
  loading: boolean;
  activeMonthlyCents: number;
  plannedMonthlyCents: number;
  projectedMonthlyCents: number;
  onNew: () => void;
  onEdit: (row: any) => void;
  onRemove: (row: any) => void | Promise<void>;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Subscriptions & monthly cost estimate</h2>
        <span className="card__subtitle">
          Recurring software, services, and operating subscriptions converted to monthly equivalents.
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button className="btn-action" onClick={onNew}>
            <PlusCircle size={12} /> Add subscription
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ margin: "0 16px 16px" }}>
        <Stat label="Active monthly" value={money(activeMonthlyCents)} />
        <Stat label="Planned monthly" value={money(plannedMonthlyCents)} />
        <Stat label="Projected monthly" value={money(projectedMonthlyCents)} />
        <Stat label="Annual run-rate" value={money(projectedMonthlyCents * 12)} />
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Category</th>
            <th>Status</th>
            <th>Billing</th>
            <th style={{ textAlign: "right" }}>Monthly est.</th>
            <th>Renewal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td>
                <strong>{row.name}</strong>
                {row.vendorName && <div className="muted" style={{ fontSize: 12 }}>{row.vendorName}</div>}
              </td>
              <td><span className="cell-tag">{row.category}</span></td>
              <td><Badge tone={operatingSubscriptionStatusTone(row.status)}>{row.status}</Badge></td>
              <td>
                <span className="table__cell--mono">{money(row.amountCents)}</span>
                <span className="muted"> / {operatingSubscriptionIntervalLabel(row.interval)}</span>
              </td>
              <td className="table__cell--mono" style={{ textAlign: "right" }}>
                {money(row.monthlyEstimateCents ?? monthlyEstimateCents(row))}
              </td>
              <td className="table__cell--mono">{row.nextRenewalDate ? formatDate(row.nextRenewalDate) : "—"}</td>
              <td style={{ textAlign: "right" }}>
                <button className="btn btn--ghost btn--sm" onClick={() => onEdit(row)}>
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove subscription cost ${row.name}`}
                  onClick={() => onRemove(row)}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>
                No subscription costs yet. Add software, services, or other recurring expenses to estimate monthly spend.
              </td>
            </tr>
          )}
          {loading && (
            <tr>
              <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>
                Loading subscription costs...
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: tone === "danger" ? "var(--danger)" : undefined }}>{value}</div>
    </div>
  );
}

export function ProviderCard({
  name,
  desc,
  status,
  onConnect,
  busy,
}: {
  name: string;
  desc: string;
  status: "live" | "demo" | "setup" | "planned";
  onConnect?: () => void;
  busy?: boolean;
}) {
  const statusLabel = status === "setup" ? "setup required" : status;
  const statusTone = status === "live" ? "success" : status === "demo" ? "info" : status === "setup" ? "warn" : "neutral";
  return (
    <div
      className="panel"
      style={{
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 8,
        minWidth: 220,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{name}</strong>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>
      <div className="muted" style={{ fontSize: 12, margin: "6px 0 10px" }}>
        {desc}
      </div>
      {onConnect ? (
        <button className="btn btn--accent btn--sm" disabled={busy} onClick={onConnect}>
          <Link2 size={12} /> Connect
        </button>
      ) : status === "setup" ? (
        <button className="btn btn--ghost btn--sm" disabled>
          Configure Wave
        </button>
      ) : (
        <button className="btn btn--ghost btn--sm" disabled>
          Coming soon
        </button>
      )}
    </div>
  );
}

import { Link2, PlusCircle, Repeat, Settings, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { Badge } from "../../../components/ui";
import { formatDate } from "../../../lib/format";
import { Money } from "../../../components/Money";
import { StatTile } from "../../../components/StatTile";
import {
  OPERATING_SUBSCRIPTION_INTERVALS,
  OPERATING_SUBSCRIPTION_STATUSES,
  monthlyEstimateCents,
  operatingSubscriptionIntervalLabel,
  operatingSubscriptionStatusTone,
} from "../lib/operatingSubscriptions";

/** A recurring operating cost as `financialHub.operatingSubscriptions` returns it. */
export type OperatingSubscriptionRow = {
  _id: string;
  name: string;
  vendorName?: string;
  category: string;
  status: string;
  amountCents: number;
  currency?: string;
  interval: string;
  monthlyEstimateCents?: number;
  nextRenewalDate?: string;
  notes?: string;
};

const STATUS_COLOR: Record<string, string> = { Active: "green", Planned: "blue", Paused: "amber" };

const SUBSCRIPTIONS_TABLE = staticRecordTable({
  id: "financials:operating-subscriptions",
  nameSingular: "operatingSubscription",
  namePlural: "operatingSubscriptions",
  labelSingular: "Subscription",
  labelPlural: "Subscriptions",
  labelIdentifierFieldName: "name",
  viewName: "All subscriptions",
  density: "comfortable",
  fields: [
    { name: "name", label: "Service", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "vendorName", label: "Vendor", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "category", label: "Category", fieldType: FIELD_TYPES.TEXT, size: 140 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      config: { options: OPERATING_SUBSCRIPTION_STATUSES.map((status) => ({ ...status, color: STATUS_COLOR[status.value] ?? "gray" })) },
    },
    { name: "amountCents", label: "Billing", fieldType: FIELD_TYPES.CURRENCY, size: 160, config: { isCents: true } },
    {
      name: "interval",
      label: "Billed",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      isVisible: false,
      config: { options: OPERATING_SUBSCRIPTION_INTERVALS.map((interval) => ({ ...interval, color: "gray" })) },
    },
    { name: "monthlyEstimateCents", label: "Monthly est.", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true }, aggregate: "sum" },
    { name: "nextRenewalDate", label: "Renewal", fieldType: FIELD_TYPES.DATE, size: 120 },
  ],
});

type SubscriptionRecord = {
  _id: string;
  name: string;
  vendorName: string;
  category: string;
  status: string;
  amountCents: number;
  interval: string;
  monthlyEstimateCents: number;
  nextRenewalDate: string | null;
  row: OperatingSubscriptionRow;
};

function subscriptionRecord(row: OperatingSubscriptionRow): SubscriptionRecord {
  return {
    _id: row._id,
    name: row.name,
    vendorName: row.vendorName ?? "",
    category: row.category,
    status: row.status,
    amountCents: row.amountCents,
    interval: row.interval,
    monthlyEstimateCents: row.monthlyEstimateCents ?? monthlyEstimateCents(row),
    nextRenewalDate: row.nextRenewalDate ?? null,
    row,
  };
}

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
  rows: OperatingSubscriptionRow[];
  loading: boolean;
  activeMonthlyCents: number;
  plannedMonthlyCents: number;
  projectedMonthlyCents: number;
  onNew: () => void;
  onEdit: (row: OperatingSubscriptionRow) => void;
  onRemove: (row: OperatingSubscriptionRow) => void | Promise<void>;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Subscriptions & monthly cost estimate</h2>
        <span className="card__subtitle">
          Recurring software, services, and operating subscriptions converted to monthly equivalents.
        </span>
        <div className="financials-subscriptions__actions">
          <Link className="btn-action" to="/app/financials/planning">Plan period costs</Link>
          <button className="btn-action" onClick={onNew}>
            <PlusCircle size={12} /> Add subscription
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ margin: 16 }}>
        <StatTile label="Active monthly" value={<Money variant="hero" cents={activeMonthlyCents} />} />
        <StatTile label="Planned monthly" value={<Money variant="hero" cents={plannedMonthlyCents} />} />
        <StatTile label="Projected monthly" value={<Money variant="hero" cents={projectedMonthlyCents} />} />
        <StatTile label="Annual run-rate" value={<Money variant="hero" cents={projectedMonthlyCents * 12} />} />
      </div>

      <RecordListTable<SubscriptionRecord>
        variant="card"
        table={SUBSCRIPTIONS_TABLE}
        tableId="financials-operating-subscriptions"
        label="Subscriptions"
        icon={<Repeat size={14} />}
        records={rows.map(subscriptionRecord)}
        loading={loading}
        onOpen={(record) => onEdit(record.row)}
        renderCell={({ record, field }) => {
          const { row } = record;
          if (field.name === "category") return <span className="cell-tag">{row.category}</span>;
          if (field.name === "status") return <Badge tone={operatingSubscriptionStatusTone(row.status)}>{row.status}</Badge>;
          if (field.name === "amountCents")
            return (
              <>
                <Money cents={row.amountCents} currency={row.currency} />
                <span className="muted"> / {operatingSubscriptionIntervalLabel(row.interval)}</span>
              </>
            );
          if (field.name === "monthlyEstimateCents") return <Money cents={record.monthlyEstimateCents} currency={row.currency} />;
          return undefined;
        }}
        renderRowActions={(record) => (
          <>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(record.row)}>
              Edit
            </button>
            <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Remove subscription cost ${record.name}`} onClick={() => void onRemove(record.row)}>
              <Trash2 size={12} />
            </button>
          </>
        )}
        renderPhoneCard={(record, { open, field, selecting }) => (
          <RecordTablePhoneCard
            title={record.name}
            badge={field("status")}
            meta={[
              <span key="monthly"><Money cents={record.monthlyEstimateCents} currency={record.row.currency} /> / month</span>,
              record.category,
            ]}
            detail={[record.vendorName, record.nextRenewalDate ? `Renews ${formatDate(record.nextRenewalDate)}` : ""]}
            onOpen={open}
            selecting={selecting}
          />
        )}
        emptyState={
          <RecordTableEmpty
            title="No subscription costs yet"
            description="Add software, services, or other recurring expenses to estimate monthly spend."
          />
        }
      />
    </div>
  );
}

export function ProviderCard({
  name,
  desc,
  status,
  onConnect,
  setupHref,
  busy,
}: {
  name: string;
  desc: string;
  status: "live" | "demo" | "setup" | "planned";
  onConnect?: () => void;
  /** Where to send the user to finish configuring this provider when it can't be
   * connected yet (no credentials). Renders a real link instead of a dead button. */
  setupHref?: string;
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
      ) : status === "setup" && setupHref ? (
        <Link className="btn btn--ghost btn--sm" to={setupHref}>
          <Settings size={12} /> Configure {name}
        </Link>
      ) : status === "planned" ? (
        // Roadmap teaser — intentionally not a control.
        <span className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>
          Coming soon
        </span>
      ) : (
        <button className="btn btn--ghost btn--sm" disabled>
          Configure {name}
        </button>
      )}
    </div>
  );
}

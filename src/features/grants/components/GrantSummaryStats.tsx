import { money } from "../../../lib/format";

export function GrantSummaryStats({ summary }: { summary: any }) {
  return (
    <div className="stat-grid" style={{ marginBottom: 16 }}>
      <Stat label="Pre-award" value={String(summary?.pipeline ?? 0)} />
      <Stat label="Active awards" value={String(summary?.active ?? 0)} />
      <Stat label="Pending intake" value={String(summary?.pendingApplications ?? 0)} />
      {/* Spend is a neutral running total, not an alarm; overdue reports are
          flagged on the reports table itself. */}
      <Stat label="Ledger spend" value={money(summary?.ledgerSpendCents ?? 0)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
    </div>
  );
}

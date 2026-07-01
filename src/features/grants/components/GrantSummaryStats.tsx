import { money } from "../../../lib/format";

export function GrantSummaryStats({ summary }: { summary: any }) {
  return (
    <div className="stat-grid" style={{ marginBottom: 16 }}>
      <Stat label="Pre-award" value={String(summary?.pipeline ?? 0)} />
      <Stat label="Active awards" value={String(summary?.active ?? 0)} />
      <Stat label="Pending intake" value={String(summary?.pendingApplications ?? 0)} />
      <Stat
        label="Ledger spend"
        value={money(summary?.ledgerSpendCents ?? 0)}
        tone={(summary?.overdueReports ?? 0) > 0 ? "danger" : undefined}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={tone ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
    </div>
  );
}

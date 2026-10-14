import { Money } from "../../../components/Money";
import { StatTile } from "../../../components/StatTile";

export function GrantSummaryStats({ summary }: { summary: any }) {
  return (
    <div className="stat-grid" style={{ marginBottom: 16 }}>
      <StatTile label="Pre-award" value={summary?.pipeline ?? 0} />
      <StatTile label="Active awards" value={summary?.active ?? 0} />
      <StatTile label="Pending intake" value={summary?.pendingApplications ?? 0} />
      {/* Spend is a neutral running total, not an alarm; overdue reports are
          flagged on the reports table itself. */}
      <StatTile label="Ledger spend" value={<Money variant="hero" trimWholeCents cents={summary?.ledgerSpendCents ?? 0} />} />
    </div>
  );
}

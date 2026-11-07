import { Money } from "../../../components/Money";
import { StatStrip, StatTile } from "../../../components/StatTile";

export function GrantSummaryStats({ summary }: { summary: any }) {
  return (
    <StatStrip className="grants-stats stat-strip--fit" ariaLabel="Grant summary">
      <StatTile label="Pre-award" value={summary?.pipeline ?? 0} />
      <StatTile label="Active awards" value={summary?.active ?? 0} />
      <StatTile label="Pending intake" value={summary?.pendingApplications ?? 0} />
      {/* Spend is a neutral running total, not an alarm; overdue reports are
          flagged on the reports table itself. */}
      <StatTile label="Ledger spend" value={<Money variant="hero" trimWholeCents cents={summary?.ledgerSpendCents ?? 0} />} />
    </StatStrip>
  );
}

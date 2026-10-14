import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../../hooks/usePermissions";
import { useModuleEnabled } from "../../hooks/useModules";
import { StatTile } from "../../components/StatTile";
import { Money } from "../../components/Money";
import { formatDate } from "../../lib/format";
import type { InvestedReservesSummary } from "./types";

/**
 * The organization's invested reserves (GICs, term deposits, savings and
 * investment accounts at today's value), split restricted and unrestricted.
 * Undefined while loading, null when the investments register is off or the
 * viewer can't read finance records.
 */
export function useInvestedReserves(societyId: string | undefined): (InvestedReservesSummary & { today: string }) | null | undefined {
  const { loaded, can } = usePermissions();
  const enabled = useModuleEnabled("investments");
  const allowed = loaded && can("financials:read") && enabled;
  const result = useQuery(api.investments.reserves, societyId && allowed ? { societyId } : "skip") as (InvestedReservesSummary & { today: string }) | undefined;
  if (!societyId || (loaded && !allowed)) return null;
  return result;
}

/** A Financials overview tile for invested reserves; renders nothing without holdings. */
export function InvestedReservesTile({ societyId }: { societyId: string }) {
  const reserves = useInvestedReserves(societyId);
  if (!reserves || reserves.activeCount === 0) return null;
  return (
    <StatTile
      label="Invested reserves"
      value={<Money variant="hero" trimWholeCents cents={reserves.totalCents} />}
      sub={reserves.nextMaturity ? `Next maturity ${formatDate(reserves.nextMaturity.date, "MMM d")}` : undefined}
      href="/app/investments"
      actionLabel="Open investments"
    />
  );
}

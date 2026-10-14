import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { BudgetBars, ChartCard } from "../../../components/charts";
import { formatMoney } from "../../../lib/money";

const FUNDED_STATUSES = new Set(["Awarded", "Active", "Closed", "Completed"]);

/**
 * Committed vs spent vs remaining per funded grant. "Committed" is the
 * awarded amount; "spent" sums the grant ledger's outflows. Renders nothing
 * until at least one grant has an award amount.
 */
export function GrantFundingCard({ societyId }: { societyId: string }) {
  const grants = useQuery(api.grants.list, { societyId: societyId as any }) as any[] | undefined;
  const ledger = useQuery(api.grants.transactions, { societyId: societyId as any }) as any[] | undefined;

  const rows = useMemo(() => {
    const spentByGrant = new Map<string, number>();
    for (const row of ledger ?? []) {
      if (row.direction !== "outflow") continue;
      const key = String(row.grantId);
      spentByGrant.set(key, (spentByGrant.get(key) ?? 0) + Math.abs(Number(row.amountCents) || 0));
    }
    return (grants ?? [])
      .filter((grant) => !grant.archivedAtISO && FUNDED_STATUSES.has(grant.status) && Number(grant.amountAwardedCents) > 0)
      .map((grant) => ({
        key: String(grant._id),
        label: String(grant.title ?? grant.funder ?? "Grant"),
        planned: Number(grant.amountAwardedCents),
        actual: spentByGrant.get(String(grant._id)) ?? 0,
      }))
      .sort((a, b) => b.planned - a.planned);
  }, [grants, ledger]);

  const loading = grants === undefined || ledger === undefined;
  if (!loading && rows.length === 0) return null;
  const committed = rows.reduce((sum, r) => sum + r.planned, 0);
  const spent = rows.reduce((sum, r) => sum + r.actual, 0);

  return (
    <ChartCard
      title="Grant funds: committed, spent and remaining"
      subtitle={loading ? undefined : `${formatMoney(spent, { trimWholeCents: true })} spent of ${formatMoney(committed, { trimWholeCents: true })} awarded · ${formatMoney(committed - spent, { trimWholeCents: true, signDisplay: "auto" })} remaining`}
      loading={loading}
      height={120}
      className="grant-funding-card"
      table={{
        caption: "Grant funds by grant",
        columns: [
          { key: "grant", label: "Grant" },
          { key: "awarded", label: "Awarded", numeric: true },
          { key: "spent", label: "Spent", numeric: true },
          { key: "remaining", label: "Remaining", numeric: true },
        ],
        rows: rows.map((r) => ({ grant: r.label, awarded: formatMoney(r.planned), spent: formatMoney(r.actual), remaining: formatMoney(r.planned - r.actual) })),
      }}
    >
      <BudgetBars
        rows={rows}
        ariaLabel="Spent against awarded amount for each funded grant"
        labels={{ planned: "Awarded", favourable: "remaining", unfavourable: "overspent" }}
      />
    </ChartCard>
  );
}

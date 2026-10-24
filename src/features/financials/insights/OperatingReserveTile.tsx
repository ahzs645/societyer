import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { StatTile } from "../../../components/StatTile";
import { formatMonthLong, monthKey } from "../../../components/charts";
import { formatMoney } from "../../../lib/money";
import type { FinanceTxn } from "./series";
import { MIN_RESERVE_MONTHS, formatReserveMonths, operatingReserve } from "./topFlows";

type PolicyRow = { _id: string; policyName?: string; status?: string };

const RESERVE_POLICY = /\breserves?\b/i;
const RETIRED = new Set(["Superseded", "Ceased"]);

/** The organisation's reserves policy, when one is on file. */
function useReservePolicy(societyId: string) {
  const policies = useQuery(api.policies.list, { societyId: societyId as any }) as PolicyRow[] | undefined;
  return useMemo(
    () => (policies ?? []).find((row) => RESERVE_POLICY.test(String(row.policyName ?? "")) && !RETIRED.has(String(row.status ?? ""))) ?? null,
    [policies],
  );
}

/**
 * Months of operating reserve: unrestricted cash over average monthly money
 * out. Uses complete months only, so it does not follow the range selector.
 */
export function OperatingReserveTile({ societyId, txns, unrestrictedCents, today, currency = "CAD" }: { currency?: string; societyId: string; txns: FinanceTxn[]; unrestrictedCents: number; today: string }) {
  const reserve = useMemo(() => operatingReserve(txns, unrestrictedCents, today), [today, txns, unrestrictedCents]);
  const policy = useReservePolicy(societyId);
  const span = reserve.window ? `${formatMonthLong(monthKey(reserve.window.start))} to ${formatMonthLong(monthKey(reserve.window.end))}` : null;
  const value = reserve.months == null ? "—" : `${formatReserveMonths(reserve.months)} ${reserve.months >= 0.95 && reserve.months < 1.05 ? "month" : "months"}`;

  const sub = reserve.months == null
    ? reserve.window
      ? "No money out in the last few months"
      : `Needs ${MIN_RESERVE_MONTHS} complete months of transactions`
    : `Unrestricted cash ÷ ${reserve.windowMonths}-month average spend`;

  return (
    <StatTile
      className="reserve-tile"
      label="Operating reserve"
      value={value}
      sub={
        <>
          {sub}
          {policy && (
            <>
              {" · "}
              <Link className="reserve-tile__policy" to={`/app/policies?record=${encodeURIComponent(String(policy._id))}`}>
                Reserves policy
              </Link>
            </>
          )}
        </>
      }
      infoLabel="How months of operating reserve are worked out"
      info={
        <>
          <p>
            <strong>Unrestricted cash ÷ average monthly money out.</strong>
          </p>
          <p>
            Unrestricted cash is {formatMoney(unrestrictedCents, { currency, trimWholeCents: true })}: your bank and card balances, less accounts marked as restricted.
            {reserve.months != null && span && (
              <> Average monthly money out is {formatMoney(reserve.averageMonthlyOutflowCents, { currency, trimWholeCents: true })}, over the {reserve.windowMonths} complete months from {span}.</>
            )}
          </p>
          <p>
            The average uses the last 12 complete months, or the last 6 when there is less history. Transfers between your own accounts are left out.
            Receivables, investments and upcoming commitments are not included.
          </p>
          {policy ? (
            <p>
              Compare it with the target in your <Link to={`/app/policies?record=${encodeURIComponent(String(policy._id))}`}>{policy.policyName}</Link>.
            </p>
          ) : (
            <p>Many boards set a target range in a reserves policy, often three to six months.</p>
          )}
        </>
      }
    />
  );
}

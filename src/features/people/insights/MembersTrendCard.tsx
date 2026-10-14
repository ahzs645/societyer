import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import {
  ChartCard,
  FlowBarChart,
  TimeSeriesChart,
  endOfMonth,
  formatMonthLong,
  monthsBetween,
  type ChartSeries,
  type FlowRow,
  type TimeRow,
} from "../../../components/charts";
import { usePermissions } from "../../../hooks/usePermissions";
import { todayDateOnly } from "../../../lib/format";

const DATE = /^\d{4}-\d{2}-\d{2}/;
const MEMBERS_SERIES: ChartSeries[] = [{ key: "members", label: "Members", color: "var(--dv-cat-1)", variant: "area" }];
const count = (value: number) => Math.round(value).toLocaleString("en-CA");

type MemberRow = { joinedAt?: string; leftAt?: string };

/**
 * Members over time (month-end count from join and leave dates) and members
 * joined vs left per year. Renders nothing without a members register or
 * without permission to read it.
 */
export function MembersTrendCard({ societyId }: { societyId: string }) {
  const { loaded, can } = usePermissions();
  const allowed = loaded && can("members:read");
  const members = useQuery(api.members.list, allowed ? { societyId: societyId as any } : "skip") as MemberRow[] | undefined;
  const today = todayDateOnly();

  const view = useMemo(() => {
    const dated = (members ?? []).filter((m) => typeof m.joinedAt === "string" && DATE.test(m.joinedAt));
    if (dated.length < 2) return null;
    const joins = dated.map((m) => m.joinedAt!.slice(0, 10));
    const leaves = dated.map((m) => (m.leftAt && DATE.test(m.leftAt) ? m.leftAt.slice(0, 10) : null));
    const first = joins.reduce((a, b) => (a < b ? a : b));
    const months = monthsBetween(first, today);
    const trend: TimeRow[] = months.map((month, i) => {
      const at = i === months.length - 1 ? today : endOfMonth(`${month}-01`);
      const active = joins.filter((join, idx) => join <= at && !(leaves[idx] && leaves[idx]! <= at)).length;
      return { date: `${month}-01`, members: active };
    });
    const years = Array.from(new Set([...joins, ...leaves.filter(Boolean) as string[]].map((d) => d.slice(0, 4)))).sort();
    const firstYear = Number(years[0]);
    const lastYear = Number(today.slice(0, 4));
    const yearly: FlowRow[] = [];
    for (let y = firstYear; y <= lastYear; y += 1) {
      const key = String(y);
      yearly.push({ key, label: key, inflow: joins.filter((d) => d.startsWith(key)).length, outflow: leaves.filter((d) => d?.startsWith(key)).length });
    }
    return { trend, yearly, current: trend[trend.length - 1]?.members as number, since: formatMonthLong(months[0]) };
  }, [members, today]);

  if (!allowed || members === undefined || !view) return null;
  const joinedTotal = view.yearly.reduce((s, r) => s + r.inflow, 0);
  const leftTotal = view.yearly.reduce((s, r) => s + r.outflow, 0);

  return (
    <div className="insights__grid insights__grid--two members-trend">
      <ChartCard
        title="Members over time"
        subtitle={`${count(view.current)} members today · month-end counts since ${view.since}`}
        table={{
          caption: "Members at each month end",
          columns: [{ key: "month", label: "Month" }, { key: "members", label: "Members", numeric: true }],
          rows: view.trend.map((r) => ({ month: formatMonthLong(r.date), members: count(r.members as number) })),
        }}
      >
        <TimeSeriesChart
          data={view.trend}
          series={MEMBERS_SERIES}
          curve="step"
          height={220}
          integerAxis
          formatValue={count}
          formatAxis={count}
          formatDate={(date) => formatMonthLong(date)}
          ariaLabel={`Members at each month end since ${view.since}, now ${count(view.current)}`}
        />
      </ChartCard>
      <ChartCard
        title="Joined and left by year"
        subtitle={`${count(joinedTotal)} joined · ${count(leftTotal)} left (from recorded join and leave dates)`}
        table={{
          caption: "Members joined and left by year",
          columns: [{ key: "year", label: "Year" }, { key: "joined", label: "Joined", numeric: true }, { key: "left", label: "Left", numeric: true }, { key: "net", label: "Net change", numeric: true }],
          rows: view.yearly.map((r) => ({ year: r.label, joined: count(r.inflow), left: count(r.outflow), net: `${r.inflow - r.outflow > 0 ? "+" : ""}${r.inflow - r.outflow}` })),
        }}
      >
        <FlowBarChart
          rows={view.yearly}
          height={220}
          integerAxis
          showNet
          labels={{ inflow: "Joined", outflow: "Left", net: "Net change" }}
          formatValue={count}
          formatAxis={count}
          ariaLabel={`Members joined and left each year: ${count(joinedTotal)} joined and ${count(leftTotal)} left in total`}
        />
      </ChartCard>
    </div>
  );
}

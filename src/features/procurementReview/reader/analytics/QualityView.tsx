/**
 * Data quality, for whoever runs the catalog: what the published awards
 * cover, why the filters leave awards out (counted over every published
 * award, the person's own exclusions among the reasons), and each quality
 * flag. Every count lists its awards.
 */
import { useMemo } from "react";
import { ChartCard } from "../../../../components/charts";
import { StatTile } from "../../../../components/StatTile";
import {
  QUALITY_DETAILS, QUALITY_LABELS, count, counted, defaultFilters, filterAwards, leftOut, percent, validateFilters, type LeftOutReason, type MarketFilters, type QualityFlag, type metadata, type Award,
} from "../../lib/market";
import { formatSourceDate } from "../../lib/notice";
import { soFar, type ViewContext } from "./context";

/** Why the filters leave awards out, and how many remain, over every published award. */
function reasons(all: Award[], filters: MarketFilters, today: string) {
  const left = filterAwards(all, filters, today).length;
  return { reasons: leftOut(all, filters, today), left, out: all.length - left };
}

export function QualityView({ ctx, meta }: { ctx: ViewContext; meta: ReturnType<typeof metadata> }) {
  const { partial } = ctx;
  const gone = useMemo(() => {
    if (ctx.aggregate) return { reasons: ctx.aggregate.exclusions as { reason?: LeftOutReason; label: string; count: number; note: string }[], left: ctx.aggregate.included, out: ctx.aggregate.excluded };
    let filters = defaultFilters;
    try { filters = validateFilters(ctx.filters); } catch { /* Malformed filters read as the defaults here. */ }
    return reasons(ctx.all, filters, ctx.today);
  }, [ctx.all, ctx.filters, ctx.today, ctx.aggregate]);
  return (
    <>
      <div className="stat-grid procurement-analytics__stats">
        <StatTile label="Published awards" value={count(meta.count)} sub={soFar(partial)} onClick={meta.count ? () => ctx.inspect({ slice: {}, title: "All published awards", all: true }) : undefined} actionLabel="List every published award" />
        <StatTile label="Date range" compact value={meta.firstDate ? `${formatSourceDate(meta.firstDate)} – ${formatSourceDate(meta.lastDate)}` : "No valid dates"} />
        <StatTile label="Procurement types" value={count(ctx.aggregate?.meta.typeCount ?? meta.types.length)} onClick={() => ctx.showView("mix")} actionLabel="Open the procurement mix" />
        <StatTile label="Currencies" compact value={meta.currencies.map((code) => (code === "UNSPECIFIED" ? "not stated" : code)).join(", ") || "—"} />
      </div>
      <ChartCard
        title="Left out of the figures"
        subtitle={`${counted(gone.out, "award")} of ${count(meta.count)} with the current filters${partial ? ", so far" : ""}; ${count(gone.left)} remain. An award can be left out for more than one reason. Choose a reason for its awards.`}
        headingLevel={3}
      >
        <ul className="procurement-analytics__reasons">
          {gone.reasons.map((item) => (
            <li key={item.label}>
              {item.reason && item.count ? (
                <button type="button" className="procurement-analytics__reason" onClick={() => ctx.inspect({ slice: { left: item.reason }, title: item.reason === "excluded" ? item.label : `Left out · ${item.label}`, all: true })} aria-label={`${counted(item.count, "award")} left out: ${item.label}. List them`}>
                  <strong>{count(item.count)}</strong> <span>{item.label}</span>
                </button>
              ) : <><strong>{count(item.count)}</strong> <span>{item.label}</span></>}
              {" "}<span className="muted">{item.note}</span>
            </li>
          ))}
        </ul>
      </ChartCard>
      <div className="stat-grid procurement-analytics__stats procurement-analytics__quality">
        {meta.quality.map(({ flag, count: n }) => (
          <StatTile
            key={flag}
            label={QUALITY_LABELS[flag as QualityFlag]}
            value={<>{count(n)} <small className="muted">({percent(meta.count ? n / meta.count : 0)})</small></>}
            sub={QUALITY_DETAILS[flag as QualityFlag]}
            onClick={n ? () => ctx.inspect({ slice: { quality: flag }, title: QUALITY_LABELS[flag as QualityFlag], all: true }) : undefined}
            actionLabel={`List ${QUALITY_LABELS[flag as QualityFlag].toLowerCase()}`}
          />
        ))}
      </div>
      <p className="muted">Contract-number input unavailable for {count(meta.unavailable.contractNumber)} awards; justification input unavailable for {count(meta.unavailable.justification)}. Unavailable inputs are not counted as confirmed missing fields.</p>
      <ChartCard title="How to read these figures" headingLevel={3}>
        <ul className="procurement-analytics__signals">
          <li>Totals are recorded award amounts on their award date, not actual spend.</li>
          <li>Buyer names and proposed hierarchy follow the versioned mapping supplied with the publication.</li>
          <li>Concentration uses positive values only. Currencies are not converted.</li>
          <li>Winner records say nothing about bidder counts, win rates, or compliance.</li>
        </ul>
      </ChartCard>
    </>
  );
}

/**
 * A commodity's overview, under CommodityPage's Overview tab: how much is
 * open and closing soon, how much has been awarded and how large awards
 * typically run (the median); the codes one level down that hold notices; the few
 * opportunities closing soonest; who buys it (by notices) and who wins it
 * (by recorded value), each opening its page; and awards by year when they
 * span more than one.
 *
 * Fit to the data as a buyer's overview is (party/BuyerSummary.tsx): a code
 * with a notice or two leads with a sentence instead of tiles of zeros, and a
 * card with nothing to say isn't shown.
 */
import { useMemo } from "react";
import { ChartCard } from "../../../../components/charts";
import { StatTile } from "../../../../components/StatTile";
import { count, counted, money, normalizeAwards } from "../../lib/market";
import { opportunityInsights, type OpportunityInsights } from "../../lib/insights";
import { shortSourceDate } from "../../lib/notice";
import { useIsOurOrganisation } from "../../lib/ourOrganisation";
import { useProcurementClock } from "../../lib/clock";
import { toNoticeRow, type NoticeRow } from "../../../../../shared/procurementNoticeRow";
import { useReaderNavigation } from "../routes";
import type { ListRow } from "../source";
import { Amount, RankedCard, RankedList, foldRanked } from "../analytics/parts";
import { TopSuppliers, useAwarded, type Awarded } from "../party/BuyerSummary";
import { NoticeLinks, PREVIEW, UsBadge, partyKey, type PartyTab } from "../party/parts";
import { NARROWER, codeLabel, levelName } from "./codes";
import { unspscLevel } from "../../../../../shared/unspsc";

/** At most this many notices in all, the overview leads with a sentence instead of tiles. */
const SMALL = 3;
/** Buyers and narrower codes listed before "+N more". */
const LISTED = 8;

/** Who publishes notices in this commodity, most first: opportunities and awards both count. */
function useBuyers(opportunities: ListRow[], awards: ListRow[]) {
  return useMemo(() => {
    const buyers = new Map<string, { name: string; opportunities: number; awards: number }>();
    for (const [rows, kind] of [[opportunities, "opportunities"], [awards, "awards"]] as const) {
      for (const row of rows) {
        const name = row.organization.trim();
        const key = partyKey(name);
        if (!key) continue;
        const entry = buyers.get(key) ?? { name, opportunities: 0, awards: 0 };
        entry[kind] += 1;
        buyers.set(key, entry);
      }
    }
    return [...buyers.values()].sort((a, b) => b.opportunities + b.awards - (a.opportunities + a.awards) || a.name.localeCompare(b.name));
  }, [opportunities, awards]);
}

/** "2 opportunities · 1 award", leaving out a zero. */
const noticeDetail = (opportunities: number, awards: number) =>
  [opportunities ? counted(opportunities, "opportunity", "opportunities") : "", awards ? counted(awards, "award") : ""].filter(Boolean).join(" · ");

/** Awards by calendar year in the summary's currency, newest first. */
function useYears(awards: ListRow[], currency: string) {
  return useMemo(() => {
    const years = new Map<string, { value: number; count: number }>();
    for (const award of normalizeAwards(awards)) {
      if (!award.date || award.currencyCode !== currency) continue;
      const year = award.date.slice(0, 4);
      const entry = years.get(year) ?? { value: 0, count: 0 };
      entry.value += Math.max(0, award.value ?? 0);
      entry.count += 1;
      years.set(year, entry);
    }
    return [...years].map(([year, entry]) => ({ year, ...entry })).sort((a, b) => b.year.localeCompare(a.year));
  }, [awards, currency]);
}

function Tiles({ open, soon, later, undated, opportunities, awards, awarded, partial, onShow }: {
  open: number; soon: number; later: number; undated: number; opportunities: number; awards: number; awarded: Awarded; partial: boolean;
  onShow: (tab: PartyTab) => void;
}) {
  const now = useProcurementClock();
  const so = (text?: string) => (partial ? [text, "so far"].filter(Boolean).join(" · ") : text);
  const tiles = [
    opportunities > 0 && (
      <StatTile
        key="open"
        label="Open opportunities"
        value={count(open)}
        sub={so([open === opportunities ? "All of them open" : `${count(opportunities)} published`, undated ? `${count(undated)} with no closing date` : ""].filter(Boolean).join(" · "))}
        onClick={() => onShow("opportunities")}
        actionLabel="Show the opportunities"
      />
    ),
    (soon > 0 || later > 0) && (
      <StatTile key="soon" label="Closing within 7 days" value={count(soon)} tone={soon ? "warn" : "neutral"} sub={so(later ? `${count(later)} more in the week after` : undefined)} />
    ),
    awards > 0 && (
      <StatTile
        key="awards"
        label="Awards"
        value={count(awards)}
        sub={so(awarded.latest ? `Latest ${shortSourceDate(awarded.latest, now)}` : "No readable award dates")}
        onClick={() => onShow("awards")}
        actionLabel="Show the awards"
      />
    ),
    awarded.valued > 0 && (
      <StatTile
        key="value"
        label="Total awarded"
        value={<Amount value={awarded.value} currency={awarded.currency} />}
        sub={so([
          `${count(awarded.valued)} with values`,
          // The typical award, as the median: one large contract would pull an average up.
          awarded.valued > 1 ? `typical ${money(awarded.median, awarded.currency, true)}` : "",
          awarded.other ? `${count(awarded.other)} in other currencies` : "",
        ].filter(Boolean).join(" · "))}
      />
    ),
  ].filter(Boolean);
  return <div className="stat-grid procurement-analytics__stats" data-count={tiles.length}>{tiles}</div>;
}

/** The codes one level down that hold notices, each opening its own page. */
function NarrowerCard({ code, name, narrower, titles }: { code: string; name: string; narrower: { code: string; count: number }[]; titles: (code: string) => string }) {
  const nav = useReaderNavigation();
  const plural = NARROWER[unspscLevel(code)];
  return (
    <RankedCard
      title={`${plural} with notices`}
      subtitle={`The ${plural.toLowerCase()} under ${name} that notices are classified in. Open one for its page.`}
      headingLevel={3}
      table={{
        caption: `${plural} by notices`,
        columns: [
          { key: "code", label: "Code" },
          { key: "title", label: "Title" },
          { key: "count", label: "Notices", numeric: true },
        ],
        rows: narrower.map((item) => ({ code: item.code, title: titles(item.code) || "Untitled", count: count(item.count) })),
      }}
    >
      {(showTable) => {
        const rows = foldRanked(
          narrower.map((item) => ({ key: item.code, label: titles(item.code) || codeLabel(item.code, ""), detail: item.code, value: item.count, href: nav.commodityHref(item.code) })),
          LISTED,
        );
        return (
          <RankedList
            rows={rows.rows}
            rest={rows.rest}
            onMore={showTable}
            ariaLabel={`${plural} by notices`}
            formatValue={(value) => counted(value, "notice")}
            onSelect={(row) => nav.openCommodity(row.key)}
            selectLabel={(row) => `Open ${row.key} ${row.label}`}
          />
        );
      }}
    </RankedCard>
  );
}

/** Who publishes notices in the code, by opportunities and awards, each opening the buyer's page. */
function BuyersCard({ buyers, level, partial }: { buyers: ReturnType<typeof useBuyers>; level: string; partial: boolean }) {
  const nav = useReaderNavigation();
  const ours = useIsOurOrganisation();
  const folded = foldRanked(
    buyers.map((buyer) => ({
      key: buyer.name,
      label: buyer.name,
      value: buyer.opportunities + buyer.awards,
      detail: noticeDetail(buyer.opportunities, buyer.awards),
      href: nav.partyHref("organization", buyer.name),
      badge: ours(buyer.name) ? <UsBadge /> : undefined,
    })),
    LISTED,
  );
  return (
    <RankedCard
      title="Leading buyers"
      subtitle={`Who publishes notices in this ${level}, by opportunities and awards${partial ? ", so far" : ""}. Open one for its page.`}
      headingLevel={3}
      table={{
        caption: "Buyers by notices",
        columns: [
          { key: "name", label: "Buyer" },
          { key: "opportunities", label: "Opportunities", numeric: true },
          { key: "awards", label: "Awards", numeric: true },
        ],
        rows: buyers.map((buyer) => ({ name: buyer.name, opportunities: count(buyer.opportunities), awards: count(buyer.awards) })),
      }}
    >
      {(showTable) => (
        <RankedList
          rows={folded.rows}
          rest={folded.rest}
          onMore={showTable}
          ariaLabel="Buyers by notices"
          formatValue={(value) => counted(value, "notice")}
          onSelect={(row) => nav.openParty("organization", row.key)}
          selectLabel={(row) => `Open buyer ${row.label}`}
        />
      )}
    </RankedCard>
  );
}

/** Awards by year in one currency, newest first; shown when they span more than one year. */
function YearsCard({ years, currency, partial }: { years: ReturnType<typeof useYears>; currency: string; partial: boolean }) {
  return (
    <ChartCard
      title="Awards by year"
      subtitle={`Recorded value in ${currency} by award year, newest first${partial ? ", so far" : ""}.`}
      headingLevel={3}
      table={{
        caption: "Awards by year",
        columns: [
          { key: "year", label: "Year" },
          { key: "count", label: "Awards", numeric: true },
          { key: "value", label: "Award value", numeric: true },
        ],
        rows: years.map((row) => ({ year: row.year, count: count(row.count), value: money(row.value, currency) })),
      }}
    >
      <RankedList
        rows={years.map((row) => ({ key: row.year, label: row.year, value: row.value, detail: counted(row.count, "award") }))}
        ariaLabel="Awards by year"
        formatValue={(value) => money(value, currency, true)}
        exactValue={(value) => money(value, currency)}
      />
    </ChartCard>
  );
}

/** "3 open opportunities, the first closing tomorrow · 1 award, $40K": a code with a notice or two, in a sentence. */
function leadSentence(insights: OpportunityInsights, closing: NoticeRow[], opportunities: number, awards: number, awarded: Awarded, awardsClassified: boolean) {
  const text = [
    insights.open > 0
      ? [counted(insights.open, "open opportunity", "open opportunities"), closing[0]?.relative ? `closing ${closing[0].relative}` : ""].filter(Boolean).join(insights.open === 1 ? ", " : ", the first ")
      : opportunities ? `${counted(opportunities, "opportunity", "opportunities")}, none open` : "no published opportunities",
    awards
      ? [counted(awards, "award"), awarded.valued ? money(awarded.value, awarded.currency, true) : ""].filter(Boolean).join(", ")
      : awardsClassified ? "no published awards" : "",
  ].filter(Boolean).join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function CommoditySummary({ code, name, opportunities, awards, awardsClassified, narrower, titles, partial, onShow }: {
  code: string;
  name: string;
  opportunities: ListRow[];
  awards: ListRow[];
  /** Whether any published award carries a commodity code; if none does, the page says why it lists none. */
  awardsClassified: boolean;
  narrower: { code: string; count: number }[];
  titles: (code: string) => string;
  partial: boolean;
  onShow: (tab: PartyTab) => void;
}) {
  const nav = useReaderNavigation();
  const now = useProcurementClock();
  const insights = useMemo(() => opportunityInsights(opportunities, now), [opportunities, now]);
  // Open ones by closing date, undated last.
  const closing = useMemo(
    () => opportunities
      .filter((row) => insights.openKeys.has(row.recordKey))
      .map((row) => toNoticeRow(row, now))
      .sort((a, b) => Number(!a.when) - Number(!b.when) || a.when.localeCompare(b.when)),
    [opportunities, insights, now],
  );
  const awarded = useAwarded(awards);
  const buyers = useBuyers(opportunities, awards);
  const years = useYears(awards, awarded.currency);
  const level = levelName(code).toLowerCase();

  return (
    <>
      {opportunities.length + awards.length <= SMALL ? (
        <p className="procurement-party__lead">
          {leadSentence(insights, closing, opportunities.length, awards.length, awarded, awardsClassified)}
          {partial ? " · so far." : "."}
        </p>
      ) : (
        <Tiles
          open={insights.open}
          soon={insights.windows.today + insights.windows.week}
          later={insights.windows.twoWeeks}
          undated={insights.windows.undated}
          opportunities={opportunities.length}
          awards={awards.length}
          awarded={awarded}
          partial={partial}
          onShow={onShow}
        />
      )}
      {!awardsClassified && (
        <p className="procurement-party__note">The published awards don't carry commodity codes, so this page counts opportunities only.</p>
      )}
      <div className="procurement-analytics__columns procurement-party__overview">
        {narrower.length > 0 && <NarrowerCard code={code} name={name} narrower={narrower} titles={titles} />}
        {closing.length > 0 && (
          <ChartCard
            title="Closing soonest"
            subtitle={`Open opportunities in this ${level}${partial ? ", so far" : ""}.`}
            headingLevel={3}
            footer={closing.length > PREVIEW && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onShow("opportunities")}>
                All {count(closing.length)} open opportunities
              </button>
            )}
          >
            <NoticeLinks
              rows={closing.slice(0, PREVIEW)}
              onOpen={nav.openNotice}
              meta={(row) => (
                <span className="procurement-reader__when" data-state={row.state}>
                  {row.organization && <>{row.organization} · </>}
                  {row.when ? `Closes ${row.whenText}` : row.whenText}
                  {row.relative && <small> · {row.relative}</small>}
                </span>
              )}
              aside={(row) => (row.documents ? counted(row.documents, "document") : null)}
            />
          </ChartCard>
        )}
        {buyers.length > 0 && <BuyersCard buyers={buyers} level={level} partial={partial} />}
        {awarded.suppliers.length > 0 && <TopSuppliers title="Leading suppliers" who={`buyers in this ${level}`} awarded={awarded} partial={partial} />}
        {years.length > 1 && <YearsCard years={years} currency={awarded.currency} partial={partial} />}
      </div>
    </>
  );
}

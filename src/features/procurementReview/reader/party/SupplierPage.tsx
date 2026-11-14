/**
 * A supplier across the catalog (`?supplier=<name>`): what it has won, from
 * whom, and how large its contracts run. This is what a bidder most wants to
 * know about a competitor (or a partner), so supplier names elsewhere in the
 * reader link here. The workspace's own organisation is marked "Us".
 *
 * Read from the whole award list, matched by name the way buyers are
 * (`partyKey`); the server's analysis and paging know buyers only. Two tabs:
 * Overview (the figures, the buyers it won from, its latest wins) and Awards
 * (one table, without the supplier column every row would repeat). Suppliers
 * publish no opportunities, so there is no Opportunities tab.
 */
import { useDeferredValue, useMemo } from "react";
import { Building2 } from "lucide-react";
import { EmptyState, Skeleton } from "../../../../components/ui";
import { ChartCard } from "../../../../components/charts";
import { StatTile } from "../../../../components/StatTile";
import { count, counted, money, normalizeAwards, quantile, rank } from "../../lib/market";
import { shortSourceDate } from "../../lib/notice";
import { useIsOurOrganisation } from "../../lib/ourOrganisation";
import { useProcurementClock } from "../../lib/clock";
import { toNoticeRow } from "../../../../../shared/procurementNoticeRow";
import { NoticeTable } from "../NoticeTable";
import { ReaderBackButton, ReaderHeader } from "../ReaderHeader";
import { useReaderNavigation } from "../routes";
import { useReaderSource, type ListRow } from "../source";
import { Amount, LoadingLine, RankedCard, RankedList, foldRanked } from "../analytics/parts";
import {
  NoticeLinks,
  PARTY_ROUTE_KEY,
  PREVIEW,
  PartyLink,
  PartyTabs,
  UsBadge,
  partyKey,
  progressOf,
  titleOf,
  usePartyTab,
} from "./parts";

/** At most this many wins, the overview leads with a sentence instead of tiles. */
const SMALL = 2;
type SupplierTab = "overview" | "awards";

export function SupplierPage({ name }: { name: string }) {
  const source = useReaderSource();
  const ours = useIsOurOrganisation();
  const [requested, setTab] = usePartyTab();
  const tab: SupplierTab = requested === "awards" ? "awards" : "overview";
  const awardList = source.useList("award");
  const loaded = useDeferredValue(awardList);
  const key = partyKey(name);
  const awards = useMemo(
    () => (key && loaded ? loaded.rows.filter((row) => partyKey(row.supplier) === key) : []),
    [loaded, key],
  );
  const header = (subtitle?: string) => (
    <ReaderHeader
      title={
        ours(name) ? (
          <>
            {titleOf(name)} <UsBadge />
          </>
        ) : (
          titleOf(name)
        )
      }
      routeKey={PARTY_ROUTE_KEY}
      eyebrow="Supplier"
      subtitle={subtitle}
    />
  );

  if (!awardList) {
    return (
      <div className="procurement-party" aria-busy="true">
        {header("Reading the published awards…")}
        <div className="stat-grid procurement-analytics__stats">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={92} width="100%" radius={8} />
          ))}
        </div>
      </div>
    );
  }
  if (awardList.done && awards.length === 0) {
    return (
      <div className="procurement-party">
        {header()}
        <EmptyState
          icon={<Building2 size={18} />}
          title="No published awards to this supplier"
          description="The name may be spelled differently in the source, or Zoer published a newer catalog without these awards."
          action={<ReaderBackButton />}
        />
      </div>
    );
  }
  const partial = !awardList.done;
  return (
    <div className="procurement-party">
      {header(`${counted(awards.length, "published award")}${partial ? " so far" : ""}`)}
      <LoadingLine list={awardList} noun="awards" />
      <PartyTabs<SupplierTab>
        tab={tab}
        onChange={setTab}
        items={[
          { id: "overview", label: "Overview" },
          { id: "awards", label: "Awards", count: awards.length },
        ]}
      >
        {tab === "overview" ? (
          <SupplierSummary awards={awards} partial={partial} onAwards={() => setTab("awards")} />
        ) : (
          <NoticeTable
            kind="award"
            rows={awards}
            tableId="procurement-review:supplier:award"
            view="all"
            label="Latest first"
            progress={progressOf(awardList)}
            hiddenFields={["supplier"]}
          />
        )}
      </PartyTabs>
    </div>
  );
}

/** What it won, in one currency (CAD unless it wins in another only; currencies are never added together). */
function useWon(awards: ListRow[]) {
  return useMemo(() => {
    const normalized = normalizeAwards(awards);
    const currency = normalized.some((award) => award.currencyCode === "CAD") ? "CAD" : (normalized[0]?.currencyCode ?? "CAD");
    const inCurrency = normalized.filter((award) => award.currencyCode === currency);
    const values = inCurrency.flatMap((award) => (award.value === null ? [] : [award.value]));
    const all = inCurrency.reduce((n, award) => n + Math.max(0, award.value ?? 0), 0);
    const latest = normalized.reduce<(typeof normalized)[number] | null>(
      (last, award) => (award.date && (!last?.date || award.date > last.date) ? award : last),
      null,
    );
    return {
      currency,
      value: values.reduce((n, value) => n + value, 0),
      valued: values.length,
      median: quantile(values, 0.5),
      other: normalized.length - inCurrency.length,
      buyers: rank(inCurrency, "buyer").map((row) => ({ ...row, share: all > 0 ? row.positiveValue / all : 0 })),
      latest,
    };
  }, [awards]);
}
type Won = ReturnType<typeof useWon>;

/** Wins, total value, the typical award and the latest win, without the ones that have nothing to say. */
function SupplierTiles({ wins, won, partial, onAwards }: { wins: number; won: Won; partial: boolean; onAwards: () => void }) {
  const now = useProcurementClock();
  const so = (text?: string) => (partial ? [text, "so far"].filter(Boolean).join(" · ") : text);
  const latestDate = won.latest?.date ? shortSourceDate(won.latest.date, now) : null;
  const tiles = [
    <StatTile
      key="wins"
      label="Wins"
      value={count(wins)}
      sub={so(won.buyers.length ? `From ${counted(won.buyers.length, "buyer")}` : undefined)}
      onClick={onAwards}
      actionLabel="Show the awards"
    />,
    won.valued > 0 && (
      <StatTile
        key="value"
        label="Total value"
        value={<Amount value={won.value} currency={won.currency} />}
        sub={so([won.valued < wins ? `${count(won.valued)} with values` : "", won.other ? `${count(won.other)} in other currencies` : ""].filter(Boolean).join(" · ") || undefined)}
      />
    ),
    won.valued > 1 && (
      <StatTile key="typical" label="Typical award" value={<Amount value={won.median} currency={won.currency} />} sub="Median of the recorded values" />
    ),
    won.latest && latestDate && <StatTile key="latest" label="Latest win" compact value={latestDate} sub={won.latest.buyer} />,
  ].filter(Boolean);
  return <div className="stat-grid procurement-analytics__stats" data-count={tiles.length}>{tiles}</div>;
}

/**
 * Wins, total value, the typical award and the latest win; the buyers it won
 * from, by value, each opening its buyer page; its latest wins, each opening
 * the notice. One or two wins read better as a sentence than as tiles.
 */
function SupplierSummary({
  awards,
  partial,
  onAwards,
}: {
  awards: ListRow[];
  partial: boolean;
  onAwards: () => void;
}) {
  const nav = useReaderNavigation();
  const now = useProcurementClock();
  const won = useWon(awards);
  const recent = useMemo(
    () =>
      awards
        .map((row) => toNoticeRow(row, now))
        .sort((a, b) => b.when.localeCompare(a.when))
        .slice(0, PREVIEW),
    [awards, now],
  );
  const moneyOf = (value: number) => money(value, won.currency, true);
  const exactOf = (value: number) => money(value, won.currency);
  const small = awards.length <= SMALL;
  const buyers = foldRanked(
    won.buyers.map((row) => ({
      key: row.name,
      label: row.name,
      value: Math.max(0, row.value),
      share: row.share,
      detail: counted(row.count, "award"),
      href: nav.partyHref("organization", row.name),
    })),
    8,
  );
  const latestDate = won.latest?.date ? shortSourceDate(won.latest.date, now) : null;

  return (
    <>
      {small ? (
        <p className="procurement-party__lead">
          {counted(awards.length, "win")}
          {won.buyers.length === 1 && (
            <>
              , from <PartyLink field="organization" name={won.buyers[0].name} />
            </>
          )}
          {won.valued > 0 && <>, <Amount value={won.value} currency={won.currency} /></>}
          {latestDate && <> · {awards.length === 1 ? latestDate : `latest ${latestDate}`}</>}
          {partial && " · so far"}.
        </p>
      ) : (
        <SupplierTiles wins={awards.length} won={won} partial={partial} onAwards={onAwards} />
      )}
      {!small && won.buyers.length === 1 && (
        <p className="procurement-party__note">
          All from <PartyLink field="organization" name={won.buyers[0].name} />.
        </p>
      )}
      <div className="procurement-analytics__columns procurement-party__overview">
        {buyers.rows.length > 1 && (
          <RankedCard
            title="Won from"
            subtitle={`The buyers that awarded to this supplier, by recorded value in ${won.currency}${partial ? ", so far" : ""}. Open one for its page.`}
            headingLevel={3}
            table={{
              caption: "Buyers by recorded award value",
              columns: [
                { key: "name", label: "Buyer" },
                { key: "count", label: "Awards", numeric: true },
                { key: "value", label: "Award value", numeric: true },
              ],
              rows: won.buyers.map((row) => ({ name: row.name, count: count(row.count), value: exactOf(row.value) })),
            }}
          >
            {(showTable) => (
              <RankedList
                rows={buyers.rows}
                rest={buyers.rest}
                onMore={showTable}
                ariaLabel="Buyers by award value"
                formatValue={moneyOf}
                exactValue={exactOf}
                onSelect={(row) => nav.openParty("organization", row.key)}
                selectLabel={(row) => `Open buyer ${row.label}`}
              />
            )}
          </RankedCard>
        )}
        <ChartCard
          title="Latest wins"
          subtitle={`The most recent contracts it won${partial ? ", so far" : ""}.`}
          headingLevel={3}
          footer={
            awards.length > PREVIEW && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={onAwards}>
                All {count(awards.length)} awards
              </button>
            )
          }
        >
          <NoticeLinks
            rows={recent}
            onOpen={nav.openNotice}
            meta={(row) => (
              <>
                {row.organization ? <PartyLink field="organization" name={row.organization} /> : "Buyer not named"}
                {row.whenText && ` · ${row.whenText}`}
              </>
            )}
            aside={(row) => (row.value === null ? null : <Amount value={row.value} currency={row.currency} />)}
          />
        </ChartCard>
      </div>
    </>
  );
}

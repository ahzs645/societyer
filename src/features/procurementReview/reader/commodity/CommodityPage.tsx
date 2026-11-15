/**
 * One UNSPSC code across the catalog (`?commodity=<code>`): the notices
 * classified under it, who buys it and who wins it. Opened from a notice's
 * commodities, a breadcrumb, a narrower code or the list's commodity filter;
 * it shows over the list or the analytics as a buyer page does, and a notice
 * opens over it. Back names where it was opened from.
 *
 * A segment, family or class includes everything under it, as the list's
 * commodity filter and the analytics' do (shared/unspsc.ts), so the counts
 * here match theirs. The header names the code's level and title, the trail
 * above it in the hierarchy (each a page of its own), and the tabs are the
 * buyer page's: Overview (CommoditySummary.tsx), then Opportunities and
 * Awards, each the shared notice table.
 *
 * Read from the whole lists, as the supplier page is: the server's paging
 * and analysis know buyers, not commodities. Awards match by their own
 * classification; where a catalog's awards carry no codes, the page says so
 * rather than showing none.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronRight, Tags } from "lucide-react";
import { EmptyState, Skeleton } from "../../../../components/ui";
import { counted } from "../../lib/market";
import { useProcurementClock } from "../../lib/clock";
import { isOpenOpportunity } from "../../lib/insights";
import { unspscAncestors } from "../../../../../shared/unspsc";
import { titlesFromRows } from "../filters/commodityTree";
import { NoticeTable, type NoticeViewId } from "../NoticeTable";
import { ReaderBackButton, ReaderHeader, plainClick } from "../ReaderHeader";
import { ReaderPlaceTitleContext, useReaderNavigation } from "../routes";
import { useReaderSource, type ListRow, type RecordList } from "../source";
import { LoadingLine } from "../analytics/parts";
import { PARTY_ROUTE_KEY, PartyTabs, progressOf, usePartyTab } from "../party/parts";
import { CommodityLink } from "./CommodityLink";
import { CommoditySummary } from "./CommoditySummary";
import { codeLabel, inCommodity, isClassified, levelName, narrowerCodes } from "./codes";
import { rememberCommodityTitles, useCommodityTitles } from "./titles";

const under = (list: RecordList | undefined, code: string): ListRow[] => (list ? list.rows.filter((row) => inCommodity(row, code)) : []);

export function CommodityPage({ code }: { code: string }) {
  const source = useReaderSource();
  const now = useProcurementClock();
  const [tab, setTab] = usePartyTab();
  const opportunityList = source.useList("opportunity");
  const awardList = source.useList("award");
  const opportunityRows = useDeferredValue(opportunityList);
  const awardRows = useDeferredValue(awardList);
  const opportunities = useMemo(() => under(opportunityRows, code), [opportunityRows, code]);
  const awards = useMemo(() => under(awardRows, code), [awardRows, code]);
  // Whether any award in the catalog is classified at all: if none is, an empty Awards tab says why.
  const awardsClassified = useMemo(() => Boolean(awardRows?.rows.some(isClassified)), [awardRows]);
  const notices = useMemo(() => [...opportunities, ...awards], [opportunities, awards]);
  const narrower = useMemo(() => narrowerCodes(notices, code), [notices, code]);
  const trail = useMemo(() => unspscAncestors(code), [code]);
  // The notices name their codes and those codes' ancestors: enough for this code, its trail and what's below it.
  useEffect(() => rememberCommodityTitles(titlesFromRows(notices)), [notices]);
  const titles = useCommodityTitles([code, ...trail, ...narrower.map((item) => item.code)]);
  const title = titles(code);
  const level = levelName(code);
  const name = title || `Untitled ${level.toLowerCase()}`;
  const [view, setView] = useState<NoticeViewId | null>(null);

  const done = Boolean(opportunityList?.done && awardList?.done);
  const partial = !done;
  const header = (subtitle?: string) => (
    <CommodityHeader code={code} name={name} trail={trail} titles={titles} subtitle={subtitle} analytics={awardsClassified && (source.catalog.counts.award ?? 0) > 0} />
  );

  let body;
  if (!opportunityList || !awardList) {
    body = (
      <div className="procurement-party procurement-commodity" aria-busy="true">
        {header("Reading the published notices…")}
        <div className="stat-grid procurement-analytics__stats">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={92} width="100%" radius={8} />
          ))}
        </div>
      </div>
    );
  } else if (done && notices.length === 0) {
    body = (
      <div className="procurement-party procurement-commodity">
        {header()}
        <EmptyState
          icon={<Tags size={18} />}
          title={`No published notices under this ${level.toLowerCase()}`}
          description="Notices are matched by the UNSPSC codes their source classifies them under. Pre-2023 BC Bid notices and other sources' categories carry none."
          action={<ReaderBackButton />}
        />
      </div>
    );
  } else {
    const anyOpen = opportunities.some((row) => isOpenOpportunity(row, now));
    const none = (list: RecordList, noun: string, why?: string) => (
      <p className="muted">{!list.done ? "None found yet." : why ?? `No published ${noun} under ${name}.`}</p>
    );
    body = (
      <div className="procurement-party procurement-commodity">
        {header(`${counted(notices.length, "published notice")}${partial ? " so far" : ""}`)}
        {partial && (
          <LoadingLine
            list={!opportunityList.done ? opportunityList : awardList}
            noun={!opportunityList.done ? "opportunities" : "awards"}
          />
        )}
        <PartyTabs
          tab={tab}
          onChange={setTab}
          items={[
            { id: "overview", label: "Overview" },
            { id: "opportunities", label: "Opportunities", count: opportunities.length },
            { id: "awards", label: "Awards", count: awards.length },
          ]}
        >
          {tab === "overview" && (
            <CommoditySummary
              code={code}
              name={name}
              opportunities={opportunities}
              awards={awards}
              awardsClassified={awardsClassified}
              narrower={narrower}
              titles={titles}
              partial={partial}
              onShow={setTab}
            />
          )}
          {tab === "opportunities" &&
            (opportunities.length ? (
              <NoticeTable
                kind="opportunity"
                rows={opportunities}
                tableId="procurement-review:commodity:opportunity"
                // Open ones first, closing soonest; a commodity with nothing open shows everything.
                view={view ?? (anyOpen ? "upcoming" : "all")}
                onChangeView={setView}
                progress={progressOf(opportunityList)}
              />
            ) : (
              none(opportunityList, "opportunities")
            ))}
          {tab === "awards" &&
            (awards.length ? (
              <NoticeTable
                kind="award"
                rows={awards}
                tableId="procurement-review:commodity:award"
                view="all"
                label="Latest first"
                progress={progressOf(awardList)}
              />
            ) : (
              none(awardList, "awards", awardsClassified ? undefined : "The published awards don't carry commodity codes, so none can be listed by commodity.")
            ))}
        </PartyTabs>
      </div>
    );
  }
  return <ReaderPlaceTitleContext.Provider value={name}>{body}</ReaderPlaceTitleContext.Provider>;
}

/**
 * The page's head: Back, the level ("Class"), the title with its code, the
 * trail of broader codes it sits in (each opening its own page), the counts,
 * and "See in analytics" where the awards carry codes to analyse.
 */
function CommodityHeader({ code, name, trail, titles, subtitle, analytics }: {
  code: string;
  name: string;
  trail: string[];
  titles: (code: string) => string;
  subtitle?: string;
  analytics: boolean;
}) {
  const nav = useReaderNavigation();
  return (
    <ReaderHeader
      title={
        <>
          {name} <span className="procurement-commodity__code">{code}</span>
        </>
      }
      routeKey={PARTY_ROUTE_KEY}
      eyebrow={levelName(code)}
      subtitle={
        <>
          {trail.length > 0 && (
            <span className="procurement-commodity__trail">
              <span className="muted">In </span>
              {trail.map((item, index) => (
                <span key={item}>
                  {index > 0 && <ChevronRight size={12} aria-hidden="true" className="procurement-commodity__sep" />}
                  <CommodityLink code={item} className="procurement-commodity__trail-link" title={codeLabel(item, titles(item))}>
                    {titles(item) || item}
                  </CommodityLink>
                </span>
              ))}
            </span>
          )}
          {subtitle && <span className="procurement-commodity__counts">{subtitle}</span>}
        </>
      }
      actions={
        analytics ? (
          <a
            className="btn btn--sm"
            href={nav.commodityAnalyticsHref(code)}
            // Phones show header actions as icons; the name stays.
            aria-label="See in analytics"
            title="The award analytics for this code"
            onClick={(event) => {
              if (!plainClick(event)) return;
              event.preventDefault();
              nav.openCommodityAnalytics(code);
            }}
          >
            <BarChart3 size={14} aria-hidden="true" /> See in analytics
          </a>
        ) : undefined
      }
    />
  );
}

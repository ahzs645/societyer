/**
 * One organisation across the catalog, for a quick flow from a notice: as the
 * buyer (`?buyer=`), what else it is looking for and whom it has awarded; as
 * the organisation a notice is issued for (`?issuedFor=`), the same, and the
 * buyers who issue for it. A supplier (`?supplier=`) has its own page
 * (party/SupplierPage.tsx): what it won, and from whom.
 *
 * In tabs, so a buyer with hundreds of awards isn't one endless scroll:
 * Overview (the figures, what closes soonest, the latest awards, the top
 * suppliers and the organisations it issues for), then Opportunities and
 * Awards, each one table that fills the page. The tab is in the URL
 * (`partyTab`), so Back from a notice lands on the same one. Both lists load
 * progressively, so the figures say when they're partial. A notice opens over
 * this page, and Back returns here. The overview itself is
 * party/BuyerSummary.tsx; it fits what the organisation has published.
 */
import { useDeferredValue, useMemo, useState } from "react";
import { BarChart3, Building2, ExternalLink } from "lucide-react";
import { EmptyState, Skeleton } from "../../../components/ui";
import { ChartCard } from "../../../components/charts";
import { StatTile } from "../../../components/StatTile";
import { count, counted, money } from "../lib/market";
import { isOpenOpportunity } from "../lib/insights";
import { safeHttpsUrl, sourceLabel } from "../lib/notice";
import { useIsOurOrganisation } from "../lib/ourOrganisation";
import { NoticeTable, type NoticeViewId } from "./NoticeTable";
import { ReaderBackButton, ReaderHeader } from "./ReaderHeader";
import { useReaderNavigation, type PartyField } from "./routes";
import { useReaderSource, type ListRow, type RecordList } from "./source";
import { Amount, LoadingLine, RankedList, foldRanked } from "./analytics/parts";
import { PARTY_ROUTE_KEY, PartyTabs, UsBadge, partyKey, progressOf, titleOf, usePartyTab, type NoticeTab } from "./party/parts";
import { BuyerSummary, relation, type BuyerField } from "./party/BuyerSummary";
import { SupplierPage } from "./party/SupplierPage";
import { useProcurementClock } from "../lib/clock";

const eyebrowOf = (field: BuyerField) => (field === "organization" ? "Buyer" : "Issued for");
/** Sources whose notices sit on the buyer's own procurement site (a bids&tenders portal or its website). */
const OWN_SITE_SOURCES = new Set(["bids&tenders", "Buyer's website"]);

function mine(list: RecordList | undefined, field: BuyerField, key: string): ListRow[] {
  return key && list
    ? list.rows.filter((row) => partyKey(field === "organization" ? row.organization : row.issuedFor) === key)
    : [];
}

export function BuyerPage({ field, name }: { field: PartyField; name: string }) {
  const source = useReaderSource();
  const [analysis, setAnalysis] = useState(false);
  // The summary needs the server's analysis and its table the server's pages; the
  // service reader offers analysis but only whole lists, so it reads the full page.
  // A supplier page reads the whole award list: the server's analysis and pages know buyers only.
  if (field === "supplier") return <SupplierPage name={name} />;
  if (source.useAnalysis && source.usePage) return <ServerBuyerPage field={field} name={name} />;
  if (!source.usePage || analysis) return <FullBuyerPage field={field} name={name} />;
  return <PagedBuyerPage field={field} name={name} onAnalysis={() => setAnalysis(true)} />;
}

const EMPTY_PAGE: ListRow[] = [];

/** A server-paged table of the organisation's notices of one kind. */
function ServerNotices({ field, name, tab }: { field: BuyerField; name: string; tab: NoticeTab }) {
  const kind = tab === "awards" ? "award" : "opportunity";
  return (
    <NoticeTable
      key={kind}
      kind={kind}
      rows={EMPTY_PAGE}
      tableId={`procurement-buyer:${field}:${name}:${kind}`}
      view="all"
      serverPaging
      fixedParty={{ field, name }}
    />
  );
}

/** A server with pages but no analysis: the two lists, and the full page's figures on request. */
function PagedBuyerPage({ field, name, onAnalysis }: { field: BuyerField; name: string; onAnalysis: () => void }) {
  const [tab, setTab] = usePartyTab("opportunities");
  const shown: NoticeTab = tab === "awards" ? "awards" : "opportunities";
  return (
    <div className="procurement-party">
      <ReaderHeader
        title={titleOf(name)}
        routeKey={PARTY_ROUTE_KEY}
        eyebrow={eyebrowOf(field)}
        subtitle="Notices for this organisation"
      />
      <PartyTabs<NoticeTab>
        tab={shown}
        onChange={setTab}
        items={[
          { id: "opportunities", label: "Opportunities" },
          { id: "awards", label: "Awards" },
        ]}
        trailing={
          <button type="button" className="btn btn--ghost btn--sm" onClick={onAnalysis}>
            <BarChart3 size={14} aria-hidden="true" /> Load buyer analysis
          </button>
        }
      >
        <ServerNotices field={field} name={name} tab={shown} />
      </PartyTabs>
    </div>
  );
}

function ServerBuyerPage({ field, name }: { field: BuyerField; name: string }) {
  const source = useReaderSource();
  const nav = useReaderNavigation();
  const ours = useIsOurOrganisation();
  const [tab, setTab] = usePartyTab();
  const result = source.useAnalysis!({ view: "party", party: { field, name } });
  const data = result.result?.type === "party" ? result.result.data : null;
  const soon = data ? data.opportunities.windows.today + data.opportunities.windows.week : 0;
  const cad = (value: number) => money(value, "CAD", true);
  const suppliers = data
    ? foldRanked(
        data.awards.overview.suppliers.map((row) => ({
          key: row.name,
          label: row.name,
          value: Math.max(0, row.value),
          share: row.share,
          detail: counted(row.count, "award"),
          href: nav.partyHref("supplier", row.name),
          badge: ours(row.name) ? <UsBadge /> : undefined,
        })),
        8,
      )
    : null;
  return (
    <div className="procurement-party">
      <ReaderHeader
        title={titleOf(name)}
        routeKey={PARTY_ROUTE_KEY}
        eyebrow={eyebrowOf(field)}
        subtitle="Publication summary and notices for this organisation"
      />
      <PartyTabs
        tab={tab}
        onChange={setTab}
        items={[
          { id: "overview", label: "Overview" },
          { id: "opportunities", label: "Opportunities", count: data?.opportunities.total ?? null },
          { id: "awards", label: "Awards", count: data?.awards.published ?? null },
        ]}
      >
        {tab !== "overview" ? (
          <ServerNotices field={field} name={name} tab={tab} />
        ) : result.state === "failed" ? (
          <p role="alert">
            {result.error}{" "}
            <button className="btn" onClick={result.retry}>
              Retry summary
            </button>
          </p>
        ) : data && suppliers ? (
          <>
            <div className="stat-grid procurement-analytics__stats">
              {data.opportunities.total > 0 && (
                <StatTile
                  label="Open opportunities"
                  value={count(data.opportunities.open)}
                  sub={`${count(data.opportunities.total)} published`}
                  onClick={() => setTab("opportunities")}
                />
              )}
              {soon > 0 && <StatTile label="Closing within 7 days" value={count(soon)} tone="warn" />}
              {data.awards.published > 0 && (
                <StatTile label="Awards" value={count(data.awards.published)} onClick={() => setTab("awards")} />
              )}
              {data.awards.included > 0 && (
                <StatTile
                  label="Recorded award value (CAD)"
                  value={<Amount value={data.awards.overview.value} currency="CAD" />}
                  sub={`${count(data.awards.included)} included; ${count(data.awards.excluded)} excluded by currency, supplier and date rules`}
                />
              )}
            </div>
            {suppliers.rows.length > 0 && (
              <ChartCard
                title="Top suppliers"
                subtitle="CAD recorded values; placeholder suppliers and future awards excluded. Open one for everything it won."
                headingLevel={3}
              >
                <RankedList
                  rows={suppliers.rows}
                  rest={suppliers.rest}
                  ariaLabel="Top suppliers"
                  formatValue={cad}
                  exactValue={(value) => money(value, "CAD")}
                  onSelect={(row) => nav.openParty("supplier", row.key)}
                  selectLabel={(row) => `Open supplier ${row.label}`}
                />
              </ChartCard>
            )}
          </>
        ) : (
          <p className="muted" role="status">
            Preparing buyer summary…
          </p>
        )}
      </PartyTabs>
    </div>
  );
}

/**
 * The buyer's own procurement site, from the newest of its notices that came
 * from there (a bids&tenders portal or its website). BC Bid and CanadaBuys
 * notices name no site of the buyer's, so a buyer seen only there has none.
 */
function BuyerSiteLink({ recordKey }: { recordKey: string }) {
  const source = useReaderSource();
  const record = source.useRecord(recordKey);
  const url = useMemo(() => {
    if (!record) return undefined;
    try {
      const data: unknown = JSON.parse(record.dataJson);
      return data && typeof data === "object" && "sourceUrl" in data ? safeHttpsUrl(data.sourceUrl) : undefined;
    } catch {
      return undefined;
    }
  }, [record]);
  if (!url) return null;
  return (
    <a className="btn-action" href={url} target="_blank" rel="noreferrer noopener" title={url} aria-label="Procurement site, in a new tab">
      <ExternalLink size={12} aria-hidden="true" /> Procurement site
    </a>
  );
}

function FullBuyerPage({ field, name }: { field: BuyerField; name: string }) {
  const source = useReaderSource();
  const now = useProcurementClock();
  const [tab, setTab] = usePartyTab();
  const opportunityList = source.useList("opportunity");
  const awardList = source.useList("award");
  const opportunityRows = useDeferredValue(opportunityList);
  const awardRows = useDeferredValue(awardList);
  const key = partyKey(name);
  const opportunities = useMemo(() => mine(opportunityRows, field, key), [opportunityRows, field, key]);
  const awards = useMemo(() => mine(awardRows, field, key), [awardRows, field, key]);
  const done = Boolean(opportunityList?.done && awardList?.done);
  const [view, setView] = useState<NoticeViewId | null>(null);
  const partial = !done;
  // The newest notice from the buyer's own site, for the header's link to it.
  const ownSite = useMemo(
    () =>
      field === "organization"
        ? opportunities
            .filter((row) => OWN_SITE_SOURCES.has(sourceLabel(row.recordKey)))
            .reduce<ListRow | null>((newest, row) => (!newest || row.date > newest.date ? row : newest), null)
        : null,
    [opportunities, field],
  );

  const header = (subtitle?: string) => (
    <ReaderHeader
      title={titleOf(name)}
      routeKey={PARTY_ROUTE_KEY}
      eyebrow={eyebrowOf(field)}
      subtitle={subtitle}
      actions={ownSite ? <BuyerSiteLink recordKey={ownSite.recordKey} /> : undefined}
    />
  );

  if (!opportunityList || !awardList) {
    return (
      <div className="procurement-party" aria-busy="true">
        {header("Reading the published notices…")}
        <div className="stat-grid procurement-analytics__stats">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={92} width="100%" radius={8} />
          ))}
        </div>
      </div>
    );
  }
  if (done && opportunities.length === 0 && awards.length === 0) {
    return (
      <div className="procurement-party">
        {header()}
        <EmptyState
          icon={<Building2 size={18} />}
          title={`No published notices ${relation(field)} this organisation`}
          description="The name may be spelled differently in the source, or Zoer published a newer catalog without these notices."
          action={<ReaderBackButton />}
        />
      </div>
    );
  }

  const total = opportunities.length + awards.length;
  const anyOpen = opportunities.some((row) => isOpenOpportunity(row, now));
  const none = (list: RecordList, noun: string) => (
    <p className="muted">
      {list.done ? `No published ${noun} ${relation(field)} ${titleOf(name)}.` : "None found yet."}
    </p>
  );
  return (
    <div className="procurement-party">
      {header(`${counted(total, "published notice")}${partial ? " so far" : ""}`)}
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
          <BuyerSummary field={field} opportunities={opportunities} awards={awards} partial={partial} onShow={setTab} />
        )}
        {tab === "opportunities" &&
          (opportunities.length ? (
            <NoticeTable
              kind="opportunity"
              rows={opportunities}
              tableId={`procurement-review:${field}:opportunity`}
              // Open ones first, closing soonest; a buyer with nothing open shows everything.
              view={view ?? (anyOpen ? "upcoming" : "all")}
              onChangeView={setView}
              progress={progressOf(opportunityList)}
              hiddenFields={field === "organization" ? ["organization"] : []}
            />
          ) : (
            none(opportunityList, "opportunities")
          ))}
        {tab === "awards" &&
          (awards.length ? (
            <NoticeTable
              kind="award"
              rows={awards}
              tableId={`procurement-review:${field}:award`}
              view="all"
              label="Latest first"
              progress={progressOf(awardList)}
              hiddenFields={field === "organization" ? ["organization"] : []}
            />
          ) : (
            none(awardList, "awards")
          ))}
      </PartyTabs>
    </div>
  );
}

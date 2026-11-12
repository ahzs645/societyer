/**
 * One organisation across the catalog, for a quick flow from a notice: as the
 * buyer (`?buyer=`), what else it is looking for and whom it has awarded; as
 * the organisation a notice is issued for (`?issuedFor=`), the same, and the
 * buyers who issue for it.
 *
 * In tabs, so a buyer with hundreds of awards isn't one endless scroll:
 * Overview (the figures, what closes soonest, the latest awards, the top
 * suppliers and the organisations it issues for), then Opportunities and
 * Awards, each one table that fills the page. The tab is in the URL
 * (`partyTab`), so Back from a notice lands on the same one. Both lists load
 * progressively, so the figures say when they're partial. A notice opens over
 * this page, and Back returns here.
 */
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { BarChart3, Building2 } from "lucide-react";
import { EmptyState, Skeleton } from "../../../components/ui";
import { ChartCard } from "../../../components/charts";
import { StatTile } from "../../../components/StatTile";
import { Tabs } from "../../../components/primitives";
import { count, counted, money, normalizeAwards, rank } from "../lib/market";
import { isOpenOpportunity, opportunityInsights } from "../lib/insights";
import { shortSourceDate } from "../lib/notice";
import { NoticeTable, type NoticeViewId } from "./NoticeTable";
import { ReaderBackButton, ReaderHeader } from "./ReaderHeader";
import {
  PARTY_TAB_PARAM,
  useReaderNavigation,
  type PartyField,
} from "./routes";
import { useReaderSource, type ListRow, type RecordList } from "./source";
import { LoadingLine, RankedList } from "./analytics/parts";
import { useProcurementClock } from "../lib/clock";
import { procurementPartyKey } from "../../../../shared/procurementAnalytics";
import { toNoticeRow, type NoticeRow } from "../../../../shared/procurementNoticeRow";

/** Not a registered route: the header shows no icon tile beside a long organisation name. */
const PARTY_ROUTE_KEY = "procurement-review/party";
/** The notice page's rule for "the same organisation" (lib/notice.ts `partyCount`): case, spacing and punctuation don't matter. */
const partyKey = procurementPartyKey;
const eyebrowOf = (field: PartyField) =>
  field === "organization" ? "Buyer" : "Issued for";
const titleOf = (name: string) => name || "Unnamed organisation";
/** "from" a buyer, "issued for" an organisation. */
const relation = (field: PartyField) =>
  field === "organization" ? "from" : "issued for";
/** How many notices the overview's short lists show before "All …". */
const PREVIEW = 5;

type PartyTab = "overview" | "opportunities" | "awards";
type NoticeTab = Exclude<PartyTab, "overview">;
const isPartyTab = (value: string | null): value is PartyTab =>
  value === "overview" || value === "opportunities" || value === "awards";

/** The tab showing, from the URL; changing it replaces the history entry rather than adding one. */
function usePartyTab(fallback: PartyTab = "overview") {
  const nav = useReaderNavigation();
  const requested = nav.params.get(PARTY_TAB_PARAM);
  const tab: PartyTab = isPartyTab(requested) ? requested : fallback;
  const setTab = (next: PartyTab) =>
    nav.update({ [PARTY_TAB_PARAM]: next === fallback ? null : next });
  return [tab, setTab] as const;
}

/** The tab row and the panel it controls. */
function PartyTabs<T extends PartyTab>({
  tab,
  onChange,
  items,
  trailing,
  children,
}: {
  tab: T;
  onChange: (tab: T) => void;
  items: { id: T; label: string; count?: number | null }[];
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Tabs
        value={tab}
        onChange={onChange}
        items={items}
        trailing={trailing}
        tabRoles
        ariaLabel="Organisation sections"
      />
      <div
        role="tabpanel"
        aria-label={items.find((item) => item.id === tab)?.label}
        className="procurement-party__panel"
      >
        {children}
      </div>
    </>
  );
}

const progressOf = (list: RecordList) => ({
  loaded: list.rows.length,
  total: list.total,
  done: list.done,
});

function mine(
  list: RecordList | undefined,
  field: PartyField,
  key: string,
): ListRow[] {
  return key && list
    ? list.rows.filter(
        (row) =>
          partyKey(
            field === "organization" ? row.organization : row.issuedFor,
          ) === key,
      )
    : [];
}

export function BuyerPage({
  field,
  name,
}: {
  field: PartyField;
  name: string;
}) {
  const source = useReaderSource();
  const [analysis, setAnalysis] = useState(false);
  // The summary needs the server's analysis and its table the server's pages; the
  // service reader offers analysis but only whole lists, so it reads the full page.
  if (source.useAnalysis && source.usePage)
    return <ServerBuyerPage field={field} name={name} />;
  if (!source.usePage || analysis)
    return <FullBuyerPage field={field} name={name} />;
  return (
    <PagedBuyerPage
      field={field}
      name={name}
      onAnalysis={() => setAnalysis(true)}
    />
  );
}

const EMPTY_PAGE: ListRow[] = [];

/** A server-paged table of the organisation's notices of one kind. */
function ServerNotices({
  field,
  name,
  tab,
}: {
  field: PartyField;
  name: string;
  tab: NoticeTab;
}) {
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
function PagedBuyerPage({
  field,
  name,
  onAnalysis,
}: {
  field: PartyField;
  name: string;
  onAnalysis: () => void;
}) {
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
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onAnalysis}
          >
            <BarChart3 size={14} aria-hidden="true" /> Load buyer analysis
          </button>
        }
      >
        <ServerNotices field={field} name={name} tab={shown} />
      </PartyTabs>
    </div>
  );
}

function ServerBuyerPage({ field, name }: { field: PartyField; name: string }) {
  const source = useReaderSource();
  const [tab, setTab] = usePartyTab();
  const result = source.useAnalysis!({ view: "party", party: { field, name } });
  const data = result.result?.type === "party" ? result.result.data : null;
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
          {
            id: "opportunities",
            label: "Opportunities",
            count: data?.opportunities.total ?? null,
          },
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
        ) : data ? (
          <>
            <div className="stat-grid procurement-analytics__stats">
              <StatTile
                label="Open opportunities"
                value={count(data.opportunities.open)}
                sub={`of ${count(data.opportunities.total)} published`}
                onClick={() => setTab("opportunities")}
              />
              <StatTile
                label="Closing within 7 days"
                value={count(
                  data.opportunities.windows.today +
                    data.opportunities.windows.week,
                )}
              />
              <StatTile
                label="Awards"
                value={count(data.awards.published)}
                onClick={() => setTab("awards")}
              />
              <StatTile
                label="Recorded award value (CAD)"
                value={money(data.awards.overview.value, "CAD", true)}
                sub={`${count(data.awards.included)} included; ${count(data.awards.excluded)} excluded by currency, supplier and date rules`}
              />
            </div>
            <ChartCard
              title="Top suppliers"
              subtitle="CAD recorded values; placeholder suppliers and future awards excluded."
              headingLevel={3}
            >
              <RankedList
                rows={data.awards.overview.suppliers.slice(0, 8).map((row) => ({
                  key: row.name,
                  label: row.name,
                  value: Math.max(0, row.value),
                  share: row.share,
                  detail: counted(row.count, "award"),
                }))}
                ariaLabel="Top suppliers"
                formatValue={(v) => money(v, "CAD", true)}
              />
            </ChartCard>
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

function FullBuyerPage({ field, name }: { field: PartyField; name: string }) {
  const source = useReaderSource();
  const now = useProcurementClock();
  const [tab, setTab] = usePartyTab();
  const opportunityList = source.useList("opportunity");
  const awardList = source.useList("award");
  const opportunityRows = useDeferredValue(opportunityList);
  const awardRows = useDeferredValue(awardList);
  const key = partyKey(name);
  const opportunities = useMemo(
    () => mine(opportunityRows, field, key),
    [opportunityRows, field, key],
  );
  const awards = useMemo(
    () => mine(awardRows, field, key),
    [awardRows, field, key],
  );
  const done = Boolean(opportunityList?.done && awardList?.done);
  const [view, setView] = useState<NoticeViewId | null>(null);
  const partial = !done;

  const header = (subtitle?: string) => (
    <ReaderHeader
      title={titleOf(name)}
      routeKey={PARTY_ROUTE_KEY}
      eyebrow={eyebrowOf(field)}
      subtitle={subtitle}
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
      {list.done
        ? `No published ${noun} ${relation(field)} ${titleOf(name)}.`
        : "None found yet."}
    </p>
  );
  return (
    <div className="procurement-party">
      {header(
        `${counted(total, "published notice")}${partial ? " so far" : ""}`,
      )}
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
          {
            id: "opportunities",
            label: "Opportunities",
            count: opportunities.length,
          },
          { id: "awards", label: "Awards", count: awards.length },
        ]}
      >
        {tab === "overview" && (
          <PartySummary
            field={field}
            opportunities={opportunities}
            awards={awards}
            partial={partial}
            onShow={setTab}
          />
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

/**
 * The overview: open and closing soon, how much it has awarded and to whom,
 * and when it last did; the few opportunities closing soonest and the latest
 * awards, each a way into its notice; and for an issued-for organisation the
 * buyers who issue for it (for a buyer, the organisations it issues for, when
 * there are any). The tiles for the two lists open their tabs.
 */
function PartySummary({
  field,
  opportunities,
  awards,
  partial,
  onShow,
}: {
  field: PartyField;
  opportunities: ListRow[];
  awards: ListRow[];
  partial: boolean;
  onShow: (tab: PartyTab) => void;
}) {
  const nav = useReaderNavigation();
  const now = useProcurementClock();
  const open = useMemo(
    () => opportunityInsights(opportunities, now),
    [opportunities, now],
  );
  // Open ones by closing date, undated last; the latest awards first.
  const closing = useMemo(
    () =>
      opportunities
        .filter((row) => open.openKeys.has(row.recordKey))
        .map((row) => toNoticeRow(row, now))
        .sort(
          (a, b) =>
            Number(!a.when) - Number(!b.when) || a.when.localeCompare(b.when),
        ),
    [opportunities, open, now],
  );
  const latest = useMemo(
    () =>
      awards
        .map((row) => toNoticeRow(row, now))
        .sort((a, b) => b.when.localeCompare(a.when))
        .slice(0, PREVIEW),
    [awards, now],
  );
  const awarded = useMemo(() => {
    const normalized = normalizeAwards(awards);
    // CAD unless the organisation awards in another currency only; currencies are never added together.
    const currency = normalized.some((award) => award.currencyCode === "CAD")
      ? "CAD"
      : (normalized[0]?.currencyCode ?? "CAD");
    const inCurrency = normalized.filter(
      (award) => award.currencyCode === currency,
    );
    const positive = (rows: typeof inCurrency) =>
      rows.reduce((n, award) => n + Math.max(0, award.value ?? 0), 0);
    // Shares are of everything awarded, so they add up against the Total awarded tile;
    // what went to unknown or migrated supplier names is said, not ranked.
    const all = positive(inCurrency);
    const unnamed = positive(inCurrency.filter((award) => award.placeholder));
    const suppliers = rank(
      inCurrency.filter((award) => !award.placeholder),
      "supplier",
    ).map((row) => ({ ...row, share: all > 0 ? row.positiveValue / all : 0 }));
    const latestDate = normalized.reduce<string | null>(
      (last, award) =>
        award.date && (!last || award.date > last) ? award.date : last,
      null,
    );
    return {
      currency,
      value: inCurrency.reduce((n, award) => n + (award.value ?? 0), 0),
      valued: inCurrency.filter((award) => award.value !== null).length,
      other: normalized.length - inCurrency.length,
      all,
      unnamed,
      suppliers,
      latest: latestDate,
    };
  }, [awards]);
  const counterparts = useMemo(() => {
    const names = new Map<string, number>();
    for (const row of [...opportunities, ...awards]) {
      const other = (
        field === "issuedFor" ? row.organization : row.issuedFor
      ).trim();
      if (
        other &&
        partyKey(other) !==
          partyKey(field === "issuedFor" ? row.issuedFor : row.organization)
      )
        names.set(other, (names.get(other) ?? 0) + 1);
    }
    return [...names]
      .map(([label, n]) => ({ key: label, label, value: n }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [opportunities, awards, field]);
  const soon = open.windows.today + open.windows.week;
  const so = (text?: string) =>
    partial ? [text, "so far"].filter(Boolean).join(" · ") : text;
  const money0 = (value: number) => money(value, awarded.currency, true);

  return (
    <>
      <div className="stat-grid procurement-analytics__stats">
        <StatTile
          label="Open opportunities"
          value={count(open.open)}
          sub={so(
            [
              `of ${counted(opportunities.length, "opportunity", "opportunities")}`,
              // The list's "Open, closing soonest" leaves these out; say so, or the counts disagree.
              open.windows.undated
                ? `${count(open.windows.undated)} with no closing date`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
          )}
          onClick={opportunities.length ? () => onShow("opportunities") : undefined}
          actionLabel="Show the opportunities"
        />
        <StatTile
          label="Closing within 7 days"
          value={count(soon)}
          tone={soon ? "warn" : "neutral"}
          sub={so(
            open.windows.twoWeeks
              ? `${count(open.windows.twoWeeks)} more in the week after`
              : undefined,
          )}
        />
        <StatTile
          label="Awards"
          value={count(awards.length)}
          sub={so(
            awarded.latest
              ? `Latest ${shortSourceDate(awarded.latest)}`
              : awards.length
                ? "No readable award dates"
                : undefined,
          )}
          onClick={awards.length ? () => onShow("awards") : undefined}
          actionLabel="Show the awards"
        />
        <StatTile
          label="Total awarded"
          value={awarded.valued ? money0(awarded.value) : "—"}
          sub={so(
            [
              awarded.valued
                ? `${count(awarded.valued)} with values`
                : awards.length
                  ? "No values published"
                  : "",
              awarded.other
                ? `${count(awarded.other)} in other currencies`
                : "",
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          )}
        />
      </div>
      <div className="procurement-analytics__columns procurement-party__overview">
        {closing.length > 0 && (
          <ChartCard
            title="Closing soonest"
            subtitle={`Open opportunities ${relation(field)} this organisation${partial ? ", so far" : ""}.`}
            headingLevel={3}
            footer={
              closing.length > PREVIEW && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onShow("opportunities")}
                >
                  All {count(closing.length)} open opportunities
                </button>
              )
            }
          >
            <NoticeLinks
              rows={closing.slice(0, PREVIEW)}
              onOpen={nav.openNotice}
              meta={(row) => (
                <span
                  className="procurement-reader__when"
                  data-state={row.state}
                >
                  {row.when ? `Closes ${row.whenText}` : row.whenText}
                  {row.relative && <small> · {row.relative}</small>}
                </span>
              )}
              aside={(row) =>
                row.documents ? counted(row.documents, "document") : null
              }
            />
          </ChartCard>
        )}
        {latest.length > 0 && (
          <ChartCard
            title="Latest awards"
            subtitle={`Who won the most recent contracts${partial ? ", so far" : ""}.`}
            headingLevel={3}
            footer={
              awards.length > PREVIEW && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onShow("awards")}
                >
                  All {count(awards.length)} awards
                </button>
              )
            }
          >
            <NoticeLinks
              rows={latest}
              onOpen={nav.openNotice}
              meta={(row) =>
                [row.supplier || "Supplier not named", row.whenText]
                  .filter(Boolean)
                  .join(" · ")
              }
              aside={(row) =>
                row.value === null ? null : money(row.value, row.currency, true)
              }
            />
          </ChartCard>
        )}
        {awarded.suppliers.length > 0 && (
          <ChartCard
            title="Top suppliers"
            subtitle={[
              `Who ${field === "organization" ? "this buyer" : "these notices"} awarded to, by recorded value in ${awarded.currency}${partial ? ", so far" : ""}. Shares are of all ${money0(awarded.all)} awarded.`,
              awarded.unnamed > 0
                ? `${money0(awarded.unnamed)} went to unnamed or migrated suppliers, not ranked here.`
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            headingLevel={3}
          >
            <RankedList
              rows={awarded.suppliers.slice(0, PREVIEW).map((row) => ({
                key: row.name,
                label: row.name,
                value: Math.max(0, row.value),
                share: row.share,
                detail: counted(row.count, "award"),
              }))}
              ariaLabel="Top suppliers by award value"
              formatValue={money0}
            />
          </ChartCard>
        )}
        {counterparts.length > 0 && (
          <ChartCard
            title={
              field === "issuedFor"
                ? "Buyers who issue for them"
                : "Issues notices for"
            }
            subtitle={`${field === "issuedFor" ? "The buyers named on these notices." : "Organisations this buyer issued notices for."} Open one for its own page.`}
            headingLevel={3}
          >
            <RankedList
              rows={counterparts
                .slice(0, 8)
                .map((row) => ({ ...row, detail: undefined }))}
              ariaLabel={
                field === "issuedFor"
                  ? "Buyers by notices"
                  : "Organisations by notices"
              }
              formatValue={(value) => counted(value, "notice")}
              onSelect={(row) =>
                nav.openParty(
                  field === "issuedFor" ? "organization" : "issuedFor",
                  row.key,
                )
              }
              selectLabel={(row) => `Open ${row.label}`}
            />
          </ChartCard>
        )}
      </div>
    </>
  );
}

/** A short list of notices, each opening its page: the title, a line under it, and a figure at the right. */
function NoticeLinks({
  rows,
  onOpen,
  meta,
  aside,
}: {
  rows: NoticeRow[];
  onOpen: (recordKey: string) => void;
  meta: (row: NoticeRow) => ReactNode;
  aside: (row: NoticeRow) => ReactNode;
}) {
  return (
    <ul className="procurement-party__notices">
      {rows.map((row) => (
        <li key={row._id}>
          <button
            type="button"
            className="procurement-analytics__award"
            onClick={() => onOpen(row._id)}
          >
            <span className="procurement-analytics__award-title">
              {row.title}
            </span>
            <span className="procurement-party__notice-aside">
              {aside(row)}
            </span>
            <span className="procurement-analytics__award-meta muted">
              {meta(row)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One organisation across the catalog, for a quick flow from a notice: as the
 * buyer (`?buyer=`), what else it is looking for and whom it has awarded; as
 * the organisation a notice is issued for (`?issuedFor=`), the same, and the
 * buyers who issue for it. A summary up top, then its opportunities, then its
 * awards. Both lists load progressively, so the figures say when they're
 * partial. A notice opens over this page, and Back returns here.
 */
import { useDeferredValue, useMemo, useState, type MouseEvent } from "react";
import { ArrowLeft, Building2 } from "lucide-react";
import { PageHeader } from "../../../pages/_helpers";
import { EmptyState, Skeleton } from "../../../components/ui";
import { ChartCard } from "../../../components/charts";
import { StatTile } from "../../../components/StatTile";
import {
  count,
  counted,
  money,
  normalizeAwards,
  rank,
} from "../lib/market";
import { isOpenOpportunity, opportunityInsights } from "../lib/insights";
import { backLabel, shortSourceDate } from "../lib/notice";
import { NoticeTable, type NoticeViewId } from "./NoticeTable";
import { SECTION_PARAM, useReaderNavigation, type PartyField } from "./routes";
import { useReaderSource, type ListRow, type RecordList } from "./source";
import { LoadingLine, RankedList } from "./analytics/parts";
import { useProcurementClock } from "../lib/clock";
import { procurementPartyKey } from "../../../../shared/procurementAnalytics";

/** Not a registered route: the header shows no icon tile beside a long organisation name. */
const PARTY_ROUTE_KEY = "procurement-review/party";
/** The notice page's rule for "the same organisation" (lib/notice.ts `partyCount`): case, spacing and punctuation don't matter. */
const partyKey = procurementPartyKey;
const plainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

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
  const navigation = useReaderNavigation();
  const [analysis, setAnalysis] = useState(false),
    [kind, setKind] = useState<"opportunity" | "award">("opportunity");
  if (source.useAnalysis) return <ServerBuyerPage field={field} name={name} />;
  if (!source.usePage || analysis)
    return <FullBuyerPage field={field} name={name} />;
  return (
    <>
      <button className="btn btn--ghost" onClick={navigation.back}><ArrowLeft size={14} /> Back</button>
      <PageHeader title={name} subtitle="Notices for this organisation" />
      <div className="btn-group">
        <button
          className="btn btn--secondary"
          onClick={() => setKind("opportunity")}
        >
          Opportunities
        </button>
        <button className="btn btn--secondary" onClick={() => setKind("award")}>
          Awards
        </button>
        <button className="btn btn--ghost" onClick={() => setAnalysis(true)}>
          Load detailed buyer analysis
        </button>
      </div>
      <NoticeTable
        key={kind}
        kind={kind}
        rows={EMPTY_PAGE}
        tableId={`procurement-buyer:${field}:${name}:${kind}`}
        view="all"
        serverPaging
        fixedParty={{ field, name }}
      />
    </>
  );
}
const EMPTY_PAGE: ListRow[] = [];
function ServerBuyerPage({ field, name }: { field: PartyField; name: string }) {
  const source = useReaderSource(), nav = useReaderNavigation();
  const [kind, setKind] = useState<"opportunity" | "award">("opportunity");
  const result = source.useAnalysis!({ view: "party", party: { field, name } });
  const data = result.result?.type === "party" ? result.result.data : null;
  return <div className="procurement-party">
    <button className="btn btn--ghost" onClick={nav.back}><ArrowLeft size={14} /> Back</button>
    <PageHeader title={name} routeKey={PARTY_ROUTE_KEY} subtitle="Publication summary and notices for this organisation" />
    {result.state === "failed" ? <p role="alert">{result.error} <button className="btn" onClick={result.retry}>Retry summary</button></p> : data ? <>
      <div className="stat-grid procurement-analytics__stats">
        <StatTile label="Open opportunities" value={count(data.opportunities.open)} sub={`of ${count(data.opportunities.total)} published`} />
        <StatTile label="Closing within 7 days" value={count(data.opportunities.windows.today + data.opportunities.windows.week)} />
        <StatTile label="Awards" value={count(data.awards.published)} />
        <StatTile label="Recorded award value (CAD)" value={money(data.awards.overview.value, "CAD", true)} sub={`${count(data.awards.included)} included; ${count(data.awards.excluded)} excluded by currency, supplier and date rules`} />
      </div>
      <ChartCard title="Top suppliers" subtitle="CAD recorded values; placeholder suppliers and future awards excluded." headingLevel={3}>
        <RankedList rows={data.awards.overview.suppliers.slice(0, 8).map(row => ({ key: row.name, label: row.name, value: Math.max(0, row.value), share: row.share, detail: counted(row.count, "award") }))} ariaLabel="Top suppliers" formatValue={v => money(v, "CAD", true)} />
      </ChartCard>
    </> : <p className="muted" role="status">Preparing buyer summary…</p>}
    <div className="btn-group"><button className="btn btn--secondary" aria-pressed={kind === "opportunity"} onClick={() => setKind("opportunity")}>Opportunities</button><button className="btn btn--secondary" aria-pressed={kind === "award"} onClick={() => setKind("award")}>Awards</button></div>
    <NoticeTable key={kind} kind={kind} rows={EMPTY_PAGE} tableId={`procurement-buyer:${field}:${name}:${kind}`} view="all" serverPaging fixedParty={{ field, name }} />
  </div>;
}
function FullBuyerPage({ field, name }: { field: PartyField; name: string }) {
  const source = useReaderSource();
  const now = useProcurementClock();
  const nav = useReaderNavigation();
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

  const eyebrow = field === "organization" ? "Buyer" : "Issued for";
  const backTo = backLabel({
    section: nav.params.get(SECTION_PARAM),
    kind: nav.params.get("kind"),
  });
  const back = (
    <a
      className="procurement-notice__back"
      href={nav.parentHref()}
      aria-label={`Back to ${backTo}`}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.back();
      }}
    >
      <ArrowLeft size={16} aria-hidden="true" />
      <span>{backTo}</span>
    </a>
  );
  const header = (subtitle?: string) => (
    <>
      {back}
      <p className="procurement-party__eyebrow">{eyebrow}</p>
      <PageHeader
        title={name || "Unnamed organisation"}
        routeKey={PARTY_ROUTE_KEY}
        breadcrumbs={false}
        subtitle={subtitle}
      />
    </>
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
          title={`No published notices ${field === "organization" ? "from" : "issued for"} this organisation`}
          description="The name may be spelled differently in the source, or Zoer published a newer catalog without these notices."
          action={
            <button
              type="button"
              className="btn btn--accent"
              onClick={nav.back}
            >
              Back to {backTo}
            </button>
          }
        />
      </div>
    );
  }

  const total = opportunities.length + awards.length;
  const anyOpen = opportunities.some((row) => isOpenOpportunity(row, now));
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
      <PartySummary
        field={field}
        opportunities={opportunities}
        awards={awards}
        partial={partial}
      />
      <section
        className="procurement-party__section"
        aria-labelledby="procurement-party-opportunities"
      >
        <h2
          id="procurement-party-opportunities"
          className="procurement-party__heading"
        >
          Opportunities{" "}
          <span className="muted">
            {count(opportunities.length)}
            {opportunityList.done ? "" : " so far"}
          </span>
        </h2>
        {opportunities.length ? (
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
          <p className="muted">
            {opportunityList.done
              ? `No published opportunities ${field === "organization" ? "from" : "issued for"} ${name}.`
              : "None found yet."}
          </p>
        )}
      </section>
      <section
        className="procurement-party__section"
        aria-labelledby="procurement-party-awards"
      >
        <h2
          id="procurement-party-awards"
          className="procurement-party__heading"
        >
          Awards{" "}
          <span className="muted">
            {count(awards.length)}
            {awardList.done ? "" : " so far"}
          </span>
        </h2>
        {awards.length ? (
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
          <p className="muted">
            {awardList.done
              ? `No published awards ${field === "organization" ? "from" : "issued for"} ${name}.`
              : "None found yet."}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Open and closing soon, how much it has awarded and to whom, and when it
 * last did; for an issued-for organisation, the buyers who issue for it (for
 * a buyer, the organisations it issues for, when there are any).
 */
function PartySummary({
  field,
  opportunities,
  awards,
  partial,
}: {
  field: PartyField;
  opportunities: ListRow[];
  awards: ListRow[];
  partial: boolean;
}) {
  const nav = useReaderNavigation();
  const now = useProcurementClock();
  const open = useMemo(
    () => opportunityInsights(opportunities, now),
    [opportunities, now],
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
    const suppliers = rank(
      inCurrency.filter((award) => !award.placeholder),
      "supplier",
    );
    const latest = normalized.reduce<string | null>(
      (last, award) =>
        award.date && (!last || award.date > last) ? award.date : last,
      null,
    );
    return {
      currency,
      value: inCurrency.reduce((n, award) => n + (award.value ?? 0), 0),
      valued: inCurrency.filter((award) => award.value !== null).length,
      other: normalized.length - inCurrency.length,
      suppliers,
      latest,
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

  return (
    <>
      <div className="stat-grid procurement-analytics__stats">
        <StatTile
          label="Open opportunities"
          value={count(open.open)}
          sub={so(
            `of ${counted(opportunities.length, "opportunity", "opportunities")}`,
          )}
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
        />
        <StatTile
          label="Total awarded"
          value={
            awarded.valued ? money(awarded.value, awarded.currency, true) : "—"
          }
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
      {(awarded.suppliers.length > 0 || counterparts.length > 0) && (
        <div className="procurement-analytics__columns">
          {awarded.suppliers.length > 0 && (
            <ChartCard
              title="Top suppliers"
              subtitle={`Who ${field === "organization" ? "this buyer" : "these notices"} awarded to, by recorded value in ${awarded.currency}${partial ? ", so far" : ""}.`}
              headingLevel={3}
            >
              <RankedList
                rows={awarded.suppliers
                  .slice(0, 5)
                  .map((row) => ({
                    key: row.name,
                    label: row.name,
                    value: Math.max(0, row.value),
                    share: row.share,
                    detail: counted(row.count, "award"),
                  }))}
                ariaLabel="Top suppliers by award value"
                formatValue={(value) => money(value, awarded.currency, true)}
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
      )}
    </>
  );
}

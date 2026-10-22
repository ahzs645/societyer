/**
 * The notice side of the analytics: what is open and closing soon (from the
 * opportunity list), and Zoer's Decision insights over the published reviews
 * (`dashboard/review-workspace/Insights.tsx`): the fit matrix, AI suggestions
 * and recorded decisions, requirement match coverage, and decisions whose
 * evidence changed. AI output is a suggestion, never counted as a decision.
 */
import { useDeferredValue, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { ChartCard } from "../../../../components/charts";
import { StatTile } from "../../../../components/StatTile";
import { Segmented } from "../../../../components/primitives";
import { Badge, Banner, Skeleton } from "../../../../components/ui";
import { count, counted, percent } from "../../lib/market";
import {
  CLOSING_LABELS, MATCH_ORDER, READINESS_DETAIL, READINESS_TEXT, RELEVANCE_TEXT, decisionInsights, opportunityInsights,
  type ClosingWindow, type Readiness, type Relevance, type OpportunityInsights, type DecisionInsights,
} from "../../lib/insights";
import { shortSourceDate } from "../../lib/notice";
import { SECTION_PARAM, useReaderNavigation } from "../routes";
import { useReaderSource, type RecordList } from "../source";
import { useProcurementClock } from "../../lib/clock";
import { currentReviewProjection } from "../../../../../shared/procurementAnalytics";
import { LoadingLine, RankedList } from "./parts";

const WINDOWS: ClosingWindow[] = ["today", "week", "twoWeeks", "later", "undated"];
const soFar = (partial: boolean, text?: string) => (partial ? [text, "so far"].filter(Boolean).join(" · ") : text);

export function OpportunityAnalysis({ title }: { title: string }) {
  const source = useReaderSource();
  return source.useAnalysis ? <ServerOpportunities title={title} /> : <LocalOpportunities title={title} />;
}
function ServerOpportunities({ title }: { title: string }) {
  const source = useReaderSource(), result = source.useAnalysis!({ view: "opportunities" });
  if (result.state === "failed") return <Banner tone="danger">{result.error} <button className="btn" onClick={result.retry}>Retry analysis</button></Banner>;
  const data = result.result?.type === "opportunities" ? { ...result.result.data, openKeys: new Set<string>() } : opportunityInsights([]);
  return <OpportunityContent title={title} data={data} list={result.state === "ready" ? { rows: [], total: data.total, done: true } : undefined} partial={false} />;
}
function LocalOpportunities({ title }: { title: string }) {
  const source = useReaderSource(), now = useProcurementClock();
  const list = source.useList("opportunity"), rows = useDeferredValue(list?.rows);
  const data = useMemo(() => opportunityInsights(rows ?? [], now), [rows, now]);
  return <OpportunityContent title={title} data={data} list={list} partial={!list?.done} />;
}
function OpportunityContent({ title, data, list, partial }: { title: string; data: OpportunityInsights; list: RecordList | undefined; partial: boolean }) {
  const nav = useReaderNavigation();
  const openList = () => nav.update({ [SECTION_PARAM]: null, kind: null, status: "Open", q: null });
  return (
    <>
      <header className="procurement-analytics__header">
        <div className="procurement-analytics__heading">
          <h2>{title}</h2>
          <p className="muted">{list ? `${counted(data.total, "published opportunity", "published opportunities")}${partial ? " so far" : ""}; open means the closing date hasn’t passed` : "Reading the published opportunities…"}</p>
        </div>
      </header>
      <LoadingLine list={list} noun="opportunities" />
      {!list ? <Skeleton height={220} width="100%" radius={8} /> : (
        <div className="procurement-analytics__stack">
          <div className="stat-grid procurement-analytics__stats">
            <StatTile label="Open now" value={count(data.open)} sub={soFar(partial, `of ${count(data.total)}`)} onClick={openList} actionLabel="Open opportunities, closing soonest" />
            <StatTile label="Closing within 7 days" value={count(data.windows.today + data.windows.week)} tone={data.windows.today + data.windows.week ? "warn" : "neutral"} sub={soFar(partial, data.windows.today ? `${count(data.windows.today)} today` : undefined)} />
            <StatTile label="Closing in 8 to 14 days" value={count(data.windows.twoWeeks)} sub={soFar(partial)} />
            <StatTile label="Open, with documents" value={data.open ? percent(data.openWithDocuments / data.open) : "—"} sub={soFar(partial, `${count(data.openWithDocuments)} of ${count(data.open)} have files to preview`)} />
          </div>
          <div className="procurement-analytics__columns">
            <ChartCard
              title="When open opportunities close"
              subtitle={`${counted(data.open, "open opportunity", "open opportunities")}, by days to the closing date in Vancouver time.`}
              headingLevel={3}
              empty={!data.open}
              emptyMessage="Nothing is open right now."
              table={{ caption: "Open opportunities by closing window", columns: [{ key: "window", label: "Closes" }, { key: "count", label: "Opportunities", numeric: true }], rows: WINDOWS.map((window) => ({ window: CLOSING_LABELS[window], count: count(data.windows[window]) })) }}
            >
              <RankedList rows={WINDOWS.map((window) => ({ key: window, label: CLOSING_LABELS[window], value: data.windows[window], share: data.open ? data.windows[window] / data.open : 0 }))} ariaLabel="Open opportunities by closing window" formatValue={count} />
            </ChartCard>
            <ChartCard
              title="By source"
              subtitle="Open opportunities from each source Zoer collects; the total published beside it."
              headingLevel={3}
              empty={!data.total}
              table={{ caption: "Opportunities by source", columns: [{ key: "source", label: "Source" }, { key: "open", label: "Open", numeric: true }, { key: "count", label: "Published", numeric: true }], rows: data.sources.map((row) => ({ source: row.name, open: count(row.open), count: count(row.count) })) }}
            >
              <RankedList rows={data.sources.slice(0, 8).map((row) => ({ key: row.name, label: row.name, value: row.open, detail: `${count(row.count)} published` }))} ariaLabel="Open opportunities by source" formatValue={count} />
            </ChartCard>
          </div>
          <div className="procurement-analytics__columns">
            <ChartCard
              title="Buyers with the most open opportunities"
              subtitle="Open a buyer for everything it has published."
              headingLevel={3}
              empty={!data.open}
              emptyMessage="Nothing is open right now."
              table={{ caption: "Opportunities by buyer", columns: [{ key: "buyer", label: "Buyer" }, { key: "open", label: "Open", numeric: true }, { key: "count", label: "Published", numeric: true }], rows: data.buyers.slice(0, 200).map((row) => ({ buyer: row.name, open: count(row.open), count: count(row.count) })) }}
            >
              <RankedList
                rows={data.buyers.filter((row) => row.open > 0).slice(0, 10).map((row) => ({ key: row.name, label: row.name, value: row.open, detail: `${count(row.count)} published` }))}
                ariaLabel="Buyers by open opportunities"
                formatValue={count}
                onSelect={(row) => nav.openParty("organization", row.key)}
                selectLabel={(row) => `Open buyer ${row.label}`}
              />
            </ChartCard>
            <ChartCard
              title="Documents"
              subtitle="Files Zoer downloaded and published can be previewed here; listed files are named by the source but weren’t downloaded."
              headingLevel={3}
              empty={!data.total}
            >
              <RankedList
                rows={[
                  { key: "downloaded", label: "Downloaded documents", value: data.withDocuments, share: data.total ? data.withDocuments / data.total : 0 },
                  { key: "listed", label: "Listed by the source only", value: data.listedOnly, share: data.total ? data.listedOnly / data.total : 0 },
                  { key: "none", label: "No documents", value: data.total - data.withDocuments - data.listedOnly, share: data.total ? (data.total - data.withDocuments - data.listedOnly) / data.total : 0 },
                ]}
                ariaLabel="Opportunities by documents"
                formatValue={count}
              />
            </ChartCard>
          </div>
        </div>
      )}
    </>
  );
}

const RELEVANCE: Relevance[] = ["strong", "possible", "weak"];
const READINESS: Readiness[] = ["ready", "conditions", "blocker"];

export function DecisionAnalysis({ title }: { title: string }) {
  const source = useReaderSource();
  return source.useAnalysis ? <ServerDecisions title={title} /> : <LocalDecisions title={title} />;
}
function ServerDecisions({ title }: { title: string }) {
  const source = useReaderSource(), nav = useReaderNavigation();
  const scope = nav.params.get("scope") === "all" ? "all" : "open";
  const result = source.useAnalysis!({ view: "decisions", scope });
  if (result.state === "failed") return <Banner tone="danger">{result.error} <button className="btn" onClick={result.retry}>Retry analysis</button></Banner>;
  const remote = result.result?.type === "decisions" ? result.result.data : null;
  const data = remote ? { ...remote, fit: (relevance: Relevance, readiness: Readiness) => remote.fit.find(cell => cell.relevance === relevance && cell.readiness === readiness)?.count ?? 0 } : null;
  return <>{remote && <p className="muted">{remote.coverage.complete ? "Verified complete current-review projection" : "Current-review projection (legacy input inventory unverified)"} of {count(remote.coverage.total)} notices: {count(remote.coverage.notReviewed)} not reviewed; {count(remote.coverage.failed)} failed; {count(remote.coverage.olderSourceRevision)} reviewed against older source revisions; {count(remote.coverage.currentInstructions)} with current versioned instructions; {count(remote.coverage.versionUnspecified)} without verified instruction versions. {count(remote.staleCount)} decisions need reconfirmation.</p>}<DecisionContent title={title} data={data} scope={scope} waiting={result.state !== "ready"} truncated={false} titles={new Map()} /></>;
}
function LocalDecisions({ title }: { title: string }) {
  const source = useReaderSource();
  const now = useProcurementClock();
  const nav = useReaderNavigation();
  const reviews = source.useReviews();
  const opportunities = source.useList("opportunity");
  const rows = useDeferredValue(opportunities?.rows);
  const scope = nav.params.get("scope") === "all" ? "all" : "open";
  const open = useMemo(() => (scope === "open" ? opportunityInsights(rows ?? [], now).openKeys : undefined), [rows, scope, now]);
  const titles = useMemo(() => new Map((rows ?? []).map((row) => [row.recordKey, row.title])), [rows]);
  const data = useMemo(() => (reviews ? decisionInsights(currentReviewProjection(reviews.rows), open) : null), [reviews, open]);
  // The open scope needs the whole opportunity list; until then the figures would be partial.
  const waiting = !data || (scope === "open" && !opportunities?.done);
  return <DecisionContent title={title} data={data} scope={scope} waiting={waiting} truncated={reviews?.truncated ?? false} titles={titles} />;
}
function DecisionContent({ title, data, scope, waiting, truncated, titles }: { title: string; data: (DecisionInsights & { staleCount?: number }) | null; scope: "open" | "all"; waiting: boolean; truncated: boolean; titles: Map<string, string> }) {
  const nav = useReaderNavigation();
  const staleCount = data?.staleCount ?? data?.stale.length ?? 0;
  const unplaced = data ? data.assessed - RELEVANCE.reduce((n, relevance) => n + READINESS.reduce((m, readiness) => m + data.fit(relevance, readiness), 0), 0) : 0;
  return (
    <>
      <header className="procurement-analytics__header procurement-analytics__header--wrap">
        <div className="procurement-analytics__heading">
          <h2>{title}</h2>
          <p className="muted">What Zoer’s reviews found, {scope === "open" ? "for open opportunities" : "for every reviewed notice"}. Read only: decisions are made in Zoer.</p>
        </div>
        <div className="procurement-analytics__actions">
          <Segmented value={scope} onChange={(next) => nav.update({ scope: next === "open" ? null : next })} items={[{ id: "open", label: "Open opportunities" }, { id: "all", label: "All reviewed" }]} />
        </div>
      </header>

      {truncated && <Banner tone="warn">Zoer published more review rows than the reader loads at once, so these figures leave some reviews out.</Banner>}
      {waiting || !data ? <Skeleton height={220} width="100%" radius={8} /> : data.reviewed === 0 ? (
        <section className="card"><div className="card__body"><p className="muted">No published reviews {scope === "open" ? "for open opportunities yet. Try “All reviewed”." : "yet. Zoer publishes them once someone reviews a notice."}</p></div></section>
      ) : (
        <div className="procurement-analytics__stack">
          <div className="stat-grid procurement-analytics__stats">
            <StatTile label="Reviewed notices" value={count(data.reviewed)} sub={`${count(data.assessed)} with an AI assessment`} />
            <StatTile label="Decisions recorded" value={count(data.decided)} sub={data.reviewed ? `${percent(data.decided / data.reviewed)} of reviewed notices` : undefined} />
            <StatTile label="Decisions to reconfirm" value={count(staleCount)} tone={staleCount ? "warn" : "neutral"} sub="Evidence changed after the decision" />
            <StatTile label="Open tasks" value={count(data.openTasks)} sub={data.unacknowledgedChanges ? `${counted(data.unacknowledgedChanges, "change")} not yet acknowledged` : "No unacknowledged changes"} />
          </div>
          <ChartCard title="Fit and readiness" subtitle={<><AiNote /> Categorical states from the current assessment, not a score or a chance of winning.</>} headingLevel={3}>
              <div className="procurement-analytics__fit-scroll">
                <table className="procurement-analytics__fit">
                  <caption className="sr-only">Notices by work relevance (columns) and suggested readiness (rows)</caption>
                  <thead><tr><td />{RELEVANCE.map((relevance) => <th key={relevance} scope="col">{RELEVANCE_TEXT[relevance]}</th>)}</tr></thead>
                  <tbody>
                    {READINESS.map((readiness) => (
                      <tr key={readiness}>
                        <th scope="row"><span>{READINESS_TEXT[readiness]}</span><small className="muted">{READINESS_DETAIL[readiness]}</small></th>
                        {RELEVANCE.map((relevance) => {
                          const n = data.fit(relevance, readiness);
                          return <td key={relevance} data-tone={readiness}><strong>{count(n)}</strong><span className="muted">{n === 1 ? "notice" : "notices"}</span></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted procurement-analytics__caption">{counted(unplaced, "assessed notice")} not yet placed: relevance or readiness unknown. Unknowns are not counted as zero or failed.</p>
          </ChartCard>
          <div className="procurement-analytics__columns">
            <ChartCard
              title="AI suggestions"
              subtitle={<><AiNote /> {data.staleSuggestions ? `${counted(data.staleSuggestions, "suggestion")} stale: the notice changed after it.` : "The suggested next step from each notice’s current assessment."}</>}
              headingLevel={3}
              empty={!data.suggestions.length}
              emptyMessage="No AI suggestions published."
            >
              <RankedList rows={data.suggestions.map((row) => ({ key: row.label, label: row.label, value: row.count, share: data.assessed ? row.count / data.assessed : 0 }))} ariaLabel="AI suggestions by suggested action" formatValue={count} />
            </ChartCard>
            <ChartCard
              title="Decisions"
              subtitle="What people recorded in Zoer, latest decision per notice."
              headingLevel={3}
              empty={!data.decisions.length}
              emptyMessage="Nobody has recorded a decision yet."
            >
              <RankedList rows={data.decisions.map((row) => ({ key: row.label, label: row.label, value: row.count, share: data.decided ? row.count / data.decided : 0 }))} ariaLabel="Decisions by outcome" formatValue={count} />
            </ChartCard>
          </div>
          <div className="procurement-analytics__columns">
            <ChartCard
              title="Requirement match coverage"
              subtitle={`${counted(data.requirements, "extracted requirement")} across ${counted(data.withRequirements, "notice")}, by whether the workspace meets them.`}
              headingLevel={3}
              empty={!data.requirements}
              emptyMessage="No requirements extracted yet."
            >
              <RankedList rows={MATCH_ORDER.map((label) => { const n = data.matches.find((row) => row.label === label)?.count ?? 0; return { key: label, label, value: n, share: data.requirements ? n / data.requirements : 0 }; })} ariaLabel="Requirements by match" formatValue={count} />
            </ChartCard>
            <ChartCard title="Stale decisions" subtitle="Evidence changed after a decision; the earlier decision stands until someone reconfirms it in Zoer." headingLevel={3}>
                {data.stale.length === 0 ? <p className="muted">No decision needs reconfirming.</p> : (
                  <ul className="procurement-analytics__stale">
                    {data.stale.slice(0, 8).map((row) => (
                      <li key={row.recordKey}>
                        <button type="button" className="procurement-analytics__award" onClick={() => nav.openNotice(row.recordKey, "review")}>
                          <span className="procurement-analytics__award-title">{titles.get(row.recordKey) || row.recordKey}</span>
                          <Badge tone={row.tone}>{row.label}</Badge>
                          <span className="procurement-analytics__award-meta muted">{[row.at ? `Decided ${shortSourceDate(row.at)}` : "", row.note].filter(Boolean).join(" · ")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {staleCount > 8 && <p className="muted procurement-analytics__caption">And {count(staleCount - 8)} more.</p>}
            </ChartCard>
          </div>
        </div>
      )}
    </>
  );
}

function AiNote() {
  return <span className="procurement-analytics__ai"><Sparkles size={12} aria-hidden="true" /> AI suggestion, not a decision.</span>;
}

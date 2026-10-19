/**
 * Catalog-wide figures for the reader's analytics, beside the award market
 * (market.ts): what is open and closing soon, and what Zoer's reviews say.
 * The opportunity figures read the list rows; the decision figures follow
 * Zoer's Decision insights (`dashboard/review-workspace/Insights.tsx` and
 * `home-data.ts`) over the published review rows, decoded the way a notice's
 * Review tab decodes them (review.ts). AI suggestions are counted apart from
 * the decisions people recorded and never stand in for one.
 */
import type { CatalogReviewRow, ListRow } from "../reader/source";
import { deadlineOf, parseSourceDate, sourceLabel, statusOf, zoneToday } from "./notice";
import { describeReview, reviewTone } from "./review";
import { normalizeLabel } from "./market";
import type { Tone } from "./notice";

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

export type ClosingWindow = "today" | "week" | "twoWeeks" | "later" | "undated";
export const CLOSING_LABELS: Record<ClosingWindow, string> = {
  today: "Closing today", week: "In 1 to 7 days", twoWeeks: "In 8 to 14 days", later: "Later", undated: "No readable closing date",
};

type Counted = { name: string; count: number; open: number };
function tally(map: Map<string, Counted>, name: string, open: boolean) {
  const entry = map.get(name) ?? { name, count: 0, open: 0 };
  entry.count += 1; if (open) entry.open += 1;
  map.set(name, entry);
}
const byOpen = (a: Counted, b: Counted) => b.open - a.open || b.count - a.count || a.name.localeCompare(b.name);

/**
 * Whether an opportunity is still open: the source says so (or says nothing)
 * and its closing date, when readable, hasn't passed. Sources keep saying
 * "Open" for weeks after the closing date, so the date wins.
 */
export function isOpenOpportunity(row: ListRow, now = Date.now()): boolean {
  const deadline = deadlineOf(row.date || row.dateText, now);
  const status = statusOf("opportunity", row.status, deadline);
  if (status) return status.label === "Open";
  return !!deadline && deadline.state !== "closed";
}

export function opportunityInsights(rows: ListRow[], now = Date.now()) {
  const today = dayNumber(zoneToday(now));
  const windows: Record<ClosingWindow, number> = { today: 0, week: 0, twoWeeks: 0, later: 0, undated: 0 };
  const sources = new Map<string, Counted>(), buyers = new Map<string, Counted>();
  let open = 0, withDocuments = 0, listedOnly = 0, openWithDocuments = 0;
  const openKeys = new Set<string>();
  for (const row of rows) {
    const isOpen = isOpenOpportunity(row, now);
    tally(sources, sourceLabel(row.recordKey), isOpen);
    tally(buyers, normalizeLabel(row.organization) ?? "Unknown buyer", isOpen);
    if (row.documents > 0) withDocuments += 1;
    else if (row.listedDocuments > 0) listedOnly += 1;
    if (!isOpen) continue;
    open += 1; openKeys.add(row.recordKey);
    if (row.documents > 0) openWithDocuments += 1;
    const parsed = parseSourceDate(row.date || row.dateText);
    const days = parsed ? dayNumber(parsed.date) - today : null;
    windows[days === null ? "undated" : days <= 0 ? "today" : days <= 7 ? "week" : days <= 14 ? "twoWeeks" : "later"] += 1;
  }
  return {
    total: rows.length, open, openKeys, windows, withDocuments, listedOnly, openWithDocuments,
    sources: [...sources.values()].sort(byOpen),
    buyers: [...buyers.values()].sort(byOpen),
  };
}
export type OpportunityInsights = ReturnType<typeof opportunityInsights>;

// ---------------------------------------------------------------------------
// Decisions. Zoer's fit matrix crosses work relevance with the readiness its
// suggested action implies (`review-workspace/queue.ts`).

export type Relevance = "strong" | "possible" | "weak" | "unknown";
export type Readiness = "ready" | "conditions" | "blocker" | "unknown";
export const RELEVANCE_TEXT: Record<Relevance, string> = { strong: "Strong fit", possible: "Possible fit", weak: "Weak fit", unknown: "Relevance unknown" };
export const READINESS_TEXT: Record<Readiness, string> = { ready: "Ready for a decision", conditions: "Conditions", blocker: "Blocker", unknown: "Readiness unknown" };
export const READINESS_DETAIL: Record<Readiness, string> = {
  ready: "Suggested: ready for a human decision", conditions: "Suggested: needs information, investigate or consider a partner", blocker: "Suggested: decline", unknown: "",
};
const READINESS_ACTIONS: Record<Exclude<Readiness, "unknown">, readonly string[]> = {
  ready: ["ready_for_human_decision"], conditions: ["needs_information", "investigate", "consider_partner"], blocker: ["decline"],
};
const readinessOf = (action: unknown): Readiness => {
  for (const [bucket, actions] of Object.entries(READINESS_ACTIONS)) if (actions.includes(String(action))) return bucket as Readiness;
  return "unknown";
};
const relevanceOf = (value: unknown): Relevance => (value === "strong" || value === "possible" || value === "weak" ? value : "unknown");

/** Requirement match states in Zoer's order; "none" is a requirement nobody has matched yet. */
export const MATCH_ORDER = ["Met", "Gap we can close", "Not met", "Unknown", "Not applicable", "Not matched yet"] as const;

type Row = Record<string, unknown>;
function parse(json: string): Row | null {
  try { const value: unknown = JSON.parse(json); return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null; } catch { return null; }
}
const str = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const isTrue = (value: unknown) => value === 1 || value === true || value === "1";

/** The assessment describeReview shows: the newest current one, else the newest. */
function currentAssessment(rows: CatalogReviewRow[]): Row | null {
  const assessments = rows.filter((row) => row.source === "procurement_assessments").map((row) => parse(row.dataJson)).filter((row): row is Row => !!row);
  const newest = (list: Row[]) => [...list].sort((a, b) => str(b.as_of).localeCompare(str(a.as_of)))[0];
  return newest(assessments.filter((row) => isTrue(row.is_current))) ?? newest(assessments) ?? null;
}

type LabelCount = { label: string; tone: Tone; count: number };
function countLabels(map: Map<string, LabelCount>, label: string, tone: Tone) {
  const entry = map.get(label) ?? { label, tone, count: 0 };
  entry.count += 1; map.set(label, entry);
}

/**
 * `scope` limits the figures to some records (the open opportunities);
 * omitted, every reviewed record counts.
 */
export function decisionInsights(rows: CatalogReviewRow[], scope?: Set<string>) {
  const byRecord = new Map<string, CatalogReviewRow[]>();
  for (const row of rows) {
    if (scope && !scope.has(row.recordKey)) continue;
    const list = byRecord.get(row.recordKey);
    if (list) list.push(row); else byRecord.set(row.recordKey, [row]);
  }
  const suggestions = new Map<string, LabelCount>(), decisions = new Map<string, LabelCount>();
  const matches = new Map<string, number>(MATCH_ORDER.map((label) => [label, 0]));
  const fit = new Map<string, number>();
  const stale: { recordKey: string; label: string; tone: Tone; at: string; note: string }[] = [];
  let reviewed = 0, assessed = 0, staleSuggestions = 0, requirements = 0, withRequirements = 0, openTasks = 0, unacknowledgedChanges = 0;
  for (const [recordKey, list] of byRecord) {
    const review = describeReview(list);
    if (review.empty) continue;
    reviewed += 1;
    if (review.suggestion) {
      countLabels(suggestions, review.suggestion.label, review.suggestion.tone);
      if (review.suggestion.stale) staleSuggestions += 1;
    }
    if (review.decision) {
      countLabels(decisions, review.decision.label, review.decision.tone);
      if (review.decision.stale) stale.push({ recordKey, label: review.decision.label, tone: review.decision.tone, at: review.decision.at, note: review.decision.note });
    }
    if (review.requirements.length) withRequirements += 1;
    for (const requirement of review.requirements) {
      requirements += 1;
      const key = requirement.match?.label ?? "Not matched yet";
      matches.set(key, (matches.get(key) ?? 0) + 1);
    }
    openTasks += review.tasks.filter((task) => !task.done).length;
    unacknowledgedChanges += review.changes.filter((change) => !change.acknowledged).length;
    const assessment = currentAssessment(list);
    if (assessment) {
      assessed += 1;
      const cell = `${relevanceOf(assessment.relevance)}:${readinessOf(assessment.suggested_action)}`;
      fit.set(cell, (fit.get(cell) ?? 0) + 1);
    }
  }
  const sorted = (map: Map<string, LabelCount>) => [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return {
    records: byRecord.size, reviewed, assessed, staleSuggestions, requirements, withRequirements, openTasks, unacknowledgedChanges,
    suggestions: sorted(suggestions), decisions: sorted(decisions),
    decided: [...decisions.values()].reduce((n, entry) => n + entry.count, 0),
    matches: [...matches].map(([label, n]) => ({ label, count: n })),
    fit: (relevance: Relevance, readiness: Readiness) => fit.get(`${relevance}:${readiness}`) ?? 0,
    stale: stale.sort((a, b) => b.at.localeCompare(a.at)),
  };
}
export type DecisionInsights = ReturnType<typeof decisionInsights>;

/** A match label's tone, for the coverage bars (labels come from review.ts). */
export const MATCH_TONES: Record<string, Tone> = {
  Met: reviewTone("supported"), "Gap we can close": reviewTone("remediable_gap"), "Not met": reviewTone("unmet"),
  Unknown: "neutral", "Not applicable": "neutral", "Not matched yet": "neutral",
};

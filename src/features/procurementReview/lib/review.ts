/**
 * Turns the review rows Zoer published for one record (its `procurement_*`
 * tables and AI `reviews`, exported as raw rows with JSON in text columns)
 * into what a reader needs: the decision people made, the AI suggestion and
 * why, the requirements and whether the workspace meets them, extracted
 * facts, open tasks and recent changes. Nothing here is a decision; the page
 * labels AI output as a suggestion.
 */
import type { Tone } from "./notice";

export type ReviewRow = { source: string; dataJson: string };

export type ReviewModel = {
  decision?: { label: string; tone: Tone; note: string; actor: string; at: string; stale: boolean };
  suggestion?: { label: string; tone: Tone; stale: boolean; dimensions: { label: string; value: string; tone: Tone }[]; reasons: string[]; unknowns: string[]; at: string };
  summary?: { text: string; labels: string[]; model: string; at: string };
  requirements: { text: string; strength: string; category: string; match?: { label: string; tone: Tone; note: string } }[];
  facts: { label: string; value: string }[];
  tasks: { title: string; owner: string; due: string; done: boolean }[];
  changes: { text: string; at: string; acknowledged: boolean }[];
  empty: boolean;
};

const LABELS: Record<string, string> = {
  strong: "Strong", possible: "Possible", weak: "Weak", unknown: "Unknown", not_assessed: "Not assessed",
  supported_for_reviewed_requirements: "Supported for reviewed requirements", unresolved: "Unresolved", blocker: "Blocker",
  feasible: "Feasible", conditional: "Conditional", not_feasible: "Not feasible", sufficient: "Sufficient", tight: "Tight", insufficient: "Insufficient",
  assessable: "Assessable", information_needed: "Information needed", outside_policy: "Outside policy",
  investigate: "Investigate", needs_information: "Needs information", consider_partner: "Consider a partner",
  ready_for_human_decision: "Ready for a decision", decline: "Decline", archive_or_monitor: "Archive or monitor",
  pursue: "Pursue", no_bid: "No bid", monitor: "Monitor", defer: "Defer",
  mandatory: "Mandatory", preferred: "Preferred", informational: "Informational",
  supported: "Met", remediable_gap: "Gap we can close", unmet: "Not met", not_applicable: "Not applicable",
  document_added: "Document added", document_removed: "Document removed", document_changed: "Document changed",
  closing_changed: "Closing date changed", status_changed: "Status changed", amendment_added: "Amendment added",
};
export const reviewLabel = (value: unknown): string => {
  const key = typeof value === "string" ? value : "";
  return LABELS[key] ?? (key ? key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "Unknown");
};

const GOOD = new Set(["strong", "supported_for_reviewed_requirements", "feasible", "sufficient", "assessable", "ready_for_human_decision", "supported", "pursue"]);
const CAUTION = new Set(["possible", "unresolved", "conditional", "tight", "information_needed", "needs_information", "investigate", "consider_partner", "remediable_gap", "monitor", "defer"]);
const BAD = new Set(["blocker", "not_feasible", "insufficient", "outside_policy", "decline", "unmet", "no_bid"]);
/** Unknown values stay neutral: never green by default. */
export const reviewTone = (value: unknown): Tone => {
  const key = String(value);
  return GOOD.has(key) ? "success" : CAUTION.has(key) ? "warn" : BAD.has(key) ? "danger" : "neutral";
};

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
const list = (value: unknown): string[] => {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean) : [];
};
const newest = (rows: Row[], key: string) => [...rows].sort((a, b) => str(b[key]).localeCompare(str(a[key])));
const isTrue = (value: unknown) => value === 1 || value === true || value === "1";

const DIMENSIONS: [string, string][] = [["relevance", "Work fit"], ["eligibility", "Eligibility"], ["delivery", "Delivery"], ["response", "Response time"], ["commercial", "Commercial"]];

function factValue(value: unknown): string {
  const parsed = parseJson(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const row = parsed as Row;
    return str(row.raw) || str(row.text) || str(row.value) || str(row.iso);
  }
  return str(parsed);
}

export function describeReview(rows: ReviewRow[]): ReviewModel {
  const by = new Map<string, Row[]>();
  for (const row of rows) {
    const parsed = parseJson(row.dataJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    by.set(row.source, [...(by.get(row.source) ?? []), parsed as Row]);
  }
  const rowsOf = (source: string) => by.get(source) ?? [];

  const decisionRow = newest(rowsOf("procurement_decisions"), "created_at")[0];
  const decision = decisionRow && {
    label: reviewLabel(decisionRow.decision), tone: reviewTone(decisionRow.decision), note: str(decisionRow.note),
    actor: str(decisionRow.actor), at: str(decisionRow.created_at), stale: isTrue(decisionRow.needs_reconfirmation),
  };

  const assessments = rowsOf("procurement_assessments");
  const assessment = newest(assessments.filter((row) => isTrue(row.is_current)), "as_of")[0] ?? newest(assessments, "as_of")[0];
  const suggestion = assessment && {
    label: reviewLabel(assessment.suggested_action), tone: reviewTone(assessment.suggested_action), stale: str(assessment.freshness) === "stale",
    dimensions: DIMENSIONS.filter(([key]) => str(assessment[key]) && str(assessment[key]) !== "not_assessed").map(([key, label]) => ({ label, value: reviewLabel(assessment[key]), tone: reviewTone(assessment[key]) })),
    reasons: list(assessment.reasons), unknowns: list(assessment.critical_unknowns), at: str(assessment.as_of),
  };

  const review = newest(rowsOf("reviews").filter((row) => str(row.status) === "succeeded"), "created_at")[0];
  const result = review ? parseJson(review.result) : null;
  const resultRow = result && typeof result === "object" && !Array.isArray(result) ? result as Row : null;
  const triage = newest(rowsOf("procurement_stage_runs").filter((row) => str(row.stage) === "triage" && isTrue(row.is_current) && str(row.summary)), "finished_at")[0];
  const summary = resultRow && str(resultRow.summary)
    ? { text: str(resultRow.summary), labels: list(resultRow.labels), model: str(review?.model), at: str(review?.created_at) }
    : triage ? { text: str(triage.summary), labels: [], model: str(triage.model), at: str(triage.finished_at) } : undefined;

  const matches = new Map(newest(rowsOf("procurement_matches"), "updated_at").map((row) => [str(row.requirement_id), row] as const).reverse());
  const requirements = [...rowsOf("procurement_requirements")].sort((a, b) => Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0)).map((row) => {
    const match = matches.get(str(row.id));
    return {
      text: str(row.text), strength: reviewLabel(row.strength), category: reviewLabel(row.category),
      ...(match ? { match: { label: reviewLabel(match.status), tone: reviewTone(match.status), note: str(match.rationale) } } : {}),
    };
  }).filter((row) => row.text);

  const facts = rowsOf("procurement_facts").filter((row) => str(row.status) !== "explicitly_absent")
    .map((row) => ({ label: reviewLabel(row.field_key), value: factValue(row.value) })).filter((row) => row.value);

  const tasks = newest(rowsOf("procurement_tasks"), "created_at").map((row) => ({ title: str(row.title), owner: str(row.owner), due: str(row.due_at), done: str(row.status) !== "open" })).filter((row) => row.title);

  const changes = newest(rowsOf("procurement_changes"), "detected_at").map((row) => {
    const detail = parseJson(row.detail);
    const name = detail && typeof detail === "object" && !Array.isArray(detail) ? str((detail as Row).name) : "";
    return { text: name ? `${reviewLabel(row.kind)}: ${name}` : reviewLabel(row.kind), at: str(row.detected_at), acknowledged: Boolean(str(row.acknowledged_at)) };
  });

  return {
    decision, suggestion, summary, requirements, facts, tasks, changes,
    empty: !decision && !suggestion && !summary && !requirements.length && !facts.length && !tasks.length && !changes.length,
  };
}

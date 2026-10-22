/** Versioned analytical reader contract. Results contain summaries or one bounded drill-down page. */
import type { ListRow } from "./procurementListRow";
import {
  analyticalFields, defaultFilters, distribution, filterAwards, matrix, metadata, normalizeAwards, overview,
  sliceAwards, trends, validateFilters, type MarketFilters, type Slice,
} from "../src/features/procurementReview/lib/market";
import { decisionInsights, opportunityInsights, type Readiness, type Relevance } from "../src/features/procurementReview/lib/insights";
import { zoneToday } from "../src/features/procurementReview/lib/notice";
import type { CatalogReviewRow } from "../src/features/procurementReview/reader/source";

export const PROCUREMENT_METRIC_VERSION = "procurement-metrics-v2";
export const PROCUREMENT_MAPPING_VERSION = "source-party-normalization-v1";
export const ANALYSIS_PAGE_SIZE = 50;
export type AnalysisView = "overview" | "trends" | "buyers" | "suppliers" | "sizes" | "mix" | "quality" | "opportunities" | "decisions" | "party" | "awards" | "compare";
export type AnalysisRequest = {
  view: AnalysisView; filters?: Partial<MarketFilters>; year?: string; scope?: "open" | "all";
  search?: string; offset?: number; slice?: Slice; all?: boolean; party?: { field: "organization" | "issuedFor"; name: string };
  buyerLevel?: "source" | "office" | "organization" | "group" | "type";
};
const VIEWS = new Set<AnalysisView>(["overview", "trends", "buyers", "suppliers", "sizes", "mix", "quality", "opportunities", "decisions", "party", "awards", "compare"]);
const FLAGS = new Set(["future", "undated", "currency", "placeholder", "value", "negative", "zero", "contract", "justification", "mapping"]);
export const procurementPartyKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whitespace/case variants share a party; original source labels remain on each notice. */
export function canonicalProcurementRows(rows: ListRow[], level: AnalysisRequest["buyerLevel"] = "organization"): ListRow[] {
  const names = new Map<string, string>();
  for (const row of rows) for (const label of [row.organization, row.issuedFor, row.supplier]) {
    const name = label.replace(/\s+/g, " ").trim(), key = procurementPartyKey(name);
    if (key && (!names.has(key) || name.localeCompare(names.get(key)!, "en") < 0)) names.set(key, name);
  }
  return rows.map(row => {
    const extra = analyticalFields(row);
    const field = level === "office" ? "buyerDisplayName" : level === "organization" ? "buyerOrganization" : level === "group" ? "buyerGroup" : level === "type" ? "buyerType" : "buyerOriginal";
    const mapped = typeof extra[field] === "string" ? extra[field].trim() : "";
    return { ...row, organization: mapped || names.get(procurementPartyKey(row.organization)) || "", issuedFor: names.get(procurementPartyKey(row.issuedFor)) ?? "", supplier: names.get(procurementPartyKey(row.supplier)) ?? "" };
  });
}
export function matchesProcurementParty(row: ListRow, field: "organization" | "issuedFor", name: string) {
  const extra = analyticalFields(row), key = procurementPartyKey(name);
  const values = field === "issuedFor" ? [row.issuedFor] : [row.organization, extra.buyerOriginal, extra.buyerDisplayName, extra.buyerOrganization, extra.buyerGroup, extra.buyerType, ...(Array.isArray(extra.buyerAliases) ? extra.buyerAliases : [])];
  return values.some(value => typeof value === "string" && procurementPartyKey(value) === key);
}

export function normalizeAnalysisRequest(input: string | AnalysisRequest): AnalysisRequest {
  if (typeof input === "string" && input.length > 8000) throw new Error("Analysis request is too large.");
  const r = typeof input === "string" ? JSON.parse(input) : input;
  if (!r || typeof r !== "object" || !VIEWS.has(r.view)) throw new Error("Unknown analysis view.");
  const f = { ...defaultFilters, ...r.filters };
  for (const key of ["from", "to", "buyer", "supplier", "type", "currency", "minValue"] as const)
    if (typeof f[key] !== "string" || f[key].length > 500) throw new Error("Invalid analysis filter.");
  if (typeof f.includePlaceholders !== "boolean" || typeof f.includeFuture !== "boolean") throw new Error("Invalid analysis flag.");
  if (r.offset !== undefined && (!Number.isSafeInteger(r.offset) || r.offset < 0 || r.offset > 1_000_000)) throw new Error("Invalid analysis page.");
  if (r.year && !/^(19|20|21)\d{2}$/.test(r.year)) throw new Error("Choose a valid analysis year.");
  if (r.scope !== undefined && r.scope !== "all" && r.scope !== "open") throw new Error("Unknown decision scope.");
  if (r.search !== undefined && (typeof r.search !== "string" || r.search.length > 200)) throw new Error("Search is too long.");
  if (r.buyerLevel !== undefined && !["source", "office", "organization", "group", "type"].includes(r.buyerLevel)) throw new Error("Unknown buyer grouping.");
  if (r.party && (!["organization", "issuedFor"].includes(r.party.field) || typeof r.party.name !== "string" || r.party.name.length > 500)) throw new Error("Invalid analysis party.");
  const slice: Slice = {};
  if (r.slice) {
    for (const key of ["buyer", "supplier", "type", "month", "from", "to"] as const) if (r.slice[key] !== undefined) {
      if (typeof r.slice[key] !== "string" || r.slice[key].length > 500) throw new Error("Invalid drill-down scope.");
      slice[key] = r.slice[key];
    }
    for (const key of ["min", "max", "exact"] as const) if (r.slice[key] !== undefined) {
      if (typeof r.slice[key] !== "number" || !Number.isFinite(r.slice[key])) throw new Error("Invalid drill-down value.");
      slice[key] = r.slice[key];
    }
    if (r.slice.quality !== undefined) {
      if (!FLAGS.has(r.slice.quality)) throw new Error("Unknown quality rule.");
      slice.quality = r.slice.quality;
    }
  }
  return { view: r.view, filters: validateFilters(f), year: r.year ?? "", scope: r.scope ?? "open", search: (r.search ?? "").trim(), offset: r.offset ?? 0, slice, all: r.all === true, buyerLevel: r.buyerLevel ?? "organization", ...(r.party ? { party: { field: r.party.field, name: r.party.name.trim() } } : {}) };
}
export function analysisIdentity(request: AnalysisRequest, asOf: number) {
  const r = normalizeAnalysisRequest(request);
  // Deadline results share minute buckets and expire at the next precise source instant.
  const time = ["opportunities", "decisions", "party"].includes(r.view) ? Math.floor(asOf / 60_000) : zoneToday(asOf);
  return JSON.stringify([PROCUREMENT_METRIC_VERSION, PROCUREMENT_MAPPING_VERSION, time, r]);
}
const boundMeta = (m: ReturnType<typeof metadata>) => ({ ...m, typeCount: m.types.length, buyers: m.buyers.slice(0, 200), suppliers: m.suppliers.slice(0, 200), types: m.types.slice(0, 200), choicesTruncated: m.buyers.length > 200 || m.suppliers.length > 200 || m.types.length > 200 });

export function buildAwardAnalytics(input: ListRow[], request: AnalysisRequest, asOf: number) {
  const r = normalizeAnalysisRequest(request), today = zoneToday(asOf), all = normalizeAwards(canonicalProcurementRows(input, r.buyerLevel));
  const rows = filterAwards(all, r.filters!, today), data = overview(rows);
  const ranked = r.view === "suppliers" ? data.suppliers : data.buyers;
  const searchTerms = new Map<string, string[]>();
  if (r.view === "buyers" && r.search) {
    const canonical = canonicalProcurementRows(input, r.buyerLevel);
    for (const row of canonical) {
      const extra = analyticalFields(row), terms = searchTerms.get(row.organization) ?? [];
      terms.push(row.organization, String(extra.buyerOriginal ?? ""), String(extra.buyerDisplayName ?? ""), ...(Array.isArray(extra.buyerAliases) ? extra.buyerAliases.map(String) : []), ...(Array.isArray(extra.buyerHierarchy) ? extra.buyerHierarchy.map(String) : []), ...(Array.isArray(extra.buyerParticipants) ? extra.buyerParticipants.map(String) : []));
      searchTerms.set(row.organization, terms);
    }
  }
  const term = procurementPartyKey(r.search ?? "");
  const directory = ranked.filter(row => (searchTerms.get(row.name) ?? [row.name]).some(name => procurementPartyKey(name).includes(term)));
  const { buyers, suppliers, types, ...totals } = data;
  return {
    published: all.length, included: rows.length, excluded: all.length - rows.length,
    overview: { ...totals, buyers: buyers.slice(0, 25), suppliers: suppliers.slice(0, 25), types: types.slice(0, 25) },
    meta: boundMeta(metadata(all, today)),
    mappings: { versions: [...new Set(input.map(row => analyticalFields(row).mappingVersion).filter((v): v is string => typeof v === "string"))], supplied: all.filter(row => !!row.buyerId).length, published: all.length, proposed: input.some(row => analyticalFields(row).mappingProvenance?.authority === "proposed-source-label-mapping") },
    trends: r.view === "trends" ? trends(rows, r.year ?? "", today) : null,
    sizes: r.view === "sizes" ? distribution(rows) : null,
    mix: r.view === "mix" ? matrix(rows, "type") : null,
    comparison: r.view === "compare" ? comparePeriods(all, validateFilters(r.filters!), today) : null,
    directory: { rows: directory.slice(r.offset, r.offset! + ANALYSIS_PAGE_SIZE), total: directory.length, offset: r.offset!, reliant: ranked.filter(row => row.count >= 3 && (row.dependence ?? 0) >= .8).length },
    exclusions: [
      { label: `Not in ${r.filters!.currency}`, count: all.filter(row => row.currencyCode !== r.filters!.currency).length, note: "Currencies are never converted or combined." },
      { label: "Excluded source URLs", count: all.filter(row => row.urlExcluded).length, note: "The publication’s versioned URL exclusion policy." },
      { label: "Placeholder supplier", count: r.filters!.includePlaceholders ? 0 : all.filter(row => row.placeholder).length, note: "Missing or migration supplier labels." },
      { label: "Dated after today", count: r.filters!.includeFuture ? 0 : all.filter(row => !!row.date && row.date > today).length, note: "Source dates that require verification." },
    ],
  };
}
function comparePeriods(all: ReturnType<typeof normalizeAwards>, filters: MarketFilters, today: string) {
  const to = filters.to || today, from = filters.from || `${to.slice(0, 4)}-01-01`;
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  if (days < 1 || days > 36600) throw new Error("Choose a comparison period of at most 100 years.");
  const previousTo = new Date(start - 86400000).toISOString().slice(0, 10), previousFrom = new Date(start - days * 86400000).toISOString().slice(0, 10);
  const summary = (from: string, to: string) => { const result = overview(filterAwards(all, { ...filters, from, to }, today)); return { from, to, count: result.count, value: result.value, median: result.median, buyerCount: result.buyerCount, supplierCount: result.supplierCount }; };
  const current = summary(from, to), previous = summary(previousFrom, previousTo);
  return { current, previous, days, valueChange: current.value - previous.value, countChange: current.count - previous.count, valuePercent: previous.value > 0 ? (current.value - previous.value) / previous.value : null };
}
export type AwardAnalytics = ReturnType<typeof buildAwardAnalytics>;

export function buildAnalysis(input: ListRow[], evidence: CatalogReviewRow[], request: AnalysisRequest, asOf: number) {
  const r = normalizeAnalysisRequest(request), rows = canonicalProcurementRows(input, r.buyerLevel);
  if (r.view === "awards") {
    const all = normalizeAwards(rows), today = zoneToday(asOf);
    const selected = sliceAwards(r.all ? all : filterAwards(all, r.filters!, today), r.slice, today);
    const keys = new Set(selected.slice(r.offset, r.offset! + ANALYSIS_PAGE_SIZE).map(row => row.id));
    return { type: "awards" as const, data: { rows: input.filter(row => keys.has(row.recordKey)), total: selected.length, offset: r.offset! } };
  }
  if (r.view === "party") {
    if (!r.party) throw new Error("A buyer scope is required.");
    const selected = input.filter(row => matchesProcurementParty(row, r.party!.field, r.party!.name));
    return { type: "party" as const, data: { opportunities: publicOpportunities(selected.filter(row => row.kind === "opportunity"), asOf), awards: buildAwardAnalytics(selected.filter(row => row.kind === "award"), { view: "overview", filters: defaultFilters }, asOf), mappings: selected.slice(0, 50).map(row => analyticalFields(row)).filter(extra => extra.buyerId).map(extra => ({ id: String(extra.buyerId), hierarchy: Array.isArray(extra.buyerHierarchy) ? extra.buyerHierarchy.map(String) : [], status: String(extra.mappingProvenance?.status ?? "Unverified"), version: String(extra.mappingVersion ?? ""), authority: String(extra.mappingProvenance?.authority ?? "") })) } };
  }
  if (r.view === "opportunities") return { type: "opportunities" as const, data: publicOpportunities(rows, asOf) };
  if (r.view === "decisions") {
    const opportunities = opportunityInsights(rows.filter(row => row.kind === "opportunity"), asOf);
    const scope = r.scope === "open" ? opportunities.openKeys : undefined;
    const current = currentReviewProjection(evidence), result = decisionInsights(current, scope);
    const { fit, stale, ...rest } = result;
    const relevances: Relevance[] = ["strong", "possible", "weak", "unknown"], readinesses: Readiness[] = ["ready", "conditions", "blocker", "unknown"];
    const statuses = reviewCoverage(input, current, scope);
    return { type: "decisions" as const, data: { ...rest, nextBoundaryAt: opportunities.nextBoundaryAt, stale: stale.slice(0, 50), staleCount: stale.length, fit: relevances.flatMap(relevance => readinesses.map(readiness => ({ relevance, readiness, count: fit(relevance, readiness) }))), coverage: { ...statuses, total: scope?.size ?? rows.length, reviewed: result.reviewed, evidenceRows: evidence.length, currentRows: current.length, complete: false } } };
  }
  return { type: "award" as const, data: buildAwardAnalytics(rows, r, asOf) };
}
function publicOpportunities(rows: ListRow[], asOf: number) {
  const { openKeys, buyers, sources, ...rest } = opportunityInsights(rows, asOf);
  return { ...rest, buyers: buyers.slice(0, 200), sources: sources.slice(0, 200), buyerCount: buyers.length };
}
/** A complete projection, never the first N history rows. Ties break by stable run ID. */
export function currentReviewProjection(rows: CatalogReviewRow[]): CatalogReviewRow[] {
  const latest = new Map<string, { row: CatalogReviewRow; order: string }>(), retained: CatalogReviewRow[] = [];
  for (const row of rows) {
    let value: Record<string, unknown>;
    try { value = JSON.parse(row.dataJson); } catch { throw new Error(`Malformed review evidence for ${row.recordKey}.`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Review evidence must be an object.");
    if (!["reviews", "procurement_stage_runs", "procurement_assessments", "procurement_decisions", "procurement_matches"].includes(row.source)) { retained.push(row); continue; }
    const scope = row.source === "procurement_matches" ? `${value.requirement_id ?? ""}:${value.profile_version_id ?? ""}`
      : row.source === "procurement_decisions" ? "decision"
      : row.source === "procurement_assessments" ? `${value.profile_version_id ?? ""}`
      : row.source === "procurement_stage_runs" ? String(value.stage ?? "") : `${value.prompt_id ?? value.prompt_key ?? ""}:${value.profile_version_id ?? ""}`;
    const key = JSON.stringify([row.recordKey, row.source, scope]);
    const timestamp = [value.as_of, value.finished_at, value.updated_at, value.created_at].find(v => typeof v === "string" && v);
    const maintainedCurrent = (row.source === "procurement_stage_runs" || row.source === "procurement_assessments") && (value.is_current === 1 || value.is_current === true || value.is_current === "1");
    const order = `${maintainedCurrent ? "1" : "0"}\0${timestamp ?? ""}\0${value.id ?? ""}\0${row.dataJson}`;
    if (!latest.has(key) || order > latest.get(key)!.order) latest.set(key, { row, order });
  }
  const selected = [...latest.values()].map(item => item.row), extractionRuns = new Map<string, Set<string>>();
  for (const row of selected) if (row.source === "procurement_stage_runs") {
    const run = JSON.parse(row.dataJson);
    if (run.stage !== "extract" || !run.id) continue;
    const ids = extractionRuns.get(row.recordKey) ?? new Set<string>(); ids.add(String(run.id)); extractionRuns.set(row.recordKey, ids);
  }
  const currentRows = retained.filter(row => {
    if (!["procurement_requirements", "procurement_facts"].includes(row.source)) return true;
    const value = JSON.parse(row.dataJson), runs = extractionRuns.get(row.recordKey);
    return !runs || !value.stage_run_id || runs.has(String(value.stage_run_id));
  });
  const requirements = new Set(currentRows.filter(row => row.source === "procurement_requirements").map(row => String(JSON.parse(row.dataJson).id)));
  const profiles = new Map<string, { id: string; order: string }>();
  for (const row of selected) if (row.source === "procurement_assessments") {
    const value = JSON.parse(row.dataJson);
    const maintained = value.is_current === 1 || value.is_current === true || value.is_current === "1";
    if (!value.profile_version_id) continue;
    const order = `${maintained ? "1" : "0"}\0${value.as_of ?? ""}\0${value.id ?? ""}`;
    if (!profiles.has(row.recordKey) || order > profiles.get(row.recordKey)!.order) profiles.set(row.recordKey, { id: String(value.profile_version_id), order });
  }
  return [...currentRows, ...selected.filter(row => {
    if (row.source !== "procurement_matches") return true;
    const value = JSON.parse(row.dataJson), currentProfiles = profiles.get(row.recordKey);
    return requirements.has(String(value.requirement_id)) && (!currentProfiles || currentProfiles.id === String(value.profile_version_id));
  })];
}
function reviewCoverage(records: ListRow[], rows: CatalogReviewRow[], scope?: Set<string>) {
  const runs = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) if (["reviews", "procurement_stage_runs", "procurement_assessments"].includes(row.source)) {
    const list = runs.get(row.recordKey) ?? []; list.push(JSON.parse(row.dataJson)); runs.set(row.recordKey, list);
  }
  let failed = 0, olderSourceRevision = 0, currentInstructions = 0, versionUnspecified = 0, notReviewed = 0;
  for (const record of records) {
    if (scope && !scope.has(record.recordKey)) continue;
    const list = runs.get(record.recordKey);
    if (!list?.length) { notReviewed++; continue; }
    if (list.some(run => /^(failed|error|cancelled|timed_out)$/.test(String(run.status)))) { failed++; continue; }
    const revision = analyticalFields(record).sourceRevision;
    if (list.some(run => run.freshness === "stale" || (revision && (run.source_revision ?? run.reviewed_source_revision ?? run.sourceRevision) && (run.source_revision ?? run.reviewed_source_revision ?? run.sourceRevision) !== revision))) { olderSourceRevision++; continue; }
    if (list.some(run => (run.is_current === true || run.is_current === 1) && (run.prompt_version ?? run.promptVersion))) currentInstructions++;
    else versionUnspecified++;
  }
  return { failed, olderSourceRevision, currentInstructions, versionUnspecified, notReviewed };
}
export type AnalysisResult = ReturnType<typeof buildAnalysis>;
export type AnalysisState = { state: "preparing" | "ready" | "failed"; result: AnalysisResult | null; error: string | null; computedAt: number | null; asOf: number; metricVersion: string; mappingVersion: string };

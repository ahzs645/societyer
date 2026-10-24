import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { analysisIdentity, buildAnalysis, currentReviewProjection, matchesProcurementParty, normalizeAnalysisRequest, type AnalysisRequest } from "../shared/procurementAnalytics";
import { filterAwards, normalizeAwards, overview } from "../src/features/procurementReview/lib/market";
import type { ListRow } from "../shared/procurementListRow";
import { isOpenOpportunity } from "../src/features/procurementReview/lib/insights";
import { zoneToday } from "../src/features/procurementReview/lib/notice";

const now = Date.now(), today = zoneToday(now);
const base: ListRow = { recordKey: "", kind: "award", title: "Award", organization: "City", issuedFor: "", status: "Awarded", date: today, dateText: "", reference: "", documents: 0, listedDocuments: 0, supplier: "Supplier", value: 100, currency: "CAD", procurementType: "Goods" };
const awards = Array.from({ length: 140 }, (_, i) => ({ ...base, recordKey: `award:${i}`, supplier: `Supplier ${i}`, value: i + 1 }));
const mixed: ListRow[] = [...awards, { ...base, recordKey: "award:usd", currency: "USD", value: 9999999 }, { ...base, recordKey: "award:placeholder", supplier: "", value: 9999999 }, { ...base, recordKey: "award:future", date: "2199-01-01", value: 9999999 }];
for (const view of ["overview", "trends", "buyers", "suppliers", "sizes", "mix", "quality", "compare"] as const) {
  const result = buildAnalysis(mixed, [], { view }, now);
  assert.equal(result.type, "award");
  if (result.type !== "award") throw new Error("Unexpected view");
  assert.equal(result.data.included, 140);
  assert.equal(result.data.excluded, 3);
  assert.equal(result.data.overview.value, overview(filterAwards(normalizeAwards(mixed), {}, today)).value);
  assert.equal(result.data.overview.median, 70.5, "Median is recomputed over records, never added across buckets");
  assert.ok(result.data.directory.rows.length <= 50);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 900000);
}
const matching = buildAnalysis(mixed, [], { view: "awards", slice: { min: 100, max: 130 } }, now);
assert.equal(matching.type === "awards" && matching.data.total, 30);
const page2 = buildAnalysis(mixed, [], { view: "awards", offset: 50 }, now);
assert.equal(page2.type === "awards" && page2.data.rows.length, 50);
const mapped: ListRow = { ...base, recordKey: "award:mapped", organization: "Source unit", analyticsJson: JSON.stringify({ buyerId: "buyer-1", buyerOrganization: "Parent organization", buyerAliases: ["Source alias"], buyerHierarchy: ["Government", "Parent organization", "Unit"], mappingVersion: "v1", mappingProvenance: { authority: "proposed-source-label-mapping", status: "Label-supported proposal" }, contractNumber: "", justification: "" }) };
assert.ok(matchesProcurementParty(mapped, "organization", "parent ORGANIZATION"));
assert.ok(matchesProcurementParty(mapped, "organization", "source alias"));
const quality = buildAnalysis([mapped, base], [], { view: "quality" }, now);
assert.equal(quality.type === "award" && quality.data.meta.unavailable.contractNumber, 1);
assert.equal(quality.type === "award" && quality.data.meta.quality.find(f => f.flag === "contract")!.count, 1);
const mappedResult = buildAnalysis([mapped], [], { view: "buyers" }, now);
assert.equal(mappedResult.type === "award" && mappedResult.data.overview.buyers[0].name, "Parent organization");
assert.ok(mappedResult.type === "award" && mappedResult.data.mappings.proposed);
assert.throws(() => normalizeAnalysisRequest({ view: "overview", filters: { from: "2026-02-30" } }), /valid/);
assert.throws(() => normalizeAnalysisRequest({ view: "awards", slice: { min: NaN } }), /value/);
assert.throws(() => normalizeAnalysisRequest({ view: "suppliers", offset: -1 }), /page/);
assert.equal(analysisIdentity({ view: "overview" }, now), analysisIdentity({ view: "overview", filters: {} }, now));
assert.notEqual(analysisIdentity({ view: "overview" }, now), analysisIdentity({ view: "overview", filters: { currency: "USD" } }, now));
const tied = [{ recordKey: "opportunity:x", source: "reviews", dataJson: JSON.stringify({ id: "a", prompt_id: "p", created_at: today, status: "succeeded" }) }, { recordKey: "opportunity:x", source: "reviews", dataJson: JSON.stringify({ id: "b", prompt_id: "p", created_at: today, status: "failed" }) }];
assert.equal(JSON.parse(currentReviewProjection(tied)[0].dataJson).id, "b");
assert.equal(JSON.parse(currentReviewProjection(tied.reverse())[0].dataJson).id, "b", "Ties are independent of input order");
assert.equal(isOpenOpportunity({ ...base, kind: "opportunity", status: "Cancelled", date: "2199-01-01" }, now), false);
assert.equal(isOpenOpportunity({ ...base, kind: "opportunity", status: "Open", date: "2000-01-01" }, now), false);
assert.equal(isOpenOpportunity({ ...base, kind: "opportunity", status: "Accepting bids", date: "2199-01-01" }, now), true);

// Maintained current pointers and extraction lineage must survive a newer historical run.
const lifecycleAt = Date.parse("2026-10-22T12:00:00-07:00");
const notice: ListRow = { ...base, recordKey: "opportunity:lineage", kind: "opportunity", status: "Open", date: "2026-10-30", value: null, supplier: "" };
const evidence = (source: string, value: Record<string, unknown>, recordKey = notice.recordKey) => ({ source, recordKey, dataJson: JSON.stringify(value) });
const lineage = [
  evidence("procurement_stage_runs", { id: "extract-current", run_id: "workflow-current", stage: "extract", stage_key: "extract-default", template_id: "template", template_version: 1, is_current: 1, status: "succeeded", finished_at: "2026-10-20T10:00:00Z" }),
  evidence("procurement_stage_runs", { id: "extract-historical", run_id: "workflow-historical", stage: "extract", stage_key: "extract-obsolete-template", template_id: "obsolete-template", template_version: 3, is_current: 0, status: "succeeded", finished_at: "2026-10-21T10:00:00Z" }),
  evidence("procurement_assessments", { id: "assessment-current", profile_version_id: "profile-current", policy_version: "policy-1", is_current: 1, as_of: "2026-10-20T10:00:00Z", relevance: "strong", suggested_action: "ready_for_human_decision", freshness: "current" }),
  evidence("procurement_assessments", { id: "assessment-historical", profile_version_id: "profile-current", policy_version: "policy-1", is_current: 0, as_of: "2026-10-21T10:00:00Z", relevance: "weak", suggested_action: "decline", freshness: "stale" }),
  evidence("procurement_assessments", { id: "assessment-current-prior-profile", profile_version_id: "profile-prior", policy_version: "policy-1", is_current: 1, as_of: "2026-10-19T10:00:00Z", relevance: "weak", suggested_action: "decline", freshness: "current" }),
  evidence("procurement_requirements", { id: "requirement-current", stage_run_id: "extract-current", text: "Current mandatory requirement", ordinal: 1, strength: "mandatory", category: "eligibility" }),
  evidence("procurement_requirements", { id: "requirement-historical", stage_run_id: "extract-historical", text: "Superseded requirement", ordinal: 1, strength: "mandatory", category: "eligibility" }),
  evidence("procurement_facts", { id: "fact-current", stage_run_id: "extract-current", field_key: "budget", value: "Current fact", status: "stated" }),
  evidence("procurement_facts", { id: "fact-historical", stage_run_id: "extract-historical", field_key: "budget", value: "Superseded fact", status: "stated" }),
  evidence("procurement_matches", { requirement_id: "requirement-current", profile_version_id: "profile-current", status: "supported", updated_at: "2026-10-20T10:00:00Z" }),
  evidence("procurement_matches", { requirement_id: "requirement-current", profile_version_id: "profile-historical", status: "unmet", updated_at: "2026-10-21T10:00:00Z" }),
  evidence("procurement_matches", { requirement_id: "requirement-current", profile_version_id: "profile-prior", status: "unmet", updated_at: "2026-10-22T10:00:00Z" }),
  evidence("procurement_matches", { requirement_id: "requirement-historical", profile_version_id: "profile-current", status: "unmet", updated_at: "2026-10-21T10:00:00Z" }),
];
const projection = currentReviewProjection(lineage);
const projected = projection.map(row => ({ source: row.source, value: JSON.parse(row.dataJson) }));
assert.deepEqual(projected.filter(row => row.source === "procurement_stage_runs").map(row => row.value.id), ["extract-current"], "A maintained current extraction wins over a newer historical run");
assert.deepEqual(projected.filter(row => row.source === "procurement_assessments" && row.value.profile_version_id === "profile-current").map(row => row.value.id), ["assessment-current"], "A maintained current assessment wins over a newer historical row in the same profile scope");
assert.deepEqual(projected.filter(row => row.source === "procurement_requirements").map(row => row.value.id), ["requirement-current"], "Requirements join their stage_run_id to the selected stage run ID, not workflow run_id");
assert.deepEqual(projected.filter(row => row.source === "procurement_facts").map(row => row.value.id), ["fact-current"], "Facts use the same extraction lineage as requirements");
assert.ok(!projected.some(row => row.source === "procurement_matches" && row.value.requirement_id === "requirement-historical"), "Matches to a superseded requirement are excluded");
const currentDecisions = buildAnalysis([notice], lineage, { view: "decisions", scope: "all" }, lifecycleAt);
assert.equal(currentDecisions.type, "decisions");
if (currentDecisions.type !== "decisions") throw new Error("Expected decision analysis");
assert.equal(currentDecisions.data.requirements, 1);
assert.equal(currentDecisions.data.matches.find(row => row.label === "Met")?.count, 1, "An old company profile's newer match cannot override the current profile match");
assert.equal(currentDecisions.data.fit.find(row => row.relevance === "strong" && row.readiness === "ready")?.count, 1);
assert.equal(currentDecisions.data.fit.find(row => row.relevance === "weak" && row.readiness === "blocker")?.count, 0);

const staleNotices = Array.from({ length: 60 }, (_, i) => ({ ...notice, recordKey: `opportunity:stale-${i}` }));
const staleEvidence = staleNotices.map(row => evidence("procurement_decisions", { id: `decision-${row.recordKey}`, decision: "pursue", needs_reconfirmation: 1, created_at: "2026-10-20T10:00:00Z" }, row.recordKey));
const manyStale = buildAnalysis(staleNotices, staleEvidence, { view: "decisions", scope: "all" }, lifecycleAt);
assert.equal(manyStale.type, "decisions");
if (manyStale.type !== "decisions") throw new Error("Expected decision analysis");
assert.equal(manyStale.data.staleCount, 60, "The exact stale total remains separate from the bounded display sample");
assert.equal(manyStale.data.stale.length, 50, "Only the bounded stale-decision detail list is truncated");

assert.equal(isOpenOpportunity({ ...notice, status: "", date: "2026-10-30" }, lifecycleAt), false, "A future deadline does not establish an unknown source status as open");
assert.equal(isOpenOpportunity({ ...notice, date: "2026-10-22T09:00", dateText: "2026-10-22T09:00", analyticsJson: JSON.stringify({ closingDate: "2026-10-22T09:00", datePrecision: "date", dateTimezone: "unknown" }) }, lifecycleAt), true, "A same-day timezone-less time remains unverified rather than silently closed");
const precise: ListRow = { ...notice, date: "2026-10-22T12:00", dateText: "2026-10-22T19:00:30Z", analyticsJson: JSON.stringify({ closingAt: "2026-10-22T19:00:30Z", datePrecision: "instant", dateTimezone: "UTC" }) };
assert.equal(isOpenOpportunity(precise, lifecycleAt), true, "The exact offset deadline is still in the future during its final thirty seconds");
assert.equal(isOpenOpportunity(precise, lifecycleAt + 31_000), false, "The exact offset deadline closes once that instant has passed");

const aliasDirectory = buildAnalysis([mapped], [], { view: "buyers", search: "source alias" }, now);
assert.equal(aliasDirectory.type === "award" && aliasDirectory.data.directory.total, 1, "Directory alias search and buyer drill-down use the same party membership");

for (const key of ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SITE_ID", "DRIVE_ID", "TRANSFER_HOSTS"]) process.env[`PROCUREMENT_SHAREPOINT_${key}`] = "synthetic";
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./procurementReview.js": () => import("../convex/procurementReview"),
  "./procurementAnalytics.js": () => import("../convex/procurementAnalytics"),
  "./procurementAnalyticsJobs.js": () => import("../convex/procurementAnalyticsJobs"),
} as any);
const api: any = anyApi, issuer = betterAuthIssuer();
const ids = await t.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Analytics fixture", isCharity: false, isMemberFunded: false, updatedAt: 0, disabledModules: ["+procurementReview"] });
  const foreign = await ctx.db.insert("societies", { name: "Foreign", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await ctx.db.patch(societyId, { integrationSettings: { ...defaultIntegrationSettings(), procurementReviewFolder: `Zoer/bc-bid-monitor/${societyId}` } as any });
  await ctx.db.insert("users", { societyId, email: "viewer@example.invalid", displayName: "Viewer", role: "Viewer", status: "Active", authSubject: "viewer", authIssuer: issuer, authProvider: "better-auth", createdAtISO: today });
  const generation = "synthetic-publication";
  await ctx.db.insert("procurementCatalogs", { societyId, generation, folder: `Zoer/bc-bid-monitor/${societyId}`, publishedAt: new Date(now).toISOString(), counts: { award: mixed.length, opportunity: 5101 } });
  for (const row of mixed) {
    const { value, ...rest } = row;
    await ctx.db.insert("procurementRecords", { ...rest, societyId, generation, updatedAt: today, ...(value === null ? {} : { value }) });
  }
  return { societyId, foreign, generation };
});
for (let start = 0; start < 5101; start += 500) await t.run(async ctx => {
  for (let i = start; i < Math.min(5101, start + 500); i++) {
    const recordKey = `opportunity:${String(i).padStart(5, "0")}`;
    await ctx.db.insert("procurementRecords", { societyId: ids.societyId, generation: ids.generation, recordKey, kind: "opportunity", title: `Opportunity ${i}`, organization: "City", status: "Open", date: "2199-01-01", updatedAt: today });
    await ctx.db.insert("procurementEvidence", { societyId: ids.societyId, generation: ids.generation, recordKey, source: "reviews", dataJson: JSON.stringify({ id: `review-${i}`, status: "succeeded", created_at: today, result: JSON.stringify({ summary: "Reviewed" }) }) });
  }
});
const reader = t.withIdentity({ subject: "viewer", issuer });
async function analyze(r: AnalysisRequest) {
  const args = { societyId: ids.societyId, generation: ids.generation, request: JSON.stringify(r), asOf: now };
  await reader.mutation(api.procurementAnalytics.request, args);
  const job = await t.run(ctx => ctx.db.query("procurementAnalytics").withIndex("by_society_generation_key", q => q.eq("societyId", ids.societyId).eq("generation", ids.generation).eq("key", analysisIdentity(r, now))).unique());
  await t.action(api.procurementAnalytics.compute, { id: job!._id });
  const result = await reader.query(api.procurementAnalytics.get, args);
  assert.equal(result.state, "ready", result.error ?? "Expected finished analysis");
  return { result: JSON.parse(result.resultJson), args };
}
const server = await analyze({ view: "overview" });
assert.equal(server.result.data.overview.value, 9870);
await reader.mutation(api.procurementAnalytics.request, server.args);
assert.equal(await t.run(async ctx => (await ctx.db.query("procurementAnalytics").collect()).length), 1, "Replayed requests share one job/result");
const decisions = await analyze({ view: "decisions", scope: "open" });
assert.equal(decisions.result.data.coverage.evidenceRows, 5101, "Complete inputs exceed the old 5,000-row cap");
assert.equal(decisions.result.data.coverage.total, 5101);
assert.equal(decisions.result.data.coverage.reviewed, 5101);
const drill = await analyze({ view: "awards", offset: 50 });
assert.equal(drill.result.data.rows.length, 50);
assert.equal(drill.result.data.total, 140);
await t.run(async ctx => {
  const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", ids.societyId)).unique();
  await ctx.db.patch(active!._id, { expected: { procurementRecords: mixed.length + 5101, procurementDetails: 0, procurementDocuments: 0, procurementEvidence: 5102 } });
});
const incompleteRequest: AnalysisRequest = { view: "decisions", scope: "all" };
const incompleteArgs = { societyId: ids.societyId, generation: ids.generation, request: JSON.stringify(incompleteRequest), asOf: now };
await reader.mutation(api.procurementAnalytics.request, incompleteArgs);
const incompleteJob = await t.run(ctx => ctx.db.query("procurementAnalytics").withIndex("by_society_generation_key", q => q.eq("societyId", ids.societyId).eq("generation", ids.generation).eq("key", analysisIdentity(incompleteRequest, now))).unique());
await t.action(api.procurementAnalytics.compute, { id: incompleteJob!._id });
const incomplete = await reader.query(api.procurementAnalytics.get, incompleteArgs);
assert.equal(incomplete.state, "failed", "Matching notice counts cannot authenticate an incomplete review/evidence input");
assert.match(incomplete.error ?? "", /evidence|incomplete|inventory/i);
await t.run(async ctx => {
  const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", ids.societyId)).unique();
  await ctx.db.patch(active!._id, { expected: { procurementRecords: mixed.length + 5101, procurementDetails: 0, procurementDocuments: 0, procurementEvidence: 5101 } });
});
const recovered = await analyze(incompleteRequest);
assert.equal(recovered.result.data.coverage.evidenceRows, 5101, "The exact failed analytical job can be retried after input completeness is restored");
// A precise deadline can expire inside a shared cache minute, including fractional seconds.
const minuteStart = Math.floor(now / 60000) * 60000, deadlineAt = minuteStart + 30125;
await t.run(async ctx => {
  const row = await ctx.db.query("procurementRecords").withIndex("by_key", q => q.eq("societyId", ids.societyId).eq("generation", ids.generation).eq("recordKey", "opportunity:00000")).unique();
  await ctx.db.patch(row!._id, { analyticsJson: JSON.stringify({ closingAt: new Date(deadlineAt).toISOString() }) });
});
const beforeArgs = { ...server.args, request: JSON.stringify({ view: "opportunities" }), asOf: minuteStart + 1000 };
const afterArgs = { ...beforeArgs, asOf: deadlineAt + 10 };
assert.equal(analysisIdentity({ view: "opportunities" }, beforeArgs.asOf), analysisIdentity({ view: "opportunities" }, afterArgs.asOf));
await reader.mutation(api.procurementAnalytics.request, beforeArgs);
const boundaryJob = await t.run(ctx => ctx.db.query("procurementAnalytics").withIndex("by_society_generation_key", q => q.eq("societyId", ids.societyId).eq("generation", ids.generation).eq("key", analysisIdentity({ view: "opportunities" }, beforeArgs.asOf))).unique());
await t.action(api.procurementAnalytics.compute, { id: boundaryJob!._id });
const beforeDeadline = await reader.query(api.procurementAnalytics.get, beforeArgs);
assert.equal(JSON.parse(beforeDeadline.resultJson).data.open, 5101);
const expired = await reader.query(api.procurementAnalytics.get, afterArgs);
assert.equal(expired.state, "preparing");
assert.equal(expired.resultJson, null, "A cached open count cannot survive a precise deadline in the same minute");
await reader.mutation(api.procurementAnalytics.request, afterArgs);
await t.action(api.procurementAnalytics.compute, { id: boundaryJob!._id });
const afterDeadline = await reader.query(api.procurementAnalytics.get, afterArgs);
assert.equal(JSON.parse(afterDeadline.resultJson).data.open, 5100, "The same cache reservation recomputes at the exact source boundary");
await assert.rejects(reader.query(api.procurementAnalytics.get, { ...server.args, societyId: ids.foreign }), /permission|workspace|access|membership/i);
await assert.rejects(t.query(api.procurementAnalytics.get, server.args), /sign|auth/i);
await t.run(async ctx => { const active = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", ids.societyId)).unique(); await ctx.db.patch(active!._id, { generation: "new-publication" }); });
await assert.rejects(reader.query(api.procurementAnalytics.get, server.args), /publication changed/i);
console.log("OK: publication analytics, exact currency/median/filter parity, bounded directories and drill-downs, mapping provenance, complete 5,101-review coverage, deterministic ties, request deduplication, workspace authorization and generation invalidation.");

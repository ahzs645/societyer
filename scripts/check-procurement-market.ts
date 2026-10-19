/**
 * The procurement reader's analytics on fixture rows: the award market port
 * (src/features/procurementReview/lib/market.ts, mirroring Zoer's
 * dashboard/market/model.ts) and the opportunity and decision insights
 * (lib/insights.ts); and where the reader sits in the sidebar. Run with
 * `tsx scripts/check-procurement-market.ts`.
 */
import assert from "node:assert/strict";
import {
  distribution, filterAwards, isPlaceholderSupplier, matrix, metadata, money, normalizeAwards, normalizeLabel, overview, quantile, rank, trends, validateFilters, yearly,
} from "../src/features/procurementReview/lib/market";
import { decisionInsights, isOpenOpportunity, opportunityInsights } from "../src/features/procurementReview/lib/insights";
import type { CatalogReviewRow, ListRow } from "../src/features/procurementReview/reader/source";
import { RESOLVED_NAV_TREE, navEntryInArea, navParentForPath } from "../src/lib/navTree";
import { ROUTE_IDENTITY } from "../src/lib/routeIdentity";

import { canonicalReaderParams, readerPlaces } from "../src/features/procurementReview/reader/routes";
const migrated = canonicalReaderParams(new URLSearchParams("record=opportunity%3A233770&tab=documents&buyer=City"))!;
assert.equal(migrated.get("notice"), "opportunity:233770");
assert.equal(migrated.has("record"), false, "Old bookmarks must not open the shared table inspector and reset notice tabs");
assert.equal(migrated.get("tab"), "documents");
assert.equal(readerPlaces(migrated).party?.name, "City");
assert.equal(canonicalReaderParams(new URLSearchParams("record=unrelated-record")), null);
assert.equal(canonicalReaderParams(new URLSearchParams("notice=award%3A1")), null);
const TODAY = "2026-10-18";
const base: ListRow = {
  recordKey: "", kind: "award", title: "", organization: "", issuedFor: "", status: "Awarded", date: "", dateText: "",
  reference: "", documents: 0, listedDocuments: 0, supplier: "", value: null, currency: "CAD", procurementType: "",
};
const award = (key: string, patch: Partial<ListRow>): ListRow => ({ ...base, recordKey: `bc-bid:${key}`, title: `Award ${key}`, ...patch });

const rows: ListRow[] = [
  award("1", { organization: "City of Prince George", supplier: "Acme Paving", value: 100000, procurementType: "Construction", date: "2026-01-15" }),
  award("2", { organization: "City of Prince George", supplier: "Acme Paving", value: 50000, procurementType: "Construction", date: "2026-01-20T14:00" }),
  award("3", { organization: "UNBC", supplier: "Northern Labs", value: 20000, procurementType: "Goods", date: "2026-03-02" }),
  award("4", { organization: "UNBC  ", supplier: "Acme Paving", value: 30000, procurementType: "Services", date: "2025-11-30" }),
  // Excluded by default: a placeholder supplier, an empty supplier, US dollars, a future date.
  award("5", { organization: "UNBC", supplier: "Migrated Supplier", value: 999999, procurementType: "Goods", date: "2026-02-01" }),
  award("6", { organization: "UNBC", supplier: "", value: 888888, procurementType: "Goods", date: "2026-02-01" }),
  award("7", { organization: "UNBC", supplier: "Northern Labs", value: 777777, currency: "USD", procurementType: "Goods", date: "2026-02-01" }),
  award("8", { organization: "UNBC", supplier: "Northern Labs", value: 666666, procurementType: "Goods", date: "2027-01-01" }),
  // Kept, but flagged: no value, no date, no currency.
  award("9", { organization: "School District 57", supplier: "Ridge Supply", value: null, procurementType: "", date: "2026-05-05" }),
  award("10", { organization: "School District 57", supplier: "Ridge Supply", value: 0, procurementType: "Goods", date: "" }),
  award("11", { organization: "School District 57", supplier: "Ridge Supply", value: 12345, currency: "", procurementType: "Goods", date: "2026-05-06" }),
];

// Labels and placeholders follow Zoer's contractAwardsAnalysis rules.
assert.equal(normalizeLabel("  UNBC   "), "UNBC");
assert.equal(normalizeLabel("   "), null);
assert.equal(isPlaceholderSupplier("migrated supplier"), true);
assert.equal(isPlaceholderSupplier(""), true);
assert.equal(isPlaceholderSupplier("Acme Paving"), false);

const all = normalizeAwards(rows);
assert.equal(all[1].date, "2026-01-20", "an award with a time is dated by its day");
assert.equal(all[3].buyer, "UNBC", "whitespace never splits a buyer");
assert.equal(all[3].supplier, "Acme Paving");
assert.equal(all[8].type, "Unspecified type");
assert.equal(all[10].currencyCode, "UNSPECIFIED");
assert.equal(all[9].date, null);

// Default filters: CAD only, no placeholder suppliers, nothing dated after today.
const kept = filterAwards(all, {}, TODAY);
assert.deepEqual(kept.map((r) => r.id.split(":")[1]), ["1", "2", "3", "4", "9", "10"]);
assert.equal(filterAwards(all, { includePlaceholders: true }, TODAY).length, 8);
assert.equal(filterAwards(all, { includeFuture: true }, TODAY).length, 7);
assert.deepEqual(filterAwards(all, { currency: "USD" }, TODAY).map((r) => r.value), [777777]);
assert.deepEqual(filterAwards(all, { from: "2026-01-01", to: "2026-01-31" }, TODAY).map((r) => r.value), [100000, 50000]);
assert.equal(filterAwards(all, { from: "2026-01-01" }, TODAY).some((r) => r.date === null), false, "a date range leaves undated awards out");
assert.deepEqual(filterAwards(all, { buyer: "UNBC" }, TODAY).map((r) => r.value), [20000, 30000]);
assert.deepEqual(filterAwards(all, { supplier: "Acme Paving", type: "Construction" }, TODAY).length, 2);
assert.equal(filterAwards(all, { minValue: "30000" }, TODAY).length, 3);
assert.throws(() => validateFilters({ from: "2026-02-30" }), /valid start and end/);
assert.throws(() => validateFilters({ from: "2026-03-01", to: "2026-01-01" }), /on or before/);

// Overview: totals, median and counts over the kept rows.
const view = overview(kept);
assert.equal(view.count, 6);
assert.equal(view.value, 200000);
assert.equal(view.valuedCount, 5, "a missing value is counted as an award, not as a value");
assert.equal(view.median, 30000);
assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
assert.equal(quantile([], 0.5), null);
assert.equal(view.buyerCount, 3);
assert.equal(view.supplierCount, 3);
assert.equal(view.buyers[0].name, "City of Prince George");
assert.equal(view.buyers[0].value, 150000);
assert.equal(view.buyers[0].leading, "Acme Paving");
assert.equal(view.buyers[0].dependence, 1);
assert.equal(view.suppliers[0].name, "Acme Paving");
assert.equal(view.suppliers[0].value, 180000);
assert.equal(view.suppliers[0].counterparties, 2);
assert.equal(view.suppliersFor80, 1, "Acme Paving alone holds 90% of positive value");
assert.ok(Math.abs(view.top10Share - 1) < 1e-9);
assert.deepEqual(rank(kept, "type").map((r) => r.name), ["Construction", "Services", "Goods", "Unspecified type"]);

// Trends: one bucket per month from the first to the last dated award, gaps included.
const trend = trends(kept, "2026", TODAY);
assert.deepEqual(trend.series.map((r) => r.month), ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
assert.deepEqual(trend.series.map((r) => r.count), [1, 0, 2, 0, 1, 0, 1]);
assert.equal(trend.series[2].value, 150000);
assert.equal(trend.undated, 1);
assert.equal(trend.yearCount, 4);
assert.equal(trend.cells.find((c) => c.row === "City of Prince George" && c.column === "2026-01")?.count, 2);
assert.deepEqual(yearly(trend.series), [{ year: "2025", value: 30000, count: 1 }, { year: "2026", value: 170000, count: 4 }]);
assert.throws(() => trends(kept, "12", TODAY), /valid heatmap year/);

// Award sizes: ranges exclude their upper bound; zero and missing are their own.
const sizes = distribution(kept);
const bin = (label: string) => sizes.bins.find((b) => b.label === label)!;
assert.equal(bin("Zero").count, 1);
assert.equal(bin("10k–50k").count, 2, "20,000 and 30,000; 50,000 is the next range");
assert.equal(bin("50k–100k").count, 1);
assert.equal(bin("100k–250k").count, 1);
assert.equal(sizes.missing, 1);
assert.equal(sizes.max, 100000);

// The buyer × type matrix sums each cell once.
const mix = matrix(kept, "type");
assert.equal(mix.cells.find((c) => c.row === "City of Prince George" && c.column === "Construction")?.value, 150000);
assert.equal(mix.shownCount, kept.length);

// Data quality covers every award regardless of filters.
const meta = metadata(all, TODAY);
const flag = (name: string) => meta.quality.find((q) => q.flag === name)!.count;
assert.equal(meta.count, 11);
assert.equal(flag("placeholder"), 2);
assert.equal(flag("future"), 1);
assert.equal(flag("currency"), 1);
assert.equal(flag("undated"), 1);
assert.equal(flag("value"), 1);
assert.equal(flag("zero"), 1);
assert.deepEqual(meta.currencies, ["CAD", "UNSPECIFIED", "USD"]);
assert.equal(meta.firstDate, "2025-11-30");

assert.equal(money(1234567, "CAD"), "$1,234,567");
assert.equal(money(null, "CAD"), "—");
assert.match(money(1500, "UNSPECIFIED"), /units$/);

// Opportunities: the closing date wins over a stale "Open".
const now = Date.parse("2026-10-18T19:00:00Z"); // noon in Vancouver
const opportunity = (key: string, patch: Partial<ListRow>): ListRow => ({ ...base, kind: "opportunity", status: "Open", recordKey: `bc-bid:${key}`, title: key, organization: "UNBC", ...patch });
const opportunities = [
  opportunity("a", { date: "2026-10-18T15:00" }),
  opportunity("b", { date: "2026-10-22", documents: 2 }),
  opportunity("c", { date: "2026-10-30", listedDocuments: 3 }),
  opportunity("d", { date: "2026-12-01", organization: "City of Prince George" }),
  opportunity("e", { date: "2026-10-01" }),
  opportunity("f", { date: "", dateText: "Open until filled" }),
  opportunity("g", { date: "2026-11-01", status: "Cancelled" }),
  opportunity("h", { recordKey: "civicinfo:civicinfo:h", date: "2026-10-20" }),
];
assert.equal(isOpenOpportunity(opportunities[4], now), false, "a passed closing date reads closed");
assert.equal(isOpenOpportunity(opportunities[6], now), false);
const open = opportunityInsights(opportunities, now);
assert.equal(open.total, 8);
assert.equal(open.open, 6);
assert.deepEqual(open.windows, { today: 1, week: 2, twoWeeks: 1, later: 1, undated: 1 });
assert.equal(open.withDocuments, 1);
assert.equal(open.listedOnly, 1);
assert.equal(open.buyers[0].name, "UNBC");
assert.equal(open.buyers[0].open, 5);
assert.equal(open.sources.find((s) => s.name === "BC Bid")?.count, 7);
assert.equal(open.openKeys.has("bc-bid:e"), false);

// Decisions: AI suggestions and recorded decisions are counted apart; a stale decision is listed.
const review = (recordKey: string, source: string, data: Record<string, unknown>): CatalogReviewRow => ({ recordKey, source, dataJson: JSON.stringify(data) });
const reviews = [
  review("bc-bid:a", "procurement_assessments", { is_current: 1, as_of: "2026-10-10", relevance: "strong", suggested_action: "ready_for_human_decision" }),
  review("bc-bid:a", "procurement_decisions", { decision: "pursue", created_at: "2026-10-11", needs_reconfirmation: 1 }),
  review("bc-bid:a", "procurement_requirements", { id: "r1", text: "WorkSafeBC clearance", ordinal: 1 }),
  review("bc-bid:a", "procurement_requirements", { id: "r2", text: "Bonding", ordinal: 2 }),
  review("bc-bid:a", "procurement_matches", { requirement_id: "r1", status: "supported", updated_at: "2026-10-10" }),
  review("bc-bid:b", "procurement_assessments", { is_current: 1, as_of: "2026-10-12", relevance: "possible", suggested_action: "needs_information", freshness: "stale" }),
  review("bc-bid:b", "procurement_tasks", { title: "Ask about bonding", status: "open", created_at: "2026-10-12" }),
  review("bc-bid:e", "procurement_assessments", { is_current: 1, as_of: "2026-09-01", relevance: "weak", suggested_action: "decline" }),
];
const decided = decisionInsights(reviews);
assert.equal(decided.reviewed, 3);
assert.equal(decided.assessed, 3);
assert.equal(decided.fit("strong", "ready"), 1);
assert.equal(decided.fit("possible", "conditions"), 1);
assert.equal(decided.fit("weak", "blocker"), 1);
assert.deepEqual(decided.suggestions.map((s) => [s.label, s.count]), [["Decline", 1], ["Needs information", 1], ["Ready for a decision", 1]]);
assert.deepEqual(decided.decisions.map((d) => [d.label, d.count]), [["Pursue", 1]]);
assert.equal(decided.staleSuggestions, 1);
assert.equal(decided.stale.length, 1);
assert.equal(decided.stale[0].recordKey, "bc-bid:a");
assert.equal(decided.requirements, 2);
assert.equal(decided.matches.find((m) => m.label === "Met")?.count, 1);
assert.equal(decided.matches.find((m) => m.label === "Not matched yet")?.count, 1);
assert.equal(decided.openTasks, 1);
const scoped = decisionInsights(reviews, open.openKeys);
assert.equal(scoped.reviewed, 2, "the open scope leaves the closed notice's review out");

// Procurement is a section of its own: one top-level row (no sub-items, not
// under Finance), still behind the module switch, which defaults off.
const READER = "/app/procurement-review";
assert.ok(RESOLVED_NAV_TREE.some((node) => node.kind === "item" && node.to === READER), "procurement review is a top-level sidebar row");
assert.equal(RESOLVED_NAV_TREE.some((node) => node.kind === "parent" && node.children.some((child) => child.to === READER)), false, "procurement review sits under no other section");
assert.equal(navParentForPath(`${READER}/opportunities/x`), null);
assert.equal(ROUTE_IDENTITY[READER].module, "procurementReview");
assert.notEqual(ROUTE_IDENTITY[READER].group, "finance", "a finance group would pull it back under Finance");
assert.equal(navEntryInArea({ kind: "item" }, "all"), true);

console.log("procurement market, insights and navigation: ok");

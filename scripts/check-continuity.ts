/**
 * Gate: record continuity (governance expectations → expected periods →
 * matching against native records) and the BC record-continuity rule pack.
 * Synthetic fixtures only.
 */
import assert from "node:assert/strict";
import {
  classifyMeeting,
  defaultRange,
  effectiveExpectations,
  evaluateContinuity,
  expandPeriods,
  findMinutesReferences,
  flattenRecordGaps,
  inferCadenceSuggestions,
  resolveCrossReferences,
  type ContinuitySnapshot,
  type EffectiveExpectation,
} from "../shared/continuity";
import { BC_SOCIETIES_EXPECTATION_PACK, describeCadenceRule, normalizeCadenceRule } from "../shared/continuityRules";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { actionPermission } from "../shared/functions/actionPolicy";

/* ------------------------------ rule pack ------------------------------- */

for (const rule of BC_SOCIETIES_EXPECTATION_PACK.rules) {
  assert.ok(rule.citation.startsWith("Societies Act, SBC 2015, c. 18, s."), `${rule.ruleKey} cites the current Act`);
  assert.equal(rule.status, "draft", `${rule.ruleKey} stays draft until reviewed`);
  assert.ok(rule.sourceIds.every((id) => BC_SOCIETIES_EXPECTATION_PACK.sources.some((source) => source.sourceId === id)), `${rule.ruleKey} sources resolve`);
  assert.ok(rule.caveat.length > 20, `${rule.ruleKey} carries a caveat`);
}
assert.deepEqual(BC_SOCIETIES_EXPECTATION_PACK.rules.map((rule) => rule.ruleKey).sort(), ["BC-SOC-AGM-ANNUAL", "BC-SOC-ANNUAL-REPORT", "BC-SOC-DIRECTOR-CONSENT", "BC-SOC-DIRECTORS-MIN", "BC-SOC-FS-AT-AGM"]);
assert.equal(BC_SOCIETIES_EXPECTATION_PACK.sources[0].currentTo, "2026-09-22");

/* ---------------------------- cadence rules ------------------------------ */

assert.deepEqual(normalizeCadenceRule({ frequency: "monthly", months: [12, 1, 1, 9] }), { frequency: "monthly", months: [1, 9, 12] });
assert.throws(() => normalizeCadenceRule({ frequency: "fortnightly" } as any), /Unsupported cadence/);
assert.throws(() => normalizeCadenceRule({ frequency: "per_year_count" }), /how many/);
assert.throws(() => normalizeCadenceRule({ frequency: "monthly", months: [13] }), /1–12/);
assert.equal(normalizeCadenceRule({ frequency: "after_event", offsetDays: 30 }).anchor, "agm");
assert.equal(describeCadenceRule({ frequency: "per_year_count", count: 4, months: [9, 11, 2, 5] }), "4 per year (Sep, Nov, Feb, May)");

/* --------------------------- period expansion ---------------------------- */

const base = (overrides: Partial<EffectiveExpectation>): EffectiveExpectation => ({
  key: "e", stored: true, title: "Test", kind: "meeting", bodyKind: "board", rule: { frequency: "calendar_year" }, severity: "practice", origin: "manual", status: "active", ...overrides,
});
assert.deepEqual(expandPeriods(base({}), 2018, 2020).map((p) => p.periodKey), ["2018", "2019", "2020"]);
assert.deepEqual(expandPeriods(base({ effectiveFrom: "2019-06-01" }), 2018, 2020).map((p) => p.periodKey), ["2019", "2020"]);
assert.deepEqual(expandPeriods(base({ effectiveTo: "2019-03-01" }), 2018, 2020).map((p) => p.periodKey), ["2018", "2019"]);
const monthly = expandPeriods(base({ rule: { frequency: "monthly", months: [1, 2, 9] }, effectiveFrom: "2020-02-15" }), 2020, 2020);
assert.deepEqual(monthly.map((p) => p.periodKey), ["2020-02", "2020-09"]);
assert.equal(monthly[0].end, "2020-02-29", "leap-year month end");
assert.deepEqual(expandPeriods(base({ rule: { frequency: "quarterly" } }), 2021, 2021).map((p) => p.periodKey), ["2021-Q1", "2021-Q2", "2021-Q3", "2021-Q4"]);
assert.equal(expandPeriods(base({ rule: { frequency: "per_year_count", count: 4 } }), 2021, 2021)[0].expectedCount, 4);
assert.equal(expandPeriods(base({ rule: { frequency: "ad_hoc" } }), 2018, 2020).length, 0);

/* ------------------------------ matching --------------------------------- */

const snapshot: ContinuitySnapshot = {
  today: "2026-06-15",
  society: { incorporationDate: "2015-03-01", jurisdictionCode: "CA-BC", entityType: "society", isMemberFunded: false },
  committees: [{ _id: "c-ops", name: "Operations Committee" }],
  meetings: [
    { _id: "agm16", type: "AGM", title: "2016 AGM", scheduledAt: "2016-05-10T12:00:00Z", status: "Held" },
    { _id: "agm17", type: "AGM", title: "2017 AGM", scheduledAt: "2017-05-09T12:00:00Z", status: "Held" },
    { _id: "agm17-copy", type: "AGM", title: "2017 AGM (copy)", scheduledAt: "2017-05-09T12:00:00Z", status: "Held" },
    // 2018: no AGM at all (statutory gap). 2019: held, minutes missing.
    { _id: "agm19", type: "AGM", title: "2019 AGM", scheduledAt: "2019-05-14T12:00:00Z", status: "HeldMinutesMissing" },
    { _id: "agm20", type: "AGM", title: "2020 AGM", scheduledAt: "2020-06-01T12:00:00Z", status: "Cancelled" },
    { _id: "agm21", type: "AGM", title: "2021 AGM", scheduledAt: "2021-05-18T12:00:00Z", status: "Held" },
    { _id: "agm22", type: "AGM", title: "2022 AGM", scheduledAt: "2022-05-17T12:00:00Z", status: "Held" },
    { _id: "agm23", type: "AGM", title: "2023 AGM", scheduledAt: "2023-05-16T12:00:00Z", status: "Held" },
    { _id: "agm24", type: "AGM", title: "2024 AGM", scheduledAt: "2024-05-14T12:00:00Z", status: "Held" },
    { _id: "agm25", type: "AGM", title: "2025 AGM", scheduledAt: "2025-05-13T12:00:00Z", status: "Held" },
    ...[1, 2, 3, 4, 5, 6, 9, 10, 11].map((month) => ({ _id: `ops-${month}`, type: "Committee", title: `Ops ${month}`, scheduledAt: `2021-${String(month).padStart(2, "0")}-10T12:00:00Z`, status: "Held", committeeId: "c-ops" })),
    ...[1, 2, 3, 4, 5, 6, 9, 10, 11, 12].map((month) => ({ _id: `ops22-${month}`, type: "Committee", title: `Ops ${month}`, scheduledAt: `2022-${String(month).padStart(2, "0")}-10T12:00:00Z`, status: "Held", committeeId: "c-ops" })),
    { _id: "board-2010", type: "Board", title: "Board Oct 2010", scheduledAt: "2010-10-26T12:00:00Z", status: "Held" },
  ],
  minutes: [
    { _id: "m16", meetingId: "agm16", heldAt: "2016-05-10", approvedAt: "2017-05-09" },
    { _id: "m17", meetingId: "agm17", heldAt: "2017-05-09" },
    { _id: "m21", meetingId: "agm21", heldAt: "2021-05-18", approvedAt: "2022-05-17" },
    { _id: "m22", meetingId: "agm22", heldAt: "2022-05-17" },
    { _id: "m23", meetingId: "agm23", heldAt: "2023-05-16", approvedAt: "2024-05-14" },
    { _id: "m24", meetingId: "agm24", heldAt: "2024-05-14", approvedAt: "2025-05-13" },
    { _id: "m25", meetingId: "agm25", heldAt: "2025-05-13" },
    { _id: "mb10", meetingId: "board-2010", heldAt: "2010-10-26" },
    ...[1, 2, 3, 4, 5, 6, 9, 10, 11].map((month) => ({ _id: `mops-${month}`, meetingId: `ops-${month}`, heldAt: `2021-${month}`, approvedAt: "2022-01-01" })),
    ...[1, 2, 3, 4, 5, 6, 9, 10, 11, 12].map((month) => ({ _id: `mops22-${month}`, meetingId: `ops22-${month}`, heldAt: `2022-${month}`, approvedAt: "2023-01-01" })),
  ],
  adoptedMinutesIds: ["m22"],
  filings: [
    { _id: "f21", kind: "AnnualReport", filedAt: "2021-06-01", status: "Filed" },
    { _id: "f22", kind: "AnnualReport", filedAt: "2022-07-30", status: "Filed" },
    { _id: "f23", kind: "AnnualReport", periodLabel: "2023", dueDate: "2023-06-15", status: "Draft" },
  ],
  financials: [{ _id: "fs20", fiscalYear: "2020", periodEnd: "2020-12-31" }, { _id: "fs22", fiscalYear: "2022", periodEnd: "2022-12-31", presentedAtMeetingId: "agm23" }],
  statementImports: [{ _id: "si21", fiscalYear: "2021", periodEnd: "2021-12-31", status: "NeedsReview", title: "Balance sheet 2021" }],
  directors: [
    { _id: "d1", firstName: "Ada", lastName: "Example", termStart: "2016-05-10", consentOnFile: true, status: "Active" },
    { _id: "d2", firstName: "Ben", lastName: "Sample", termStart: "2016-05-10", consentOnFile: true, status: "Active" },
    { _id: "d3", firstName: "Cy", lastName: "Placeholder", termStart: "2021-05-18", consentOnFile: false, status: "Active" },
    { _id: "d0", firstName: "Old", lastName: "Director", termStart: "2015-04-01", termEnd: "2016-05-10", consentOnFile: true, status: "Former" },
  ],
  insurance: [],
  sourceSignals: [{ table: "representationGaps", id: "g1", date: "2018-11", bodyKey: "members", infoType: "meeting.package", label: "AGM agenda Nov 2018" }],
  marks: [{ _id: "mark-2020", expectationKey: "BC-SOC-AGM-ANNUAL", periodKey: "2017", status: "satisfied", evidenceDocumentIds: ["doc1"] }],
  readable: { meetings: true, filings: true, financials: true, directors: true, insurance: true, sources: true },
};

const minutesByMeeting = new Map(snapshot.minutes.map((row) => [row.meetingId, row]));
assert.equal(classifyMeeting(snapshot.meetings[0], minutesByMeeting, new Set()), "approved");
assert.equal(classifyMeeting(snapshot.meetings[1], minutesByMeeting, new Set()), "draft");
assert.equal(classifyMeeting({ _id: "x", scheduledAt: "2022-05-17", status: "Held" }, new Map([["x", { _id: "m22", meetingId: "x" }]]), new Set(["m22"])), "approved", "adopted-by-motion counts as approved");
assert.equal(classifyMeeting(snapshot.meetings[3], minutesByMeeting, new Set()), "minutes_missing");
assert.equal(classifyMeeting(snapshot.meetings[4], minutesByMeeting, new Set()), "cancelled");

const expectations = effectiveExpectations([], snapshot);
assert.deepEqual(expectations.map((row) => row.key).sort(), ["BC-SOC-AGM-ANNUAL", "BC-SOC-ANNUAL-REPORT", "BC-SOC-DIRECTOR-CONSENT", "BC-SOC-DIRECTORS-MIN", "BC-SOC-FS-AT-AGM"]);
assert.equal(expectations.find((row) => row.key === "BC-SOC-AGM-ANNUAL")?.effectiveFrom, "2016-01-01", "no AGM required in the incorporation year (s.71(2))");
assert.equal(effectiveExpectations([], { ...snapshot, society: { ...snapshot.society!, isMemberFunded: true } }).some((row) => row.key === "BC-SOC-DIRECTORS-MIN"), false, "member-funded exception");
assert.equal(effectiveExpectations([], { ...snapshot, society: { jurisdictionCode: "CA-ON", entityType: "society" } }).length, 0, "no pack outside BC");
const overridden = effectiveExpectations([{ ...base({ key: "stored-agm", ruleKey: "BC-SOC-AGM-ANNUAL", kind: "agm", bodyKind: "members", status: "archived" }) }], snapshot);
assert.equal(overridden.some((row) => row.ruleKey === "BC-SOC-AGM-ANNUAL"), false, "archived stored row switches the rule off");

const range = defaultRange(snapshot);
assert.deepEqual(range, { fromYear: 2015, toYear: 2026 });
const rows = evaluateContinuity(expectations, snapshot, range);
const statusOf = (key: string, period: string) => rows.find((row) => row.expectation.key === key)!.periods.find((p) => p.periodKey === period)!;

assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2016").status, "satisfied");
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2017").status, "satisfied", "mark overrides draft");
assert.match(statusOf("BC-SOC-AGM-ANNUAL", "2017").note ?? "", /Marked satisfied/);
assert.ok(statusOf("BC-SOC-AGM-ANNUAL", "2017").evidence.some((item) => item.table === "documents"));
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2018").status, "source_only", "source signal for the members body in Nov 2018");
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2019").status, "record_missing");
assert.match(statusOf("BC-SOC-AGM-ANNUAL", "2019").note ?? "", /minutes missing/);
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2020").status, "cancelled");
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2022").status, "satisfied", "adopted by a later motion");
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2025").status, "draft_only");
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2026").status, "upcoming");
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2016").foundCount, 1);
assert.equal(statusOf("BC-SOC-AGM-ANNUAL", "2025").foundCount, 1);

assert.equal(statusOf("BC-SOC-ANNUAL-REPORT", "2021").status, "satisfied");
assert.equal(statusOf("BC-SOC-ANNUAL-REPORT", "2022").status, "satisfied");
assert.match(statusOf("BC-SOC-ANNUAL-REPORT", "2022").note ?? "", /day\(s\) after/, "late filing is noted");
assert.equal(statusOf("BC-SOC-ANNUAL-REPORT", "2023").status, "draft_only", "filing row not marked filed");
assert.equal(statusOf("BC-SOC-ANNUAL-REPORT", "2024").status, "record_missing");
assert.match(statusOf("BC-SOC-ANNUAL-REPORT", "2024").note ?? "", /evidence missing is not proof/);
assert.equal(statusOf("BC-SOC-ANNUAL-REPORT", "2018").status, "not_applicable");

assert.equal(statusOf("BC-SOC-FS-AT-AGM", "2021").status, "satisfied", "FY2020 official statements");
assert.equal(statusOf("BC-SOC-FS-AT-AGM", "2022").status, "draft_only", "unverified import");
assert.equal(statusOf("BC-SOC-FS-AT-AGM", "2023").status, "satisfied");
assert.equal(statusOf("BC-SOC-FS-AT-AGM", "2024").status, "record_missing");

assert.equal(statusOf("BC-SOC-DIRECTORS-MIN", "2015").status, "record_missing", "one director in 2015");
assert.equal(statusOf("BC-SOC-DIRECTORS-MIN", "2016").status, "satisfied", "outgoing and incoming directors both serve in 2016");
assert.equal(statusOf("BC-SOC-DIRECTORS-MIN", "2020").status, "record_missing");
assert.equal(statusOf("BC-SOC-DIRECTORS-MIN", "2021").status, "satisfied");
assert.equal(statusOf("BC-SOC-DIRECTOR-CONSENT", "2020").status, "satisfied");
assert.equal(statusOf("BC-SOC-DIRECTOR-CONSENT", "2021").status, "record_missing");

// Unreadable families are not reported as missing records.
const hidden = evaluateContinuity(expectations, { ...snapshot, readable: { ...snapshot.readable, directors: false } }, range);
assert.ok(hidden.find((row) => row.expectation.key === "BC-SOC-DIRECTOR-CONSENT")!.periods.every((p) => p.status === "not_applicable"));

// Committee cadence: monthly except Jul/Aug, effective from 2021.
const ops = base({ key: "ops", bodyKind: "committee", committeeId: "c-ops", rule: { frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12] }, effectiveFrom: "2021-01-01", effectiveTo: "2022-12-31" });
const opsRow = evaluateContinuity([ops], snapshot, range)[0];
assert.equal(opsRow.bodyLabel, "Operations Committee");
assert.equal(opsRow.periods.length, 20);
assert.deepEqual(opsRow.periods.filter((p) => p.status !== "satisfied").map((p) => `${p.periodKey}:${p.status}`), ["2021-12:record_missing"]);
const perYear = evaluateContinuity([base({ key: "ops-n", bodyKind: "committee", committeeId: "c-ops", rule: { frequency: "per_year_count", count: 10 }, effectiveFrom: "2021-01-01", effectiveTo: "2022-12-31" })], snapshot, range)[0];
assert.deepEqual(perYear.periods.map((p) => `${p.periodKey}:${p.status}:${p.foundCount}`), ["2021:record_missing:9", "2022:satisfied:10"]);

const gaps = flattenRecordGaps(rows);
assert.ok(gaps.length > 0);
assert.equal(gaps[0].severity, "statutory");
assert.ok(gaps.every((gap) => ["record_missing", "source_only", "draft_only"].includes(gap.status)));
assert.ok(flattenRecordGaps(rows, false).every((gap) => gap.status !== "draft_only"));

/* -------------------------- cross references ----------------------------- */

const refs = findMinutesReferences("MOTION: To adopt the minutes of September 28, 2010 as circulated. Carried. Also the minutes of the October 26, 2010 meeting.", "2010-10-26");
assert.deepEqual(refs.map((ref) => ref.referencedDate), ["2010-09-28"], "self reference excluded");
assert.deepEqual(findMinutesReferences("adopt the previous minutes dated 28 November 2018", "2019-05-14").map((r) => r.referencedDate), ["2018-11-28"]);
const inferred = findMinutesReferences("Approval of the minutes of November 20", "2019-05-14");
assert.deepEqual(inferred.map((r) => [r.referencedDate, r.yearInferred]), [["2018-11-20", true]]);
assert.deepEqual(findMinutesReferences("minutes of 2021-04-20", "2021-05-18").map((r) => r.referencedDate), ["2021-04-20"]);
// "November 2018" is a month, never "November 20" with an inferred year.
assert.deepEqual(findMinutesReferences("3. Adoption of Minutes of November 2018 Meeting", "2019-05-28").map((r) => [r.referencedDate, Boolean(r.monthOnly)]), [["2018-11", true]]);
assert.deepEqual(findMinutesReferences("Adoption of Minutes of November 2018 Meeting. MOTION: To adopt the previous minutes dated 28 November 2018", "2019-05-28").map((r) => r.referencedDate), ["2018-11-28"], "a dated citation covers the month reference");
assert.deepEqual(findMinutesReferences("Adoption of the Minutes of the May 2019 Meeting", "2020-06-23").map((r) => r.referencedDate), ["2019-05"]);
assert.deepEqual(findMinutesReferences("Draft minutes from the June 2020 Board Meeting approved", "2020-09-15").map((r) => r.referencedDate), ["2020-06"]);
const monthRefs = resolveCrossReferences([
  { minutesId: "m21", meetingId: "agm21", heldAt: "2021-05-18", text: "Adoption of the Minutes of the May 2019 meeting. Adoption of minutes of August 2020." },
], snapshot);
assert.deepEqual(monthRefs.map((gap) => [gap.referencedDate, gap.matchedMeetingId ?? "-"]), [["2019-05", "agm19"], ["2020-08", "-"]], "May 2019 meeting exists without minutes; no meeting at all in August 2020");
assert.match(monthRefs[1].note, /recorded in 2020-08/);
const xrefs = resolveCrossReferences([
  { minutesId: "mb10", meetingId: "board-2010", heldAt: "2010-10-26", text: "Moved to adopt the minutes of September 28, 2010. Carried." },
  { minutesId: "m21", meetingId: "agm21", heldAt: "2021-05-18", text: "Adopt the minutes of May 14, 2019 and the minutes of May 10, 2016" },
], snapshot);
assert.deepEqual(xrefs.map((gap) => `${gap.referencedDate}:${gap.matchedMeetingId ?? "-"}`), ["2010-09-28:-", "2019-05-14:agm19"], "2016 minutes exist; 2019 meeting has no minutes");

const nearDuplicates = resolveCrossReferences([
  { minutesId: "m21", meetingId: "agm21", heldAt: "2021-05-18", text: "Adopt the minutes of November 20 and the minutes of November 21, 2020." },
], snapshot);
assert.deepEqual(nearDuplicates.map((gap) => gap.referencedDate), ["2020-11-20"], "citations a day apart are one missing meeting");

// No incorporation date: the first recorded year stands in for it.
const noIncorporation = effectiveExpectations([], { ...snapshot, society: { jurisdictionCode: "CA-BC", entityType: "society" } });
assert.equal(noIncorporation.find((row) => row.key === "BC-SOC-AGM-ANNUAL")?.effectiveFrom, "2011-01-01", "first meeting 2010 → AGMs expected from 2011");
assert.equal(noIncorporation.find((row) => row.key === "BC-SOC-DIRECTORS-MIN")?.effectiveFrom, "2010-01-01");

/* ---------------------------- inferred cadence ---------------------------- */

const suggestions = inferCadenceSuggestions(snapshot, []);
const opsSuggestion = suggestions.find((s) => s.committeeId === "c-ops")!;
assert.ok(opsSuggestion, "ops cadence suggested");
assert.equal(opsSuggestion.rule.frequency, "monthly");
assert.equal(opsSuggestion.sampleSize, 19);
assert.ok(opsSuggestion.medianIntervalDays >= 28 && opsSuggestion.medianIntervalDays <= 31);
assert.ok(opsSuggestion.confidence > 0.5 && opsSuggestion.confidence <= 1, `confidence ${opsSuggestion.confidence}`);
assert.equal(inferCadenceSuggestions(snapshot, [ops]).some((s) => s.committeeId === "c-ops"), false, "existing expectation suppresses the suggestion");

/* --------------------- portable handlers + authorization ------------------ */

for (const name of ["continuity:gaps", "continuity:dashboardChecks", "continuity:listExpectations"]) assert.equal(actionPermission(name, "query"), "deadlines:read");
for (const name of ["continuity:createExpectation", "continuity:markPeriod", "continuity:seedRulePack"]) assert.equal(actionPermission(name, "mutation"), "deadlines:write");

const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", name: "Synthetic Society", jurisdictionCode: "CA-BC", entityType: "society", incorporationDate: "2019-02-01", isMemberFunded: false }],
    users: [
      { _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Owner" },
      { _id: "viewer", societyId: "soc", role: "Viewer", status: "Active" },
    ],
    committees: [{ _id: "c1", societyId: "soc", name: "Finance Committee", cadence: "Monthly", color: "blue", status: "Active", createdAtISO: "2019-01-01" }],
    meetings: [
      { _id: "mt1", societyId: "soc", type: "AGM", title: "AGM 2020", scheduledAt: "2020-06-02T19:00:00Z", status: "Held", electronic: false, attendeeIds: [] },
      { _id: "mt2", societyId: "soc", type: "Board", title: "Board", scheduledAt: "2021-03-02T19:00:00Z", status: "Held", electronic: false, attendeeIds: [] },
    ],
    minutes: [{ _id: "mn1", societyId: "soc", meetingId: "mt1", heldAt: "2020-06-02", attendees: [], absent: [], quorumMet: true, discussion: "Adopt the minutes of March 3, 2020.", decisions: [], actionItems: [] }],
    documents: [{ _id: "doc-ev", societyId: "soc", title: "AGM 2021 notice", category: "Minutes", createdAtISO: "2021-01-01", flaggedForDeletion: false, tags: [] }],
  },
});
const principal = (userId: string) => () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: userId, userId, societyId: "soc" });
const owner = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("owner") }).registerAll(PORTABLE_FUNCTIONS);
const viewer = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: principal("viewer") }).registerAll(PORTABLE_FUNCTIONS);

const result: any = await owner.runQuery("continuity:gaps", { societyId: "soc" });
assert.equal(result.rulePack.packId, "ca-bc-societies-record-continuity");
const agmRow = result.rows.find((row: any) => row.expectation.key === "BC-SOC-AGM-ANNUAL");
assert.deepEqual(agmRow.periods.map((p: any) => p.periodKey).slice(0, 2), ["2020", "2021"], "starts the year after incorporation");
assert.equal(agmRow.periods[0].status, "draft_only");
assert.equal(agmRow.periods[1].status, "record_missing");
assert.deepEqual(result.crossReferences.map((gap: any) => gap.referencedDate), ["2020-03-03"]);

await assert.rejects(() => viewer.runMutation("continuity:createExpectation", { societyId: "soc", title: "Board monthly", kind: "meeting", bodyKind: "board", rule: { frequency: "monthly" } }), /Permission deadlines:write/);
await assert.rejects(() => owner.runMutation("continuity:createExpectation", { societyId: "soc", title: "Committee", kind: "meeting", bodyKind: "committee", rule: { frequency: "monthly" } }), /Choose the committee/);
await assert.rejects(() => owner.runMutation("continuity:createExpectation", { societyId: "soc", title: "Bad", kind: "meeting", bodyKind: "board", rule: { frequency: "monthly" }, effectiveFrom: "2022-01-01", effectiveTo: "2021-01-01" }), /on or after/);
const boardId = await owner.runMutation("continuity:createExpectation", { societyId: "soc", title: "Board quarterly", kind: "meeting", bodyKind: "board", rule: { frequency: "quarterly" }, effectiveFrom: "2021-01-01", severity: "bylaw" });
const afterCreate: any = await owner.runQuery("continuity:gaps", { societyId: "soc" });
const boardRow = afterCreate.rows.find((row: any) => row.expectation.key === boardId);
assert.equal(boardRow.periods[0].periodKey, "2021-Q1");
assert.equal(boardRow.periods[0].status, "record_missing", "board meeting has no minutes");
assert.match(boardRow.periods[0].note, /minutes missing/);
assert.equal(boardRow.periods[1].status, "record_missing");

await assert.rejects(() => owner.runMutation("continuity:markPeriod", { societyId: "soc", expectationKey: "BC-SOC-AGM-ANNUAL", periodKey: "2021", status: "never_held" }), /reason/);
await assert.rejects(() => owner.runMutation("continuity:markPeriod", { societyId: "soc", expectationKey: "nope", periodKey: "2021", status: "cancelled" }), /not found/);
await assert.rejects(() => owner.runMutation("continuity:markPeriod", { societyId: "soc", expectationKey: "BC-SOC-AGM-ANNUAL", periodKey: "2021", status: "satisfied" }), /evidence/);
const markId = await owner.runMutation("continuity:markPeriod", { societyId: "soc", expectationKey: "BC-SOC-AGM-ANNUAL", periodKey: "2021", status: "never_held", reason: "Registrar extension; held March 2022" });
const markAgain = await owner.runMutation("continuity:markPeriod", { societyId: "soc", expectationKey: "BC-SOC-AGM-ANNUAL", periodKey: "2021", status: "waived", reason: "Resolution in lieu of AGM" });
assert.equal(markAgain, markId, "marks upsert per period");
await owner.runMutation("continuity:markPeriod", { societyId: "soc", expectationKey: "xref:minutes", periodKey: "2020-03-03", status: "satisfied", evidenceDocumentIds: ["doc-ev"] });
const afterMark: any = await owner.runQuery("continuity:gaps", { societyId: "soc" });
assert.equal(afterMark.rows.find((row: any) => row.expectation.key === "BC-SOC-AGM-ANNUAL").periods[1].status, "waived");
assert.equal(afterMark.crossReferences[0].status, "satisfied");
await owner.runMutation("continuity:clearPeriodMark", { id: markId });
assert.equal(db.dump("continuityPeriodMarks").length, 1);

const seeded: any = await owner.runMutation("continuity:seedRulePack", { societyId: "soc" });
assert.equal(seeded.created, 5);
assert.equal((await owner.runMutation("continuity:seedRulePack", { societyId: "soc" }) as any).created, 0, "idempotent");
const storedAgm = db.dump("governanceExpectations").find((row: any) => row.ruleKey === "BC-SOC-AGM-ANNUAL") as any;
assert.equal(storedAgm.effectiveFrom, "2020-01-01");
await owner.runMutation("continuity:updateExpectation", { id: storedAgm._id, patch: { status: "archived" } });
const afterArchive: any = await owner.runQuery("continuity:gaps", { societyId: "soc" });
assert.equal(afterArchive.rows.some((row: any) => row.expectation.ruleKey === "BC-SOC-AGM-ANNUAL"), false);

await assert.rejects(() => owner.runMutation("continuity:deriveFromBylawRules", { societyId: "soc" }), /Activate a bylaw rule set/);
db.dump("societies");
await db.insert("bylawRuleSets", { societyId: "soc", version: 2, status: "Active", effectiveFromISO: "2021-01-01T00:00:00Z", annualReportDueDaysAfterMeeting: 21, requireAgmFinancialStatements: true, generalNoticeMinDays: 14, generalNoticeMaxDays: 60, allowElectronicMeetings: true, allowHybridMeetings: true, allowElectronicVoting: false, allowProxyVoting: false, proxyHolderMustBeMember: true, proxyLimitPerGrantorPerMeeting: 1, quorumType: "fixed", quorumValue: 3, memberProposalThresholdPct: 5, memberProposalMinSignatures: 2, memberProposalLeadDays: 7, requisitionMeetingThresholdPct: 10, requireAgmElections: true, ballotIsAnonymous: true, voterMustBeMemberAtRecordDate: true, inspectionMemberRegisterByMembers: true, inspectionMemberRegisterByPublic: false, inspectionDirectorRegisterByMembers: true, inspectionCopiesAllowed: true, ordinaryResolutionThresholdPct: 50, specialResolutionThresholdPct: 66.67, unanimousWrittenSpecialResolution: true, updatedAtISO: "2021-01-01" });
const derived: any = await owner.runMutation("continuity:deriveFromBylawRules", { societyId: "soc" });
assert.deepEqual([derived.created, derived.updated], [2, 0]);
const bylawReport = db.dump("governanceExpectations").find((row: any) => row.ruleKey === "BYLAW-ANNUAL-REPORT") as any;
assert.equal(bylawReport.rule.offsetDays, 21);
assert.equal(bylawReport.severity, "bylaw");

const checks: any = await owner.runQuery("continuity:dashboardChecks", { societyId: "soc" });
assert.deepEqual(checks.checks.map((check: any) => check.id).sort(), ["CONTINUITY-ANNUAL-REPORT-FILED", "CONTINUITY-DIRECTOR-CONSENT", "CONTINUITY-MINUTES-APPROVED"].sort(), "AGM rule archived, so no AGM card");

// Committee structure (A4).
await owner.runMutation("committees:updateStructure", { id: "c1", kind: "standing", parentBody: "board", cadenceRule: { frequency: "per_year_count", count: 4, months: [9, 11, 2, 5] }, mandateVersions: [{ id: "tor-2021", effectiveFrom: "2021-01-01", effectiveTo: "2021-12-31", title: "TOR 2021" }, { id: "tor-2022", effectiveFrom: "2022-01-01", title: "TOR 2022", quorumText: "All five members" }] });
const committee = db.dump("committees")[0] as any;
assert.equal(committee.kind, "standing");
assert.equal(committee.cadence, "4 per year (Feb, May, Sep, Nov)", "label follows the structured rule");
assert.equal(committee.mandateVersions.length, 2);
await assert.rejects(() => owner.runMutation("committees:updateStructure", { id: "c1", kind: "secret" }), /Unsupported committee kind/);
await assert.rejects(() => owner.runMutation("committees:updateStructure", { id: "c1", mandateVersions: [{ id: "a", effectiveFrom: "2021-01-01", effectiveTo: "2022-06-01" }, { id: "b", effectiveFrom: "2022-01-01" }] }), /overlap/);
await assert.rejects(() => owner.runMutation("committees:updateStructure", { id: "c1", parentCommitteeId: "c1" }), /own parent/);

/* ------------- committee cadence → tracked expectation (retest) ------------ */

{
  const cdb = new MemoryDb({
    seed: {
      societies: [{ _id: "soc2", name: "Synthetic Air Society", jurisdictionCode: "CA-BC", entityType: "society", incorporationDate: "2018-02-01", isMemberFunded: false }],
      users: [{ _id: "owner2", societyId: "soc2", role: "Owner", status: "Active", displayName: "Owner" }],
      committees: [
        { _id: "ops2", societyId: "soc2", name: "Operations Committee", cadence: "Unknown", color: "blue", status: "NeedsReview", createdAtISO: "2019-01-01" },
        { _id: "adhoc2", societyId: "soc2", name: "Event Working Group", cadence: "Ad-hoc", color: "blue", status: "Active", createdAtISO: "2019-01-01" },
      ],
      meetings: [
        { _id: "o1", societyId: "soc2", type: "Committee", committeeId: "ops2", title: "Ops Jan", scheduledAt: "2022-01-11", status: "Held", electronic: false, attendeeIds: [] },
        { _id: "o2", societyId: "soc2", type: "Committee", committeeId: "ops2", title: "Ops Feb", scheduledAt: "2022-02-08", status: "Held", electronic: false, attendeeIds: [] },
      ],
      minutes: [
        { _id: "om1", societyId: "soc2", meetingId: "o1", heldAt: "2022-01-11", approvedAt: "2022-02-08", attendees: [], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [] },
        { _id: "om2", societyId: "soc2", meetingId: "o2", heldAt: "2022-02-08", approvedAt: "2022-03-08", attendees: [], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [] },
      ],
    },
  });
  const run = new PortableRuntime({ db: cdb, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: "owner2", userId: "owner2", societyId: "soc2" }) }).registerAll(PORTABLE_FUNCTIONS);
  const before: any = await run.runQuery("continuity:gaps", { societyId: "soc2" });
  assert.equal(before.rows.some((row: any) => row.expectation.committeeId === "ops2"), false, "no cadence rule, no committee expectation");
  await assert.rejects(() => run.runMutation("continuity:markPeriod", { societyId: "soc2", expectationKey: "committee:ops2", periodKey: "2022-03", status: "never_held", reason: "x" }), /no structured cadence/);

  // Setting the structured cadence (committee page) starts tracking from the first mandate version.
  await run.runMutation("committees:updateStructure", { id: "ops2", cadenceRule: { frequency: "monthly" }, mandateVersions: [{ id: "tor", effectiveFrom: "2022-01-01", title: "TOR" }] });
  await run.runMutation("committees:updateStructure", { id: "adhoc2", cadenceRule: { frequency: "ad_hoc" } });
  const listed: any = await run.runQuery("continuity:listExpectations", { societyId: "soc2" });
  assert.deepEqual(listed.committeeCadences.map((row: any) => [row.key, row.effectiveFrom]), [["committee:ops2", "2022-01-01"]], "ad hoc cadence is not tracked");
  const tracked: any = await run.runQuery("continuity:gaps", { societyId: "soc2" });
  const opsTracked = tracked.rows.find((row: any) => row.expectation.key === "committee:ops2");
  assert.ok(opsTracked, "committee cadence becomes an expectation");
  assert.equal(opsTracked.expectation.origin, "committee_structure");
  assert.equal(opsTracked.periods[0].periodKey, "2022-01");
  assert.deepEqual(opsTracked.periods.slice(0, 3).map((p: any) => p.status), ["satisfied", "satisfied", "record_missing"]);
  await run.runMutation("continuity:markPeriod", { societyId: "soc2", expectationKey: "committee:ops2", periodKey: "2022-03", status: "never_held", reason: "Spring break; no meeting called" });
  const marked: any = await run.runQuery("continuity:gaps", { societyId: "soc2" });
  assert.equal(marked.rows.find((row: any) => row.expectation.key === "committee:ops2").periods[2].status, "never_held");

  // A mark made on an implicit rule-pack row survives "Store rule pack".
  await run.runMutation("continuity:markPeriod", { societyId: "soc2", expectationKey: "BC-SOC-AGM-ANNUAL", periodKey: "2020", status: "never_held", reason: "No AGM called in 2020" });
  await run.runMutation("continuity:seedRulePack", { societyId: "soc2" });
  const storedAgm2 = cdb.dump("governanceExpectations").find((row: any) => row.ruleKey === "BC-SOC-AGM-ANNUAL") as any;
  assert.ok(cdb.dump("continuityPeriodMarks").some((row: any) => row.expectationKey === String(storedAgm2._id) && row.periodKey === "2020"), "mark moves to the stored row");
  const afterSeed: any = await run.runQuery("continuity:gaps", { societyId: "soc2" });
  const agm2020 = afterSeed.rows.find((row: any) => row.expectation.key === String(storedAgm2._id)).periods.find((p: any) => p.periodKey === "2020");
  assert.equal(agm2020.status, "never_held", "never-held mark still applies after storing the rule pack");

  // Storing an expectation for the committee takes over and keeps the mark.
  await run.runMutation("continuity:createExpectation", { societyId: "soc2", title: "Ops monthly", kind: "meeting", bodyKind: "committee", committeeId: "ops2", rule: { frequency: "monthly" }, effectiveFrom: "2022-01-01" });
  const takenOver: any = await run.runQuery("continuity:gaps", { societyId: "soc2" });
  assert.equal(takenOver.rows.some((row: any) => row.expectation.key === "committee:ops2"), false, "stored row replaces the implicit one");
  const storedOps = takenOver.rows.find((row: any) => row.expectation.committeeId === "ops2");
  assert.equal(storedOps.periods.find((p: any) => p.periodKey === "2022-03").status, "never_held", "mark made while implicit still applies");
}

console.log("Continuity checks passed.");

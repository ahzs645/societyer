/**
 * Gate: compliance obligations, AGM deadlines and the annual cycle read actual
 * AGM meeting records and filings (ui-governance G-02, G-03, G-12; ui-people P20).
 */
import assert from "node:assert/strict";

import { complianceFactsForOrganization, computeComplianceObligations } from "../src/lib/compliance";
import {
  annualReportForAgm,
  deriveAgmFacts,
  heldAgmDates,
  isAgmMeeting,
  isHeldMeeting,
  nextBcSocietyAgmDeadline,
  noAgmAnnualReportForYear,
} from "../shared/agmEvidence";
import { deriveComplianceDeadlines, nextAgmDate } from "../shared/corporationSettings";

const society = {
  _id: "society_1",
  name: "Synthetic Harbour Society",
  entityType: "society",
  actFormedUnder: "societies_act",
  jurisdictionCode: "CA-BC",
  incorporationDate: "2017-05-12",
  fiscalYearEnd: "03-31",
};

const heldAgm2025 = { _id: "m1", type: "AGM", status: "Held", scheduledAt: "2025-06-19T18:30:00.000Z", title: "2025 AGM" };
const board = { _id: "m2", type: "Board", status: "Held", scheduledAt: "2025-03-01T18:00:00.000Z", title: "Board" };
const draftAgm = { _id: "m3", type: "AGM", status: "Draft", scheduledAt: "2024-06-01T18:00:00.000Z", title: "2024 AGM draft" };
const scheduledAgm = { _id: "m4", type: "AGM", status: "Scheduled", scheduledAt: "2026-11-20T18:00:00.000Z", title: "2026 AGM" };

// --- meeting classification -------------------------------------------------
assert.equal(isAgmMeeting(heldAgm2025), true);
assert.equal(isAgmMeeting(board), false, "board meetings are never AGM evidence");
assert.equal(isAgmMeeting({ type: "", title: "Annual General Meeting 2019" }), true, "untyped AGM titles count");
assert.equal(isAgmMeeting({ type: "SGM", title: "Special general meeting re AGM bylaws" }), false, "an SGM is not an AGM");
assert.equal(isHeldMeeting(draftAgm, "2026-10-06"), false, "draft rows are not evidence");
assert.equal(isHeldMeeting(scheduledAgm, "2026-10-06"), false, "scheduled future rows are not evidence");
assert.deepEqual(heldAgmDates([heldAgm2025, board, draftAgm, scheduledAgm], "2026-10-06"), ["2025-06-19"]);

const agm = deriveAgmFacts(society, [heldAgm2025, board, draftAgm], "2026-10-06");
assert.equal(agm.annualMeetingDate, "2025-06-19");
assert.deepEqual(agm.agmYears, [2025]);
assert.equal(agm.source, "meetings");
assert.equal(agm.operatingSinceDate, "2025-03-01");

// --- G-02: obligations read held AGM meeting records --------------------------
const asOf = "2026-10-06";
const factsWithoutMeetings = complianceFactsForOrganization(society, { asOfDate: asOf })[0];
const withoutMeetings = computeComplianceObligations(factsWithoutMeetings);
assert.ok(
  withoutMeetings.some((o) => o.ruleId === "compliance-ca-bc-societies-no-agm-annual-report"),
  "control: without meeting records the no-AGM fallback is raised",
);
const facts = complianceFactsForOrganization(society, { asOfDate: asOf, meetings: [heldAgm2025, board] })[0];
assert.equal(facts.annualMeetingDate, "2025-06-19", "the held AGM becomes the annual meeting fact");
const obligations = computeComplianceObligations(facts);
assert.ok(
  !obligations.some((o) => o.ruleId === "compliance-ca-bc-societies-no-agm-annual-report"),
  "a held 2025 AGM suppresses the 2025 no-AGM annual report fallback",
);
const report = obligations.find((o) => o.ruleId === "compliance-ca-bc-societies-annual-report");
assert.equal(report?.dueDate, "2025-07-19", "annual report due 30 days after the held AGM (s.73)");
const agmPlanning = obligations.find((o) => o.ruleId === "compliance-ca-bc-societies-agm-planning");
assert.equal(agmPlanning?.dueDate, "2026-12-31", "the 2026 AGM is still due by Dec 31, 2026 (s.71)");

// An older AGM year is evidence too, not only the latest one.
const multi = complianceFactsForOrganization(society, {
  asOfDate: "2026-01-15",
  meetings: [{ type: "AGM", status: "Held", scheduledAt: "2025-11-20T18:00:00Z" }, { type: "AGM", status: "Held", scheduledAt: "2024-11-20T18:00:00Z" }],
})[0];
assert.deepEqual(multi.agmYears, [2024, 2025]);
assert.ok(!computeComplianceObligations(multi).some((o) => o.ruleId === "compliance-ca-bc-societies-no-agm-annual-report"));

// --- P20: imported workspace marked "preparing" but with held AGMs ------------
const imported = { ...society, incorporationDate: undefined, formationStatus: "preparing" };
assert.deepEqual(computeComplianceObligations(complianceFactsForOrganization(imported, { asOfDate: asOf })[0]), [], "control: preparing and no records computes nothing");
const importedFacts = complianceFactsForOrganization(imported, {
  asOfDate: asOf,
  meetings: [{ type: "AGM", status: "Held", scheduledAt: "2022-05-17T12:00:00Z" }, { type: "Board", status: "Held", scheduledAt: "2009-02-01T12:00:00Z" }],
})[0];
assert.equal(importedFacts.formationInferredFromRecords, true, "held AGMs prove an operating society");
assert.equal(importedFacts.formationStatus, "unverified");
assert.equal(importedFacts.operatingSinceDate, "2009-02-01");
const importedObligations = computeComplianceObligations(importedFacts);
assert.ok(importedObligations.length > 0, "an imported operating society gets provisional obligations");
assert.ok(importedObligations.every((o) => (o.caveat ?? "").includes("unverified")), "provisional obligations carry the unverified caveat");
assert.ok(importedObligations.some((o) => o.ruleId === "compliance-ca-bc-societies-agm-planning" && o.dueDate === "2026-12-31"));

// --- G-03: AGM deadline does not skip an overdue current-year AGM -------------
const settings = { agmMonth: 6, agmDay: 19, fiscalYearEnd: "03-31", jurisdictionCode: "CA-BC", entityType: "society" };
assert.equal(nextAgmDate(settings, "2026-10-06"), "2027-06-19", "legacy (no AGM history supplied) behaviour is unchanged");
assert.equal(nextAgmDate({ ...settings, heldAgmYears: [2025] }, "2026-10-06"), "2026-12-31", "no 2026 AGM held: due Dec 31, 2026");
assert.equal(nextAgmDate({ ...settings, heldAgmYears: [2025] }, "2026-03-01"), "2026-06-19", "planned date still ahead this year");
assert.equal(nextAgmDate({ ...settings, heldAgmYears: [2025, 2026] }, "2026-10-06"), "2027-06-19", "2026 AGM held: next year's planned date");
assert.equal(
  nextAgmDate({ ...settings, entityType: "corporation__business_", heldAgmYears: [2025] }, "2026-10-06"),
  "2026-06-19",
  "corporations keep the overdue planned date until an AGM is evidenced",
);
assert.deepEqual(nextBcSocietyAgmDeadline([2026], "2026-10-06"), { dueDate: "2027-12-31", targetYear: 2027, overdueAgainstPlan: false });
const derived = deriveComplianceDeadlines({ ...settings, heldAgmYears: [2025], annualMeetingDate: "2025-06-19" }, "2026-10-06");
assert.ok(derived.every((d) => ["Governance", "Tax", "Payroll", "Privacy", "Other"].includes(d.deadlineCategory)), "generated deadlines use register categories");
assert.equal(derived.find((d) => d.key === "agm")?.dueDate, "2026-12-31");

// --- G-12: annual reports belong to one cycle and late filings are flagged ----
const lateFiling = { _id: "f1", kind: "AnnualReport", status: "Filed", dueDate: "2026-04-01", filedAt: "2026-04-14", periodLabel: "FY2025-2026" };
const onTime = { _id: "f2", kind: "AnnualReport", status: "Filed", dueDate: "2025-07-19", filedAt: "2025-07-08", periodLabel: "2025" };
const lateMatch = annualReportForAgm([lateFiling], "2025-06-19");
assert.equal(lateMatch?.filed, true);
assert.equal(lateMatch?.late, true, "a report filed ~9 months after the AGM is late");
assert.equal(lateMatch?.dueDate, "2025-07-19");
assert.equal(lateMatch?.daysLate, 269);
assert.equal(annualReportForAgm([onTime], "2025-06-19")?.late, false);
assert.equal(annualReportForAgm([lateFiling], "2025-06-19", { nextAgmDate: "2026-03-01" }), null, "a filing after the next AGM belongs to that AGM");
assert.equal(annualReportForAgm([onTime], "2026-06-19"), null, "a 2025 filing never satisfies the 2026 AGM's report");
assert.equal(annualReportForAgm([onTime], "2025-06-19", { claimed: new Set(["f2"]) }), null, "claimed filings are not double counted");
const noAgm = noAgmAnnualReportForYear([{ _id: "f3", kind: "BCSocietyAnnualReport", status: "Filed", filedAt: "2026-01-20" }], 2025);
assert.equal(noAgm?.dueDate, "2026-01-31");
assert.equal(noAgm?.late, false);

console.log("compliance AGM evidence checks passed");

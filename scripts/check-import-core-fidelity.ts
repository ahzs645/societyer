// WP-B gate: import core & meeting data model (PGAIR audit C1–C14, A1/A3/A9–A13,
// A16–A18, G-04, ID-03, quorum, repair). Synthetic names only; runs on the
// local StaticConvexClient (real portable handlers) — no live backend.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { classifyMotionOutcome, canonicalMotionOutcomeLabel, storedRawMotionOutcome } from "../shared/motionOutcome";
import { motionVoteIssues, tallyCarries } from "../shared/motionValidation";
import { screenAttendanceName } from "../shared/attendanceNames";
import { inferMeetingBody, isFilenameOrGenericMeetingTitle, cleanMeetingTitle, stripTablePipes } from "../shared/meetingBody";
import { formatMeetingDate, meetingDatePrecision, isDateOnlyPlaceholder, meetingCalendarDate } from "../shared/meetingDates";
import { actionItemStatus, actionStatusFromSource, normalizeActionItemStatusFields } from "../shared/actionItemStatus";
import { computeQuorumFromRule, resolveMeetingQuorumRule, bodyQuorumRuleIssues } from "../shared/bodyQuorum";
import { quorumStatementFromText } from "../shared/quorumStatement";
import { dedupeKeyForDriveItem, EMPTY_CONTENT_SHA256 } from "../shared/driveDedupe";
import { normalizeSigningAuthorityTiers, signingTierForAmount } from "../shared/signingAuthorityTiers";
import { zonedTimeToUtc } from "../shared/functions/importSessionHelpers/importMeetingApply";
import { CONSENT_ITEM_OUTCOMES } from "../shared/evidenceReview";
import { inferMeetingType } from "../shared/functions/importSessionHelpers/importSessionRecordKinds";

// ---------- pure kernels -----------------------------------------------------
for (const word of ["Passed", "Approved", "Adopted", "Accepted", "Carried unanimously", "(Carried)", "Motion carried"]) {
  assert.deepEqual([classifyMotionOutcome(word).status, classifyMotionOutcome(word).outcome], ["Voted", "Carried"], word);
}
assert.equal(classifyMotionOutcome("with no objections").decidedBy, "consent");
assert.equal(classifyMotionOutcome("No objection").outcome, "Carried");
for (const word of ["Not carried", "Failed", "Lost", "Defeated"]) assert.equal(classifyMotionOutcome(word).outcome, "Defeated", word);
for (const word of ["NeedsReview", "Unknown", "Received"]) {
  const result = classifyMotionOutcome(word);
  assert.equal(result.status, "Moved", word);
  assert.equal(result.needsReview, true, word);
}
assert.equal(canonicalMotionOutcomeLabel("postponed"), "Deferred");
assert.equal(storedRawMotionOutcome({ history: [{ note: "legacy outcome: Passed" }] }), "Passed");

assert.deepEqual(motionVoteIssues({ votesFor: -2 }), ["For votes cannot be negative."]);
assert.match(motionVoteIssues({ outcome: "Carried", votesFor: 1, votesAgainst: 10, abstentions: -2 })[0], /Abstain votes cannot be negative/);
assert.match(motionVoteIssues({ outcome: "Carried", votesFor: 1, votesAgainst: 10 })[0], /do not reach a majority/);
assert.deepEqual(motionVoteIssues({ outcome: "Carried", votesFor: 1, votesAgainst: 10, decidedBy: "consent" }).length, 1, "override needs a note");
assert.deepEqual(motionVoteIssues({ outcome: "Carried", votesFor: 1, votesAgainst: 10, decidedBy: "chair_ruling", outcomeOverrideNote: "Chair ruled consensus reached before the count" }), []);
assert.match(motionVoteIssues({ outcome: "Defeated", votesFor: 7, votesAgainst: 2 })[0], /reach a majority/);
assert.equal(tallyCarries({ votesFor: 6, votesAgainst: 4, resolutionType: "Special" }), false, "special needs two thirds");
assert.equal(tallyCarries({ votesFor: 8, votesAgainst: 4, resolutionType: "Special" }), true);

for (const value of ["Vice President", "Public Member", "Members", "MINUTES", "Teleconference", "City of Example", "Example Health Authority", "EXA"]) {
  assert.notEqual(screenAttendanceName(value).kind, "person", value);
}
assert.deepEqual(
  (({ kind, name, affiliation }) => ({ kind, name, affiliation }))(screenAttendanceName("Alex Example, Ministry of Examples")),
  { kind: "person", name: "Alex Example", affiliation: "Ministry of Examples" },
);
assert.equal(screenAttendanceName("Jo Sample Executive Director").roleTitle, "Executive Director");
assert.equal(screenAttendanceName("Sam MacExample").kind, "person", "Mac/Mc surnames are not acronyms");

assert.equal(inferMeetingBody("2013-05-14 ExampleExecutiveMinutes_May DRAFT.docx").bodyKey, "committee:executive");
assert.equal(inferMeetingType("Operations Committee minutes"), "Committee");
for (const word of ["Strategic Planning session", "Secretariat Strategy Discussion", "AQMP minutes", "Data Working Group"]) assert.equal(inferMeetingType(word), "Committee", word);
assert.equal(inferMeetingType("Annual General Meeting"), "AGM");
assert.equal(inferMeetingType("Board meeting"), "Board");
assert.equal(isFilenameOrGenericMeetingTitle("| Subject: | Draft Meeting Minutes"), true);
assert.equal(isFilenameOrGenericMeetingTitle("Board meeting — 2020-01-01"), false);
assert.equal(cleanMeetingTitle({ bodyKey: "committee:executive", committeeName: "Executive Committee", date: "2013-05-14" }), "Executive Committee meeting — 2013-05-14");
assert.equal(stripTablePipes("| Welcome and Opening Remarks"), "Welcome and Opening Remarks");

assert.equal(isDateOnlyPlaceholder("2021-05-18T12:00:00.000Z"), true);
assert.equal(meetingDatePrecision({ scheduledAt: "2021-05-18T12:00:00.000Z" }), "date");
assert.equal(meetingCalendarDate({ scheduledAt: "2021-05-18T12:00:00.000Z" }), "2021-05-18");
const dateOnly = formatMeetingDate({ scheduledAt: "2021-05-18T12:00:00.000Z", localStartText: "6:00 PM", localEndText: "7:00 PM" }, { locale: "en-CA", timeZone: "America/Vancouver" });
assert.match(dateOnly, /2021/);
assert.match(dateOnly, /6:00 PM – 7:00 PM/);
assert.doesNotMatch(dateOnly, /5:00|4:00|12:00/, "the noon-UTC placeholder is never shown as a time");
assert.equal(zonedTimeToUtc("2021-05-18", "18:00", "America/Vancouver"), "2021-05-19T01:00:00.000Z");

assert.equal(actionStatusFromSource("Done"), "completed");
assert.equal(actionStatusFromSource("ongoing"), "ongoing");
assert.equal(actionStatusFromSource(""), "unknown");
assert.equal(actionItemStatus({ done: true }), "completed");
assert.deepEqual(normalizeActionItemStatusFields({ text: "x", done: false, status: "completed" }), { text: "x", done: true, status: "completed" });
assert.throws(() => normalizeActionItemStatusFields({ text: "x", done: false, status: "finished" }), /Invalid action item status/);
assert.ok(CONSENT_ITEM_OUTCOMES.includes("received"));

const boardRule = resolveMeetingQuorumRule({ quorumType: "percentage", quorumValue: 50, bodyQuorumRules: [{ body: "board", quorumType: "percentage", quorumValue: 60 }] }, { type: "Board" });
assert.equal(boardRule?.source, "body_rule");
assert.equal(computeQuorumFromRule(boardRule!.rule, boardRule!.body, { directorsInOffice: 13 }), 8, "60% of 13 directors");
assert.equal(resolveMeetingQuorumRule({ quorumType: "percentage", quorumValue: 50 }, { type: "Board" }), null, "legacy percentage applies to general meetings only");
const committeeRule = resolveMeetingQuorumRule({ quorumType: "fixed", quorumValue: 3 }, { type: "Committee", committeeId: "c1" }, { name: "Planning", quorumRule: { quorumType: "all_members" } });
assert.equal(computeQuorumFromRule(committeeRule!.rule, committeeRule!.body, { committeeMembers: 5 }), 5);
assert.ok(bodyQuorumRuleIssues([{ body: "board", quorumType: "percentage", quorumValue: 0 }]).length > 0);

assert.equal(quorumStatementFromText("Quorum achieved (13 directors present).").presentCount, 13);
assert.equal(quorumStatementFromText("Meeting opened without quorum. / Quorum met at 5:32.").quorumStatus, "confirmed");
assert.equal(quorumStatementFromText("deferred, assuming quorum is reached.").quorumStatus, "not_recorded");
assert.equal(quorumStatementFromText("There is no quorum for this meeting.").quorumStatus, "not_met");

assert.equal(dedupeKeyForDriveItem({ id: "a", sha256: EMPTY_CONTENT_SHA256 }), "id:a");
assert.equal(dedupeKeyForDriveItem({ id: "b", sha256: "a".repeat(64), bytes: 0 }), "id:b");
assert.equal(dedupeKeyForDriveItem({ id: "c", sha256: "b".repeat(64), bytes: 10 }), "b".repeat(64));

assert.deepEqual(normalizeSigningAuthorityTiers([{ maxCents: 500000, signaturesRequired: 1 }, { minCents: 500001, signaturesRequired: 2, roles: ["Treasurer", "President"] }])?.length, 2);
assert.throws(() => normalizeSigningAuthorityTiers([{ maxCents: 500000, signaturesRequired: 1 }, { minCents: 400000, signaturesRequired: 2 }]), /overlap/);
assert.equal(signingTierForAmount(normalizeSigningAuthorityTiers([{ maxCents: 500000, signaturesRequired: 1 }, { minCents: 500001, signaturesRequired: 2 }]), 700000)?.signaturesRequired, 2);
console.log("✓ kernels: outcomes, vote validation, attendance screening, bodies, dates, action status, body quorum, quorum statements, dedupe, signing tiers");

// ---------- import contract (local runtime) ---------------------------------
const societyId = "import_core_society";
const now = new Date().toISOString();
const client = new StaticConvexClient({ seed: {
  societies: [{ _id: societyId, name: "Import Core Test", jurisdictionCode: "CA-BC", entityType: "society" }],
  peopleDirectory: [
    { _id: "person_alex", societyId, fullName: "Alex Example", searchName: "alex example", createdAtISO: now, updatedAtISO: now },
    { _id: "person_blair", societyId, fullName: "Blair Sample", searchName: "blair sample", createdAtISO: now, updatedAtISO: now },
    { _id: "person_casey", societyId, fullName: "Casey Rep", searchName: "casey rep", createdAtISO: now, updatedAtISO: now },
  ],
} });
await client.whenLocalWorkspaceReady();
const tables = () => client.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>;
async function stageAndApply(bundle: any, kind: "meetings" | "sections" = "meetings") {
  const sessionId = await client.mutation("importSessions:createFromBundle", { societyId, bundle });
  const session = await client.query("importSessions:get", { sessionId });
  for (const record of session.records) {
    await client.mutation("importSessions:updateRecord", { recordId: record._id, status: "Approved", reviewNotes: "Synthetic fixture reviewed." });
  }
  return kind === "meetings"
    ? client.mutation("importSessions:applyApprovedMeetings", { sessionId })
    : client.mutation("importSessions:applyApprovedSectionRecords", { sessionId });
}
const src = (id: string, title: string) => ({ externalSystem: "google-drive", externalId: `google-drive:${id}`, title, url: `https://drive.google.com/file/d/${id}/view` });

// Prior board meeting whose minutes a later motion adopts (C3).
await stageAndApply({ sources: [src("prior", "Board minutes 2020-01-14")], meetingMinutes: [{
  meetingDate: "2020-01-14", meetingTitle: "2020-01-14 Board Minutes.docx", meetingType: "Board", sourceExternalIds: ["google-drive:prior"],
  attendees: ["Alex Example"], discussion: "Prior meeting.", confidence: "High",
}] });

const draftResult: any = await stageAndApply({ sources: [src("draft", "2020-02-11 Example Board Minutes DRAFT.docx")], meetingMinutes: [{
  meetingDate: "2020-02-11", meetingTitle: "2020-02-11 Example Board Minutes DRAFT.docx", sourceDocumentTitle: "2020-02-11 Example Board Minutes DRAFT.docx",
  meetingType: "Board", meetingStatus: "Held", localStartText: "6:00 PM", localEndText: "7:00 PM", location: "Online",
  sourceExternalIds: ["google-drive:draft"], confidence: "High",
  attendees: ["Members", "Alex Example", "Vice President", "City of Example", "Blair Sample, Example Society"],
  absent: ["Casey Rep"],
  agendaItems: [{ number: "1", title: "| Call to order", startTime: "6:00", presenter: "Chair" }, { number: "4", title: "Approve January minutes", requestedAction: "Approve", presenter: "Chair" }, { number: "5", title: "Report of the other body", requestedAction: "receive", consent: true }],
  sections: [{ title: "| Welcome and Opening Remarks", discussion: "Opened." }, { title: "Minutes", motionIndex: 0, actionItems: [{ text: "File the minutes", assignee: "Alex Example" }, { text: "Send letter", assignee: "Blair Sample", status: "ongoing" }] }],
  actionItems: [{ text: "Unknown status action" }],
  detailedAttendance: undefined,
  motions: [
    { motionText: "To adopt the minutes of January 14, 2020.", outcome: "Passed", movedByName: "Alex Example", secondedByName: "Blair Sample", adoptsMinutes: { meetingDate: "2020-01-14" }, sectionTitle: "Minutes", voteSummary: "Carried", pageRef: "p. 2", evidenceText: "MOTION to adopt ... Carried", sourceExternalIds: ["google-drive:draft"] },
    { motionText: "To receive the report.", outcome: "with no objections", abstainedBy: ["Casey Rep"], sourceExternalIds: ["google-drive:draft"] },
    { motionText: "To defer the budget item.", outcome: "Not carried", votesFor: 2, votesAgainst: 5, sourceExternalIds: ["google-drive:draft"] },
  ],
  nextMeetings: [{ at: "2020-03-10", body: "board" }, { at: "2020-05-12", body: "board" }],
}] });
assert.equal(draftResult.meetings, 1);
let t = tables();
const meeting = t.meetings.find((row) => row.scheduledAt.startsWith("2020-02-11"))!;
const minutes = t.minutes.find((row) => row.meetingId === meeting._id)!;
assert.equal(meeting.title, "Board meeting — 2020-02-11", "file-name titles become <Body> meeting — <date>");
assert.equal(meeting.sourceTitle, "2020-02-11 Example Board Minutes DRAFT.docx");
assert.equal(meeting.scheduledAtPrecision, "date");
assert.equal(meeting.localStartText, "6:00 PM");
assert.equal(meeting.status, "Held");
assert.deepEqual(minutes.attendees, ["Alex Example", "Blair Sample"], "role words, organizations and headings are not attendees");
assert.deepEqual(JSON.parse(minutes.draftTranscript).nonPersonAttendance.map((row: any) => row.name).sort(), ["City of Example", "Members", "Vice President"]);
const alex = minutes.detailedAttendance.find((row: any) => row.name === "Alex Example");
assert.equal(alex.personId, "person_alex");
assert.equal(minutes.detailedAttendance.find((row: any) => row.name === "Blair Sample").affiliation, "Example Society");
assert.equal(minutes.actionItems[0].status, "unknown", "C8: unstated action status stays unknown");
assert.equal(minutes.actionItems[0].done, false);
const minutesSection = minutes.sections.find((row: any) => row.title === "Minutes");
assert.equal(minutesSection.actionItems[0].assigneePersonId, "person_alex");
assert.equal(minutesSection.actionItems[1].status, "ongoing");
assert.ok(minutes.sections.some((row: any) => row.title === "Welcome and Opening Remarks" && row.sourceTitle === "| Welcome and Opening Remarks"));
assert.equal(minutes.nextMeetings.length, 2);
assert.equal(minutes.nextMeetingAt, "2020-03-10");
assert.equal(minutes.importedSourceVersions.length, 1);
assert.equal(minutes.importedSourceVersions[0].status, "draft");
const motionRows = t.motions.filter((row) => row.minutesId === minutes._id);
assert.equal(motionRows.length, 3);
const adoption = motionRows.find((row) => /adopt the minutes/.test(row.text))!;
assert.deepEqual([adoption.status, adoption.outcome, adoption.sourceOutcomeText], ["Voted", "Carried", "Passed"], "C1");
assert.equal(adoption.movedByPersonId, "person_alex");
assert.equal(adoption.secondedByPersonId, "person_blair");
const prior = t.minutes.find((row) => row.heldAt.startsWith("2020-01-14"))!;
assert.equal(adoption.adoptsMinutesId, prior._id, "C3: adoptsMinutes resolves to the prior meeting's minutes");
assert.equal(adoption.sourceLocator.pageRef, "p. 2", "C13");
assert.equal(minutesSection.motionId, minutes.motionIds[0], "C7: section motionIndex links the motion row");
const consent = motionRows.find((row) => /receive the report/.test(row.text))!;
assert.deepEqual([consent.outcome, consent.decidedBy], ["Carried", "consent"]);
assert.deepEqual(consent.abstainedBy, [{ name: "Casey Rep", personId: "person_casey" }]);
assert.equal(motionRows.find((row) => /defer the budget/.test(row.text))!.outcome, "Defeated");
const agenda = t.agendas.find((row) => row.meetingId === meeting._id)!;
const agendaItems = t.agendaItems.filter((row) => row.agendaId === agenda._id).sort((a, b) => a.order - b.order);
assert.ok(agendaItems.every((row) => !String(row.title).startsWith("|")));
console.log("✓ minutes import: identity title, attendance screening + person links, action status, sections, next meetings, motions (C1/C3/C4/C7/C13/A1/A11)");

// Approved copy of the same meeting folds in (date + body), appending only new motions (C2).
const approvedResult: any = await stageAndApply({ sources: [src("approved", "Example Board Minutes Feb 2020 APPROVED.pdf")], meetingMinutes: [{
  meetingDate: "2020-02-11", meetingTitle: "Example Board Minutes Feb 2020 APPROVED.pdf", sourceDocumentTitle: "Example Board Minutes Feb 2020 APPROVED.pdf",
  meetingType: "Board", sourceExternalIds: ["google-drive:approved"], confidence: "High",
  motions: [
    { motionText: "To adopt the minutes of January 14, 2020.", outcome: "Carried" },
    { motionText: "To thank the volunteers.", outcome: "Approved" },
  ],
}] });
assert.equal(approvedResult.existing, 1);
t = tables();
assert.equal(t.meetings.filter((row) => row.scheduledAt.startsWith("2020-02-11")).length, 1, "draft and approved copies are one meeting");
const merged = t.minutes.find((row) => row._id === minutes._id)!;
assert.equal(merged.importedSourceVersions.length, 2);
assert.equal(merged.motions, undefined, "the retired embedded field is not written");
assert.equal(merged.motionIds.length, 4, "the new motion is appended through syncMotionsForMinutes; the duplicate is skipped");
assert.equal(t.motions.find((row) => /thank the volunteers/.test(row.text))?.outcome, "Carried");

// An AGM on the same evening stays a separate meeting; an executive meeting becomes a committee (C5).
await stageAndApply({ sources: [src("agm", "AGM 2020"), src("exec", "Exec")], meetingMinutes: [
  { meetingDate: "2020-02-11", meetingTitle: "Annual General Meeting Minutes", sourceExternalIds: ["google-drive:agm"], confidence: "High", attendees: ["Alex Example"] },
  { meetingDate: "2020-02-18", meetingTitle: "2020-02-18 ExampleExecutiveMinutes.docx", sourceExternalIds: ["google-drive:exec"], confidence: "High", meetingStatus: "Scheduled", localStartText: "6:00 PM", timeZone: "America/Vancouver" },
] });
t = tables();
assert.equal(t.meetings.filter((row) => row.scheduledAt.startsWith("2020-02-11")).length, 2, "AGM and Board on one evening are not merged");
const exec = t.meetings.find((row) => row.title === "Executive Committee meeting — 2020-02-19" || row.title === "Executive Committee meeting — 2020-02-18")!;
assert.ok(exec, "executive minutes become an Executive Committee meeting");
assert.equal(exec.type, "Committee");
assert.equal(t.committees.find((row) => row._id === exec.committeeId)?.name, "Executive Committee");
assert.equal(exec.status, "Scheduled", "C14: meeting status from the payload");
assert.equal(exec.scheduledAtPrecision, "datetime");
assert.equal(exec.scheduledAt, "2020-02-19T02:00:00.000Z", "local time + zone become the real instant");
console.log("✓ identity: variants fold with importedSourceVersions and appended motions; AGM/Board separate; committee resolved; status and local time");

// New bundle keys (C11) + policy / financial / grant links (C9, C10, C12) + attendance evidence fields.
const sectionResult: any = await stageAndApply({
  sources: [src("roster", "Roster"), src("pkg", "Item 2.1 report.pdf"), src("policy", "Signing policy"), src("fs", "Statements")],
  committees: [{ name: "Planning Committee", quorumRule: { quorumType: "all_members" }, mission: "Plans" }],
  committeeMembers: [{ committeeName: "Planning Committee", name: "Casey Rep", role: "Member", representedOrganization: "Example Org", joinedAt: "2020-01-01" }],
  members: [{ name: "Dana Member", membershipClass: "Regular", joinedAt: "2019-05-01" }],
  directors: [{ name: "Alex Example", position: "President", terms: [{ position: "President", termStart: "2019-05-01", termEnd: "2020-05-01" }, { position: "Director", termStart: "2018-05-01", termEnd: "2019-05-01" }] }],
  tasks: [{ title: "Historical action", assignee: "Blair Sample", meetingDate: "2020-02-11", body: "board", statusHistory: [{ status: "open", asOf: "2020-02-11" }, { status: "done", asOf: "2020-03-10" }] }, { title: "Unknown action", assignee: "TG" }],
  goals: [{ title: "Clean air plan", targetDate: "2021-12-31" }],
  commitments: [{ title: "Quarterly funder report", counterparty: "Example Funder", requirement: "Report each quarter", cadence: "Quarterly" }],
  fundingSources: [{ name: "Example Funder", sourceType: "Grant funder", expectedAnnualCents: 1000000 }],
  grants: [{ title: "Air Grant", funder: "Example Funder", requirements: [{ label: "Budget", category: "Finance" }], useOfFunds: [{ label: "Monitors", amountCents: 500000 }], timelineEvents: [{ label: "Start", date: "2020-04-01" }], keyFacts: ["Two-year term"], contacts: [{ role: "Program officer", name: "Officer Example" }] }],
  meetingMaterials: [{ meetingDate: "2020-02-11", body: "board", label: "Item 2.1 report", sourceExternalIds: ["google-drive:pkg"] }],
  organizationSeats: [{ organizationName: "Example Org", personName: "Casey Rep", termStart: "2020-01-01" }],
  conflicts: [{ personName: "Casey Rep", meetingDate: "2020-02-11", body: "board", motionText: "To defer the budget item", natureOfInterest: "Employer", contractOrMatter: "Budget", abstainedFromVote: true }],
  proxies: [{ meetingDate: "2020-02-11", body: "agm", grantorName: "Dana Member", proxyHolderName: "Alex Example", signedAtISO: "2020-02-01" }],
  bylawRuleSets: [{ effectiveFrom: "2020-01-01", quorumType: "percentage", quorumValue: 10, bodyQuorumRules: [{ body: "board", quorumType: "percentage", quorumValue: 60 }, { body: "committee", committeeName: "Planning Committee", quorumType: "all_members" }] }],
  operatingBudgets: [{ fiscalYear: "2020", lines: [{ category: "Monitoring", plannedCents: 120000 }, { category: "Outreach", plannedCents: 30000 }] }],
  policies: [{ policyName: "Signing Authority Policy", adoptedAtMeeting: { meetingDate: "2020-02-11", body: "board" }, sourceExternalIds: ["google-drive:policy"], confidence: "High" }],
  financialStatements: [{ fiscalYear: "2019", periodEnd: "2019-12-31", revenueCents: 100, expensesCents: 50, netAssetsCents: 50, presentedAtMeeting: { meetingDate: "2020-02-11", body: "agm" }, sourceExternalIds: ["google-drive:fs"], confidence: "High" }],
  signingAuthorities: [{ personName: "Alex Example", effectiveDate: "2020-01-01", tiers: [{ maxCents: 500000, signaturesRequired: 1 }, { minCents: 500001, signaturesRequired: 2 }], confidence: "High" }],
  meetingAttendance: [{ meetingDate: "2020-02-11", meetingTitle: "Board meeting — 2020-02-11", personName: "Casey Rep", affiliation: "Example Org", representedOrganization: "Example Org", attendanceStatus: "absent", confidence: "High" }],
}, "sections");
assert.equal(sectionResult.preflightBlocked, undefined, JSON.stringify(sectionResult));
t = tables();
const planning = t.committees.find((row) => row.name === "Planning Committee")!;
assert.equal(planning.quorumRule.quorumType, "all_members");
assert.equal(t.committeeMembers.find((row) => row.committeeId === planning._id)?.personId, "person_casey");
assert.ok(t.members.some((row) => row.firstName === "Dana" && row.lastName === "Member"));
const director = t.directors.find((row) => row.firstName === "Alex")!;
assert.equal(director.directoryPersonId, "person_alex");
assert.equal(t.boardRoleAssignments.filter((row) => row.directorId === director._id).length, 2, "director terms become role history");
const historical = t.tasks.find((row) => row.title === "Historical action")!;
assert.deepEqual([historical.sourceAssignee, historical.assigneePersonId, historical.meetingId], ["Blair Sample", "person_blair", meeting._id]);
assert.equal(historical.statusHistory.length, 2);
assert.equal(t.tasks.find((row) => row.title === "Unknown action")!.status, "Unknown", "historical actions are not open To do");
assert.ok(t.goals.some((row) => row.title === "Clean air plan"));
assert.ok(t.commitments.some((row) => row.reviewStatus === "NeedsReview"));
assert.ok(t.fundingSources.some((row) => row.name === "Example Funder"));
const grant = t.grants.find((row) => row.title === "Air Grant")!;
assert.deepEqual([grant.requirements.length, grant.useOfFunds[0].amountCents, grant.timelineEvents[0].date, grant.keyFacts[0], grant.contacts[0].role], [1, 500000, "2020-04-01", "Two-year term", "Program officer"], "C10");
assert.equal(t.meetingMaterials.find((row) => row.meetingId === meeting._id)?.label, "Item 2.1 report");
assert.ok(t.organizationSeats.some((row) => row.organizationName === "Example Org"));
const conflict = t.conflicts.find((row) => row.personName === "Casey Rep")!;
assert.equal(conflict.directorId, undefined, "A1: conflicts no longer require a director");
assert.equal(conflict.personId, "person_casey");
assert.equal(conflict.motionId, t.motions.find((row) => /defer the budget/.test(row.text))!._id);
const agmMeeting = t.meetings.find((row) => row.type === "AGM" && row.scheduledAt.startsWith("2020-02-11"))!;
assert.equal(t.proxies[0].meetingId, agmMeeting._id);
const ruleSet = t.bylawRuleSets.find((row) => row.bodyQuorumRules)!;
assert.equal(ruleSet.status, "Draft", "imported rules never become active by themselves");
assert.equal(ruleSet.bodyQuorumRules.find((row: any) => row.body === "committee").committeeId, planning._id);
assert.equal(t.budgets.length, 2);
const policy = t.policies.find((row) => row.policyName === "Signing Authority Policy")!;
assert.deepEqual([policy.adoptedAtMeetingId, policy.adoptedInMinutesId], [meeting._id, minutes._id], "C9");
assert.equal(t.financials[0].presentedAtMeetingId, agmMeeting._id, "C12");
assert.equal(t.signingAuthorities[0].tiers.length, 2, "A17");
const attendance = t.meetingAttendanceRecords[0];
assert.deepEqual([attendance.affiliation, attendance.representedOrganization, attendance.directoryPersonId], ["Example Org", "Example Org", "person_casey"]);
console.log("✓ section kinds: committees, members, directors+terms, tasks, goals, commitments, funding, grants, materials, seats, conflicts, proxies, rule sets, budgets, policy/financial links");

// ---------- per-body quorum in meeting creation (A3) --------------------------
await client.mutation("bylawRules:upsertActive", { ...Object.fromEntries(Object.entries(ruleSet).filter(([key]) => !["_id", "_creationTime", "version", "status", "updatedAtISO", "entityId"].includes(key))), societyId, id: undefined });
for (const name of ["Dir One", "Dir Two", "Dir Three", "Dir Four", "Dir Five"]) {
  const [firstName, lastName] = name.split(" ");
  await client.mutation("directors:create", { societyId, firstName, lastName, position: "Director", isBCResident: true, termStart: "2019-01-01", consentOnFile: true, status: "Active" }).catch(() => undefined);
}
const directorsActive = tables().directors.filter((row) => row.status === "Active").length;
const boardMeetingId = await client.mutation("meetings:create", { societyId, type: "Board", title: "Board quorum check", scheduledAt: "2021-01-12T19:00:00.000Z", electronic: false, status: "Scheduled", attendeeIds: [] });
const boardMeeting = tables().meetings.find((row) => row._id === boardMeetingId)!;
assert.ok(directorsActive >= 5, "directors fixture created");
assert.equal(boardMeeting.quorumRequired, Math.ceil(directorsActive * 0.6), "board quorum uses the board body rule");
await client.mutation("committees:addMember", { committeeId: planning._id, societyId, name: "Second Member", role: "Member" });
const committeeMeetingId = await client.mutation("meetings:create", { societyId, type: "Committee", committeeId: planning._id, title: "Planning", scheduledAt: "2021-01-13T19:00:00.000Z", electronic: false, status: "Scheduled", attendeeIds: [] });
assert.equal(tables().meetings.find((row) => row._id === committeeMeetingId)!.quorumRequired, 2, "committee quorum rule (all members) uses committee membership");
await assert.rejects(client.mutation("meetings:update", { id: committeeMeetingId, patch: { hostBody: "external" } }), /external organization/);
console.log("✓ per-body quorum: board and committee rules drive quorumRequired");

// ---------- G-04 server-side --------------------------------------------------
await assert.rejects(client.mutation("motions:create", { societyId, text: "Negative", status: "Voted", outcome: "Carried", votesFor: 1, votesAgainst: 10, abstentions: -2 }), /cannot be negative/);
await assert.rejects(client.mutation("motions:create", { societyId, text: "Inconsistent", status: "Voted", outcome: "Carried", votesFor: 1, votesAgainst: 10 }), /do not reach a majority/);
const overrideId = await client.mutation("motions:create", { societyId, text: "Consensus first", status: "Voted", outcome: "Carried", votesFor: 1, votesAgainst: 10, decidedBy: "consent", outcomeOverrideNote: "Consensus reached before the count" });
assert.ok(overrideId);
await assert.rejects(client.mutation("motions:update", { motionId: overrideId, patch: { outcomeOverrideNote: "" } }), /override note/);
await assert.rejects(client.mutation("motions:recordVote", { motionId: overrideId, votesFor: -1 }), /cannot be negative/);
const minutesMotions = await client.query("motions:listForMinutes", { minutesId: minutes._id });
const embedded = minutesMotions.map((row: any) => ({ text: row.text, outcome: row.outcome ?? "Pending", motionId: row._id, votesFor: row.votesFor, votesAgainst: row.votesAgainst }));
await client.mutation("minutes:update", { id: minutes._id, patch: { motions: embedded, discussion: "Unchanged motions are not re-judged." } });
const broken = embedded.map((motion: any, index: number) => index === 0 ? { ...motion, outcome: "Carried", votesFor: 0, votesAgainst: 3 } : motion);
await assert.rejects(client.mutation("minutes:update", { id: minutes._id, patch: { motions: broken } }), /do not reach a majority/);
console.log("✓ G-04: negative counts and outcomes contradicting the tally are rejected unless overridden with a note");

// ---------- repair mutation on legacy-shaped rows -----------------------------
const legacySociety = "legacy_repair_society";
const legacy = new StaticConvexClient({ seed: {
  societies: [{ _id: legacySociety, name: "Legacy", jurisdictionCode: "CA-BC", entityType: "society" }],
  meetings: [
    { _id: "m_exec", societyId: legacySociety, type: "Board", title: "2013-05-14 ExampleExecutiveMinutes_May_2013 DRAFT.docx", scheduledAt: "2013-05-14T12:00:00.000Z", electronic: false, status: "Held", attendeeIds: [], minutesId: "min_exec" },
    { _id: "m_board", societyId: legacySociety, type: "Board", title: "| Subject: | Draft Meeting Minutes", scheduledAt: "2019-02-19T12:00:00.000Z", electronic: false, status: "Held", attendeeIds: [], minutesId: "min_board" },
  ],
  minutes: [
    { _id: "min_exec", societyId: legacySociety, meetingId: "m_exec", heldAt: "2013-05-14T12:00:00.000Z", attendees: ["Members", "Alex Example", "Vice President"], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: "Quorum achieved (5 members present).", decisions: [], actionItems: [], sourceExternalIds: ["google-drive:legacy-exec"],
      sections: [{ title: "| Welcome", discussion: "Hello" }], motionIds: ["mo_passed"] },
    { _id: "min_board", societyId: legacySociety, meetingId: "m_board", heldAt: "2019-02-19T12:00:00.000Z", attendees: [], absent: [], quorumMet: false, quorumStatus: "not_recorded", discussion: "No statement.", decisions: [], actionItems: [],
      motions: [{ text: "Embedded motion one", outcome: "Passed" }, { text: "Embedded motion two", outcome: "Carried" }] },
  ],
  motions: [{ _id: "mo_passed", societyId: legacySociety, minutesId: "min_exec", primaryMeetingId: "m_exec", text: "To approve the plan", status: "Moved", source: "minutes", history: [{ at: now, status: "Moved", note: "legacy outcome: Passed" }], createdAtISO: now, updatedAtISO: now }],
  agendas: [{ _id: "ag_exec", societyId: legacySociety, meetingId: "m_exec", title: "Agenda", status: "Draft", createdAtISO: now, updatedAtISO: now }],
  agendaItems: [{ _id: "ai_exec", societyId: legacySociety, agendaId: "ag_exec", order: 0, type: "discussion", title: "| Welcome", createdAtISO: now }],
} });
await legacy.whenLocalWorkspaceReady();
const before = JSON.stringify(legacy.exportLocalWorkspaceSnapshot().tables.meetings);
const dry: any = await legacy.mutation("minutes:repairImported", { societyId: legacySociety, dryRun: true });
assert.equal(JSON.stringify(legacy.exportLocalWorkspaceSnapshot().tables.meetings), before, "dry run writes nothing");
assert.equal(dry.meetingTitlesCleaned, 2);
const run: any = await legacy.mutation("minutes:repairImported", { societyId: legacySociety });
assert.deepEqual(
  [run.motionsRederived, run.embeddedMotionsSynced, run.sectionTitlesCleaned, run.agendaTitlesCleaned, run.meetingTitlesCleaned, run.meetingBodiesReclassified, run.datePrecisionMarked, run.quorumFromSource, run.attendeesScreened],
  [1, 2, 1, 1, 2, 1, 2, 1, 2],
);
const repaired = legacy.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>;
const execMeeting = repaired.meetings.find((row) => row._id === "m_exec")!;
assert.equal(execMeeting.title, "Executive Committee meeting — 2013-05-14");
assert.equal(execMeeting.sourceTitle, "2013-05-14 ExampleExecutiveMinutes_May_2013 DRAFT.docx");
assert.equal(execMeeting.type, "Committee");
assert.equal(execMeeting.scheduledAtPrecision, "date");
assert.equal(repaired.meetings.find((row) => row._id === "m_board")!.title, "Board meeting — 2019-02-19");
assert.deepEqual([repaired.motions.find((row) => row._id === "mo_passed")!.status, repaired.motions.find((row) => row._id === "mo_passed")!.outcome], ["Voted", "Carried"]);
const boardMinutes = repaired.minutes.find((row) => row._id === "min_board")!;
assert.equal(boardMinutes.motions, undefined);
assert.equal(boardMinutes.motionIds.length, 2);
const execMinutes = repaired.minutes.find((row) => row._id === "min_exec")!;
assert.deepEqual(execMinutes.attendees, ["Alex Example"]);
assert.equal(execMinutes.quorumStatus, "confirmed");
assert.equal(execMinutes.quorumCheckpoints[0].eligibleCount, 5);
assert.equal(execMinutes.sections[0].title, "Welcome");
const again: any = await legacy.mutation("minutes:repairImported", { societyId: legacySociety });
for (const key of ["motionsRederived", "embeddedMotionsSynced", "sectionTitlesCleaned", "agendaTitlesCleaned", "meetingTitlesCleaned", "meetingBodiesReclassified", "datePrecisionMarked", "quorumFromSource", "attendeesScreened", "committeesCreated"]) {
  assert.equal(again[key], 0, `repair is idempotent (${key})`);
}
console.log("✓ repair: dry run, motion outcomes, embedded motions, pipes, titles/bodies, precision, quorum, attendance; second run changes nothing");

// ---------- stage-drive-audit: ID-03 and stated quorum ------------------------
const corpus = mkdtempSync(path.join(tmpdir(), "wpb-corpus-"));
const out = path.join(corpus, "out");
mkdirSync(out);
const minutesText = path.join(corpus, "minutes.txt");
writeFileSync(minutesText, [
  "Example Air Society Board Meeting Minutes",
  "Date: March 10, 2020",
  "Present: Alex Example, Blair Sample",
  "Call to order at 6:00 PM. Quorum achieved (9 directors present).",
  "MOTION: To approve the agenda. Moved by Alex Example, seconded by Blair Sample. Carried.",
  "Meeting adjourned at 7:00 PM.",
].join("\n"));
writeFileSync(path.join(corpus, "manifest.json"), JSON.stringify({ finished: true, rootId: "root" }));
writeFileSync(path.join(corpus, "extraction.json"), JSON.stringify({ finished: true, items: [
  { id: "empty-a", name: "Empty minutes A.docx", path: "Board/Empty minutes A.docx", url: "https://drive.google.com/a", sha256: EMPTY_CONTENT_SHA256, bytes: 0, textStatus: "empty" },
  { id: "empty-b", name: "Empty minutes B.docx", path: "Board/Empty minutes B.docx", url: "https://drive.google.com/b", sha256: EMPTY_CONTENT_SHA256, bytes: 0, textStatus: "empty" },
  { id: "real", name: "2020-03-10 Board Minutes.docx", path: "Board/2020-03-10 Board Minutes.docx", url: "https://drive.google.com/c", sha256: "c".repeat(64), bytes: 400, textStatus: "extracted", textPath: minutesText },
] }));
execFileSync(process.execPath, ["--import", "tsx", path.resolve("scripts/stage-drive-audit.ts"), corpus, out], { stdio: "pipe" });
const candidates = JSON.parse(readFileSync(path.join(out, "document-candidates.json"), "utf8"));
assert.equal(candidates.filter((row: any) => row.id.startsWith("empty-")).length, 2, "ID-03: empty-hash files are not collapsed");
const index = JSON.parse(readFileSync(path.join(out, "index.json"), "utf8"));
const bundle = JSON.parse(readFileSync(path.join(out, index.bundles[0].file), "utf8"));
const staged = bundle.meetingMinutes.find((row: any) => row.meetingDate === "2020-03-10");
assert.ok(staged, "the synthetic minutes are staged");
assert.equal(staged.quorumStatus, "confirmed", "stated quorum is kept");
assert.equal(staged.quorumCheckpoints[0].eligibleCount, 9);
console.log("✓ stage-drive-audit: empty-hash files kept apart; stated quorum staged as confirmed");
console.log("Import core fidelity checks passed.");

/**
 * Director consent evidence state (shared/directorConsentRecords.ts) and its
 * write paths: the consent register's save/review mutations, the derived
 * `directors.consentOnFile` cache, and the director create/update paths that
 * must not assert consent. Run: tsx scripts/check-director-consent-state.ts
 */
import assert from "node:assert/strict";
import {
  acceptedConsentBases,
  assessDirectorConsent,
  CBCA_LATE_WRITTEN_CONSENT,
  CBCA_WRITTEN_CONSENT_NEEDS_DATE,
  consentAssessmentOptions,
  consentBasisOptions,
  consentReviewProblem,
  consentStateSatisfied,
  consentTimingNote,
  consentToday,
  describeUnverifiedConsents,
  OBCA_LATE_WRITTEN_CONSENT_NOTE,
  unverifiedConsentSentence,
  writtenConsentTiming,
  type DirectorConsentRow,
} from "../shared/directorConsentRecords";
import { bcSocietiesDashboardComplianceRulePack, dashboardComplianceRulePackForOrganization } from "../shared/dashboardComplianceRules";
import { MemoryDb } from "../shared/portable/memoryDb";
import { PortableRuntime } from "../shared/portable/define";
import { makeCapabilities } from "../shared/portable/capabilities";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";

const BC_SOCIETY = { name: "Riverside Community Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act" };
const BC_COMPANY = { name: "Example Provincial Inc.", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_" };
const CBCA = { name: "Northwind Ltd.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" };
const OBCA = { name: "Contoso Inc.", jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__ontario_" };

/* ------------------------------- pure state ------------------------------- */
const today = "2026-11-21";
const society = { today, acceptedBases: acceptedConsentBases(BC_SOCIETY) };
const entry = (id: string, fields: Partial<DirectorConsentRow>): DirectorConsentRow => ({
  _id: id, directorId: "d1", scope: "Consent to act", event: "Given", effectiveDate: "2026-01-01", basis: "Written consent", recordedAt: `2026-01-01T00:00:0${id.length % 10}Z`, ...fields,
});
const director = { _id: "d1" };
const stateOf = (rows: DirectorConsentRow[], options: Parameters<typeof assessDirectorConsent>[2] = society, who: { _id: string; consentOnFile?: boolean } = director) => assessDirectorConsent(rows, who, options).state;

assert.equal(stateOf([]), "none", "no entry, no flag");
assert.equal(stateOf([], society, { _id: "d1", consentOnFile: true }), "legacy_flag_only", "legacy flag only");
assert.equal(consentStateSatisfied("legacy_flag_only"), false, "a legacy flag alone doesn't satisfy the requirement");
assert.equal(stateOf([entry("a", {})]), "awaiting_review", "a recorded basis with no review");
assert.equal(stateOf([entry("a", { reviewStatus: "Awaiting review" })]), "awaiting_review");
assert.equal(stateOf([entry("a", { reviewStatus: "Disputed" })]), "disputed", "disputed doesn't establish consent");
assert.equal(stateOf([entry("a", { reviewStatus: "Reviewed" })]), "verified", "reviewed written consent is verified");
assert.equal(consentStateSatisfied("verified"), true);
for (const state of ["none", "awaiting_review", "disputed", "scheduled", "withdrawn", "legacy_flag_only"] as const) assert.equal(consentStateSatisfied(state), false, state);

// A future effective date is scheduled, not current consent.
const future = assessDirectorConsent([entry("a", { effectiveDate: "2026-12-01", reviewStatus: "Reviewed" })], director, society);
assert.equal(future.state, "scheduled", "future effective date doesn't establish current consent");
assert.equal(future.upcoming?._id, "a");
// ...and an entry effective today is current.
assert.equal(stateOf([entry("a", { effectiveDate: today, reviewStatus: "Reviewed" })]), "verified", "effective today counts");
// A later withdrawal ends a verified consent; a scheduled one doesn't yet.
const verified = entry("a", { effectiveDate: "2025-06-01", reviewStatus: "Reviewed" });
assert.equal(stateOf([verified, entry("bb", { event: "Withdrawn", effectiveDate: "2026-03-01" })]), "withdrawn", "withdrawn after verified is not satisfied");
const pendingWithdrawal = assessDirectorConsent([verified, entry("bb", { event: "Withdrawn", effectiveDate: "2027-01-01" })], director, society);
assert.equal(pendingWithdrawal.state, "verified", "a scheduled withdrawal leaves today's consent in place");
assert.equal(pendingWithdrawal.upcoming?.event, "Withdrawn");
// A superseded version doesn't count; the revision does.
assert.equal(stateOf([verified, entry("cc", { effectiveDate: "2025-06-01", reviewStatus: "Disputed", previousId: "a" })]), "disputed", "a revision replaces the entry it supersedes");
// Another director's entries and other scopes are ignored.
assert.equal(stateOf([entry("a", { directorId: "d2", reviewStatus: "Reviewed" }), entry("bb", { scope: "Remote participation", reviewStatus: "Reviewed" })]), "none");

// Meeting basis: present at the meeting and did not refuse (Societies Act s.42(4)).
assert.equal(stateOf([entry("a", { basis: "Meeting record", meetingId: "m1", reviewStatus: "Reviewed" })]), "verified", "a verified meeting basis satisfies a BC society");
// A basis the Act doesn't recognise for this entity stays awaiting review.
const conduct = assessDirectorConsent([entry("a", { basis: "Conduct", reviewStatus: "Reviewed" })], director, society);
assert.deepEqual([conduct.state, conduct.basisNotAccepted], ["awaiting_review", true], "a BC society has no conduct basis");
assert.equal(stateOf([entry("a", { basis: "Conduct", reviewStatus: "Reviewed" })], { today, acceptedBases: acceptedConsentBases(BC_COMPANY) }), "verified", "BCBCA s.123 accepts conduct");
assert.equal(stateOf([entry("a", { basis: undefined, reviewStatus: "Reviewed" })]), "awaiting_review", "a review without a basis is not verified");

// Basis options follow the governing Act.
assert.deepEqual(acceptedConsentBases(BC_SOCIETY), ["Written consent", "Meeting record"]);
// BCA s.123(1)(a) written, s.123(1)(b) conduct, and s.122(4)(b) present at the
// electing meeting without refusing (not for a first director's designation).
assert.deepEqual(acceptedConsentBases(BC_COMPANY), ["Written consent", "Meeting record", "Conduct"]);
const bcOption = (value: string) => consentBasisOptions(BC_COMPANY).find((option) => option.value === value)!;
assert.match(bcOption("Written consent").label, /before or after the appointment/);
assert.match(bcOption("Conduct").label, /after learning of the appointment/);
assert.match(bcOption("Meeting record").evidence, /first director/);
assert.deepEqual(acceptedConsentBases(CBCA).sort(), ["Conduct", "Meeting record", "Written consent"]);
assert.match(consentBasisOptions(CBCA).find((option) => option.value === "Written consent")!.label, /ten days/);
assert.match(consentBasisOptions(CBCA).find((option) => option.value === "Conduct")!.label, /Not at the meeting/);
assert.deepEqual(acceptedConsentBases(OBCA), ["Written consent"]);
assert.ok(acceptedConsentBases(null).includes("Other"), "an unreviewed profile allows any basis");
assert.equal(consentAssessmentOptions(CBCA, today).writtenConsentWindowDays, 10, "CBCA s.106(9) has a ten-day window");
for (const org of [BC_SOCIETY, BC_COMPANY, OBCA]) assert.equal(consentAssessmentOptions(org, today).writtenConsentWindowDays, undefined, `${org.name}: no enforced window`);

// Marking reviewed needs a basis the Act accepts and something pointing at the evidence.
assert.match(consentReviewProblem({ event: "Given" }, BC_SOCIETY)!, /basis/);
assert.match(consentReviewProblem({ event: "Given", basis: "Conduct", evidenceLocation: "x" }, BC_SOCIETY)!, /governing Act/);
assert.match(consentReviewProblem({ event: "Given", basis: "Meeting record", evidenceLocation: "Minute book" }, BC_SOCIETY)!, /meeting/);
assert.equal(consentReviewProblem({ event: "Given", basis: "Meeting record", meetingId: "m1" }, BC_SOCIETY), undefined);
assert.match(consentReviewProblem({ event: "Given", basis: "Written consent" }, BC_SOCIETY)!, /evidence/);
assert.equal(consentReviewProblem({ event: "Given", basis: "Written consent", evidenceLocation: "Minute book" }, BC_SOCIETY), undefined);

/* -------------------- written consent timing per Act --------------------- */
// The entry's effective date is the appointment date.
const late = { effectiveDate: "2026-03-01", signedOn: "2026-03-12" }; // eleven days after
const dayTen = { effectiveDate: "2026-03-01", signedOn: "2026-03-11" };
const before = { effectiveDate: "2026-03-01", signedOn: "2026-02-20" };
const writtenAt = (dates: { effectiveDate: string; signedOn?: string }) => ({ event: "Given", basis: "Written consent", evidenceLocation: "Minute book", ...dates });
assert.equal(writtenConsentTiming(writtenAt(late)), "late");
assert.equal(writtenConsentTiming(writtenAt(dayTen)), "on_time", "the tenth day after still counts");
assert.equal(writtenConsentTiming(writtenAt(before)), "on_time", "a consent before the appointment counts");
assert.equal(writtenConsentTiming(writtenAt({ effectiveDate: "2026-03-01" })), "missing");
assert.equal(writtenConsentTiming({ basis: "Conduct", ...late }), undefined, "timing is about written consent only");

// CBCA: a late written consent can't be reviewed on that basis; a missing date must be recorded first.
assert.equal(consentReviewProblem(writtenAt(late), CBCA), CBCA_LATE_WRITTEN_CONSENT);
assert.equal(consentReviewProblem(writtenAt(dayTen), CBCA), undefined);
assert.equal(consentReviewProblem(writtenAt(before), CBCA), undefined);
assert.equal(consentReviewProblem(writtenAt({ effectiveDate: "2026-03-01" }), CBCA), CBCA_WRITTEN_CONSENT_NEEDS_DATE);
assert.equal(consentReviewProblem({ event: "Given", basis: "Conduct", evidenceLocation: "Board minutes", ...late }, CBCA), undefined, "acting as a director has no ten-day limit");
const cbcaOptions = consentAssessmentOptions(CBCA, today);
const lateReviewed = assessDirectorConsent([entry("a", { reviewStatus: "Reviewed", ...late })], director, cbcaOptions);
assert.deepEqual([lateReviewed.state, lateReviewed.basisNotAccepted, lateReviewed.basisNotAcceptedReason], ["awaiting_review", true, CBCA_LATE_WRITTEN_CONSENT], "an already-reviewed late CBCA consent isn't verified");
assert.equal(stateOf([entry("a", { reviewStatus: "Reviewed", ...dayTen })], cbcaOptions), "verified");
assert.equal(stateOf([entry("a", { reviewStatus: "Reviewed", effectiveDate: "2026-03-01" })], cbcaOptions), "verified", "an existing review without a signed date isn't reopened");
assert.equal(consentTimingNote(writtenAt(late), CBCA), CBCA_LATE_WRITTEN_CONSENT);

// OBCA: a late written consent still validates the appointment (s.119(10)); it is noted, not blocked.
const obcaOptions = consentAssessmentOptions(OBCA, today);
assert.equal(consentReviewProblem(writtenAt(late), OBCA), undefined);
assert.equal(stateOf([entry("a", { reviewStatus: "Reviewed", ...late })], obcaOptions), "verified");
assert.equal(consentTimingNote(writtenAt(late), OBCA), OBCA_LATE_WRITTEN_CONSENT_NOTE);
assert.equal(OBCA_LATE_WRITTEN_CONSENT_NOTE, "Signed after the ten-day window; s.119(10) still validates the appointment.");
assert.equal(consentTimingNote(writtenAt(dayTen), OBCA), undefined);

// BC company and BC society: no timing gate; a BC written consent may come before or after.
for (const org of [BC_COMPANY, BC_SOCIETY]) {
  assert.equal(consentReviewProblem(writtenAt(late), org), undefined, `${org.name}: late written consent`);
  assert.equal(consentReviewProblem(writtenAt({ effectiveDate: "2026-03-01" }), org), undefined, `${org.name}: no signed date needed`);
  assert.equal(stateOf([entry("a", { reviewStatus: "Reviewed", ...late })], consentAssessmentOptions(org, today)), "verified");
  assert.equal(consentTimingNote(writtenAt(late), org), undefined);
}
assert.equal(stateOf([entry("a", { basis: "Conduct", evidenceLocation: "Board minutes", reviewStatus: "Reviewed" })], consentAssessmentOptions(BC_COMPANY, today)), "verified", "BCA s.123(1)(b) conduct");

// "Today" is the organization's calendar day.
assert.equal(consentToday(BC_SOCIETY, new Date("2026-11-21T07:30:00Z")), "2026-11-20", "Vancouver is still on the 20th");
assert.equal(consentToday(OBCA, new Date("2026-11-21T07:30:00Z")), "2026-11-21", "Toronto has moved on");

// Wording.
assert.equal(unverifiedConsentSentence(["verified", "awaiting_review", "none"]), "Consent to act isn't verified for 2 active directors (1 with no basis recorded, 1 awaiting review).");
assert.equal(unverifiedConsentSentence(["legacy_flag_only"]), "Consent to act isn't verified for 1 active director (marked on file without details).");
assert.equal(unverifiedConsentSentence(["verified"]), undefined);
assert.equal(describeUnverifiedConsents(["disputed", "scheduled", "withdrawn"]), "1 disputed, 1 not yet in effect, 1 withdrawn");

// Dashboard rules read the state, not the legacy flag.
const consentRule = bcSocietiesDashboardComplianceRulePack.rules.find((rule) => rule.id === "BC-SOC-DIRECTOR-CONSENT")!;
const ruleContext = (states: ("verified" | "awaiting_review" | "none" | "legacy_flag_only")[]) => ({
  society: { isMemberFunded: false }, rulesConfigured: true,
  activeDirectors: states.map((consentState) => ({ consentState, isBCResident: true })),
});
assert.equal(consentRule.passFail(ruleContext(["verified", "verified", "verified"])), null);
const ruleFlag = consentRule.passFail(ruleContext(["verified", "awaiting_review", "none"]))!;
assert.equal(ruleFlag.level, "warn");
assert.equal(ruleFlag.text, "Consent to act isn't verified for 2 active directors (1 with no basis recorded, 1 awaiting review).");
assert.equal(ruleFlag.citationId, "BC-SOC-DIRECTOR-CONSENT", "citation kept");
assert.ok(consentRule.passFail(ruleContext(["legacy_flag_only"])), "a legacy flag alone is flagged");
const companyRule = dashboardComplianceRulePackForOrganization(BC_COMPANY).rules.find((rule) => rule.id === "LEGAL-bc_company-DIRECTOR-CONSENT")!;
const companyFlag = companyRule.passFail(ruleContext(["awaiting_review"]))!;
assert.match(companyFlag.text, /^Consent to act isn't verified for 1 active director \(awaiting review\)\. /);
assert.deepEqual(companyFlag.citationIds, ["BC-BCA-DIRECTOR-CONSENT"]);
assert.equal(companyRule.passFail(ruleContext(["verified"])), null);

/* ------------------------------- write paths ------------------------------ */
const db = new MemoryDb({ seed: {
  societies: [{ _id: "soc", ...BC_SOCIETY }],
  users: [
    { _id: "owner", societyId: "soc", role: "Owner", displayName: "Olive Owner" },
    { _id: "viewer", societyId: "soc", role: "Viewer", displayName: "Vic Viewer" },
    { _id: "secretary", societyId: "soc", role: "Admin", displayName: "Sam Secretary" },
  ],
  directors: ["d1", "d2", "d3", "d4", "d5"].map((id) => ({ _id: id, societyId: "soc", firstName: "Example", lastName: id, position: "Director", isBCResident: true, termStart: "2026-01-01", status: "Active", consentOnFile: id === "d4" })),
  meetings: [{ _id: "m1", societyId: "soc", type: "AGM", title: "2026 AGM", scheduledAt: "2026-06-20T18:00:00Z", status: "Held" }],
  documents: [{ _id: "doc", societyId: "soc", title: "Signed consent", category: "Governance", tags: [] }],
} });
function runtime(userId: string) {
  return new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({
    kind: "user", runtime: "test", assurance: "trusted-workspace", subject: userId, userId, societyId: "soc",
  }) }).registerAll(PORTABLE_FUNCTIONS);
}
const owner = runtime("owner");
const viewer = runtime("viewer");
const secretary = runtime("secretary");
const consentRow = (id: string) => (db.dump("directorConsents") as Record<string, unknown>[]).find((row) => row._id === id)!;
const scope = { societyId: "soc", register: "directorConsents" };
const flagOf = (id: string) => (db.dump("directors") as { _id: string; consentOnFile: boolean }[]).find((row) => row._id === id)!.consentOnFile;
const states = async () => new Map((await owner.runQuery<{ directorId: string; state: string; currentId?: string }[]>("directors:consentStates", { societyId: "soc" })).map((row) => [row.directorId, row]));

// Meeting basis recorded: awaiting review until someone checks it.
const meetingEntry = await owner.runMutation<string>("businessEvidence:save", { ...scope, values: {
  directorId: "d1", scope: "Consent to act", event: "Given", effectiveDate: "2026-06-20", basis: "Meeting record", reviewStatus: "Awaiting review",
} });
assert.equal(flagOf("d1"), false);
assert.equal((await states()).get("d1")?.state, "awaiting_review");
await assert.rejects(owner.runMutation("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: meetingEntry, decision: "Reviewed" }), /meeting/, "a meeting basis needs its meeting");
const withMeeting = await owner.runMutation<string>("businessEvidence:save", { ...scope, previousId: meetingEntry, values: {
  directorId: "d1", scope: "Consent to act", event: "Given", effectiveDate: "2026-06-20", basis: "Meeting record", meetingId: "m1", evidenceReference: "Minutes item 6", reviewStatus: "Awaiting review",
} });
await assert.rejects(viewer.runMutation("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: withMeeting, decision: "Reviewed" }), /Permission/, "reviewing needs the consent write permission");
const reviewedId = await owner.runMutation<string>("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: withMeeting, decision: "Reviewed" });
const reviewed = (db.dump("directorConsents") as Record<string, unknown>[]).find((row) => row._id === reviewedId)!;
assert.equal(reviewed.reviewStatus, "Reviewed");
assert.equal(reviewed.reviewedBy, "owner", "the reviewer is the signed-in member, not a client value");
assert.equal(reviewed.reviewedByName, "Olive Owner");
assert.ok(typeof reviewed.reviewedAt === "string");
assert.equal(reviewed.previousId, withMeeting, "a review is a new version of the entry");
assert.equal(reviewed.meetingId, "m1", "particulars carry forward");
assert.equal(reviewed.enteredBy, "owner", "the review keeps who recorded the particulars");
assert.equal(reviewed.selfReviewed, true, "recorded and reviewed by the same person is stamped, not blocked");
assert.equal(flagOf("d1"), true, "verified meeting basis sets the cached flag for a BC society");
assert.equal((await states()).get("d1")?.state, "verified");
await assert.rejects(owner.runMutation("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: withMeeting, decision: "Reviewed" }), /newer version/);

// Disputing needs a reason, and clears the flag.
await assert.rejects(owner.runMutation("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: reviewedId, decision: "Disputed" }), /why/);
const disputedId = await owner.runMutation<string>("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: reviewedId, decision: "Disputed", note: "Not listed as present in the minutes." });
assert.equal(flagOf("d1"), false, "disputed doesn't establish consent");
assert.equal((await states()).get("d1")?.state, "disputed");
assert.equal((db.dump("directorConsents") as Record<string, unknown>[]).find((row) => row._id === disputedId)!.reviewNote, "Not listed as present in the minutes.");

// The generic register path: a Reviewed entry needs evidence and gets the reviewer stamped.
await assert.rejects(owner.runMutation("businessEvidence:save", { ...scope, values: {
  directorId: "d2", scope: "Consent to act", event: "Given", effectiveDate: "2026-01-01", basis: "Written consent", reviewStatus: "Reviewed",
} }), /evidence/);
const written = await owner.runMutation<string>("businessEvidence:save", { ...scope, documentId: "doc", values: {
  directorId: "d2", scope: "Consent to act", event: "Given", effectiveDate: "2026-01-01", basis: "Written consent", signedOn: "2025-12-30", reviewStatus: "Reviewed",
} });
assert.equal(consentRow(written).reviewedBy, "owner");
assert.equal(consentRow(written).selfReviewed, true, "saving particulars as Reviewed is a self-review");
assert.equal(flagOf("d2"), true, "verified written consent");
// Withdrawn after verified: not satisfied.
await owner.runMutation("businessEvidence:save", { ...scope, values: { directorId: "d2", scope: "Consent to act", event: "Withdrawn", effectiveDate: "2026-02-01" } });
assert.equal(flagOf("d2"), false, "withdrawn after verified");
assert.equal((await states()).get("d2")?.state, "withdrawn");

// A future-dated consent is scheduled, not current.
await owner.runMutation("businessEvidence:save", { ...scope, values: {
  directorId: "d3", scope: "Consent to act", event: "Given", effectiveDate: "2999-01-01", basis: "Written consent", evidenceLocation: "Minute book", reviewStatus: "Reviewed",
} });
assert.equal(flagOf("d3"), false, "future effective date doesn't establish current consent");
assert.equal((await states()).get("d3")?.state, "scheduled");

// d4 carries a pre-register flag and no entry.
assert.equal((await states()).get("d4")?.state, "legacy_flag_only");

// Ordinary director edits can't assert consent.
await owner.runMutation("directors:update", { id: "d3", patch: { consentOnFile: true, notes: "Edited" } });
assert.equal(flagOf("d3"), false, "directors.update ignores consentOnFile: true");
await owner.runMutation("directors:update", { id: "d4", patch: { consentOnFile: false } });
assert.equal(flagOf("d4"), false, "clearing a legacy flag works");
assert.equal((await states()).get("d4")?.state, "none");
await owner.runMutation("directors:update", { id: "d1", patch: { consentOnFile: false } });
const created = await owner.runMutation<string>("directors:create", { societyId: "soc", firstName: "New", lastName: "Director", position: "Director", isBCResident: true, termStart: "2026-01-01", consentOnFile: true, status: "Active" });
assert.equal(flagOf(created), false, "directors.create never asserts consent");
// Clearing on a verified director resets to what the register supports.
const verifiedAgain = await owner.runMutation<string>("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: disputedId, decision: "Reviewed" });
assert.ok(verifiedAgain);
assert.equal(flagOf("d1"), true);
await owner.runMutation("directors:update", { id: "d1", patch: { consentOnFile: false } });
assert.equal(flagOf("d1"), true, "the register, not the edit, decides a verified consent");

// Self-review is judged against who recorded the particulars, through every review version.
const secretaryEntry = await secretary.runMutation<string>("businessEvidence:save", { ...scope, values: {
  directorId: "d5", scope: "Consent to act", event: "Given", effectiveDate: "2026-01-01", basis: "Written consent", signedOn: "2025-12-20", evidenceLocation: "Minute book", reviewStatus: "Awaiting review",
} });
assert.equal(consentRow(secretaryEntry).selfReviewed, undefined, "not reviewed yet");
const ownerReview = await owner.runMutation<string>("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: secretaryEntry, decision: "Reviewed" });
assert.deepEqual([consentRow(ownerReview).enteredBy, consentRow(ownerReview).selfReviewed], ["secretary", undefined], "another member's review isn't stamped");
const ownerDispute = await owner.runMutation<string>("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: ownerReview, decision: "Disputed", note: "Signature page missing." });
assert.equal(consentRow(ownerDispute).enteredBy, "secretary", "carried through a review version");
const secretaryReview = await secretary.runMutation<string>("businessEvidence:reviewDirectorConsent", { societyId: "soc", consentId: ownerDispute, decision: "Reviewed" });
assert.deepEqual([consentRow(secretaryReview).enteredBy, consentRow(secretaryReview).selfReviewed, consentRow(secretaryReview).reviewedBy], ["secretary", true, "secretary"], "the recorder reviewing later is a self-review");
assert.equal(flagOf("d5"), true, "a self-review still verifies");

/* ---------------------- CBCA ten-day write path ---------------------- */
const corpDb = new MemoryDb({ seed: {
  societies: [{ _id: "corp", ...CBCA }],
  users: [{ _id: "corpOwner", societyId: "corp", role: "Owner", displayName: "Casey Owner" }],
  directors: ["c1", "c2", "c3", "c4"].map((id) => ({ _id: id, societyId: "corp", firstName: "Example", lastName: id, position: "Director", isBCResident: false, termStart: "2026-03-01", status: "Active", consentOnFile: false })),
} });
const corp = new PortableRuntime({ db: corpDb, capabilities: makeCapabilities({}), principalProvider: () => ({
  kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "corpOwner", userId: "corpOwner", societyId: "corp",
}) }).registerAll(PORTABLE_FUNCTIONS);
const corpScope = { societyId: "corp", register: "directorConsents" };
const corpConsent = (directorId: string, dates: { signedOn?: string }, reviewStatus = "Awaiting review") => ({ ...corpScope, values: {
  directorId, scope: "Consent to act", event: "Given", effectiveDate: "2026-03-01", basis: "Written consent", evidenceLocation: "Minute book", reviewStatus, ...dates,
} });
await assert.rejects(corp.runMutation("businessEvidence:save", corpConsent("c1", { signedOn: "2026-03-12" }, "Reviewed")), /more than ten days/, "a late consent can't be saved as reviewed");
const lateCorp = await corp.runMutation<string>("businessEvidence:save", corpConsent("c1", { signedOn: "2026-03-12" }));
await assert.rejects(corp.runMutation("businessEvidence:reviewDirectorConsent", { societyId: "corp", consentId: lateCorp, decision: "Reviewed" }), /more than ten days/);
const undatedCorp = await corp.runMutation<string>("businessEvidence:save", corpConsent("c2", {}));
await assert.rejects(corp.runMutation("businessEvidence:reviewDirectorConsent", { societyId: "corp", consentId: undatedCorp, decision: "Reviewed" }), /date the consent was signed/);
const timelyCorp = await corp.runMutation<string>("businessEvidence:save", corpConsent("c3", { signedOn: "2026-03-11" }));
await corp.runMutation("businessEvidence:reviewDirectorConsent", { societyId: "corp", consentId: timelyCorp, decision: "Reviewed" });
// A late consent reviewed before the rule (written straight to the register).
await corpDb.insert("directorConsents", { societyId: "corp", directorId: "c4", scope: "Consent to act", event: "Given", effectiveDate: "2026-03-01", basis: "Written consent", signedOn: "2026-04-15", evidenceLocation: "Minute book", reviewStatus: "Reviewed", reviewedBy: "corpOwner", reviewedByName: "Casey Owner", reviewedAt: "2026-04-16T00:00:00.000Z", recordedAt: "2026-04-16T00:00:00.000Z", recordedBy: "corpOwner" });
const corpStates = new Map((await corp.runQuery<{ directorId: string; state: string; basisNotAccepted?: boolean; basisNotAcceptedReason?: string }[]>("directors:consentStates", { societyId: "corp" })).map((row) => [row.directorId, row]));
assert.equal(corpStates.get("c1")?.state, "awaiting_review");
assert.equal(corpStates.get("c2")?.state, "awaiting_review");
assert.equal(corpStates.get("c3")?.state, "verified", "signed on the tenth day after the appointment");
assert.deepEqual([corpStates.get("c4")?.state, corpStates.get("c4")?.basisNotAccepted, corpStates.get("c4")?.basisNotAcceptedReason], ["awaiting_review", true, CBCA_LATE_WRITTEN_CONSENT]);

console.log("Director consent state: derivation, basis per Act, review stamping and director write-path checks passed.");

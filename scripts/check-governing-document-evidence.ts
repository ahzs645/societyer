/**
 * Gate: evidence for governing documents and the privacy policy.
 * Synthetic fixtures only.
 *
 * - "Held elsewhere" records an external system reference or a physical
 *   records location, and it satisfies the constitution / bylaws / privacy
 *   policy evidence rules on the dashboard;
 * - "Verify current" is separate from linking and tied to the copy it
 *   verified; replacing that copy leaves the new one unverified;
 * - the privacy review is an attestation: blocking findings (the default) or
 *   no policy location keep the program outstanding; a review with a location
 *   and no findings, or only minor follow-ups, marks it documented, and the
 *   follow-ups show as an info note; an older review without the flag blocks;
 * - the old one-click "Mark reviewed" route writes nothing;
 * - only the fields an organization keeps, and only people who may edit the
 *   profile.
 */
import assert from "node:assert/strict";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { actionPermission } from "../shared/functions/actionPolicy";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { governingDocumentCurrentness, privacyFindingsBlocking, privacyProgramAssessment, type EvidenceFacts } from "../shared/governingDocumentEvidence";
import { dashboardComplianceRulePackForOrganization, evaluateDashboardComplianceRules, type ComplianceSociety } from "../shared/dashboardComplianceRules";
import { todayDateOnly } from "../shared/dateOnly";
import type { recordPrivacyReviewPortable, setGoverningDocumentEvidencePortable, verifyGoverningDocumentCurrentPortable } from "../shared/functions/governingDocumentEvidence";

type EvidenceResult = Awaited<ReturnType<typeof setGoverningDocumentEvidencePortable>>;
type VerifyResult = Awaited<ReturnType<typeof verifyGoverningDocumentCurrentPortable>>;
type ReviewResult = Awaited<ReturnType<typeof recordPrivacyReviewPortable>>;

for (const name of ["society:setGoverningDocumentEvidence", "society:verifyGoverningDocumentCurrent", "society:recordPrivacyReview"]) {
  assert.equal(actionPermission(name, "mutation"), "society:write", `${name} needs profile edit rights`);
}

const now = new Date().toISOString();
const today = todayDateOnly();
const bcSociety = { name: "Riverside Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", formationStatus: "incorporated", organizationStatus: "active", isCharity: false, isMemberFunded: false };
const bcCompany = { name: "Synthetic Holdings Ltd.", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_", legalSubtype: "ordinary_private_company", formationStatus: "incorporated", organizationStatus: "active", isCharity: false, isMemberFunded: false };
const issuer = betterAuthIssuer();
const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", ...bcSociety, bylawsDocId: "d-bylaws" }, { _id: "co", ...bcCompany }],
    users: [
      { _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Pat Secretary" },
      { _id: "viewer", societyId: "soc", role: "Viewer", status: "Active", displayName: "Val Viewer" },
      { _id: "co-owner", societyId: "co", role: "Owner", status: "Active" },
    ].map((user) => ({ ...user, authSubject: user._id, authProvider: "better-auth", authIssuer: issuer })),
    documents: [{ _id: "d-bylaws", societyId: "soc", title: "Bylaws (2019 consolidation)", category: "Bylaws", createdAtISO: now, flaggedForDeletion: false, tags: [] }],
  },
});
const as = (userId: string) => new PortableRuntime({
  db, capabilities: makeCapabilities({}),
  principalProvider: () => ({ kind: "user" as const, runtime: "test" as const, assurance: "verified-jwt" as const, subject: userId, issuer, authProvider: "better-auth" }),
}).registerAll(PORTABLE_FUNCTIONS);
const owner = as("owner");
const viewer = as("viewer");
const society = async () => (await db.get("soc")) as EvidenceFacts & ComplianceSociety & Record<string, unknown>;
const flag = async (ruleId: string) => {
  const row = await society();
  const pack = dashboardComplianceRulePackForOrganization(bcSociety);
  return evaluateDashboardComplianceRules({ society: { ...row, isMemberFunded: false }, activeDirectors: [], rulesConfigured: true }, pack).find((item) => item.ruleId === ruleId);
};

/* ----------------------------- held elsewhere ----------------------------- */

assert.equal((await flag("BC-SOC-CONSTITUTION-EVIDENCE"))?.level, "warn", "nothing identified yet");
await assert.rejects(
  () => viewer.runMutation("society:setGoverningDocumentEvidence", { societyId: "soc", field: "constitutionDocId", evidence: { kind: "external", reference: "x" } }),
  /permission|not allowed|role|cannot/i,
  "a viewer can't record evidence",
);
await assert.rejects(
  () => owner.runMutation("society:setGoverningDocumentEvidence", { societyId: "soc", field: "constitutionDocId", evidence: { kind: "external", reference: "  " } }),
  /required/,
);
await assert.rejects(
  () => owner.runMutation("society:setGoverningDocumentEvidence", { societyId: "soc", field: "constitutionDocId", evidence: { kind: "somewhere", reference: "x" } }),
  /external system reference or a physical records location/,
);
const recorded = (await owner.runMutation("society:setGoverningDocumentEvidence", {
  societyId: "soc",
  field: "constitutionDocId",
  evidence: { kind: "external", reference: "https://registry.example/societies/S0012345/filings", custodian: "Secretary", version: "Transition filing", effectiveDate: "2017-03-01" },
})) as EvidenceResult;
assert.equal(recorded.changed, true);
assert.equal(recorded.entry?.recordedByName, "Pat Secretary");
assert.equal(recorded.entry?.recordedByUserId, "owner");
const afterRecord = await society();
assert.equal(afterRecord.constitutionDocId, undefined, "held elsewhere never links a document");
assert.equal(governingDocumentCurrentness(afterRecord, "constitutionDocId").evidence?.kind, "external");
const unverified = await flag("BC-SOC-CONSTITUTION-EVIDENCE");
assert.equal(unverified?.level, "info", "external evidence resolves the gap; currentness stays a note");
assert.match(unverified!.text, /Constitution on record — currentness not verified/);

// A BC company keeps articles only: no bylaws slot to record against.
await assert.rejects(
  () => as("co-owner").runMutation("society:setGoverningDocumentEvidence", { societyId: "co", field: "bylawsDocId", evidence: { kind: "physical", reference: "Minute book" } }),
  /doesn't keep that document/,
);
// Another workspace's owner can't write here.
await assert.rejects(() => as("co-owner").runMutation("society:setGoverningDocumentEvidence", { societyId: "soc", field: "constitutionDocId", evidence: null }));

/* ---------------------------- verify current ---------------------------- */

await assert.rejects(
  () => owner.runMutation("society:verifyGoverningDocumentCurrent", { societyId: "soc", field: "privacyPolicyDocId", verifiedAsOf: today }),
  /before verifying/,
  "nothing to verify until the copy is identified",
);
await assert.rejects(
  () => owner.runMutation("society:verifyGoverningDocumentCurrent", { societyId: "soc", field: "constitutionDocId", verifiedAsOf: "2999-01-01" }),
  /future/,
);
const verified = (await owner.runMutation("society:verifyGoverningDocumentCurrent", { societyId: "soc", field: "constitutionDocId", verifiedAsOf: today, versionReference: "Constitution as filed 2017-03-01" })) as VerifyResult;
assert.equal(verified.verification.evidenceKind, "external");
assert.equal(verified.verification.verifiedByName, "Pat Secretary");
assert.equal(await flag("BC-SOC-CONSTITUTION-EVIDENCE"), undefined, "verified external copy passes");

// Uploaded but unverified bylaws show the note; verifying the uploaded copy clears it.
assert.equal((await flag("BC-SOC-BYLAWS-EVIDENCE"))?.level, "info");
await owner.runMutation("society:verifyGoverningDocumentCurrent", { societyId: "soc", field: "bylawsDocId", verifiedAsOf: today });
assert.equal((await society()).governingDocumentVerifications?.find((row) => row.field === "bylawsDocId")?.documentId, "d-bylaws");
assert.equal(await flag("BC-SOC-BYLAWS-EVIDENCE"), undefined);

// Changing the reference leaves the new copy unverified.
await new Promise((resolve) => setTimeout(resolve, 5));
await owner.runMutation("society:setGoverningDocumentEvidence", { societyId: "soc", field: "constitutionDocId", evidence: { kind: "physical", reference: "Records binder, registered office" } });
const replaced = await flag("BC-SOC-CONSTITUTION-EVIDENCE");
assert.equal(replaced?.level, "info");
assert.match(replaced!.text, /replaced/);

// Clearing it brings the gap back.
const cleared = (await owner.runMutation("society:setGoverningDocumentEvidence", { societyId: "soc", field: "constitutionDocId", evidence: null })) as EvidenceResult;
assert.equal(cleared.changed, true);
assert.equal((await flag("BC-SOC-CONSTITUTION-EVIDENCE"))?.level, "warn");

/* ----------------------------- privacy review ----------------------------- */

assert.equal((await flag("PIPA-POLICY-EVIDENCE"))?.level, "warn");
await assert.rejects(
  () => owner.runMutation("dashboardRemediation:markPrivacyProgramReviewed", { societyId: "soc", ruleId: "PIPA-POLICY-DOCUMENTED", flagLevel: "warn", flagText: "x", evidenceRequired: [] }),
  /Record review/,
  "the one-click route is retired",
);
assert.equal((await society()).privacyProgramStatus, undefined, "the retired route writes nothing");

// No location anywhere: recorded, but the program stays outstanding.
const noLocation = (await owner.runMutation("society:recordPrivacyReview", { societyId: "soc", policiesReviewed: "Privacy policy", reviewedOn: today })) as ReviewResult;
assert.equal(noLocation.documented, false);
assert.equal(noLocation.missingLocation, true);
assert.equal((await society()).privacyProgramStatus, "Needs review");
assert.equal((await flag("PIPA-POLICY-DOCUMENTED"))?.level, "warn");

// Findings keep it outstanding even with a location, and they show on the dashboard.
const withFindings = (await owner.runMutation("society:recordPrivacyReview", {
  societyId: "soc",
  policiesReviewed: "Privacy policy, complaint process",
  versionOrEffectiveDate: "v2",
  maintainedAt: "Staff handbook site",
  reviewedOn: today,
  unresolvedFindings: "Complaint process is not published.",
})) as ReviewResult;
assert.equal(withFindings.documented, false);
assert.equal((await society()).privacyProgramStatus, "Needs review");
const findingsFlag = await flag("PIPA-POLICY-DOCUMENTED");
assert.equal(findingsFlag?.level, "warn");
assert.match(findingsFlag!.text, /Reviewed by Pat Secretary/);
assert.match(findingsFlag!.text, /Complaint process is not published/);
assert.equal((await society()).privacyProgramReview?.findingsBlocking, true, "findings block unless the reviewer says otherwise");

// Saying they block is the same as leaving the default.
const explicitBlocking = (await owner.runMutation("society:recordPrivacyReview", {
  societyId: "soc", policiesReviewed: "Privacy policy", maintainedAt: "Staff handbook site", reviewedOn: today,
  unresolvedFindings: "No retention schedule.", findingsBlocking: true,
})) as ReviewResult;
assert.equal(explicitBlocking.documented, false);
assert.equal((await flag("PIPA-POLICY-DOCUMENTED"))?.level, "warn");

// Minor follow-ups: the program is documented, and the dashboard notes them at info.
const followUps = (await owner.runMutation("society:recordPrivacyReview", {
  societyId: "soc", policiesReviewed: "Privacy policy, complaint process", maintainedAt: "Staff handbook site", reviewedOn: today,
  unresolvedFindings: "Update the privacy officer's phone number.", findingsBlocking: false,
})) as ReviewResult;
assert.equal(followUps.documented, true);
const withFollowUps = await society();
assert.equal(withFollowUps.privacyProgramStatus, "Documented");
assert.equal(withFollowUps.privacyProgramReview?.findingsBlocking, false);
assert.equal(privacyProgramAssessment(withFollowUps).state, "follow-ups");
const followUpFlag = await flag("PIPA-POLICY-DOCUMENTED");
assert.equal(followUpFlag?.level, "info", "follow-ups are a note, not a gap");
assert.match(followUpFlag!.text, /documented, with follow-ups/);
assert.match(followUpFlag!.text, /privacy officer's phone number/);
assert.equal(privacyFindingsBlocking(withFollowUps.privacyProgramReview), false);
// Non-blocking findings still need a location.
const followUpsNoLocation = (await owner.runMutation("society:recordPrivacyReview", {
  societyId: "soc", policiesReviewed: "Privacy policy", reviewedOn: today, unresolvedFindings: "Minor wording.", findingsBlocking: false,
})) as ReviewResult;
assert.equal(followUpsNoLocation.documented, false);
assert.equal(followUpsNoLocation.missingLocation, true);
// An older review stored before the flag existed counts its findings as blocking.
const legacyReview = { policiesReviewed: "Privacy policy", maintainedAt: "Binder", unresolvedFindings: "Something", reviewedOn: today, reviewedAtISO: `${today}T00:00:00.000Z` };
assert.equal(privacyFindingsBlocking(legacyReview), true);
assert.equal(privacyProgramAssessment({ privacyProgramStatus: "Documented", privacyProgramReview: legacyReview }).state, "findings");
// The flag means nothing without findings, and isn't stored.
assert.equal(privacyFindingsBlocking({ ...legacyReview, unresolvedFindings: undefined }), false);

// Location and no findings: documented, attributed to the reviewer.
const clean = (await owner.runMutation("society:recordPrivacyReview", {
  societyId: "soc",
  policiesReviewed: "Privacy policy, complaint process",
  versionOrEffectiveDate: "v3",
  maintainedAt: "Staff handbook site",
  reviewedOn: today,
  findingsBlocking: false,
})) as ReviewResult;
assert.equal(clean.documented, true);
const reviewed = await society();
assert.equal(reviewed.privacyProgramReview?.findingsBlocking, undefined, "no findings, no flag stored");
assert.equal(reviewed.privacyProgramStatus, "Documented");
assert.equal(reviewed.privacyProgramReviewedAtISO, today);
assert.equal(reviewed.privacyProgramReview?.reviewedByName, "Pat Secretary");
assert.equal(privacyProgramAssessment(reviewed).state, "documented");
assert.equal(await flag("PIPA-POLICY-DOCUMENTED"), undefined);

// The policy itself held elsewhere answers the evidence-location question.
await owner.runMutation("society:setGoverningDocumentEvidence", { societyId: "soc", field: "privacyPolicyDocId", evidence: { kind: "external", reference: "https://handbook.example/privacy" } });
assert.equal(await flag("PIPA-POLICY-EVIDENCE"), undefined);
await assert.rejects(() => viewer.runMutation("society:recordPrivacyReview", { societyId: "soc", policiesReviewed: "x", reviewedOn: today, maintainedAt: "y" }));

const activity = await db.query("activity").collect();
for (const action of ["governing-document-evidence-recorded", "governing-document-verified-current", "governing-document-evidence-cleared", "privacy-program-reviewed"]) {
  assert.ok(activity.some((row) => row.action === action && row.actor === "Pat Secretary"), `activity: ${action}`);
}

console.log("Governing-document evidence, currentness and privacy review checks passed.");

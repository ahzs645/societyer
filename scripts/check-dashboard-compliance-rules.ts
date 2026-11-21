import assert from "node:assert/strict";
import {
  bcSocietiesDashboardComplianceRulePack,
  dashboardComplianceRulePackForOrganization,
  evaluateDashboardComplianceRules,
  type ComplianceSociety,
  type DashboardComplianceContext,
} from "../convex/lib/dashboardComplianceRules";
import { governingDocumentCurrentness, privacyProgramAssessment } from "../shared/governingDocumentEvidence";

let fixtureCount = 0;

for (const rule of bcSocietiesDashboardComplianceRulePack.rules) {
  assert.ok(rule.id, "rule id is required");
  assert.ok(["bc_society", "bc_organization", "general"].includes(rule.audience), `${rule.id} audience is required`);
  if (/Societies Act|Society bylaws|model bylaws/i.test(rule.citation)) {
    assert.equal(rule.audience, "bc_society", `${rule.id}: Societies Act rules must be BC-society-only`);
  }
  assert.ok(rule.jurisdiction, `${rule.id} jurisdiction is required`);
  assert.ok(rule.societyType, `${rule.id} society type is required`);
  assert.ok(rule.effectiveDate, `${rule.id} effective date is required`);
  assert.ok(rule.ruleText, `${rule.id} rule text is required`);
  assert.ok(rule.citation, `${rule.id} citation is required`);
  assert.ok(rule.evidenceRequired.length > 0, `${rule.id} evidence is required`);
  assert.ok(rule.fixtures.length > 0, `${rule.id} needs at least one fixture`);

  for (const fixture of rule.fixtures) {
    fixtureCount += 1;
    const result = rule.passFail(fixture.context);
    assert.equal(
      result?.level ?? null,
      fixture.expectedLevel,
      `${rule.id}: ${fixture.name}`,
    );
    if (result) {
      assert.equal(result.ruleId, rule.id, `${rule.id}: fixture result should carry rule id`);
      assert.deepEqual(
        result.evidenceRequired,
        rule.evidenceRequired,
        `${rule.id}: fixture result should carry evidence requirements`,
      );
    }
  }
}

const verifiedAt = "2026-01-15T17:00:00.000Z";
const reviewedSociety: ComplianceSociety = {
  isMemberFunded: false,
  privacyPolicyDocId: "doc_privacy",
  privacyProgramStatus: "Documented",
  privacyProgramReview: { policiesReviewed: "Privacy policy", maintainedAt: "Documents", reviewedOn: "2026-01-15", reviewedAtISO: verifiedAt, reviewedByName: "Reviewer" },
  memberDataAccessStatus: "Society-controlled",
  memberDataGapDocumented: true,
  constitutionDocId: "doc_constitution",
  bylawsDocId: "doc_bylaws",
  governingDocumentVerifications: [
    { field: "constitutionDocId", verifiedAsOf: "2026-01-15", evidenceKind: "document", documentId: "doc_constitution", recordedAtISO: verifiedAt, verifiedByName: "Reviewer" },
    { field: "bylawsDocId", verifiedAsOf: "2026-01-15", evidenceKind: "document", documentId: "doc_bylaws", recordedAtISO: verifiedAt, verifiedByName: "Reviewer" },
  ],
};
const directors = [
  { consentOnFile: true, isBCResident: true },
  { consentOnFile: true, isBCResident: false },
  { consentOnFile: true, isBCResident: false },
];
const contextFor = (society: ComplianceSociety): DashboardComplianceContext => ({ society, activeDirectors: directors, rulesConfigured: true });
const flagFor = (society: ComplianceSociety, ruleId: string) =>
  evaluateDashboardComplianceRules(contextFor(society)).find((flag) => flag.ruleId === ruleId);

const okFlags = evaluateDashboardComplianceRules(contextFor(reviewedSociety));
assert.equal(okFlags.length, 1);
assert.equal(okFlags[0].level, "ok");

/* -------- governing documents: evidence held elsewhere + currentness -------- */

for (const [field, ruleId, phrase] of [
  ["constitutionDocId", "BC-SOC-CONSTITUTION-EVIDENCE", "constitution"],
  ["bylawsDocId", "BC-SOC-BYLAWS-EVIDENCE", "bylaws"],
] as const) {
  const missing = flagFor({ ...reviewedSociety, [field]: undefined, governingDocumentVerifications: [] }, ruleId);
  assert.equal(missing?.level, "warn", `${ruleId}: nothing identified is a gap`);
  assert.match(missing!.text, new RegExp(`Current ${phrase} not yet identified in Societyer`), `${ruleId}: says Societyer lacks it, not the society`);
  assert.doesNotMatch(missing!.text, /not uploaded|missing|has no/i, `${ruleId}: no wording that implies the document doesn't exist`);
  assert.ok(missing!.remediationActions.some((action) => action.id === "record-held-elsewhere" && action.to?.includes(`field=${field}`)), `${ruleId}: routes to Held elsewhere for this field`);

  // An external reference (or physical location) satisfies the evidence question.
  for (const kind of ["external", "physical"] as const) {
    const heldElsewhere: ComplianceSociety = {
      ...reviewedSociety,
      [field]: undefined,
      governingDocumentVerifications: [],
      governingDocumentEvidence: [{ field, kind, reference: kind === "external" ? "https://registry.example/filing/1" : "Records binder, registered office", custodian: "Secretary", recordedAtISO: verifiedAt }],
    };
    const note = flagFor(heldElsewhere, ruleId);
    assert.equal(note?.level, "info", `${ruleId}: ${kind} evidence resolves the gap; currentness stays a note`);
    assert.match(note!.text, /currentness not verified/);
    assert.equal(governingDocumentCurrentness(heldElsewhere, field).evidence?.kind, kind);
    const verified = { ...heldElsewhere, governingDocumentVerifications: [{ field, verifiedAsOf: "2026-02-01", evidenceKind: kind, evidenceRecordedAtISO: verifiedAt, recordedAtISO: verifiedAt, verifiedByName: "Reviewer" }] };
    assert.equal(flagFor(verified, ruleId), undefined, `${ruleId}: verified ${kind} evidence passes`);
    // Replacing the reference leaves the new one unverified.
    const replaced = { ...verified, governingDocumentEvidence: [{ ...heldElsewhere.governingDocumentEvidence![0], recordedAtISO: "2026-03-01T00:00:00.000Z" }] };
    assert.equal(flagFor(replaced, ruleId)?.level, "info", `${ruleId}: a replaced ${kind} reference needs verifying again`);
  }

  // Uploaded but unverified: the currentness note, with Verify current.
  const unverified = flagFor({ ...reviewedSociety, governingDocumentVerifications: [] }, ruleId);
  assert.equal(unverified?.level, "info", `${ruleId}: uploaded but unverified is a note`);
  assert.match(unverified!.text, /on record — currentness not verified/);
  assert.ok(unverified!.remediationActions.some((action) => action.id === "verify-current"), `${ruleId}: offers Verify current`);
  // A different document linked after verification is unverified again.
  const relinked = flagFor({ ...reviewedSociety, [field]: "doc_new" }, ruleId);
  assert.equal(relinked?.level, "info");
  assert.match(relinked!.text, /replaced/);
}

/* -------- privacy: evidence location + accountable review attestation -------- */

const noPolicyEvidence = flagFor({ ...reviewedSociety, privacyPolicyDocId: undefined }, "PIPA-POLICY-EVIDENCE");
assert.equal(noPolicyEvidence?.level, "warn");
assert.match(noPolicyEvidence!.text, /Societyer doesn't have the privacy policy's location identified/);
assert.equal(
  flagFor({ ...reviewedSociety, privacyPolicyDocId: undefined, governingDocumentEvidence: [{ field: "privacyPolicyDocId", kind: "external", reference: "https://intranet.example/privacy", recordedAtISO: verifiedAt }] }, "PIPA-POLICY-EVIDENCE"),
  undefined,
  "an external privacy policy reference satisfies the evidence-location question",
);
assert.ok(!flagFor({ ...reviewedSociety, privacyProgramStatus: "Needs review", privacyProgramReview: undefined }, "PIPA-POLICY-DOCUMENTED")?.remediationActions.some((action) => action.intent === "markPrivacyProgramReviewed"), "no one-click Mark reviewed");

const withFindings: ComplianceSociety = {
  ...reviewedSociety,
  privacyProgramStatus: "Needs review",
  privacyProgramReview: { ...reviewedSociety.privacyProgramReview!, unresolvedFindings: "Complaint process isn't published." },
};
const findingsFlag = flagFor(withFindings, "PIPA-POLICY-DOCUMENTED");
assert.equal(findingsFlag?.level, "warn", "a review with unresolved findings keeps the program outstanding");
assert.match(findingsFlag!.text, /unresolved findings \(Reviewed by Reviewer · 2026-01-15\): Complaint process/);
assert.equal(privacyProgramAssessment({ ...withFindings, privacyProgramStatus: "Documented" }).state, "findings", "findings outrank a hand-set Documented status");
assert.equal(flagFor(reviewedSociety, "PIPA-POLICY-DOCUMENTED"), undefined, "a review with a location and no findings documents the program");
const noLocation: ComplianceSociety = { ...reviewedSociety, privacyPolicyDocId: undefined, privacyProgramStatus: "Needs review", privacyProgramReview: { ...reviewedSociety.privacyProgramReview!, maintainedAt: undefined } };
assert.equal(flagFor(noLocation, "PIPA-POLICY-DOCUMENTED")?.level, "warn", "a review without a policy location stays outstanding");
assert.equal(flagFor({ ...reviewedSociety, privacyProgramReview: undefined }, "PIPA-POLICY-DOCUMENTED")?.level, "info", "documented without an attestation is a note");

/* -------- entity scope: the right rule set still reaches each organization -------- */

const ids = (organization: Record<string, unknown>) => dashboardComplianceRulePackForOrganization(organization).rules.map((rule) => rule.id);
const bcSociety = { name: "Riverside Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act" };
for (const ruleId of ["BC-SOC-CONSTITUTION-EVIDENCE", "BC-SOC-BYLAWS-EVIDENCE", "PIPA-POLICY-DOCUMENTED", "PIPA-POLICY-EVIDENCE"]) {
  assert.ok(ids(bcSociety).includes(ruleId), `BC society keeps ${ruleId}`);
}
const federalCorp = { name: "Northwind Ltd.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" };
const albertaSociety = { name: "Prairie Society", jurisdictionCode: "alberta", entityType: "society", actFormedUnder: "societies_act__alberta_" };
for (const organization of [federalCorp, albertaSociety]) {
  assert.ok(!ids(organization).some((id) => id.startsWith("BC-SOC-")), `${organization.name}: no Societies Act governing-document rules`);
  assert.ok(!ids(organization).includes("PIPA-POLICY-EVIDENCE"), `${organization.name}: no BC PIPA evidence rule`);
}
const corpPack = dashboardComplianceRulePackForOrganization(federalCorp);
const corpGoverning = corpPack.rules.find((rule) => rule.id.endsWith("-GOVERNING-DOCUMENTS"));
assert.ok(corpGoverning, "corporation keeps its own-Act governing-document rule");
assert.equal(corpGoverning!.passFail(contextFor({ isMemberFunded: false }))?.level, "warn");
assert.equal(
  corpGoverning!.passFail(contextFor({ isMemberFunded: false, governingDocumentEvidence: [{ field: "constitutionDocId", kind: "physical", reference: "Minute book at counsel's office", recordedAtISO: verifiedAt }] })),
  null,
  "corporate articles held at a physical location satisfy the own-Act document check",
);

console.log(
  `Checked ${bcSocietiesDashboardComplianceRulePack.rules.length} dashboard compliance rules and ${fixtureCount} fixtures.`,
);

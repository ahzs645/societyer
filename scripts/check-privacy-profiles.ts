import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { PRIVACY_CITATIONS, PRIVACY_LAWS, PRIVACY_REFORM_WATCH, resolvePrivacyProfile, hasApplicablePrivacyLaw, privacyCitationIdsFor, type PrivacyAssessmentInput } from "../shared/privacyRuleProfiles";
import { buildPrivacyPolicyDraft } from "../shared/privacyPolicyTemplate";
import { privacyRecordTemplate } from "../shared/privacyRecordTemplates";
import { pipaSetupMotionsFor } from "../shared/functions/motionBacklog";

const within = (province: string, extra: Partial<PrivacyAssessmentInput> = {}): PrivacyAssessmentInput => ({
  privacyOperatingJurisdictions: [province], privacyFederalWork: "no", privacyCommercialActivity: "no", privacyCrossBorderCommercial: "no", privacySectorSpecific: "none", ...extra,
});
const bc = within("CA-BC", { name: "Example BC Company", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_" });
const pipeda = within("CA-ON", { name: "Example Ontario Company", jurisdictionCode: "CA-ON-OBCA", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__ontario_", privacyCommercialActivity: "yes" });
const quebec = within("CA-QC", { name: "Example Québec Enterprise", privacyQuebecEnterprise: "yes" });

// Outside BC, form of incorporation and a province/address never resolve privacy law.
for (const org of [undefined, null, { jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" }, { jurisdictionCode: "CA-ON-OBCA" }, { jurisdictionCode: "alberta", entityType: "society", actFormedUnder: "societies_act__alberta_" }]) {
  const result = resolvePrivacyProfile(org);
  assert.equal(result.status, "unassessed");
  assert.deepEqual(result.applicableLawIds, []);
  assert.deepEqual(result.presumedLawIds, []);
  assert.ok(result.possibleLawIds.length > 0);
}
// BC PIPA s. 1 includes a not-for-profit in "organization" and s. 3(1) applies the
// Act to every organization, subject to the federal Act. A BC-home workspace
// without recorded facts is therefore presumed covered, labelled for confirmation.
const bcSociety = { name: "Riverside Community Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act" };
const bcCompanyNoFacts = { name: "Example BC Company", jurisdictionCode: "CA-BC", entityType: "corporation__business_", actFormedUnder: "business_corporations_act__british_columbia_" };
for (const org of [bcSociety, bcCompanyNoFacts, { jurisdictionCode: "CA-BC", name: "Legacy Society" }, { jurisdictionCode: "british_columbia", entityType: "cooperative" }]) {
  const result = resolvePrivacyProfile(org);
  assert.equal(result.status, "presumed", JSON.stringify(org));
  assert.deepEqual(result.applicableLawIds, ["bc_pipa"]);
  assert.deepEqual(result.presumedLawIds, ["bc_pipa"]);
  assert.equal(result.assessments.find((item) => item.lawId === "bc_pipa")?.basis, "presumed");
  assert.match(result.assessments.find((item) => item.lawId === "bc_pipa")!.reason, /^Presumed: confirm facts\./);
  assert.match(result.label, /BC PIPA — presumed: confirm facts/);
  assert.ok(hasApplicablePrivacyLaw(org, "bc_pipa"));
  assert.deepEqual(privacyCitationIdsFor(org, "access"), ["PIPA-ACCESS"]);
  assert.ok(result.possibleLawIds.includes("pipeda"), "federal-work and cross-border facts stay open");
  assert.ok(!result.possibleLawIds.includes("ab_pipa") && !result.possibleLawIds.includes("qc_private"), "a BC presumption does not list other provinces");
  assert.ok(result.unresolvedFacts.some((text) => /federal work/.test(text)));
}
assert.ok(PRIVACY_CITATIONS["PIPA-SCOPE"].quote.includes("not-for-profit"));
// Recorded facts displace the presumption.
assert.deepEqual(resolvePrivacyProfile({ ...bcSociety, privacyFederalWork: "yes" }).applicableLawIds, [], "a recorded federal work displaces BC PIPA (PIPEDA remains conditional on sector facts)");
assert.deepEqual(resolvePrivacyProfile({ ...bcSociety, privacyFederalWork: "yes", privacySectorSpecific: "none" }).applicableLawIds, ["pipeda"], "a recorded federal work selects PIPEDA instead of BC PIPA");
assert.equal(hasApplicablePrivacyLaw({ ...bcCompanyNoFacts, privacyFederalWork: "yes" }, "bc_pipa"), false);
assert.deepEqual(resolvePrivacyProfile({ ...bcSociety, privacyOperatingJurisdictions: ["CA-AB"] }).presumedLawIds, [], "recorded operations outside BC displace the presumption");
assert.ok(!resolvePrivacyProfile({ ...bcSociety, privacyOperatingJurisdictions: ["CA-AB"] }).applicableLawIds.includes("bc_pipa"));
assert.deepEqual(resolvePrivacyProfile({ ...bcSociety, privacySectorSpecific: "health" }).applicableLawIds, [], "a recorded health/public-sector regime needs its own assessment");
const partiallyRecorded = resolvePrivacyProfile({ ...bcSociety, privacyOperatingJurisdictions: ["CA-BC"] });
assert.deepEqual([partiallyRecorded.status, partiallyRecorded.presumedLawIds], ["conditional", ["bc_pipa"]], "BC operations with open federal-work facts remain presumed");
const recordedBc = resolvePrivacyProfile({ ...bcSociety, ...within("CA-BC") });
assert.deepEqual([recordedBc.status, recordedBc.presumedLawIds, recordedBc.label], ["assessed", [], "Privacy (BC PIPA)"], "recorded facts replace the presumption");
// Outside BC, recorded BC operations alone stay conditional until federal-work status is known.
assert.deepEqual(resolvePrivacyProfile({ jurisdictionCode: "CA-FED-CBCA", privacyOperatingJurisdictions: ["CA-BC"] }).applicableLawIds, []);
assert.deepEqual(resolvePrivacyProfile(bc).applicableLawIds, ["bc_pipa"]);
assert.equal(resolvePrivacyProfile(bc).status, "assessed");
assert.ok(hasApplicablePrivacyLaw(bc, "bc_pipa"));
assert.deepEqual(privacyCitationIdsFor(bc, "access"), ["PIPA-ACCESS"]);
assert.deepEqual(resolvePrivacyProfile(pipeda).applicableLawIds, ["pipeda"]);
assert.deepEqual(resolvePrivacyProfile(within("CA-ON")).applicableLawIds, [], "noncommercial nonprofit member handling does not automatically engage PIPEDA");
assert.equal(resolvePrivacyProfile(within("CA-ON")).status, "no-general-law-identified");
assert.deepEqual(resolvePrivacyProfile(within("CA-YT")).applicableLawIds, [], "a territory alone does not establish the federal scope of noncommercial member records");
assert.equal(resolvePrivacyProfile(within("CA-YT")).status, "conditional");
assert.deepEqual(resolvePrivacyProfile(within("CA-YT", { privacyCommercialActivity: "yes" })).applicableLawIds, ["pipeda"]);
assert.deepEqual(resolvePrivacyProfile(within("CA-YT", { privacyFederalWork: "yes" })).applicableLawIds, ["pipeda"]);
assert.deepEqual(resolvePrivacyProfile(within("CA-AB", { privacyAlbertaNonprofitClass: "section-56" })).applicableLawIds, []);
assert.deepEqual(resolvePrivacyProfile(within("CA-AB", { privacyAlbertaNonprofitClass: "other" })).applicableLawIds, ["ab_pipa"], "a nonprofit outside the defined Alberta class is not exempt merely for noncommercial activity");
assert.deepEqual(resolvePrivacyProfile(within("CA-AB", { privacyAlbertaNonprofitClass: "section-56", privacyCommercialActivity: "yes" })).applicableLawIds, ["ab_pipa"]);
assert.ok(resolvePrivacyProfile(within("CA-AB")).possibleLawIds.includes("ab_pipa"));
assert.deepEqual(resolvePrivacyProfile(quebec).applicableLawIds, ["qc_private"], "Québec can cover a noncommercial enterprise");
assert.ok(resolvePrivacyProfile(within("CA-QC")).possibleLawIds.includes("qc_private"));
assert.deepEqual(resolvePrivacyProfile({ ...bc, privacyFederalWork: "yes" }).applicableLawIds, ["pipeda"], "actual federal-work status changes the profile");
assert.deepEqual(resolvePrivacyProfile({ ...bc, privacyCommercialActivity: "yes", privacyCrossBorderCommercial: "yes" }).applicableLawIds.sort(), ["bc_pipa", "pipeda"]);
assert.deepEqual(resolvePrivacyProfile({ ...quebec, privacyOperatingJurisdictions: ["CA-BC", "CA-QC"], privacyCommercialActivity: "yes", privacyCrossBorderCommercial: "yes" }).applicableLawIds.sort(), ["bc_pipa", "pipeda", "qc_private"]);
assert.deepEqual(resolvePrivacyProfile({ ...bc, privacySectorSpecific: "health" }).applicableLawIds, [], "health-sector uncertainty is not a certified general profile");
assert.equal(resolvePrivacyProfile({ ...bc, privacyFederalWork: "unknown" }).status, "conditional");
const conflict = resolvePrivacyProfile({ ...bc, privacyCrossBorderCommercial: "yes" });
assert.ok(conflict.possibleLawIds.includes("pipeda"));
assert.ok(conflict.unresolvedFacts.some((text) => /conflicting/.test(text)));
assert.equal(resolvePrivacyProfile({ ...bc, privacyOperatingJurisdictions: ["CA-FED-CBCA"] }).status, "unassessed", "a registry code is not an operating province");

// Distinguish day basis, absence of fixed minima, and proposed legislation.
assert.deepEqual([PRIVACY_LAWS.bc_pipa.access.days, PRIVACY_LAWS.bc_pipa.access.basis], [30, "bc-business"]);
assert.deepEqual([PRIVACY_LAWS.ab_pipa.access.days, PRIVACY_LAWS.ab_pipa.access.basis], [45, "calendar"]);
assert.deepEqual([PRIVACY_LAWS.pipeda.access.days, PRIVACY_LAWS.pipeda.access.basis], [30, "calendar"]);
assert.equal(PRIVACY_LAWS.qc_private.access.days, 30);
assert.equal(PRIVACY_LAWS.pipeda.incidentRecordMinimumMonths, 24);
assert.equal(PRIVACY_LAWS.qc_private.incidentRecordMinimumMonths, 60);
assert.equal(PRIVACY_LAWS.bc_pipa.incidentRecordMinimumMonths, null);
assert.equal(PRIVACY_LAWS.ab_pipa.incidentRecordMinimumMonths, null);
assert.equal(PRIVACY_LAWS.bc_pipa.rules.find((rule) => rule.key === "breach")?.obligation, "recommended");
assert.equal(PRIVACY_REFORM_WATCH.proposedBill.inForce, false);
assert.equal(PRIVACY_REFORM_WATCH.currentLaw, "PIPEDA");
for (const law of Object.values(PRIVACY_LAWS)) {
  for (const rule of law.rules) for (const id of rule.citationIds) assert.ok(PRIVACY_CITATIONS[id]?.url.startsWith("https://"), `${law.id}: missing official citation ${id}`);
}
assert.equal(PRIVACY_CITATIONS["AB-PIPA-ACCESS"].sourceCurrentToISO, undefined, "a blocked publisher is not assigned an invented consolidation date");

// Drafts name applicable laws, preserve unknown scope, and separate approval.
const federalDraft = buildPrivacyPolicyDraft(pipeda, "2026-10-11");
assert.match(federalDraft, /### PIPEDA/);
assert.doesNotMatch(federalDraft, /### BC PIPA|contact the Office of the Information and Privacy Commissioner for British Columbia/);
assert.match(federalDraft, /shareholder and securities records/);
assert.doesNotMatch(federalDraft, /The organization maintains its own member register/);
const unknownDraft = buildPrivacyPolicyDraft({ name: "Unassessed entity", jurisdictionCode: "CA-ON-OBCA" }, "2026-10-11");
assert.match(unknownDraft, /Unresolved scope questions/);
assert.doesNotMatch(unknownDraft, /### BC PIPA|### PIPEDA/);
const presumedDraft = buildPrivacyPolicyDraft({ name: "Unassessed BC entity", jurisdictionCode: "CA-BC" }, "2026-10-11");
assert.match(presumedDraft, /### BC PIPA/, "a BC-home draft starts from the presumed BC PIPA requirements");
assert.match(presumedDraft, /Unresolved scope questions/, "and still lists the facts to confirm");
assert.doesNotMatch(presumedDraft, /### PIPEDA/);
assert.match(buildPrivacyPolicyDraft(quebec), /### Québec private-sector privacy law/);
assert.match(privacyRecordTemplate("incidentRegister", pipeda).content, /Date the organization determined/);
assert.match(privacyRecordTemplate("incidentRegister", quebec).content, /five years after awareness/);
assert.match(privacyRecordTemplate("accessLog", within("CA-AB", { privacyAlbertaNonprofitClass: "other" })).content, /45 calendar days/);
assert.match(privacyRecordTemplate("privacyAssessment", quebec).content, /## Decision/);
assert.ok(pipaSetupMotionsFor({ name: "Unknown BC", jurisdictionCode: "CA-BC" }).some((motion) => motion.motionText.includes("PIPA privacy policy")), "BC PIPA setup is offered under the BC-home presumption");
assert.doesNotMatch(pipaSetupMotionsFor({ name: "Federal work BC", jurisdictionCode: "CA-BC", privacyFederalWork: "yes" } as any).map((motion) => motion.motionText).join(" "), /PIPA privacy policy/);
assert.doesNotMatch(pipaSetupMotionsFor({ name: "Unknown Ontario", jurisdictionCode: "CA-ON-OBCA" }).map((motion) => motion.motionText).join(" "), /PIPA privacy policy/);
assert.ok(pipaSetupMotionsFor(bc).some((motion) => motion.motionText.includes("PIPA privacy policy")));

// Exercise the real schema, authenticated mutation, saved facts and template path.
const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
  "./documents.js": () => import("../convex/documents"),
  "./motionBacklog.js": () => import("../convex/motionBacklog"),
  "./dashboardRemediation.js": () => import("../convex/dashboardRemediation"),
} as any);
const issuer = betterAuthIssuer();
const societyId = await test.run(async (ctx) => {
  const id = await ctx.db.insert("societies", { name: pipeda.name!, jurisdictionCode: pipeda.jurisdictionCode!, entityType: pipeda.entityType!, actFormedUnder: pipeda.actFormedUnder!, isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  await ctx.db.insert("users", { societyId: id, role: "Owner", status: "Active", displayName: "Privacy test owner", email: "privacy@example.test", authSubject: "privacy-test", authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
  return id;
});
const actor = test.withIdentity({ subject: "privacy-test", issuer });
await actor.mutation(api.society.upsert, { id: societyId, name: pipeda.name!, isCharity: false, isMemberFunded: false, privacyOperatingJurisdictions: ["CA-ON"], privacyCommercialActivity: "yes", privacyFederalWork: "no", privacyCrossBorderCommercial: "no", privacySectorSpecific: "none", privacyScopeReviewedAtISO: "2026-10-11" });
const stored = await test.run((ctx) => ctx.db.get(societyId));
assert.equal(resolvePrivacyProfile(stored as any).status, "assessed");
assert.deepEqual(resolvePrivacyProfile(stored as any).applicableLawIds, ["pipeda"]);
const created = await actor.mutation(api.documents.createPipaPolicyDraft, { societyId });
assert.equal(created.document.content, buildPrivacyPolicyDraft(stored as any), "hosted generation and client helper use identical scope and wording");
assert.ok(created.document.tags.includes("scope-aware-v2"));
const edited = `${created.document.content}\nApproved working customization.`;
await actor.mutation(api.documents.updateDraftContent, { id: created.document._id, title: created.document.title, content: edited, tags: created.document.tags });
const reopened = await actor.mutation(api.documents.createPipaPolicyDraft, { societyId });
assert.equal(reopened.document._id, created.document._id, "repeated creation reuses the draft");
assert.equal(reopened.document.content, edited, "reopening preserves authored changes");
const firstSeed = await actor.mutation(api.motionBacklog.seedPipaSetup, { societyId });
const secondSeed = await actor.mutation(api.motionBacklog.seedPipaSetup, { societyId });
assert.equal(firstSeed.inserted, 3);
assert.equal(secondSeed.inserted, 0, "generic privacy setup is idempotent");
const reviewInput = { societyId, ruleId: "PRIVACY-APPLICABILITY", flagLevel: "warn", flagText: "Review applicable privacy law", evidenceRequired: ["Recorded activity assessment"] };
const reviewTask = await actor.mutation(api.dashboardRemediation.createPrivacyReviewTask, reviewInput);
const task = await test.run(ctx => ctx.db.get(reviewTask.taskId));
assert.match(task!.title, /privacy remediation/);
assert.doesNotMatch(`${task!.title} ${task!.description}`, /PIPA|member-data/);
assert.equal((await actor.mutation(api.dashboardRemediation.createPrivacyReviewTask, reviewInput)).taskId, reviewTask.taskId, "the corrected privacy task remains idempotent");
await assert.rejects(() => test.mutation(api.documents.createPipaPolicyDraft, { societyId }), /[Aa]uthentication|[Ss]ign in|[Aa]ccess|[Mm]embership|[Pp]ermission/);
console.log("Privacy profiles passed: BC-home presumption and federal-work override, activity-based scope, nonprofit exceptions, overlapping laws, uncertainty, deadlines, retention, proposed-law exclusion, persisted assessment, shared drafts, edit preservation, idempotence and authorization.");

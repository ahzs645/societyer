import assert from "node:assert/strict";
import {
  BC_DIRECTOR_OTHER_DISQUALIFICATIONS,
  ageOn,
  eligibilityScopeFor,
  roleHolderEligibility,
  sharedOfficeWarnings,
} from "../shared/registerValidation";
import { upsertRoleHolderPortable } from "../shared/functions/roleHolders";
import { MemoryDb, PortableRuntime, definePortableMutation, makeCapabilities } from "../shared/portable/index";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";

/**
 * Director and officer eligibility (lawyer-records rule 8 and 11). BC Business
 * Corporations Act, verified against the consolidation current to
 * October 6, 2026: s. 124 (1) a director must be an individual; s. 124 (2) (a)
 * an individual under 18 is not qualified; s. 141 (3) the same qualifications
 * apply to officers. Societies keep their own rules; other corporations get
 * neutral data-quality warnings only. Synthetic fixtures only.
 */

const today = "2026-10-12";
const bcOrg = { entityType: "corporation__business_", jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act" };
assert.equal(eligibilityScopeFor(bcOrg), "bc_company");
assert.equal(eligibilityScopeFor({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA" }), "other_corporation");
assert.equal(eligibilityScopeFor({ entityType: "society", jurisdictionCode: "CA-BC" }), "not_corporation");
assert.equal(eligibilityScopeFor(null), "not_corporation");

assert.equal(ageOn("2008-10-13", today), 17, "the day before the 18th birthday");
assert.equal(ageOn("2008-10-12", today), 18, "the 18th birthday");
assert.equal(ageOn("2008-02-29", "2026-02-28"), 17, "a Feb 29 birthday is reached on Mar 1 in common years");
assert.equal(ageOn("bad", today), null);

// --- BC company directors ---------------------------------------------------------
const corporateDirector = roleHolderEligibility({ roleType: "director", status: "current", fullName: "Birch Holdings Ltd.", nonNaturalPerson: true }, "bc_company", today);
assert.equal(corporateDirector.blocking.length, 1);
assert.match(corporateDirector.blocking[0], /must be an individual \(Business Corporations Act s\. 124 \(1\)\)/);
const namedLikeCompany = roleHolderEligibility({ roleType: "director", status: "current", fullName: "Birch Holdings Ltd." }, "bc_company", today);
assert.deepEqual(namedLikeCompany.blocking, [], "a name heuristic warns but never blocks");
assert.match(namedLikeCompany.warnings[0], /looks like an organization/);
const minor = roleHolderEligibility({ roleType: "director", status: "current", fullName: "Kid Doe", dateOfBirth: "2009-01-01" }, "bc_company", today);
assert.match(minor.blocking[0], /under 18 .*s\. 124 \(2\) \(a\)/);
assert.match(roleHolderEligibility({ roleType: "director", status: "current", fullName: "Kid Doe", ageOver18: false }, "bc_company", today).blocking[0], /under 18/);
const adult = roleHolderEligibility({ roleType: "director", status: "current", fullName: "Pat Doe", dateOfBirth: "1980-05-05", startDate: "2016-05-10" }, "bc_company", today);
assert.deepEqual(adult.blocking, []);
assert.deepEqual(adult.warnings, []);
assert.deepEqual(adult.notes, [BC_DIRECTOR_OTHER_DISQUALIFICATIONS], "the other s. 124 (2) disqualifications are a review prompt");
assert.match(BC_DIRECTOR_OTHER_DISQUALIFICATIONS, /undischarged bankrupt/);
assert.match(BC_DIRECTOR_OTHER_DISQUALIFICATIONS, /Adult Guardianship Act/);
const appointedYoung = roleHolderEligibility({ roleType: "director", status: "current", fullName: "Jo Doe", dateOfBirth: "2007-06-01", startDate: "2025-01-01" }, "bc_company", today);
assert.deepEqual(appointedYoung.blocking, [], "now 19");
assert.match(appointedYoung.warnings[0], /before this director's 18th birthday/);
const formerCorporate = roleHolderEligibility({ roleType: "director", status: "former", fullName: "Old Co Ltd.", nonNaturalPerson: true }, "bc_company", today);
assert.deepEqual(formerCorporate.blocking, [], "historic rows are flagged, not refused");
assert.equal(formerCorporate.warnings.length, 1);

// --- officers ---------------------------------------------------------------------------
const minorOfficer = roleHolderEligibility({ roleType: "officer", status: "current", fullName: "Kid Doe", dateOfBirth: "2010-01-01", officerTitle: "secretary" }, "bc_company", today);
assert.match(minorOfficer.blocking[0], /ss\. 124 \(2\) \(a\), 141 \(3\)/);
const noOffice = roleHolderEligibility({ roleType: "officer", status: "current", fullName: "Pat Doe" }, "bc_company", today);
assert.match(noOffice.warnings[0], /no office recorded/);
assert.deepEqual(roleHolderEligibility({ roleType: "officer", status: "current", fullName: "Pat Doe", additionalOfficerTitles: ["president"] }, "bc_company", today).warnings, [], "an additional title counts as an office");
assert.match(roleHolderEligibility({ roleType: "officer", status: "current", fullName: "Birch Ltd.", nonNaturalPerson: true, officerTitle: "president" }, "bc_company", today).warnings[0], /s\. 141 \(2\) \(a\)/);

// --- entity-aware: other corporations and societies -------------------------------------------
const federalCorporate = roleHolderEligibility({ roleType: "director", status: "current", fullName: "Birch Holdings Ltd.", nonNaturalPerson: true, dateOfBirth: "2010-01-01" }, "other_corporation", today);
assert.deepEqual(federalCorporate, { blocking: [], warnings: [], notes: [] }, "BC rules and citations are not applied to a federal corporation");
assert.match(roleHolderEligibility({ roleType: "officer", status: "current", fullName: "Pat" }, "other_corporation", today).warnings[0], /no office recorded/);
assert.ok(!/Business Corporations Act|s\. 1\d\d/.test(roleHolderEligibility({ roleType: "officer", status: "current", fullName: "Pat" }, "other_corporation", today).warnings.join(" ")));
assert.deepEqual(roleHolderEligibility({ roleType: "director", status: "current", fullName: "Kid", dateOfBirth: "2012-01-01" }, "not_corporation", today), { blocking: [], warnings: [], notes: [] }, "a society keeps its own rules");

// --- offices meant to be single ---------------------------------------------------------------
const twoPresidents = sharedOfficeWarnings([
  { id: "1", fullName: "Pat Doe", status: "current", officerTitle: "president" },
  { id: "2", fullName: "Sam Doe", status: "current", officerTitle: "President" },
  { id: "3", fullName: "Lee Doe", status: "current", officerTitle: "vice_president" },
  { id: "4", fullName: "Kim Doe", status: "current", officerTitle: "vice_president" },
  { id: "5", fullName: "Ex Doe", status: "former", officerTitle: "president" },
]);
assert.equal(twoPresidents.length, 1, "two current Presidents are flagged; Vice Presidents and former holders are not");
assert.match(twoPresidents[0], /Pat Doe and Sam Doe are both recorded as President/);
assert.equal(sharedOfficeWarnings([{ fullName: "A", officerTitle: "chair" }, { fullName: "B", officerTitle: "chairman" }]).length, 1, "chair variants are one office");
assert.equal(sharedOfficeWarnings([{ fullName: "A", officerTitle: "chair" }, { fullName: "B", officerTitle: "chair" }], { allowShared: ["chair"] }).length, 0, "co-chairs when allowed");
assert.equal(sharedOfficeWarnings([{ fullName: "A", position: "President", status: "Active" }, { fullName: "B", position: "President", status: "Resigned" }]).length, 0, "directors-register positions use their own statuses");
assert.equal(sharedOfficeWarnings([{ fullName: "A", officerTitle: "president" }, { fullName: "A", additionalOfficerTitles: ["secretary"], officerTitle: "president", id: "x" }]).length, 1);

// --- the portable save refuses an unqualified BC director ------------------------------------------
const societyId = "eligibility-fixture";
const membership = portableTestSeed(societyId);
function runtime(society: Record<string, unknown>) {
  const db = new MemoryDb({ seed: { ...membership, societies: [{ ...membership.societies[0], ...society }] } });
  return new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
    .register(definePortableMutation({ name: "upsert", handler: upsertRoleHolderPortable as any }));
}
const bcRuntime = runtime(bcOrg);
await assert.rejects(bcRuntime.runMutation("upsert", { societyId, roleType: "director", status: "current", fullName: "Birch Holdings Ltd.", nonNaturalPerson: true }), /must be an individual/);
await assert.rejects(bcRuntime.runMutation("upsert", { societyId, roleType: "officer", status: "current", fullName: "Kid Doe", officerTitle: "secretary", dateOfBirth: "2012-01-01" }), /under 18/);
assert.ok(await bcRuntime.runMutation("upsert", { societyId, roleType: "director", status: "current", fullName: "Pat Doe", dateOfBirth: "1980-05-05" }));
assert.ok(await bcRuntime.runMutation("upsert", { societyId, roleType: "director", status: "former", fullName: "Old Co Ltd.", nonNaturalPerson: true }), "a former row can be corrected without being refused");
await assert.rejects(bcRuntime.runMutation("upsert", { societyId, roleType: "controller", status: "current", fullName: "Pat Doe", canadianStatus: "dual" }), /Canadian citizen/);
assert.ok(await bcRuntime.runMutation("upsert", { societyId, roleType: "controller", status: "current", fullName: "Pat Doe", canadianStatus: "citizen", significanceBases: ["shares_registered"], significanceReason: "Holds 50% of the votes.", taxResidentHomeJurisdiction: "yes" }));
const federalRuntime = runtime({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA" });
assert.ok(await federalRuntime.runMutation("upsert", { societyId, roleType: "director", status: "current", fullName: "Birch Holdings Ltd.", nonNaturalPerson: true }), "the BC refusal does not apply to a federal corporation");
const societyRuntime = runtime({ entityType: "society", jurisdictionCode: "CA-BC" });
assert.ok(await societyRuntime.runMutation("upsert", { societyId, roleType: "director", status: "current", fullName: "Youth Rep", dateOfBirth: "2011-01-01" }), "society rules are not changed here");

console.log("OK director-officer-eligibility");

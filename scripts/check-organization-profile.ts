// Pure helpers behind the organization profile tabs (src/features/organizationProfile):
// filing windows, "Needs attention" items, registry facts, the registry import's
// summary and snapshot, and the unsaved-changes dots.
// Run: ./node_modules/.bin/tsx scripts/check-organization-profile.ts
import assert from "node:assert/strict";
import { anniversaryInYear, bcExtraProvincialReportWindow, cbcaAnnualReturnWindow } from "../src/features/organizationProfile/deadlines";
import { organizationProfileAttention, type AttentionDetail, type AttentionOrganization } from "../src/features/organizationProfile/attention";
import { PROFILE_ANCHOR_TABS, unsavedProfileTabs } from "../src/features/organizationProfile/tabFields";
import { attorneyLabel, cbcaPublicRecordUrl, corporationKeyState, publicRecordLink, registrationGaps, registrationTimeLabel } from "../src/features/organizationProfile/registryFacts";
import { currentSnapshot, directorMismatches, importChangedSociety, importSummary } from "../src/features/organizationProfile/registryImport/importModel";
import type { ApplyRegistryImportResult } from "../shared/functions/organizationDetails";
import type { OrganizationRecord } from "../src/features/organizationProfile/types";

// ---- filing windows: CBCA is 60 days, BC extra-provincial is 2 calendar months.
assert.deepEqual(cbcaAnnualReturnWindow("2025-03-10", "2025-06-01"), { cycleYear: 2026, opens: "2026-03-10", due: "2026-05-09" });
assert.deepEqual(bcExtraProvincialReportWindow("2025-03-10", "2025-06-01"), { cycleYear: 2026, opens: "2026-03-10", due: "2026-05-10" });
// An open window stays current until it closes.
assert.deepEqual(cbcaAnnualReturnWindow("2025-03-10", "2026-04-01"), { cycleYear: 2026, opens: "2026-03-10", due: "2026-05-09" });
// A filing on or after the window opened moves on to the next cycle.
assert.deepEqual(bcExtraProvincialReportWindow("2025-03-10", "2026-04-01", "2026-03-20"), { cycleYear: 2027, opens: "2027-03-10", due: "2027-05-10" });
// A closed window moves on.
assert.equal(bcExtraProvincialReportWindow("2025-03-10", "2026-05-11")?.cycleYear, 2027);
// Two calendar months clamp to the month's end; 60 days do not.
assert.equal(bcExtraProvincialReportWindow("2024-12-31", "2025-01-01")?.due, "2026-02-28");
assert.equal(cbcaAnnualReturnWindow("2024-12-31", "2025-01-01")?.due, "2026-03-01");
assert.equal(anniversaryInYear("2024-02-29", 2025), "2025-02-28");
assert.equal(cbcaAnnualReturnWindow("not a date", "2025-01-01"), null);

// ---- needs attention
const detail = (patch: Partial<AttentionDetail> = {}): AttentionDetail => ({ addresses: [], registrations: [], identifiers: [], ...patch });
const federal: AttentionOrganization = {
  name: "Example Holdings Inc.", entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA",
  actFormedUnder: "canada_business_corporations_act", formationStatus: "incorporated", organizationStatus: "active",
};
const ids = (org: AttentionOrganization, value: AttentionDetail) => organizationProfileAttention(org, value).map((item) => item.id.split(":")[0]);

assert.deepEqual(ids(federal, detail()).sort(), [
  "articles-missing", "corporation-key-missing", "fiscal-year-end-missing", "governing-document-missing", "governing-document-missing", "registered-office-missing", "registry-import",
]);
const complete: AttentionOrganization = {
  ...federal, fiscalYearEnd: "12-31", corporationKeyVaultItemId: "vault1", constitutionDocId: "doc1", bylawsDocId: "doc2",
  articlesMinDirectors: 1, articlesMaxDirectors: 7, articlesSourceDocumentId: "doc3",
};
assert.deepEqual(ids(complete, detail({ addresses: [{ _id: "a1", type: "registered_office", status: "current" }] })), []);
// A proposed office is fine while preparing, but not once incorporated.
assert.deepEqual(ids(complete, detail({ addresses: [{ _id: "a1", type: "registered_office", status: "proposed" }] })), ["registered-office-proposed"]);
assert.deepEqual(ids({ ...complete, formationStatus: "preparing", organizationStatus: "pre_incorporation" }, detail({ addresses: [{ _id: "a1", type: "registered_office", status: "proposed" }] })), []);
// A confirmed BN needs its number.
const office = { addresses: [{ _id: "a1", type: "registered_office", status: "current" }] };
assert.deepEqual(ids({ ...complete, craBnStatus: "confirmed" }, detail(office)), ["business-number-missing"]);
assert.deepEqual(ids({ ...complete, craBnStatus: "confirmed" }, detail({ ...office, identifiers: [{ _id: "i1", kind: "business_number", number: "123456789" }] })), []);
// An extra-provincial registration without a number; other kinds are not checked.
assert.deepEqual(ids(complete, detail({ ...office, registrations: [{ _id: "r1", registrationType: "extra_provincial", jurisdiction: "CA-BC", status: "active" }, { _id: "r2", registrationType: "business_name", jurisdiction: "CA-BC", status: "active" }] })), ["registration-number-missing"]);
// With its number, it still needs the time, the certificate and an attorney decision.
const bcRegistration = { _id: "r1", registrationType: "extra_provincial", jurisdiction: "CA-BC", status: "active", registrationNumber: "A0999999" };
const gapItems = organizationProfileAttention(complete, detail({ ...office, registrations: [bcRegistration] }));
assert.deepEqual(gapItems.map((item) => item.id), ["registration-details-missing:r1"]);
assert.match(gapItems[0].text, /no time, certificate and attorney decision recorded/);
assert.deepEqual(ids(complete, detail({ ...office, registrations: [{ ...bcRegistration, registrationTime: "13:45", registrationTimeZone: "America/Vancouver", certificateDocumentId: "doc4", attorneyStatus: "not_required" }] })), []);
assert.deepEqual(registrationGaps({ registrationTime: "13:45", attorneyStatus: "appointed" }), ["certificate"]);
// Articles: any recorded provision counts; preparing organizations aren't asked yet.
const noArticles: AttentionOrganization = { ...complete, articlesMinDirectors: undefined, articlesMaxDirectors: undefined, articlesSourceDocumentId: undefined };
assert.deepEqual(ids(noArticles, detail(office)).sort(), ["articles-missing", "registry-import"]);
assert.deepEqual(ids({ ...noArticles, articlesOtherProvisions: "The directors may appoint additional directors." }, detail(office)), ["registry-import"]);
assert.deepEqual(ids({ ...noArticles, articlesSourceDocumentId: "doc3" }, detail(office)), []);
assert.deepEqual(ids({ ...noArticles, formationStatus: "preparing", organizationStatus: "pre_incorporation" }, detail(office)), []);
// The import is offered once filed (not while preparing), and only until registry documents are linked.
const filed = organizationProfileAttention({ ...noArticles, formationStatus: "submitted", organizationStatus: "pre_incorporation" }, detail(office));
assert.deepEqual(filed.map((item) => item.id), ["registry-import"]);
assert.deepEqual(filed[0].target, { action: "registry-import" });
assert.deepEqual(ids(noArticles, detail({ ...office, registrations: [{ _id: "h1", registrationType: "home", jurisdiction: "CA-FED-CBCA", certificateDocumentId: "doc5" }] })), ["articles-missing"]);
// The parser reads federal (and BC extra-provincial) documents: a BC company isn't offered the import.
assert.ok(!ids({ ...noArticles, jurisdictionCode: "CA-BC", actFormedUnder: "business_corporations_act__british_columbia_" }, detail(office)).includes("registry-import"));
// CBCA residency: at least one resident Canadian with fewer than four directors.
const directors = (statuses: string[]) => statuses.map((residentCanadianStatus) => ({ status: "Active", residentCanadianStatus }));
assert.deepEqual(ids(complete, detail({ ...office, directors: directors(["no", "unknown"]) })), ["resident-canadian-directors"]);
assert.deepEqual(ids(complete, detail({ ...office, directors: directors(["no", "yes"]) })), []);
// Not loaded or not readable: no residency item.
assert.deepEqual(ids(complete, detail(office)), []);
// Every target is a profile tab or an app path.
for (const item of organizationProfileAttention(federal, detail())) {
  assert.ok("tab" in item.target || "action" in item.target || item.target.href.startsWith("/app/"), item.id);
}

// ---- registry facts
assert.equal(registrationTimeLabel("11:59", "America/Vancouver"), "11:59 AM PT");
assert.equal(registrationTimeLabel("13:45", "America/Toronto"), "1:45 PM ET");
assert.equal(registrationTimeLabel("00:05", undefined), "12:05 AM");
assert.equal(registrationTimeLabel("24:00", "America/Vancouver"), undefined);
assert.equal(cbcaPublicRecordUrl("1234567-8"), "https://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?corpId=12345678&locale=en_CA");
assert.equal(cbcaPublicRecordUrl(""), undefined);
assert.deepEqual(publicRecordLink({}, { federalCbca: true, corporationNumber: "1234567-8" }), { url: cbcaPublicRecordUrl("1234567-8"), derived: true });
assert.deepEqual(publicRecordLink({ publicRecordUrl: "https://example.org/record" }, { federalCbca: true, corporationNumber: "1234567-8" }), { url: "https://example.org/record", derived: false });
assert.equal(publicRecordLink({}, { federalCbca: false, corporationNumber: "1234567-8" }), undefined);
assert.equal(attorneyLabel("not_required", "Head office is in British Columbia"), "Not required: head office is in British Columbia");
assert.equal(attorneyLabel(undefined), undefined);
// The key's custody state, never its value.
assert.equal(corporationKeyState(undefined, undefined), "missing");
assert.equal(corporationKeyState("v1", undefined), "loading");
assert.equal(corporationKeyState("v1", [{ _id: "v1", hasSecretValue: true }]), "stored");
assert.equal(corporationKeyState("v1", [{ _id: "v1", storageMode: "external_reference", hasSecretValue: false }]), "reference");
assert.equal(corporationKeyState("v1", []), "missing");
assert.equal(corporationKeyState(undefined, undefined, true), "reference");

// ---- registry import: snapshot, directors comparison and the result summary
const society = {
  _id: "s1", name: "Example Holdings Inc.", incorporationNumber: "1234567-8", jurisdictionCode: "CA-FED-CBCA", articlesMinDirectors: 1,
  corporationKeyVaultItemId: "v1", updatedAt: 1,
} as unknown as OrganizationRecord;
const snapshot = currentSnapshot(society, {
  addresses: [{ _id: "a1", type: "registered_office", status: "proposed", street: "100 Example Road", city: "Sampletown", country: "Canada" }, { _id: "a2", type: "mailing" }],
  registrations: [{ _id: "r1", registrationType: "home", jurisdiction: "CA-FED-CBCA", registrationNumber: "1234567-8", portalAccess: [{ name: "Records Owner" }] }],
  identifiers: [{ _id: "i1", kind: "business_number", number: "123456789" }, { _id: "i2", kind: "gst" }],
}, [{ firstName: "Jordan", lastName: "Example", status: "Active", residentCanadianStatus: "yes" }, { firstName: "Former", lastName: "Director", status: "Former" }]);
assert.equal(snapshot.profile?.incorporationNumber, "1234567-8");
assert.equal(snapshot.profile?.articlesMinDirectors, 1);
assert.equal(snapshot.hasCorporationKey, true);
assert.equal(snapshot.addresses?.length, 1, "addresses without a street are left out");
assert.equal(snapshot.identifiers?.length, 1, "identifiers without a number are left out");
assert.deepEqual(snapshot.directors, [{ name: "Jordan Example", residentCanadianStatus: "yes" }]);
assert.deepEqual(snapshot.registrations?.[0].portalAccess, [{ name: "Records Owner" }]);
const check = { directors: [{ name: "JORDAN EXAMPLE", residentCanadian: false }, { name: "Priya Sample", residentCanadian: true }, { name: "Alex Unknown" }], residentCount: 1, total: 3, meetsResidencyRule: true, note: "", sources: [], comparison: [], nameVariances: [] };
assert.deepEqual(directorMismatches(check, [
  { firstName: "Jordan", lastName: "Example", status: "Active", residentCanadianStatus: "yes" },
  { firstName: "Priya", lastName: "Sample", status: "Active", residentCanadianStatus: "unknown" },
]), [
  { name: "JORDAN EXAMPLE", issue: "residency_differs" },
  { name: "Priya Sample", issue: "residency_unconfirmed" },
  { name: "Alex Unknown", issue: "not_in_register" },
]);
const section = (created: number, updated: number) => ({ created, updated, unchanged: 0, ids: [] });
const result: ApplyRegistryImportResult = {
  profile: { ...section(0, 1), fields: ["incorporationNumber", "articlesMinDirectors"] },
  registrations: section(1, 1),
  addresses: { ...section(1, 0), demotedIds: [] },
  identifiers: section(2, 0),
  corporationKey: { ...section(1, 0), valueStored: false },
};
assert.equal(importSummary(result, 3), "Updated 2 profile fields, 2 registrations, 1 address and 2 tax numbers. Corporation key recorded as a reference. 3 documents uploaded.");
assert.equal(importSummary({ ...result, profile: { ...section(0, 0), fields: [] }, registrations: section(0, 0), addresses: { ...section(0, 0), demotedIds: [] }, identifiers: section(0, 0), corporationKey: null }, 0), "No profile changes.");
assert.equal(importChangedSociety(result), true);
assert.equal(importChangedSociety({ ...result, profile: { ...section(0, 0), fields: [] }, corporationKey: { ...section(0, 0), unchanged: 1, valueStored: true } }), false);

// ---- unsaved-changes dots
const saved = { name: "Example Holdings Inc.", fiscalYearEnd: "12-31", numbered: false, officialEmail: undefined, craBnStatus: "unknown" };
assert.deepEqual([...unsavedProfileTabs({ ...saved }, saved)], []);
// Blank, unset and false read the same.
assert.deepEqual([...unsavedProfileTabs({ ...saved, numbered: undefined, officialEmail: "" }, saved)], []);
assert.deepEqual([...unsavedProfileTabs({ ...saved, fiscalYearEnd: "03-31" }, saved)], ["legal"]);
assert.deepEqual([...unsavedProfileTabs({ ...saved, officialEmail: "registry@example.org", craBnStatus: "confirmed" }, saved)].sort(), ["offices", "tax"]);
assert.deepEqual([...unsavedProfileTabs({ ...saved, naicsSector: { code: "54", version: "2022" } }, { ...saved, naicsSector: { code: "54", version: "2022" } })], []);

// Section links from before the tabs keep working.
assert.equal(PROFILE_ANCHOR_TABS["registered-office"], "offices");
assert.equal(PROFILE_ANCHOR_TABS["tax-identifiers"], "tax");
assert.equal(PROFILE_ANCHOR_TABS["more-organization-details"], "legal");
assert.equal(PROFILE_ANCHOR_TABS.articles, "legal");
// The articles are saved with the Legal profile.
assert.deepEqual([...unsavedProfileTabs({ ...saved, articlesMaxDirectors: 10 }, saved)], ["legal"]);

console.log("organization profile helpers: ok");

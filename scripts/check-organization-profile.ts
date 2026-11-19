// Pure helpers behind the organization profile tabs (src/features/organizationProfile):
// filing windows, "Needs attention" items and the unsaved-changes dots.
// Run: ./node_modules/.bin/tsx scripts/check-organization-profile.ts
import assert from "node:assert/strict";
import { anniversaryInYear, bcExtraProvincialReportWindow, cbcaAnnualReturnWindow } from "../src/features/organizationProfile/deadlines";
import { organizationProfileAttention, type AttentionDetail, type AttentionOrganization } from "../src/features/organizationProfile/attention";
import { PROFILE_ANCHOR_TABS, unsavedProfileTabs } from "../src/features/organizationProfile/tabFields";

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
  "corporation-key-missing", "fiscal-year-end-missing", "governing-document-missing", "governing-document-missing", "registered-office-missing",
]);
const complete: AttentionOrganization = { ...federal, fiscalYearEnd: "12-31", corporationKeyVaultItemId: "vault1", constitutionDocId: "doc1", bylawsDocId: "doc2" };
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
// CBCA residency: at least one resident Canadian with fewer than four directors.
const directors = (statuses: string[]) => statuses.map((residentCanadianStatus) => ({ status: "Active", residentCanadianStatus }));
assert.deepEqual(ids(complete, detail({ ...office, directors: directors(["no", "unknown"]) })), ["resident-canadian-directors"]);
assert.deepEqual(ids(complete, detail({ ...office, directors: directors(["no", "yes"]) })), []);
// Not loaded or not readable: no residency item.
assert.deepEqual(ids(complete, detail(office)), []);
// Every target is a profile tab or an app path.
for (const item of organizationProfileAttention(federal, detail())) {
  assert.ok("tab" in item.target || item.target.href.startsWith("/app/"), item.id);
}

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

console.log("organization profile helpers: ok");

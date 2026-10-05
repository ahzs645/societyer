import assert from "node:assert/strict";
import { formatAddressText, normalizeAddressText, parseAddressText, splitStreet, type StructuredAddressValue } from "../shared/structuredAddress";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { createFixture, fixtureIssuer } from "../experiments/offline-convex/fixture";
import { makeFunctionReference } from "convex/server";

const numberOnly = splitStreet("123");
assert.deepEqual(numberOnly, { streetNumber: "123", streetName: "" });
const entered = { ...numberOnly, streetName: "Example Road" };
assert.deepEqual(splitStreet([entered.streetNumber, entered.streetName].join(" ")), entered);
assert.deepEqual(splitStreet("12B"), { streetNumber: "12B", streetName: "" });
assert.deepEqual(splitStreet("123-125 Example Road"), { streetNumber: "123-125", streetName: "Example Road" });
assert.deepEqual(splitStreet("Example Road"), { streetNumber: "", streetName: "Example Road" });
assert.deepEqual(splitStreet(""), { streetNumber: "", streetName: "" });
assert.equal(formatAddressText({ street: "123 Example Road", city: "Victoria", provinceState: "British Columbia", postalCode: "V1V 1V1", country: "Canada" }), "123 Example Road\nVictoria, British Columbia, V1V 1V1\nCanada");
const blank = { street: "", unit: "", city: "", provinceState: "", postalCode: "", country: "" };
const sparse: StructuredAddressValue[] = [
  { country: "Canada" }, { street: "123 Example Road", country: "Canada" }, { city: "Victoria" },
  { provinceState: "British Columbia" }, { postalCode: "V1V 1V1" }, { unit: "Suite 2" },
  { unit: "Suite 2", country: "Canada" }, { provinceState: "British Columbia", country: "Canada" },
  { city: "Victoria", postalCode: "V1V 1V1" },
  { street: "123 Example Road", city: "Victoria", provinceState: "British Columbia", postalCode: "V1V 1V1", country: "" }, {},
];
for (const address of sparse) {
  assert.deepEqual(parseAddressText(formatAddressText(address)), { ...blank, ...address });
  assert.deepEqual(parseAddressText(normalizeAddressText(formatAddressText(address))), { ...blank, ...address });
}
assert.equal(formatAddressText({ country: "Canada" }), "\n\nCanada");
assert.deepEqual(parseAddressText("Suite 2, 123 Example Road\r\nVictoria, British Columbia, V1V 1V1\r\nCanada"), { street: "123 Example Road", unit: "Suite 2", city: "Victoria", provinceState: "British Columbia", postalCode: "V1V 1V1", country: "Canada" });

const client = new StaticConvexClient({ databaseName: `sparse-address-${Date.now()}`, seed: { societies: [] } });
const answers = { version: 1, previousUse: "new", organizationStage: "existing", pathwayKey: "bc_society", governanceStructure: "needs_review", classDetails: "", governanceDocuments: "needs_review", peopleReadiness: "add_later", operatingRegions: "" };
const created = await client.mutation("society:createWorkspace", { name: "Sparse Address Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", legalSubtype: "ordinary_society", formationStatus: "unverified_existing", organizationStatus: "active", registeredOfficeAddress: formatAddressText({ country: "New Zealand" }), mailingAddress: formatAddressText({ street: "123 Example Road", postalCode: "V1V 1V1" }), onboardingAnswersJson: JSON.stringify(answers) }) as any;
await client.mutation("organizationDetails:seedFromSocietyAddresses", { societyId: created.societyId });
const saved = client.exportLocalWorkspaceSnapshot();
assert.equal(saved.tables.societies[0].registeredOfficeAddress, "\n\nNew Zealand");
const office = saved.tables.organizationAddresses.find((row: any) => row.type === "registered_office")!;
assert.equal(office.country, "New Zealand"); assert.equal(office.street, "Needs review"); assert.equal(office.city, "Needs review");
const mailing = saved.tables.organizationAddresses.find((row: any) => row.type === "mailing")!;
assert.equal(mailing.street, "123 Example Road"); assert.equal(mailing.postalCode, "V1V 1V1"); assert.equal(mailing.city, "Needs review"); assert.equal(mailing.provinceState, ""); assert.equal(mailing.country, "Needs review");

const fixture = await createFixture({ "./society.js": () => import("../convex/society"), "./organizationDetails.js": () => import("../convex/organizationDetails") });
const subject = "verified-native-sparse-address";
const actor = fixture.native.withIdentity({ subject, issuer: fixtureIssuer, tokenIdentifier: `${fixtureIssuer}|${subject}`, email: "native-sparse@example.test" });
const nativeCreated = await actor.mutation(makeFunctionReference<"mutation">("society:createWorkspace"), { name: "Native Sparse Address Society", jurisdictionCode: "CA-BC", entityType: "society", actFormedUnder: "societies_act", legalSubtype: "ordinary_society", formationStatus: "unverified_existing", organizationStatus: "active", registeredOfficeAddress: formatAddressText({ country: "New Zealand" }), mailingAddress: formatAddressText({ provinceState: "Alberta" }), onboardingAnswersJson: JSON.stringify(answers), seedDocumentPackets: false });
await actor.mutation(makeFunctionReference<"mutation">("organizationDetails:seedFromSocietyAddresses"), { societyId: nativeCreated.societyId });
const nativeRows = await fixture.native.run(async ctx => ({ organization: await ctx.db.get(nativeCreated.societyId), addresses: await ctx.db.query("organizationAddresses").withIndex("by_society", q => q.eq("societyId", nativeCreated.societyId)).collect(), owners: await ctx.db.query("users").withIndex("by_society", q => q.eq("societyId", nativeCreated.societyId)).collect() }));
assert.equal(nativeRows.organization?.registeredOfficeAddress, "\n\nNew Zealand");
assert.equal(nativeRows.organization?.mailingAddress, "\n, Alberta");
assert.equal(nativeRows.owners[0].role, "Owner"); assert.equal(nativeRows.owners[0].authSubject, subject);
const nativeOffice = nativeRows.addresses.find(row => row.type === "registered_office")!;
assert.equal(nativeOffice.country, "New Zealand"); assert.equal(nativeOffice.street, "Needs review"); assert.equal(nativeOffice.city, "Needs review");
const nativeMailing = nativeRows.addresses.find(row => row.type === "mailing")!;
assert.equal(nativeMailing.provinceState, "Alberta"); assert.equal(nativeMailing.city, "Needs review"); assert.equal(nativeMailing.country, "Needs review");
await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { registeredOfficeAddress: "  Legacy free-form address  " }));
await fixture.actor("owner-a").mutation(makeFunctionReference<"mutation">("organizationDetails:seedFromSocietyAddresses"), { societyId: fixture.ids.societyA });
const legacy = await fixture.native.run(ctx => ctx.db.query("organizationAddresses").withIndex("by_society", q => q.eq("societyId", fixture.ids.societyA)).first());
assert.equal(legacy?.street, "Legacy free-form address"); assert.equal(legacy?.city, "Needs review"); assert.ok(legacy?.notes?.includes("legacy society address text"));
console.log("Structured address partial-number, sparse line/comma slots, legacy compatibility, clearing, verified native creation/Owner binding, local and native guided backfill checks passed.");

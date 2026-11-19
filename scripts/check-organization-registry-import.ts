// organizationDetails:recordIncorporation and organizationDetails:applyRegistryImport,
// on the local runtime (custody-only corporation key) and on hosted Convex
// through convex-test (encrypted corporation key). Every name, number, address
// and key below is invented.
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { StaticConvexClient } from "../src/lib/staticConvex";
import { organizationStatusForFormation, validateArticlesProvisions } from "../shared/entitySetup";
import { CORPORATION_KEY_CUSTODY_LOCATION } from "../shared/functions/organizationDetails";

type Row = Record<string, unknown> & { _id: string };

const FAKE_KEY = "Zq7-test-key-0000";
const FAKE_NUMBER = "1000001-1";
const FAKE_DATE = "2026-03-02";

// Pure helpers.
assert.equal(organizationStatusForFormation("incorporated", undefined), "active");
assert.equal(organizationStatusForFormation("incorporated", "pre_incorporation"), "active");
assert.equal(organizationStatusForFormation("incorporated", "archived"), "archived");
assert.equal(organizationStatusForFormation("submitted", "active"), "pre_incorporation");
validateArticlesProvisions({ articlesMinDirectors: 1, articlesMaxDirectors: 10 });
assert.throws(() => validateArticlesProvisions({ articlesMinDirectors: 5, articlesMaxDirectors: 2 }), /minimum number of directors/);
assert.throws(() => validateArticlesProvisions({ articlesMinDirectors: 0 }), /at least 1/);

// ---- Local runtime ---------------------------------------------------------
const client = new StaticConvexClient({ databaseName: `societyer-registry-import-${Date.now()}`, seed: { societies: [] } });
const { societyId } = await client.mutation("society:createWorkspace", {
  name: "Tamarack Test Works Inc.", jurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act", legalSubtype: "federal_private_corporation",
  formationStatus: "submitted", organizationStatus: "pre_incorporation",
}) as { societyId: string };

const oldOffice = await client.mutation("organizationDetails:upsertAddress", { societyId, type: "registered_office", status: "current", street: "1 Placeholder Lane", city: "Testville", provinceState: "BC", postalCode: "V0V 0V0", country: "Canada" }) as string;
const proposedOffice = await client.mutation("organizationDetails:upsertAddress", { societyId, type: "registered_office", status: "proposed", street: "200 Example Street", unit: "Suite 5", city: "Testville", provinceState: "BC", postalCode: "V1V 1V1", country: "Canada" }) as string;

const certificateId = await client.mutation("documents:create", { societyId, title: "Certificate of incorporation", category: "CertificateOfIncorporation", fileName: "certificate.pdf", mimeType: "application/pdf", tags: ["certificate"] }) as string;
const recordArgs = { societyId, incorporationNumber: FAKE_NUMBER, incorporationDate: FAKE_DATE, certificateEvidenceDocumentId: certificateId };
await assert.rejects(() => client.mutation("organizationDetails:recordIncorporation", recordArgs), /uploaded file/);
await client.mutation("documentVersions:recordUploadedVersion", { societyId, documentId: certificateId, storageProvider: "local-filesystem", storageKey: `test-fixtures/${societyId}/certificate.pdf`, fileName: "certificate.pdf", mimeType: "application/pdf", fileSizeBytes: 32, sha256: "c".repeat(64) });
await assert.rejects(() => client.mutation("organizationDetails:recordIncorporation", { ...recordArgs, incorporationDate: "2026-02-30" }), /valid date/);
await assert.rejects(() => client.mutation("organizationDetails:recordIncorporation", { ...recordArgs, incorporationNumber: " " }), /number shown on the certificate/);
const recorded = await client.mutation("organizationDetails:recordIncorporation", recordArgs) as { registeredOfficeUpdated: boolean; homeRegistrationId: string | null };
assert.equal(recorded.registeredOfficeUpdated, true);
assert.ok(recorded.homeRegistrationId);

let profile = await client.query("society:getById", { id: societyId }) as Row;
assert.equal(profile.formationStatus, "incorporated");
assert.equal(profile.organizationStatus, "active");
assert.equal(profile.incorporationNumber, FAKE_NUMBER);
assert.equal(profile.incorporationDate, FAKE_DATE);
assert.equal(profile.certificateDate, FAKE_DATE);
assert.equal(profile.certificateReference, FAKE_NUMBER, "the reference defaults to the number");
assert.equal(profile.anniversaryDate, FAKE_DATE);
let overview = await client.query("organizationDetails:overview", { societyId }) as { addresses: Row[]; registrations: Row[]; identifiers: Row[] };
const office = (id: string) => overview.addresses.find((row) => row._id === id);
assert.equal(office(proposedOffice)?.status, "current");
assert.equal(office(proposedOffice)?.effectiveFrom, FAKE_DATE);
assert.equal(office(oldOffice)?.status, "past");
assert.equal(office(oldOffice)?.effectiveTo, FAKE_DATE);
const homeRows = overview.registrations.filter((row) => row.registrationType === "home");
assert.equal(homeRows.length, 1, "the existing home row is reused");
assert.equal(homeRows[0]._id, recorded.homeRegistrationId);
assert.equal(homeRows[0].status, "active");
assert.equal(homeRows[0].registrationNumber, FAKE_NUMBER);
assert.equal(homeRows[0].certificateDocumentId, certificateId);

const sheetId = await client.mutation("documents:create", { societyId, title: "Corporation information sheet", category: "Filing", fileName: "sheet.pdf", mimeType: "application/pdf", tags: [] }) as string;
const importArgs = {
  societyId,
  profile: {
    articlesMinDirectors: 1, articlesMaxDirectors: 10,
    articlesShareTransferRestrictions: "No share may be transferred without board approval.",
    articlesSourceDocumentId: sheetId, craBnStatus: "confirmed", officialEmail: "registry@example.test",
  },
  registrations: [
    { registrationType: "home", jurisdiction: "CA-FED-CBCA", registrationNumber: "10000011", sourceDocumentIds: [sheetId], publicRecordUrl: "https://registry.example.test/1000001" },
    {
      registrationType: "extra_provincial", jurisdiction: "CA-BC", registrationNumber: "A0000001", registrationDate: FAKE_DATE,
      registrationTime: "09:15", registrationTimeZone: "America/Vancouver", homeCorporationNumber: FAKE_NUMBER,
      nameInHomeJurisdiction: "Tamarack Test Works Inc.", attorneyStatus: "not_required" as const,
      attorneyNotRequiredReason: "Head office is in British Columbia.", reminderEmailsSubscribed: true,
      portalAccess: [{ name: "Pat Example", role: "Filing contact" }], status: "active", sourceDocumentIds: [sheetId],
    },
  ],
  addresses: [
    { type: "head_office_mailing", status: "current", street: "200 Example Street", unit: "Suite 5", city: "Testville", provinceState: "BC", postalCode: "V1V1V1", country: "Canada", effectiveFrom: FAKE_DATE, sourceDocumentIds: [sheetId] },
    { type: "registered_office", status: "current", street: "200  example street", city: "Testville", postalCode: "v1v 1v1", country: "Canada", effectiveFrom: FAKE_DATE, sourceDocumentIds: [sheetId] },
  ],
  identifiers: [
    { kind: "business_number", number: "000 000 001", status: "active", accessLevel: "internal", sourceDocumentIds: [sheetId] },
    { kind: "income_tax", number: "000000001RC0001", status: "active", accessLevel: "restricted" },
  ],
  corporationKey: { value: FAKE_KEY, label: "Corporation key", sourceDocumentIds: [sheetId] },
};

await assert.rejects(() => client.mutation("organizationDetails:applyRegistryImport", { ...importArgs, identifiers: [{ kind: "corporation_key", number: "1234", status: "active", accessLevel: "restricted" }] }), /vault/);
await assert.rejects(() => client.mutation("organizationDetails:applyRegistryImport", { societyId, profile: { craBnStatus: "registered" } }), /Business number status/);
await assert.rejects(() => client.mutation("organizationDetails:applyRegistryImport", { societyId, profile: { articlesMinDirectors: 9, articlesMaxDirectors: 3 } }), /minimum number of directors/);
await assert.rejects(() => client.mutation("organizationDetails:applyRegistryImport", { societyId, registrations: [{ registrationType: "extra_provincial", jurisdiction: "CA-BC", registrationTime: "9am" }] }), /24-hour/);
await assert.rejects(() => client.mutation("organizationDetails:applyRegistryImport", { societyId, profile: { incorporationDate: "2026-03-03" } }), /recorded certificate/);
// A rejected import writes nothing.
assert.equal((await client.query("organizationDetails:overview", { societyId }) as { registrations: Row[] }).registrations.length, 1);

const first = await client.mutation("organizationDetails:applyRegistryImport", importArgs) as Record<string, Record<string, unknown> | null>;
assert.deepEqual([...(first.profile?.fields as string[])].sort(), ["articlesMaxDirectors", "articlesMinDirectors", "articlesShareTransferRestrictions", "articlesSourceDocumentId", "craBnStatus", "officialEmail"]);
assert.deepEqual([first.registrations?.created, first.registrations?.updated], [1, 1], "home matched by number, BC created");
assert.deepEqual([first.addresses?.created, first.addresses?.updated, first.addresses?.unchanged], [1, 1, 0], "registered office matched by street and postal code");
assert.deepEqual(first.addresses?.demotedIds, []);
assert.equal(first.identifiers?.created, 2);
assert.equal(first.corporationKey?.created, 1);
assert.equal(first.corporationKey?.valueStored, false, "the local runtime cannot encrypt, so it records custody only");

profile = await client.query("society:getById", { id: societyId }) as Row;
assert.equal(profile.formationStatus, "incorporated");
assert.equal(profile.articlesMaxDirectors, 10);
assert.equal(profile.craBnStatus, "confirmed");
overview = await client.query("organizationDetails:overview", { societyId }) as typeof overview;
const bc = overview.registrations.find((row) => row.registrationType === "extra_provincial");
assert.equal(bc?.registrationTimeZone, "America/Vancouver");
assert.equal(bc?.homeCorporationNumber, FAKE_NUMBER);
assert.deepEqual(bc?.portalAccess, [{ name: "Pat Example", role: "Filing contact" }]);
const home = overview.registrations.find((row) => row.registrationType === "home");
assert.equal(home?.registrationNumber, FAKE_NUMBER, "a matched number keeps its stored spelling unless it changed");
assert.deepEqual(home?.sourceDocumentIds, [sheetId]);
assert.equal(overview.addresses.filter((row) => row.type === "registered_office" && row.status === "current").length, 1);

const vault = await client.query("secrets:list", { societyId }) as Row[];
const keyItem = vault.find((row) => row._id === profile.corporationKeyVaultItemId);
assert.equal(keyItem?.storageMode, "external_reference");
assert.equal(keyItem?.externalLocation, CORPORATION_KEY_CUSTODY_LOCATION);
assert.equal(keyItem?.hasSecretValue, false);
const activity = await client.query("activity:list", { societyId }) as Row[];
const exposed = JSON.stringify([vault, activity, overview, profile]);
assert.ok(!exposed.includes(FAKE_KEY), "the key value is never written outside the vault");
assert.ok(activity.some((row) => String(row.summary).startsWith("Registry documents imported:")));

const second = await client.mutation("organizationDetails:applyRegistryImport", importArgs) as Record<string, Record<string, unknown> | null>;
assert.equal(second.profile?.unchanged, 1);
assert.deepEqual([second.registrations?.created, second.registrations?.updated, second.registrations?.unchanged], [0, 0, 2]);
assert.deepEqual([second.addresses?.created, second.addresses?.updated, second.addresses?.unchanged], [0, 0, 2]);
assert.deepEqual([second.identifiers?.created, second.identifiers?.updated, second.identifiers?.unchanged], [0, 0, 2]);
assert.equal(second.corporationKey?.unchanged, 1);

// A new current head office retires the old one.
const moved = await client.mutation("organizationDetails:applyRegistryImport", { societyId, addresses: [{ type: "head_office_mailing", status: "current", street: "300 Sample Road", city: "Testville", postalCode: "V2V 2V2", country: "Canada", effectiveFrom: "2026-04-01" }] }) as { addresses: { demotedIds: string[] } };
assert.equal(moved.addresses.demotedIds.length, 1);

// Saving the profile elsewhere leaves fields it doesn't send alone.
await client.mutation("society:upsert", { id: societyId, name: profile.name, isCharity: false, isMemberFunded: false, purposes: "Testing.", articlesMinDirectors: undefined });
profile = await client.query("society:getById", { id: societyId }) as Row;
assert.equal(profile.articlesMinDirectors, 1);
assert.equal(profile.articlesShareTransferRestrictions, "No share may be transferred without board approval.");

// ---- Hosted Convex (convex-test) -------------------------------------------
const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
  "./organizationDetails.js": () => import("../convex/organizationDetails"),
});
const issuer = betterAuthIssuer();
const hosted = await native.run(async (ctx) => {
  const id = await ctx.db.insert("societies", {
    name: "Hosted Test Works Inc.", isCharity: false, isMemberFunded: false, updatedAt: 0,
    jurisdictionCode: "CA-FED-CBCA", homeJurisdictionCode: "CA-FED-CBCA", entityType: "corporation__business_",
    actFormedUnder: "canada_business_corporations_act", formationStatus: "submitted", organizationStatus: "pre_incorporation",
  });
  await ctx.db.insert("users", { societyId: id, role: "Owner", status: "Active", displayName: "Test owner", email: "owner@example.test", authSubject: "registry-owner", authIssuer: issuer, createdAtISO: "2026-01-01" });
  const documentId = await ctx.db.insert("documents", { societyId: id, title: "Certificate of incorporation", category: "CertificateOfIncorporation", fileName: "certificate.pdf", createdAtISO: "2026-03-02", flaggedForDeletion: false, tags: [] });
  await ctx.db.insert("documentVersions", { societyId: id, documentId, version: 1, storageProvider: "local-filesystem", storageKey: "test-fixtures/certificate.pdf", fileName: "certificate.pdf", uploadedAtISO: "2026-03-02", isCurrent: true });
  return { id, documentId };
});
const owner = native.withIdentity({ issuer, subject: "registry-owner" });
const recordIncorporation = makeFunctionReference<"mutation">("organizationDetails:recordIncorporation");
const applyRegistryImport = makeFunctionReference<"mutation">("organizationDetails:applyRegistryImport");
const hostedRecorded = await owner.mutation(recordIncorporation, { societyId: hosted.id, incorporationNumber: FAKE_NUMBER, incorporationDate: FAKE_DATE, certificateEvidenceDocumentId: hosted.documentId, makeRegisteredOfficeCurrent: false });
assert.equal(hostedRecorded.registeredOfficeUpdated, false);
assert.ok(hostedRecorded.homeRegistrationId, "a home row is created from the home jurisdiction");
await assert.rejects(() => owner.mutation(applyRegistryImport, { societyId: hosted.id, profile: { formationStatus: "preparing" } }), /formationStatus|extra field|Validator/i);

const hostedImport = { societyId: hosted.id, profile: { articlesMinDirectors: 1, articlesMaxDirectors: 7 }, corporationKey: { value: FAKE_KEY, label: "Corporation key" } };
const hostedFirst = await owner.mutation(applyRegistryImport, hostedImport);
assert.equal(hostedFirst.corporationKey.valueStored, true);
assert.equal(hostedFirst.corporationKey.created, 1);
const stored = await native.run(async (ctx) => ({
  society: await ctx.db.get(hosted.id),
  vault: await ctx.db.query("secretVaultItems").collect(),
  activity: await ctx.db.query("activity").collect(),
}));
assert.equal(stored.society?.formationStatus, "incorporated");
assert.equal(stored.vault.length, 1);
assert.equal(stored.vault[0]._id, stored.society?.corporationKeyVaultItemId);
assert.equal(stored.vault[0].storageMode, "stored_encrypted");
assert.ok(stored.vault[0].secretEncrypted?.startsWith("v1."));
assert.ok(!JSON.stringify(stored).includes(FAKE_KEY), "the key is only held encrypted");
const hostedSecond = await owner.mutation(applyRegistryImport, hostedImport);
assert.equal(hostedSecond.corporationKey.unchanged, 1, "the same key is recognised after decryption");
assert.equal(hostedSecond.profile.unchanged, 1);

// society.upsert patches: Transparency-style saves keep the home jurisdiction and the articles.
await owner.mutation(api.society.upsert, { id: hosted.id, name: "Hosted Test Works Inc.", isCharity: false, isMemberFunded: false, publicSummary: "Testing." });
const afterUpsert = await native.run(async (ctx) => ctx.db.get(hosted.id));
assert.equal(afterUpsert?.homeJurisdictionCode, "CA-FED-CBCA");
assert.equal(afterUpsert?.incorporationDate, FAKE_DATE);
assert.equal(afterUpsert?.articlesMaxDirectors, 7);

console.log("Registry import and incorporation recording passed on the local runtime and hosted Convex.");

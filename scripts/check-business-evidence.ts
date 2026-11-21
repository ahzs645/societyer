import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { businessRegisters } from "../shared/businessEvidence";
import { evidenceRules } from "../shared/businessEvidenceRules";
import { MemoryDb } from "../shared/portable/memoryDb";
import { PortableRuntime } from "../shared/portable/define";
import { makeCapabilities } from "../shared/portable/capabilities";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";

const company = { _id: "soc", name: "Test Ltd.", entityType: "corporation__business_", jurisdictionCode: "CA-BC" };
const doc = { _id: "doc", societyId: "soc", title: "Example", category: "Filing", tags: [] };
const db = new MemoryDb({ seed: {
  societies: [company],
  users: ["owner", "member", "viewer"].map(id => ({ _id: id, societyId: "soc", role: { owner: "Owner", member: "Member", viewer: "Viewer" }[id] })),
  documents: [doc, { ...doc, _id: "doc2" }, { ...doc, _id: "foreignDoc", societyId: "foreign" }],
  directors: [{ _id: "director", societyId: "soc", consentOnFile: false }],
  rightsholdingTransfers: [{ _id: "issuance", societyId: "soc", transferType: "issuance", status: "posted", rightsClassId: "class", quantity: 10 }],
  rightsClasses: [{ _id: "class", societyId: "soc", className: "Class A" }],
  organizationAddresses: [{ _id: "address", societyId: "soc" }],
  organizationIdentifiers: [{ _id: "identifier", societyId: "soc" }],
  organizationRegistrations: [{ _id: "registration", societyId: "soc" }],
  writtenResolutions: [{ _id: "resolution", societyId: "soc" }],
} });
function runtime(userId: string) {
  return new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({
    kind: "user", runtime: "test", assurance: "trusted-workspace", subject: userId, userId, societyId: "soc",
  }) }).registerAll(PORTABLE_FUNCTIONS);
}
const owner = runtime("owner");
const values: Record<string, Record<string, string | number>> = {
  shareNotices: { transactionId: "issuance", noticeNumber: "N1", noticeDate: "2026-01-01" },
  directorConsents: { directorId: "director", event: "Given", scope: "Consent to act", effectiveDate: "2026-01-01" },
  businessChannels: { channel: "Voicemail", value: "555-0100", purpose: "Front desk" },
  mailboxServices: { addressId: "address", boxNumber: "123", renewalDate: "2027-01-01" },
  bankRelationships: { institution: "Test bank", branch: "01234" },
  clientCardAccess: { institution: "Test bank", lastFour: "0012", cardType: "Debit", cashLimit: 12000, currency: "CAD" },
  governanceDecisions: { resolutionId: "resolution", scope: "Auditor waiver", periodEnd: "2027-04-30" },
  identifierDetails: { identifierId: "identifier", programCode: "RC" },
  recognitionDetails: { registrationId: "registration", recognizedAt: "2026-01-01T12:30", timeZone: "America/Vancouver" },
  equitySubscriptions: { classId: "class", subscriber: "Example", quantity: 10, subscribedOn: "2026-01-01" },
};
for (const register of businessRegisters) {
  const scope = { societyId: "soc", register: register.table };
  const args = { ...scope, values: values[register.table], documentId: "doc", sourcePage: 2 };
  const id = await owner.runMutation("businessEvidence:save", args);
  const rows = await owner.runQuery<any[]>("businessEvidence:list", scope);
  assert.equal(rows[0]._id, id);
  assert.equal(rows[0].sourcePage, 2);
  for (const [key, value] of Object.entries(args.values)) assert.equal(rows[0][key], value);
  await assert.rejects(runtime("viewer").runMutation("businessEvidence:save", args), /Permission/);
  await assert.rejects(owner.runMutation("businessEvidence:save", { ...args, documentId: "foreignDoc" }), /not found/);
}
const notice = { societyId: "soc", register: "shareNotices", values: values.shareNotices };
await assert.rejects(owner.runMutation("businessEvidence:save", notice), /already exists/);
const prev = db.dump("shareNotices")[0]._id;
await owner.runMutation("businessEvidence:save", { ...notice, previousId: prev, values: { ...notice.values, sentOn: "2026-01-03" } });
await assert.rejects(owner.runMutation("businessEvidence:save", { ...notice, previousId: prev }), /newer version/);
assert.equal(db.dump("rightsholdingTransfers").length, 1);
// A "Consent to act" entry that was given keeps the director's consent flag in step with the register.
assert.equal(db.dump("directors")[0].consentOnFile, true);
await assert.rejects(runtime("member").runQuery("businessEvidence:list", { societyId: "soc", register: "directorConsents" }), /Permission/);
const shares = businessRegisters[0];
assert.ok(evidenceRules(company, shares).sources.length);
assert.equal(evidenceRules({ ...company, jurisdictionCode: "CA-ON" }, shares).sources.length, 0);
assert.equal(evidenceRules({ ...company, legalSubtype: "ulc" }, shares).available, false);
assert.equal(evidenceRules({ entityType: "society" }, shares).available, false);
// A deleted supporting document leaves the entry listed and revisable without it.
const consent = { societyId: "soc", register: "directorConsents" };
const cited = await owner.runMutation<string>("businessEvidence:save", { ...consent, values: values.directorConsents, documentId: "doc2" });
await db.delete("doc2");
const orphan = (await owner.runQuery<any[]>("businessEvidence:list", consent)).find(row => row._id === cited);
assert.equal(orphan?.documentMissing, true);
await owner.runMutation("businessEvidence:save", { ...consent, values: values.directorConsents, previousId: cited });
// A private source removes the linked entry from a reader's results.
assert.deepEqual(await runtime("member").runQuery("businessEvidence:list", { societyId: "soc", register: "equitySubscriptions" }), []);
const hosted = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./_generated/server.js": () => import("../convex/_generated/server"),
  "./businessEvidence.js": () => import("../convex/businessEvidence"),
});
const issuer = "https://evidence.test";
process.env.AUTH_MODE = "better-auth";
process.env.VITE_AUTH_MODE = "better-auth";
process.env.BETTER_AUTH_BASE_URL = issuer;
const ids = await hosted.run(async ctx => {
  const societyId = await ctx.db.insert("societies", { name: "Example records", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  await ctx.db.insert("users", { societyId, role: "Owner", status: "Active", email: "owner@example.test", displayName: "Owner", authIssuer: issuer, authSubject: "owner", createdAtISO: "2026-01-01T00:00:00Z" });
  const directorId = await ctx.db.insert("directors", { societyId, firstName: "Example", lastName: "Director", termStart: "2026-01-01", position: "Director", isBCResident: true, status: "Active", consentOnFile: false });
  return { societyId, directorId };
});
const hostedOwner = hosted.withIdentity({ issuer, subject: "owner" });
const hostedScope = { societyId: ids.societyId, register: "directorConsents" };
await hostedOwner.mutation(api.businessEvidence.save, { ...hostedScope, values: { ...values.directorConsents, directorId: ids.directorId } });
assert.equal((await hostedOwner.query(api.businessEvidence.list, hostedScope))[0].directorId, ids.directorId);
console.log("Business register persistence, document ownership, authorization, versioning and jurisdiction checks passed.");

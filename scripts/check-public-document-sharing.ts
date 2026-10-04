import assert from "node:assert/strict";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableQueryCtx } from "../shared/portable/ctx";
import { centerPortable } from "../shared/functions/partyPortals";
import { publicCenterPortable } from "../shared/functions/transparency";

let signed = 0;
const db = new MemoryDb({ seed: {
  societies: [{ _id: "society", name: "Public sharing", publicSlug: "sharing", publicTransparencyEnabled: true, publicShowBoard: false, publicShowBylaws: true, publicShowFinancials: true }],
  documents: [
    { _id: "released", societyId: "society", title: "Released policy", category: "Policy", tags: ["public"], storageId: "released-blob" },
    { _id: "private", societyId: "society", title: "Private policy", category: "Policy", tags: [], storageId: "private-blob" },
    { _id: "restricted", societyId: "society", title: "Restricted policy", category: "Policy", tags: ["public"], storageId: "restricted-blob" },
    { _id: "expired", societyId: "society", title: "Expired policy", category: "Policy", tags: ["public"], storageId: "expired-blob" },
    { _id: "unapproved", societyId: "society", title: "Unapproved policy", category: "Policy", tags: ["public"], storageId: "unapproved-blob" },
  ],
  meetingMaterials: [
    { _id: "restricted-material", societyId: "society", documentId: "restricted", accessLevel: "restricted", availabilityStatus: "available" },
    { _id: "expired-material", societyId: "society", documentId: "expired", accessLevel: "public", availabilityStatus: "available", expiresAtISO: "2000-01-01" },
  ],
  publications: ["released", "private", "restricted", "expired", "unapproved"].map((documentId) => ({ _id: `publication-${documentId}`, societyId: "society", documentId, title: `${documentId} publication`, status: "Published", reviewStatus: documentId === "unapproved" ? "InReview" : "Approved", category: "Policy", createdAtISO: "2026-01-01" })),
  partyPortals: [{ _id: "portal", societyId: "society", token: "test-token", scopes: ["documents", "publications"], allowDownload: true, expiresAtISO: "2999-01-01" }],
} });
const ctx: PortableQueryCtx = {
  db, principal: { kind: "anonymous", runtime: "test", assurance: "none" },
  capabilities: makeCapabilities({ storage: { generateUploadUrl: async () => ({ url: "unused", storageKey: "unused" }), getDownloadUrl: async ({ storageKey }) => { signed++; return { url: `https://blob.test/${storageKey}` }; } } }),
  runQuery: async () => { throw new Error("Unexpected nested query"); },
};
const publicCenter = await publicCenterPortable(ctx, { slug: "sharing" });
assert.deepEqual(publicCenter.publications.map((row: any) => row.documentId), ["released"]);
assert.equal(signed, 1, "denied publications must not issue content URLs or titles");
const portal = await centerPortable(ctx, { token: "test-token" });
assert.deepEqual(portal.publications.map((row: any) => row._id), ["publication-released"]);
assert.deepEqual(portal.documents.map((row: any) => row._id).sort(), ["released", "unapproved"], "public document release and publication approval are independent gates");
assert.equal(signed, 4);
await db.patch("released", { tags: [] });
assert.equal((await publicCenterPortable(ctx, { slug: "sharing" })).publications.length, 0);
const revokedRelease = await centerPortable(ctx, { token: "test-token" });
assert.deepEqual(revokedRelease.documents.map((row: any) => row._id), ["unapproved"]);
await db.patch("portal", { revokedAtISO: "2026-01-01" });
assert.equal(await centerPortable(ctx, { token: "test-token" }), null);
await db.patch("portal", { revokedAtISO: undefined, expiresAtISO: "2000-01-01" });
assert.equal(await centerPortable(ctx, { token: "test-token" }), null);
console.log("Public document sharing checks passed: explicit release, approved publication, restricted/expired denial, release revocation and portal expiry/revocation.");

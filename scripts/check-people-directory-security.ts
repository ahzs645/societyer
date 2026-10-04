import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { toPortableMutationCtx } from "../convex/lib/portable";
import { listPortable, upsertPortable } from "../shared/functions/peopleDirectory";

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./peopleDirectory.js": () => import("../convex/peopleDirectory"),
});
const issuer = betterAuthIssuer();
const nowISO = new Date().toISOString();
const fixture = await t.run(async (ctx) => {
  const a = await ctx.db.insert("societies", { name: "Directory A", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const b = await ctx.db.insert("societies", { name: "Directory B", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, string> = {};
  for (const [subject, role, societyId] of [["owner-a", "Owner", a], ["owner-b", "Owner", b], ["viewer", "Viewer", a], ["member", "Member", a], ["director", "Director", a]] as const) {
    users[subject] = await ctx.db.insert("users", { societyId, role, status: "Active", displayName: subject, email: `${subject}@directory.test`, authIssuer: issuer, authSubject: subject, createdAtISO: nowISO });
  }
  const person = (fullName: string) => ctx.db.insert("peopleDirectory", { fullName, searchName: fullName.toLowerCase(), createdAtISO: nowISO, updatedAtISO: nowISO });
  const aLegacy = await person("Legacy A"), bLegacy = await person("Foreign private person"), shared = await person("Shared legacy"), unlinked = await person("Unlinked private person"), controller = await person("Controller private DOB"), signerOnly = await person("Authorized legacy signer");
  await ctx.db.insert("entitySigners", { societyId: a, directoryPersonId: signerOnly, name: "Authorized legacy signer", createdAtISO: nowISO });
  for (const [societyId, directoryPersonId, roleType] of [[a, aLegacy, "other"], [b, bLegacy, "other"], [a, shared, "other"], [b, shared, "other"], [a, controller, "controller"]] as const) {
    await ctx.db.insert("roleHolders", { societyId, directoryPersonId, roleType, fullName: "Linked role", status: "current", citizenshipCountries: [], taxResidenceCountries: [], relatedShareholderIds: [], controllingIndividualIds: [], sourceDocumentIds: [], sourceExternalIds: [], createdAtISO: nowISO, updatedAtISO: nowISO });
  }
  return { a, b, users, aLegacy, bLegacy, shared, unlinked, controller, signerOnly };
});
const actor = (subject: string) => t.withIdentity({ issuer, subject });
const owner = actor("owner-a"), foreign = actor("owner-b");
await assert.rejects(() => t.query(api.peopleDirectory.list, { societyId: fixture.a }), /Authentication required/);
await assert.rejects(() => owner.query(api.peopleDirectory.list, {}), /authorized workspace/);
const foreignOwned = await foreign.mutation(api.peopleDirectory.upsert, { societyId: fixture.b, fullName: "Foreign private new contact", nowISO });
const owned = await owner.mutation(api.peopleDirectory.upsert, { societyId: fixture.a, fullName: "Owned A", nowISO });
assert.equal(await t.run(async (ctx) => (await ctx.db.get(owned))?.societyId), fixture.a);
for (const subject of ["owner-a", "viewer", "member", "director"]) {
  const client = actor(subject);
  const rows = await client.query(api.peopleDirectory.list, { societyId: fixture.a });
  assert.ok(rows.some((row: any) => row._id === owned));
  assert.ok(rows.some((row: any) => row._id === fixture.aLegacy));
  assert.ok(rows.some((row: any) => row._id === fixture.signerOnly), "Readable signer-only legacy references stay available");
  assert.equal(rows.find((row: any) => row._id === fixture.shared)?.editable, false);
  for (const id of [foreignOwned, fixture.bLegacy, fixture.unlinked]) assert.ok(!rows.some((row: any) => row._id === id));
  assert.equal(rows.some((row: any) => row._id === fixture.controller), subject !== "member");
  assert.deepEqual(await client.query(api.peopleDirectory.searchByPrefix, { societyId: fixture.a, prefix: "Foreign private" }), []);
  assert.ok(!JSON.stringify(await client.query(api.peopleDirectory.duplicates, { societyId: fixture.a })).includes("Foreign private"));
  await assert.rejects(() => client.query(api.peopleDirectory.list, { societyId: fixture.b }), /membership/);
}
for (const subject of ["viewer", "member", "director"]) await assert.rejects(() => actor(subject).mutation(api.peopleDirectory.upsert, { societyId: fixture.a, fullName: "Forbidden write", nowISO }), /Permission members:write/);
for (const id of [foreignOwned, fixture.bLegacy, fixture.unlinked, fixture.shared]) await assert.rejects(() => owner.mutation(api.peopleDirectory.upsert, { societyId: fixture.a, id, fullName: "Forbidden overwrite", nowISO }), /not found|cannot be overwritten/i);
await assert.rejects(() => owner.mutation(api.peopleDirectory.addToSociety, { societyId: fixture.a, directoryPersonId: foreignOwned, roleType: "member", nowISO }), /not found/i);
const linkedOwned = await owner.mutation(api.peopleDirectory.addToSociety, { societyId: fixture.a, directoryPersonId: owned, roleType: "member", nowISO });
assert.equal(await t.run(async (ctx) => (await ctx.db.get(linkedOwned))?.directoryPersonId), owned);
await owner.mutation(api.peopleDirectory.upsert, { societyId: fixture.a, id: fixture.aLegacy, fullName: "Claimed legacy A", nowISO });
assert.equal(await t.run(async (ctx) => (await ctx.db.get(fixture.aLegacy))?.societyId), fixture.a);
await t.run(async (ctx) => {
  const portable = await toPortableMutationCtx(ctx);
  portable.principal = { kind: "user", runtime: "browser-local", assurance: "trusted-workspace", subject: "local-owner", societyId: fixture.a, userId: fixture.users["owner-a"] };
  const rows = await listPortable(portable);
  assert.ok(rows.some((row) => row._id === fixture.unlinked), "Trusted local directory preserves reusable legacy records");
  const created = await upsertPortable(portable, { fullName: "Reusable local contact", nowISO });
  assert.equal((await ctx.db.get(created as any))?.societyId, undefined);
});
console.log("OK people directory security: scoped hosted reads/writes, foreign and shared legacy denials, sensitive legacy links, trusted local reuse");

import assert from "node:assert/strict";
import { makeFunctionReference } from "convex/server";
import { createFixture, fixtureIssuer } from "../experiments/offline-convex/fixture";

const fixture = await createFixture({ "./society.js": () => import("../convex/society"), "./http.js": () => import("../convex/http") });
const creation = makeFunctionReference<"mutation">("society:createWorkspace");
const access = makeFunctionReference<"query">("http:workspaceCreationAccess");
const memberships = makeFunctionReference<"query">("http:currentPrincipalMemberships");
const counts = () => fixture.native.run(async ctx => ({ societies: (await ctx.db.query("societies").collect()).length, users: (await ctx.db.query("users").collect()).length }));
const initial = await counts();
const args = { name: "Fresh workspace", seedDocumentPackets: false, entityType: "society", actFormedUnder: "societies_act", jurisdictionCode: "CA-BC", organizationStatus: "pre_incorporation", formationStatus: "preparing", officialEmail: "profile-only@example.test" };

assert.equal((await fixture.native.query(access, {})).allowed, false);
await assert.rejects(fixture.native.mutation(creation, args), /Sign in with a user account/);
assert.deepEqual(await counts(), initial);
console.log("PASS anonymous creation is denied before any tenant or Owner write");

const fresh = fixture.native.withIdentity({ subject: "fresh-account", issuer: fixtureIssuer, tokenIdentifier: `${fixtureIssuer}|fresh-account`, email: "verified-profile@example.test", name: "Fresh user" });
assert.equal((await fresh.query(memberships, {})).status, "needs-invitation");
assert.equal((await fresh.query(access, {})).allowed, true);
await assert.rejects(fresh.mutation(creation, { ...args, actingUserId: fixture.ids.users["owner-a"] }), /Authenticated actor/);
assert.deepEqual(await counts(), initial);
const created = await fresh.mutation(creation, args);
const lookup = await fresh.query(memberships, {});
assert.equal(lookup.status, "bound");
assert.equal(lookup.memberships.length, 1);
assert.equal(lookup.memberships[0].society._id, created.societyId);
assert.equal(lookup.memberships[0].user.role, "Owner");
assert.equal(lookup.memberships[0].user.authSubject, "fresh-account");
assert.equal(lookup.memberships[0].user.email, "verified-profile@example.test");
assert.notEqual(lookup.memberships[0].society._id, fixture.ids.societyA);
console.log("PASS first verified user owns only the new tenant; profile fields and actor IDs cannot claim another tenant");

const foreign = fixture.actor("fresh-account", "https://foreign.example.test");
assert.equal((await foreign.query(access, {})).allowed, false);
await assert.rejects(foreign.mutation(creation, args), /Sign in with a user account/);
console.log("PASS an untrusted issuer cannot create a hosted Owner");

const beforeDenied = await counts();
await fixture.native.run(async ctx => {
  await ctx.db.insert("externalIdentities", { issuer: fixtureIssuer, subject: "disabled-account", status: "Disabled", createdAtISO: new Date().toISOString() });
  await ctx.db.insert("users", { societyId: fixture.ids.societyA, authIssuer: fixtureIssuer, authSubject: "inactive-account", role: "Member", status: "Inactive", email: "inactive@example.test", displayName: "Inactive", createdAtISO: new Date().toISOString() });
  for (let index = 0; index < 2; index++) await ctx.db.insert("users", { societyId: fixture.ids.societyA, authIssuer: fixtureIssuer, authSubject: "ambiguous-account", role: "Member", status: "Active", email: "ambiguous@example.test", displayName: "Ambiguous", createdAtISO: new Date().toISOString() });
});
for (const subject of ["disabled-account", "inactive-account", "ambiguous-account"]) {
  const actor = fixture.actor(subject);
  assert.equal((await actor.query(access, {})).allowed, false);
  await assert.rejects(actor.mutation(creation, args));
}
assert.equal((await counts()).societies, beforeDenied.societies);
console.log("PASS disabled, inactive and ambiguous identities cannot bypass lifecycle restrictions through setup");

const owner = fixture.actor("owner-a");
const other = await owner.mutation(creation, { ...args, name: "Another authorized organization", actingUserId: fixture.ids.users["owner-a"] });
const ownerLookup = await owner.query(memberships, {});
assert.deepEqual(new Set(ownerLookup.memberships.map((membership: any) => membership.society._id)), new Set([fixture.ids.societyA, other.societyId]));
assert.equal(ownerLookup.memberships.some((membership: any) => membership.society._id === fixture.ids.societyB), false);
console.log("PASS returning creators retain old access and gain only their independently created workspace");
console.log("Hosted workspace setup access: 5/5 groups passed.");

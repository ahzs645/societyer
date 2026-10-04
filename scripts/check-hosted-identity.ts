import assert from "node:assert/strict";
import { stripImportedAuthBindings } from "../shared/workspaceIdentity";
import { LocalDexieRowStore } from "../src/lib/localDexieRowStore";
import { resolveAuthIssuer, validateHostedAuth, resolveSessionBroker, authSessionDurationSeconds } from "../shared/authConfiguration";
import { MemoryDb, makeCapabilities, type PortableMutationCtx, type PortablePrincipal } from "../shared/portable/index";
import { resolvePrincipalUser, requireSocietyMembership } from "../shared/functions/access";
import { ensureCurrentMembershipPortable, bootstrapUserIdentityPortable } from "../shared/functions/users";
import { seedNewSocietyOwnerPortable } from "../shared/functions/society";

assert.equal(validateHostedAuth({}, "http://127.0.0.1:3210"), "none");
assert.equal(validateHostedAuth({ VITE_AUTH_MODE: "better-auth", VITE_AUTH_BASE_URL: "https://auth.example.test" }, "https://example.convex.cloud"), "better-auth");
assert.throws(() => validateHostedAuth({}, "https://example.convex.cloud"), /Hosted resources require/);
for (const host of ["10.evil.test", "192.168.evil.test", "172.16.evil.test"]) assert.throws(() => validateHostedAuth({}, `https://${host}`));
assert.throws(() => resolveSessionBroker({ AUTH_MODE: "none", VITE_AUTH_MODE: "better-auth" }), /same session broker/);
assert.throws(() => validateHostedAuth({ AUTH_MODE: "better-auth" }, "https://example.convex.cloud"), /explicitly configured issuer/);
assert.throws(() => resolveSessionBroker({ AUTH_MODE: "clerk" }), /Unsupported session broker/);
assert.throws(() => resolveSessionBroker({ AUTH_MODE: "better-auth", CLERK_SECRET_KEY: "fixture" }), /Clerk is not implemented/);
assert.throws(() => validateHostedAuth({ AUTH_MODE: "better-auth", BETTER_AUTH_BASE_URL: "https://a.test", VITE_AUTH_BASE_URL: "https://b.test" }), /match exactly/);
for (const url of ["https://auth.test/", "https://user:pass@auth.test", "http://public.test", "https://auth.test?x=1", "https://auth.test#x"]) {
  assert.throws(() => resolveAuthIssuer({ BETTER_AUTH_BASE_URL: url }));
}
assert.equal(authSessionDurationSeconds({}), 28800);
for (const value of ["0", "300000", "NaN", "301.5"]) assert.throws(() => authSessionDurationSeconds({ AUTH_SESSION_MAX_AGE_SECONDS: value }));

const issuerA = "https://a.auth.test";
const issuerB = "https://b.auth.test";
const db = new MemoryDb({ seed: { users: [
  { _id: "a-user", societyId: "society-a", authIssuer: issuerA, authSubject: "same-sub", status: "Active", role: "Member", email: "recycled@test", displayName: "A" },
  { _id: "b-user", societyId: "society-a", authIssuer: issuerB, authSubject: "same-sub", status: "Active", role: "Owner", email: "recycled@test", displayName: "B" },
  { _id: "legacy-user", societyId: "society-b", authSubject: "same-sub", status: "Active", role: "Owner" },
  { _id: "placeholder", societyId: "society-b", status: "Active", role: "Owner" },
] } });
let principal: PortablePrincipal = { kind: "user", runtime: "test", assurance: "verified-jwt", issuer: issuerA, subject: "same-sub", email: "changed@test" };
const ctx: PortableMutationCtx = {
  db, capabilities: makeCapabilities({}), get principal() { return principal; },
  runQuery: async () => { throw new Error("unused"); }, runMutation: async () => { throw new Error("unused"); },
};
assert.equal((await resolvePrincipalUser(ctx, "society-a"))?._id, "a-user");
assert.equal((await ensureCurrentMembershipPortable(ctx, { societyId: "society-a" })).status, "bound");
assert.equal((await db.get("a-user"))?.email, "changed@test");
assert.equal((await db.get("b-user"))?.email, "recycled@test");
principal = { ...principal, issuer: issuerB };
assert.equal((await resolvePrincipalUser(ctx, "society-a"))?._id, "b-user");
principal = { ...principal, issuer: "https://foreign.test" };
assert.equal(await resolvePrincipalUser(ctx, "society-a"), null);
assert.equal((await ensureCurrentMembershipPortable(ctx, { societyId: "society-a" })).status, "needs-invitation");
principal = { ...principal, issuer: issuerA, userId: "b-user" };
assert.equal(await resolvePrincipalUser(ctx, "society-a"), null);
principal = { ...principal, userId: undefined };
assert.equal(await resolvePrincipalUser(ctx, "society-b"), null);
assert.equal((await ensureCurrentMembershipPortable(ctx, { societyId: "society-b" })).status, "needs-invitation");
await db.insert("users", { societyId: "society-a", authIssuer: issuerA, authSubject: "same-sub", status: "Active" });
assert.equal(await resolvePrincipalUser(ctx, "society-a"), null);
assert.equal((await ensureCurrentMembershipPortable(ctx, { societyId: "society-a" })).status, "ambiguous-binding");
principal = { ...principal, userId: "a-user" };
assert.equal(await resolvePrincipalUser(ctx, "society-a"), null, "a direct membership ID cannot bypass an ambiguous immutable identity");
principal = { ...principal, userId: undefined };

const bind = { userId: "placeholder", authSubject: "operator-sub", authIssuer: issuerA, authProvider: "better-auth" };
assert.equal(await bootstrapUserIdentityPortable(ctx, bind), "placeholder");
const identityId = (await db.get("placeholder"))?.externalIdentityId;
assert.ok(identityId);
assert.equal(await bootstrapUserIdentityPortable(ctx, bind), "placeholder");
await assert.rejects(() => bootstrapUserIdentityPortable(ctx, { ...bind, authIssuer: issuerB }), /different auth issuer/);
await assert.rejects(() => bootstrapUserIdentityPortable(ctx, { ...bind, authSubject: "new-sub" }), /different auth subject/);
principal = { ...principal, issuer: issuerA, subject: "operator-sub" };
const ownerId = await seedNewSocietyOwnerPortable(ctx, { societyId: "society-c", placeholderEmail: "owner@local", placeholderDisplayName: "Owner", createdAtISO: new Date().toISOString() });
assert.equal((await db.get(ownerId))?.externalIdentityId, identityId);
assert.equal((await resolvePrincipalUser(ctx, "society-b"))?._id, "placeholder");
await db.patch(identityId, { status: "Disabled" });
await assert.rejects(() => requireSocietyMembership(ctx, "society-b"), /External identity is disabled/);
await assert.rejects(() => requireSocietyMembership(ctx, "society-c"), /External identity is disabled/);
principal = { kind: "user", runtime: "electron-local", assurance: "trusted-workspace", subject: "local", userId: "legacy-user", societyId: "society-b" };
assert.equal((await requireSocietyMembership(ctx, "society-b"))._id, "legacy-user");
const snapshot = {
  users: [{ _id: "retained-user-id", role: "Owner", societyId: "society-b", authIssuer: issuerA, authSubject: "operator-sub", externalIdentityId: identityId, email: "retained@test" }],
  externalIdentities: [{ _id: identityId, issuer: issuerA, subject: "operator-sub", status: "Active" }],
  roleHolders: [{ _id: "historical-person", roleType: "director", fullName: "Historical Director" }],
};
const sanitized = stripImportedAuthBindings(snapshot);
assert.equal(sanitized.externalIdentities, undefined);
assert.equal(sanitized.users[0].authIssuer, undefined);
assert.equal(sanitized.users[0].authSubject, undefined);
assert.equal(sanitized.users[0].externalIdentityId, undefined);
assert.equal(sanitized.users[0]._id, "retained-user-id");
assert.equal(sanitized.users[0].role, "Owner");
assert.equal(sanitized.users[0].email, "retained@test");
assert.deepEqual(sanitized.roleHolders, snapshot.roleHolders);
assert.equal(snapshot.users[0].authIssuer, issuerA, "sanitization must not mutate the original backup");
const restoreStore = new LocalDexieRowStore({ seed: {}, persistKey: "hosted-identity-restore-test" });
await restoreStore.importSnapshot({ tables: snapshot });
const restored = restoreStore.exportSnapshot();
assert.equal(restored.tables.externalIdentities, undefined);
assert.equal(restored.tables.users[0].authSubject, undefined);
assert.equal(restored.tables.users[0]._id, "retained-user-id");
console.log("Hosted identity checks passed: exact issuer/subject, immutable identity, ambiguous/legacy denial, lifecycle revocation, local compatibility, and broker configuration.");

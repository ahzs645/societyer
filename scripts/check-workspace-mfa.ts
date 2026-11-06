import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { generateKeyPair, jwtVerify, SignJWT } from "jose";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { CLERK_MFA_SESSION_PATH } from "../shared/workspaceMfa";

const issuer = "https://workspace-mfa-test.clerk.accounts.dev";
const origin = "https://workspace-mfa-test.example";
process.env.AUTH_MODE = "clerk";
process.env.VITE_AUTH_MODE = "clerk";
process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./http.js": () => import("../convex/http"),
  "./society.js": () => import("../convex/society"),
  "./users.js": () => import("../convex/users"),
  "./workspaceMfa.js": () => import("../convex/workspaceMfa"),
});

const { primary, secondary } = await t.run(async (ctx) => {
  const addWorkspace = (name: string) => ctx.db.insert("societies", {
    name, isCharity: false, isMemberFunded: false, updatedAt: Date.now(),
  });
  const primary = await addWorkspace("Primary");
  const secondary = await addWorkspace("Secondary");
  for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
    await ctx.db.insert("users", {
      societyId: primary, displayName: role, email: `${role}@example.test`, role,
      status: "Active", authSubject: role, authIssuer: issuer, authProvider: "clerk", createdAtISO: new Date().toISOString(),
    });
  }
  await ctx.db.insert("users", {
    societyId: secondary, displayName: "Second Owner", email: "Owner@example.test", role: "Owner",
    status: "Active", authSubject: "Owner", authIssuer: issuer, authProvider: "clerk", createdAtISO: new Date().toISOString(),
  });
  return { primary, secondary };
});

// Convex verifies the bearer before running an HTTP action. Reproduce that
// boundary with a signed Clerk-format fixture and the same projected identity.
const { publicKey, privateKey } = await generateKeyPair("RS256");
const { privateKey: foreignKey } = await generateKeyPair("RS256");
async function sign(subject: string, claims: Record<string, unknown>, key = privateKey) {
  return new SignJWT({ azp: origin, sts: "active", ...claims })
    .setProtectedHeader({ alg: "RS256" }).setIssuer(issuer).setSubject(subject)
    .setAudience("convex").setIssuedAt().setExpirationTime("1m").sign(key);
}
async function register(token: string) {
  const verified = await jwtVerify(token, publicKey, { issuer, audience: "convex" }).catch(() => null);
  const client = verified
    ? t.withIdentity({ issuer, subject: verified.payload.sub, sid: verified.payload.sid as string })
    : t;
  return client.fetch(CLERK_MFA_SESSION_PATH, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: origin },
  });
}

const clerk = (subject: string, sid: string) => t.withIdentity({ subject, issuer, sid });
const oldOwner = clerk("Owner", "password-only-owner");
const owner = clerk("Owner", "verified-owner");
const admin = clerk("Admin", "verified-admin");
assert.equal(await oldOwner.query(api.workspaceMfa.getPolicy, { societyId: primary }), "optional");
await assert.rejects(oldOwner.mutation(api.workspaceMfa.setPolicy, { societyId: primary, policy: "everyone" }), /Verify two-factor/);

assert.equal((await register(await sign("Owner", { sid: "verified-owner", fva: [0, -1] }))).status, 403);
assert.equal((await register(await sign("Owner", { sid: "verified-owner", fva: [0, 0], sts: "pending" }))).status, 403);
assert.equal((await register(await sign("Owner", { sid: "verified-owner", fva: [0, 0], act: { sub: "impersonator" } }))).status, 403);
assert.equal((await register(await sign("Owner", { sid: "verified-owner", fva: [0, 0], azp: "https://wrong.example" }))).status, 403);
assert.equal((await register(await sign("Owner", { sid: "verified-owner", fva: [0, 0] }, foreignKey))).status, 401);
assert.equal((await register(await sign("Owner", { fva: [0, 0] }))).status, 401);
assert.equal((await register(await sign("Owner", { sid: "verified-owner", fva: [0, 0] }))).status, 204);
assert.equal((await register(await sign("Admin", { sid: "verified-admin", fva: [1, 0] }))).status, 204);
await assert.rejects(admin.mutation(api.workspaceMfa.setPolicy, { societyId: primary, policy: "everyone" }), /workspace Owner/);

await owner.mutation(api.workspaceMfa.setPolicy, { societyId: primary, policy: "owners-admins" });
const blocked = /two-factor|not found/i;
await assert.rejects(oldOwner.query(api.society.getById, { id: primary }), blocked);
await assert.rejects(clerk("Admin", "password-only-admin").query(api.society.getById, { id: primary }), blocked);
assert.equal((await admin.query(api.society.getById, { id: primary }))._id, primary);
for (const role of ["Director", "Member", "Viewer"]) {
  assert.equal((await clerk(role, "password-only").query(api.society.getById, { id: primary }))._id, primary);
}
const lookup = await oldOwner.query(api.http.currentPrincipalMemberships, {});
assert.equal(lookup.status, "bound");
assert.deepEqual(lookup.memberships.map((item: any) => item.society._id), [secondary]);
assert.deepEqual(lookup.lockedWorkspaces, [{ id: primary, name: "Primary" }]);
assert.deepEqual((await oldOwner.query(api.society.list, {})).map((item: any) => item._id), [secondary]);
assert.equal(await owner.query(api.workspaceMfa.getPolicy, { societyId: secondary }), "optional");

await owner.mutation(api.workspaceMfa.setPolicy, { societyId: primary, policy: "everyone" });
const member = clerk("Member", "password-only-member");
await assert.rejects(member.query(api.society.getById, { id: primary }), blocked);
assert.equal((await member.query(api.http.currentPrincipalMemberships, {})).status, "mfa-required");
const legacyOwner = t.withIdentity({ subject: "Owner", issuer, societyer_mfa_verified: true });
await assert.rejects(legacyOwner.query(api.society.getById, { id: primary }), blocked);
assert.equal((await legacyOwner.query(api.society.getById, { id: secondary }))._id, secondary);
const memberWithSameSid = clerk("Member", "verified-owner");
await assert.rejects(memberWithSameSid.query(api.society.getById, { id: primary }), blocked);

await t.run(async (ctx) => {
  const row = await ctx.db.query("clerkMfaSessions").withIndex("by_issuer_subject_sessionId", q =>
    q.eq("issuer", issuer).eq("subject", "Admin").eq("sessionId", "verified-admin")).unique();
  assert.ok(row);
  await ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 });
});
await assert.rejects(admin.query(api.society.getById, { id: primary }), blocked);
await t.mutation(internal.workspaceMfa.purgeExpiredClerkSessions, {});
await owner.mutation(api.workspaceMfa.setPolicy, { societyId: primary, policy: "optional" });
assert.equal((await member.query(api.society.getById, { id: primary }))._id, primary);
console.log("Workspace 2FA checks passed for Clerk JWTs, policy changes, role rules, session isolation, and multiple workspaces.");

import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hostedPrincipal, betterAuthIssuer } from "../convex/lib/authIdentity";
import { matchesAuthBinding } from "../shared/functions/identity";
import { requirePrincipalRole, requireSocietyMembership } from "../shared/functions/access";
import { ensureCurrentMembershipPortable, migrateUserToClerkPortable, userGetByAuthSubject } from "../shared/functions/users";
import { hashInvitationToken } from "../shared/functions/invitationTokens";
import { newSocietyOwnerFields, listPortable } from "../shared/functions/society";
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities, type PortablePrincipal } from "../shared/portable/index";

const clerkIssuer = "https://company.clerk.accounts.dev";
process.env.AUTH_MODE = "clerk";
process.env.VITE_AUTH_MODE = "clerk";
process.env.CLERK_JWT_ISSUER_DOMAIN = clerkIssuer;
process.env.SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT = "0";
const config = (await import("../convex/auth.config")).default;
assert.ok(config.providers.some((provider) => "domain" in provider && provider.domain === clerkIssuer && provider.applicationID === "convex"));
assert.ok(config.providers.some((provider) => "type" in provider && provider.type === "customJwt" && provider.issuer === betterAuthIssuer()));
const clerkPrincipal = hostedPrincipal({
  subject: "same-subject", issuer: clerkIssuer, tokenIdentifier: `${clerkIssuer}|same-subject`,
  email: "member@example.org", emailVerified: true, name: "Clerk Member",
  societyer_auth_issuer: betterAuthIssuer(), societyer_auth_provider: "better-auth",
} as any);
assert.equal(clerkPrincipal.kind, "user");
if (clerkPrincipal.kind !== "user") throw new Error("Expected user principal");
assert.equal(clerkPrincipal.authProvider, "clerk");
assert.equal(clerkPrincipal.issuer, clerkIssuer, "Clerk cannot spoof the trusted bridge issuer");
assert.equal(matchesAuthBinding({ authSubject: "same-subject", authProvider: "better-auth" }, clerkPrincipal), false);
assert.equal(matchesAuthBinding({ authSubject: "same-subject", authProvider: "clerk" }, clerkPrincipal), false, "Unmigrated Clerk records must fail closed");
assert.equal(matchesAuthBinding({ authSubject: "same-subject", authIssuer: "https://other.clerk.accounts.dev" }, clerkPrincipal), false);
const bridge = hostedPrincipal({
  subject: "same-subject", issuer: betterAuthIssuer(), tokenIdentifier: "machine|same-subject",
  societyer_auth_issuer: clerkIssuer, societyer_auth_provider: "clerk",
} as any);
assert.ok(matchesAuthBinding({ authSubject: "same-subject", authIssuer: clerkIssuer, authProvider: "clerk" }, bridge));
assert.equal(hostedPrincipal({ subject: "same-subject", issuer: betterAuthIssuer(), tokenIdentifier: "raw-better" } as any).kind, "anonymous", "Clerk mode does not accept an unbridged Better Auth user session");
assert.equal(hostedPrincipal({ subject: "same-subject", issuer: betterAuthIssuer(), tokenIdentifier: "machine-forged", societyer_auth_issuer: "https://foreign.clerk.accounts.dev" } as any).kind, "anonymous", "Machine bridge must match the selected broker issuer");
process.env.AUTH_MODE = "better-auth";
process.env.VITE_AUTH_MODE = "better-auth";
const betterPrincipal = hostedPrincipal({ subject: "same-subject", issuer: betterAuthIssuer(), tokenIdentifier: "better|same-subject" } as any);
assert.equal(matchesAuthBinding({ authSubject: "same-subject", authProvider: "better-auth" }, betterPrincipal), false, "Issuerless legacy rows require explicit operator binding");
assert.ok(matchesAuthBinding({ authSubject: "same-subject", authIssuer: betterAuthIssuer(), authProvider: "better-auth" }, betterPrincipal));
process.env.AUTH_MODE = "clerk";
process.env.VITE_AUTH_MODE = "clerk";

const db = new MemoryDb({ seed: {
  societies: [{ _id: "company" }, { _id: "legacy" }, { _id: "disabled" }, { _id: "foreign" }],
  users: [
    { _id: "clerk-member", societyId: "company", role: "Viewer", status: "Active", authSubject: "same-subject", authIssuer: clerkIssuer, authProvider: "clerk" },
    { _id: "legacy-owner", societyId: "legacy", role: "Owner", status: "Active", authSubject: "same-subject", authProvider: "better-auth" },
    { _id: "disabled-member", societyId: "disabled", role: "Admin", status: "Disabled", authSubject: "same-subject", authIssuer: clerkIssuer, authProvider: "clerk" },
    { _id: "foreign-owner", societyId: "foreign", role: "Owner", status: "Active", authSubject: "same-subject", authIssuer: "https://foreign.clerk.accounts.dev", authProvider: "clerk" },
  ],
  invitations: [{ _id: "invitation", societyId: "legacy", email: "member@example.org", role: "Member", tokenHash: await hashInvitationToken("inv_verified"), expiresAtISO: new Date(Date.now()+86400000).toISOString(), invitedByUserId: "legacy-owner" }],
} });
let principal: PortablePrincipal = clerkPrincipal;
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => principal })
  .register(definePortableQuery({ name: "users:get", handler: (ctx, args: { societyId: string }) => requireSocietyMembership(ctx, args.societyId) }))
  .register(definePortableQuery({ name: "permissions:check", handler: (ctx, args: { societyId: string }) => requirePrincipalRole(ctx, { ...args, required: "Admin" }) }))
  .register(definePortableQuery({ name: "society:list", handler: listPortable }))
  .register(definePortableQuery({ name: "users:getByAuthSubject", handler: userGetByAuthSubject }))
  .register(definePortableMutation({ name: "users:ensureCurrentMembership", handler: ensureCurrentMembershipPortable }))
  .register(definePortableMutation({ name: "apiPlatform:migrateUserToClerk", handler: migrateUserToClerkPortable }));
assert.equal((await runtime.runQuery<any>("users:get", { societyId: "company" }))._id, "clerk-member");
assert.deepEqual((await runtime.runQuery<any[]>("society:list")).map((row) => row._id), ["company"]);
await assert.rejects(() => runtime.runQuery("users:get", { societyId: "legacy" }), /membership not found/);
await assert.rejects(() => runtime.runQuery("users:get", { societyId: "foreign" }), /membership not found/);
await assert.rejects(() => runtime.runQuery("users:get", { societyId: "disabled" }), /disabled/);
await assert.rejects(() => runtime.runQuery("permissions:check", { societyId: "company" }), /Role Admin required/, "A Viewer cannot gain Admin because no administrators exist");
assert.equal((await runtime.runQuery<any>("users:getByAuthSubject", { authSubject: "same-subject" }))._id, "clerk-member");
assert.deepEqual(await runtime.runMutation("users:ensureCurrentMembership", { societyId: "legacy" }), { status: "needs-invitation" });
principal = { ...clerkPrincipal, emailVerified: false };
assert.deepEqual(await runtime.runMutation("users:ensureCurrentMembership", { societyId: "legacy", invitationToken: "inv_verified" }), { status: "invitation-email-unverified" });
assert.equal((await db.get("invitation"))?.acceptedAtISO, undefined);
principal = clerkPrincipal;
const accepted = await runtime.runMutation<any>("users:ensureCurrentMembership", { societyId: "legacy", invitationToken: "inv_verified" });
assert.equal(accepted.status, "invitation-accepted");
const joined = await db.get(accepted.userId);
assert.equal(joined?.authIssuer, clerkIssuer);
assert.equal(joined?.role, "Member");
assert.equal((await db.get("legacy-owner"))?.authIssuer, undefined, "Invitation must not rebind existing matching-email or matching-subject rows");
const owner = newSocietyOwnerFields(clerkPrincipal, { societyId: "new-company", placeholderEmail: "owner@local", placeholderDisplayName: "Owner", createdAtISO: new Date().toISOString() });
assert.equal(owner.authIssuer, clerkIssuer);
assert.equal(owner.authSubject, "same-subject");
assert.equal(owner.role, "Owner");

await assert.rejects(() => runtime.runMutation("apiPlatform:migrateUserToClerk", {
  userId: "legacy-owner", mappingEvidenceRef: "fixture:verified-old-new-tuple", identityPolicyEvidenceRef: "fixture:reviewed-link-policy", expectedAuthSubject: "wrong", expectedAuthProvider: "better-auth", authSubject: "new-clerk-user", authIssuer: clerkIssuer,
}), /expected binding does not match/);
await assert.rejects(() => runtime.runMutation("apiPlatform:migrateUserToClerk", {
  userId: "legacy-owner", mappingEvidenceRef: "fixture:verified-old-new-tuple", identityPolicyEvidenceRef: "fixture:reviewed-link-policy", expectedAuthSubject: "same-subject", expectedAuthProvider: "better-auth", authSubject: "same-subject", authIssuer: clerkIssuer,
}), /already bound within this society/);
await assert.rejects(() => runtime.runMutation("apiPlatform:migrateUserToClerk", {
  userId: "legacy-owner", expectedAuthSubject: "same-subject", expectedAuthProvider: "better-auth", authSubject: "new-clerk-user", authIssuer: clerkIssuer,
  mappingEvidenceRef: "", identityPolicyEvidenceRef: "",
}), /evidence references are required/);
await runtime.runMutation("apiPlatform:migrateUserToClerk", {
  userId: "legacy-owner", mappingEvidenceRef: "fixture:verified-old-new-tuple", identityPolicyEvidenceRef: "fixture:reviewed-link-policy", expectedAuthSubject: "same-subject", expectedAuthProvider: "better-auth", authSubject: "new-clerk-user", authIssuer: clerkIssuer,
});
assert.equal((await db.get("legacy-owner"))?.role, "Owner");
assert.equal((await db.get("legacy-owner"))?.authProvider, "clerk");
assert.ok((await db.get("legacy-owner"))?.externalIdentityId);
assert.match(db.dump("activity").find((row) => row.action === "identity-migrated")?.summary, /fixture:verified-old-new-tuple/);
assert.equal(db.dump("activity").filter((row) => row.action === "identity-migrated").length, 1);
principal = betterPrincipal;
await assert.rejects(() => runtime.runQuery("users:get", { societyId: "legacy" }), /membership not found/);
principal = bridge;
assert.equal((await runtime.runQuery<any>("users:get", { societyId: "company" }))._id, "clerk-member");
principal = { kind: "user", runtime: "browser-local", assurance: "trusted-workspace", subject: "local:owner", userId: "legacy-owner", societyId: "legacy" };
assert.equal((await runtime.runQuery<any>("permissions:check", { societyId: "legacy" })).user._id, "legacy-owner");
principal = { kind: "anonymous", runtime: "convex-hosted", assurance: "none" };
await assert.rejects(() => runtime.runQuery("users:get", { societyId: "company" }), /Access denied/, "Clerk configuration must enforce authentication even when the compatibility flag is 0");

// Exercise native Convex wrappers as well as portable handlers. This catches
// schema/index regressions and missing auth checks outside PortableRuntime.
const native = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./society.js": () => import("../convex/society"),
  "./http.js": () => import("../convex/http"),
  "./authorization.js": () => import("../convex/authorization"),
  "./apiPlatform.js": () => import("../convex/apiPlatform"),
  "./documentVersions.js": () => import("../convex/documentVersions"),
} as any);
await assert.rejects(() => native.mutation(api.society.upsert, { name: "Anonymous company", isCharity: false, isMemberFunded: false }), /Authentication required/);
assert.deepEqual(await native.run((ctx) => ctx.db.query("societies").collect()), []);
const seeded = await native.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "Clerk company", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
  const common = { societyId, email: "member@example.org", displayName: "Member", role: "Member", status: "Active", authSubject: "same-subject", createdAtISO: new Date().toISOString() };
  const userId = await ctx.db.insert("users", { ...common, authProvider: "clerk", authIssuer: clerkIssuer });
  const legacyUserId = await ctx.db.insert("users", { ...common, authProvider: "better-auth" });
  const documentId = await ctx.db.insert("documents", { societyId, title: "Generated member policy", category: "Policy", createdAtISO: common.createdAtISO, flaggedForDeletion: false, tags: [] });
  const versionId = await ctx.db.insert("documentVersions", { societyId, documentId, version: 1, storageProvider: "local", storageKey: "generated /key.pdf", fileName: "document.pdf", uploadedAtISO: common.createdAtISO, isCurrent: true });
  const restrictedId = await ctx.db.insert("documents", { societyId, title: "Board record", category: "governance", createdAtISO: common.createdAtISO, flaggedForDeletion: false, tags: [] });
  const restrictedVersionId = await ctx.db.insert("documentVersions", { societyId, documentId: restrictedId, version: 1, storageProvider: "local", storageKey: "restricted.pdf", fileName: "restricted.pdf", uploadedAtISO: common.createdAtISO, isCurrent: true });
  return { societyId, userId, legacyUserId, versionId, restrictedVersionId };
});
const nativeClerk = native.withIdentity({ subject: "same-subject", issuer: clerkIssuer, email: "member@example.org", emailVerified: true });
await assert.rejects(() => native.query(api.apiPlatform.devActorForSociety, { societyId: seeded.societyId }), /Authentication required/, "Clerk deployment must deny the legacy anonymous actor lookup");
const nativeMemberships = await nativeClerk.query(api.http.currentPrincipalMemberships, {});
assert.equal(nativeMemberships.memberships.length, 1);
assert.equal(nativeMemberships.memberships[0].userId, seeded.userId);
process.env.SOCIETYER_API_PUBLIC_URL = "https://files.example.test";
await assert.rejects(() => nativeClerk.action(api.documentVersions.getDownloadTarget, { versionId: seeded.restrictedVersionId }), /documents not found/, "A valid Clerk member session cannot download a board-restricted document");
const generatedTarget = await nativeClerk.action(api.documentVersions.getDownloadTarget, { versionId: seeded.versionId });
assert.equal(generatedTarget.kind, "url");
assert.ok(generatedTarget.url.startsWith("/api/v1/workflow-generated-documents/"));
const generatedUrl = new URL(generatedTarget.url, "https://browser.example");
assert.equal(generatedUrl.origin, "https://browser.example", "Browser downloads must use the same-origin API proxy");
const serverDownloadUrl = await nativeClerk.action(api.documentVersions.getDownloadUrl, { versionId: seeded.versionId });
assert.equal(new URL(serverDownloadUrl!).origin, process.env.SOCIETYER_API_PUBLIC_URL, "Server consumers retain the configured API origin");
assert.equal(generatedUrl.searchParams.get("societyId"), seeded.societyId, "Generated downloads must carry the selected workspace for users with multiple memberships");
assert.equal(decodeURIComponent(generatedUrl.pathname.split("/").at(-1)!), "generated /key.pdf");
process.env.SOCIETYER_API_PLATFORM_TOKEN = "test-clerk-service-token";
const machineBinding = await native.query(api.http.gatewayApiPrincipal, { societyId: seeded.societyId, userId: seeded.userId, serviceToken: process.env.SOCIETYER_API_PLATFORM_TOKEN });
assert.equal(machineBinding?.authIssuer, clerkIssuer);
assert.equal(machineBinding?.authProvider, "clerk");
await assert.rejects(() => native.query(api.http.gatewayApiPrincipal, { societyId: seeded.societyId, userId: seeded.userId, serviceToken: "invalid-service-token" }), /service token is invalid/);
await assert.rejects(() => native.mutation(api.apiPlatform.migrateUserToClerk, { userId: seeded.legacyUserId, mappingEvidenceRef: "fixture:verified-old-new-tuple", identityPolicyEvidenceRef: "fixture:reviewed-link-policy", expectedAuthSubject: "same-subject", expectedAuthProvider: "better-auth", authSubject: "new-subject", serviceToken: "invalid-service-token" }), /service token is invalid/);
await native.mutation(api.apiPlatform.migrateUserToClerk, { userId: seeded.legacyUserId, mappingEvidenceRef: "fixture:verified-old-new-tuple", identityPolicyEvidenceRef: "fixture:reviewed-link-policy", expectedAuthSubject: "same-subject", expectedAuthProvider: "better-auth", authSubject: "new-subject", serviceToken: process.env.SOCIETYER_API_PLATFORM_TOKEN });
assert.equal((await native.run((ctx) => ctx.db.get(seeded.legacyUserId)))?.authIssuer, clerkIssuer);
console.log("Clerk auth checks passed: issuer isolation, trusted machine bridge, roles, provisioning, migration, local compatibility, and forced hosted authentication.");

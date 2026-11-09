/**
 * Per-workspace sign-in policy on one shared Convex deployment: DDC North
 * requires a Microsoft session from its group, First Form accepts passwords.
 * Session evidence is reproduced in Convex's verified custom-JWT shape
 * (nested claims flattened to dotted keys), not the raw JWT.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import type { UserIdentity } from "convex/server";
import { exportPKCS8, generateKeyPair } from "jose";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { hostedPrincipal } from "../convex/lib/authIdentity";
import { evaluateWorkspaceSignIn } from "../shared/workspaceSignInPolicy";
import type { PortablePrincipal } from "../shared/portable/ctx";

const issuer = "https://shared-workspaces-policy.convex.site";
const tenant = "220c85f6-1cb1-4bb2-a63b-55d9fd163b55";
const ddcGroup = "815b3b71-596d-48fe-aafd-f5bf34aafa5c";
const otherGroup = "6f1c9e0a-1111-4222-8333-944444444444";
const objectId = "5c45d5ce-1834-4779-b001-3ae5df851335";
const assertionKey = await generateKeyPair("PS256", { extractable: true });
Object.assign(process.env, {
  AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", CONVEX_SITE_URL: issuer,
  SITE_URL: "https://app.shared-workspaces.example", BETTER_AUTH_SECRET: "shared-workspaces-policy-test-secret-0000000000",
  SOCIETYER_ENTRA_LOGIN: "1", MICROSOFT_LOGIN_TENANT_ID: tenant, MICROSOFT_LOGIN_CLIENT_ID: "11111111-2222-4333-8444-555555555555",
  MICROSOFT_LOGIN_GROUP_IDS: `${ddcGroup},${otherGroup}`, MICROSOFT_LOGIN_PRIVATE_KEY: await exportPKCS8(assertionKey.privateKey),
  MICROSOFT_LOGIN_CERT_SHA256: "A".repeat(43),
});
delete process.env.SOCIETYER_ENTRA_SSO_REQUIRED;
delete process.env.SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS;
delete process.env.SOCIETYER_AUTH_MANUAL_PROVISIONING;

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./_generated/server.js": () => import("../convex/_generated/server"),
  "./http.js": () => import("../convex/http"),
  "./society.js": () => import("../convex/society"),
  "./users.js": () => import("../convex/users"),
  "./accountLinks.js": () => import("../convex/accountLinks"),
  "./workspaceSignInPolicies.js": () => import("../convex/workspaceSignInPolicies"),
});

const now = Date.now();
type Proof = { userId: string; tenantId: string; objectId: string; groupIds: string[]; authenticatedAt: number; expiresAt: number };
type SessionOptions = { email?: string; emailVerified?: boolean; sessionId?: string; createdAt?: number; microsoft?: Partial<Proof> | false };
function claims(subject: string, options: SessionOptions = {}) {
  const proof: Proof | null = options.microsoft === undefined || options.microsoft === false ? null : {
    userId: subject, tenantId: tenant, objectId, groupIds: [ddcGroup], authenticatedAt: now - 60_000, expiresAt: now + 3600_000, ...options.microsoft,
  };
  return {
    issuer, subject, tokenIdentifier: `${issuer}|${subject}`,
    email: options.email ?? `${subject}@example.test`, emailVerified: options.emailVerified ?? true,
    "societyer_session.id": options.sessionId ?? `session-${subject}`, "societyer_session.createdAt": options.createdAt ?? now - 60_000,
    ...(proof ? Object.fromEntries(Object.entries(proof).map(([key, value]) => [`societyer_entra.${key}`, value])) : {}),
  };
}
const session = (subject: string, options?: SessionOptions) => t.withIdentity(claims(subject, options));
const microsoft = (subject: string, proof: Partial<Proof> = {}) => session(subject, { microsoft: proof });

const fixture = await t.run(async (ctx) => {
  const workspace = (name: string) => ctx.db.insert("societies", { name, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ddc = await workspace("DDC North");
  const firstForm = await workspace("First Form");
  const member = (societyId: typeof ddc, subject: string, role: string) => ctx.db.insert("users", {
    societyId, email: `${subject}@example.test`, displayName: subject, role, status: "Active",
    authIssuer: issuer, authSubject: subject, authProvider: "convex", createdAtISO: new Date(0).toISOString(),
  });
  await member(ddc, "ddc-user", "Owner");
  await member(firstForm, "ff-user", "Owner");
  const personDdc = await member(ddc, "person-ms", "Admin");
  const personFirstForm = await member(firstForm, "person-pw", "Director");
  await ctx.db.insert("workspaceDomains", { origin: "https://portal.ddcnorth.example", hostname: "portal.ddcnorth.example", societyId: ddc,
    status: "Active", primary: true, createdAtISO: new Date(0).toISOString(), updatedAtISO: new Date(0).toISOString() });
  return { ddc, firstForm, personDdc, personFirstForm };
});
const reachable = async (client: ReturnType<typeof session>, id: string) => {
  try { return (await client.query(api.society.getById, { id: id as typeof fixture.ddc }))._id === id; } catch { return false; }
};

// Session evidence is built only from the deployment-signed claims.
const evidence = (identity: UserIdentity) => {
  const principal = hostedPrincipal(identity);
  assert.equal(principal.kind, "user");
  return principal.kind === "user" ? principal.sessionEvidence : undefined;
};
assert.deepEqual(evidence(claims("ddc-user", { createdAt: 1234 })), { sessionId: "session-ddc-user", authenticatedAt: 1234 });
assert.deepEqual(evidence(claims("ddc-user", { microsoft: {} }))?.microsoft,
  { tenantId: tenant, objectId, groupIds: [ddcGroup], authenticatedAt: now - 60_000, expiresAt: now + 3600_000 });
assert.deepEqual(evidence({ ...claims("ddc-user"), "societyer_session.id": 7, "societyer_session.createdAt": "1234" }), {}, "Mistyped session claims are ignored");
for (const invalid of [
  { expiresAt: now - 1 }, { tenantId: "99999999-2222-4333-8444-555555555555" }, { userId: "someone-else" }, { groupIds: [] },
  { groupIds: ["12345678-1111-4222-8333-944444444444"] }, { authenticatedAt: String(now) as unknown as number },
]) assert.equal(evidence(claims("ddc-user", { microsoft: invalid }))?.microsoft, undefined, `Rejected evidence ${JSON.stringify(invalid)}`);
assert.equal(evidence(claims("ddc-user", { microsoft: { groupIds: [otherGroup] } }))?.microsoft?.groupIds[0], otherGroup,
  "A deployment group outside the workspace policy is still valid session evidence");
process.env.SOCIETYER_ENTRA_SSO_REQUIRED = "1";
assert.equal(hostedPrincipal(claims("ff-user")).kind, "anonymous", "Deployment-wide required SSO keeps its meaning");
assert.equal(hostedPrincipal(claims("ddc-user", { microsoft: {} })).kind, "user");
delete process.env.SOCIETYER_ENTRA_SSO_REQUIRED;

// Operator validation: a Microsoft policy must be satisfiable by this deployment.
const set = (args: Record<string, unknown>) => t.mutation(internal.workspaceSignInPolicies.set, { societyId: fixture.ddc, reason: "Shared deployment rollout", ...args } as never);
await assert.rejects(set({ requiredMethod: "microsoft", microsoftTenantId: "99999999-2222-4333-8444-555555555555", microsoftGroupIds: [ddcGroup] }), /MICROSOFT_LOGIN_TENANT_ID/);
await assert.rejects(set({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: ["12345678-1111-4222-8333-944444444444"] }), /MICROSOFT_LOGIN_GROUP_IDS/);
await assert.rejects(set({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [] }), /MICROSOFT_LOGIN_GROUP_IDS/);
await assert.rejects(set({ requiredMethod: "microsoft", microsoftTenantId: tenant }), /MICROSOFT_LOGIN_GROUP_IDS/);
await assert.rejects(set({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [ddcGroup], reason: "  " }), /reason/);
await assert.rejects(set({ requiredMethod: "any", microsoftTenantId: tenant }), /only applies/);
await assert.rejects(set({ requiredMethod: "any", allowedEmailDomains: ["@ddcnorth.example"] }), /domain names/);
await assert.rejects(set({ requiredMethod: "any", supportEmail: "not-an-address" }), /support email/);
process.env.SOCIETYER_ENTRA_LOGIN = "0";
await assert.rejects(set({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [ddcGroup] }), /isn't enabled/);
process.env.SOCIETYER_ENTRA_LOGIN = "1";
const savedKey = process.env.MICROSOFT_LOGIN_PRIVATE_KEY;
process.env.MICROSOFT_LOGIN_PRIVATE_KEY = "";
await assert.rejects(set({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [ddcGroup] }), /configuration is invalid/);
process.env.MICROSOFT_LOGIN_PRIVATE_KEY = savedKey;
assert.equal((await t.run((ctx) => ctx.db.query("workspaceSignInPolicies").collect())).length, 0, "Refused policies write nothing");
// AI connector tokens can't show session evidence when used, so a stricter
// policy revokes the workspace's tokens minted before it; other workspaces keep theirs.
const grant = (societyId: typeof fixture.ddc, userId: typeof fixture.personDdc) => t.run((ctx) => ctx.db.insert("agentGrants", {
  societyId, userId, kind: "token", name: "Assistant", tokenHash: `hash-${societyId}`, scopes: ["meetings:read"],
  createdAtISO: new Date(0).toISOString(), expiresAtISO: new Date(now + 86_400_000).toISOString() }));
const ddcGrant = await grant(fixture.ddc, fixture.personDdc);
const firstFormGrant = await grant(fixture.firstForm, fixture.personFirstForm);
await set({ requiredMethod: "microsoft", microsoftTenantId: tenant.toUpperCase(), microsoftGroupIds: [ddcGroup.toUpperCase(), ddcGroup], supportEmail: "it@ddcnorth.example" });
assert.ok((await t.run((ctx) => ctx.db.get(ddcGrant)))?.revokedAtISO, "A token minted before the Microsoft requirement is revoked");
assert.equal((await t.run((ctx) => ctx.db.get(firstFormGrant)))?.revokedAtISO, undefined, "Another workspace's tokens are untouched");
const stored = await t.query(internal.workspaceSignInPolicies.get, { societyId: fixture.ddc });
assert.equal(stored.microsoftTenantId, tenant);
assert.deepEqual(stored.microsoftGroupIds, [ddcGroup], "Directory IDs are lowercased and deduplicated");
assert.equal((await t.query(internal.workspaceSignInPolicies.list, {}))[0].workspaceName, "DDC North");

// DDC-only Microsoft session: DDC yes, First Form no.
const ddcMicrosoft = microsoft("ddc-user");
assert.equal(await reachable(ddcMicrosoft, fixture.ddc), true);
assert.equal(await reachable(ddcMicrosoft, fixture.firstForm), false);
const ddcLookup = await ddcMicrosoft.query(api.http.currentPrincipalMemberships, {});
assert.equal(ddcLookup.status, "bound");
assert.deepEqual(ddcLookup.sessionMethods, { microsoft: true });
assert.equal(ddcLookup.memberships[0].canonicalOrigin, "https://portal.ddcnorth.example");
assert.equal(ddcLookup.memberships[0].viaLinkedIdentity, false);

// The same DDC member with a password session, or with broken evidence, is locked out of DDC.
const ddcPassword = session("ddc-user");
await assert.rejects(ddcPassword.query(api.society.getById, { id: fixture.ddc }), /Microsoft sign-in/);
const lockedLookup = await ddcPassword.query(api.http.currentPrincipalMemberships, {});
assert.equal(lockedLookup.status, "sign-in-required");
assert.deepEqual(lockedLookup.memberships, []);
assert.deepEqual(lockedLookup.lockedWorkspaces, [{ id: fixture.ddc, name: "DDC North", reason: "microsoft",
  canonicalOrigin: "https://portal.ddcnorth.example", supportEmail: "it@ddcnorth.example" }]);
assert.deepEqual(lockedLookup.sessionMethods, { microsoft: false });
for (const proof of [{ expiresAt: now - 1 }, { tenantId: "99999999-2222-4333-8444-555555555555" }, { groupIds: [otherGroup] }, { userId: "ff-user" }]) {
  assert.equal(await reachable(microsoft("ddc-user", proof), fixture.ddc), false, `Evidence ${JSON.stringify(proof)} must not open DDC`);
}

// First-Form-only password session: First Form yes, DDC no.
const firstFormPassword = session("ff-user");
assert.equal(await reachable(firstFormPassword, fixture.firstForm), true);
assert.equal(await reachable(firstFormPassword, fixture.ddc), false);
assert.equal(await reachable(microsoft("ff-user"), fixture.ddc), false, "Microsoft evidence never creates a membership");

// One person, two linked identities: a password session for one and a Microsoft-capable one for the other.
const fresh = { createdAt: Date.now() - 5_000 };
const started = await session("person-ms", fresh).mutation(api.accountLinks.begin, {});
assert.equal(started.status, "started");
assert.deepEqual(await session("person-pw", fresh).mutation(api.accountLinks.confirm, { code: started.code }), { status: "linked" });
const personPassword = session("person-pw");
assert.equal(await reachable(personPassword, fixture.firstForm), true);
assert.equal(await reachable(personPassword, fixture.ddc), false, "A linked Microsoft identity is not Microsoft evidence for this session");
const personPasswordLookup = await personPassword.query(api.http.currentPrincipalMemberships, {});
assert.equal(personPasswordLookup.status, "bound");
assert.deepEqual(personPasswordLookup.memberships.map((item: { userId: string }) => item.userId), [fixture.personFirstForm]);
assert.deepEqual(personPasswordLookup.lockedWorkspaces.map((lock: { id: string; reason: string }) => [lock.id, lock.reason]), [[fixture.ddc, "microsoft"]]);
assert.equal(personPasswordLookup.linkedIdentityCount, 1);
const personMicrosoft = microsoft("person-ms");
assert.equal(await reachable(personMicrosoft, fixture.ddc), true);
assert.equal(await reachable(personMicrosoft, fixture.firstForm), true);
const bothLookup = await personMicrosoft.query(api.http.currentPrincipalMemberships, {});
assert.deepEqual(bothLookup.memberships.map((item: { userId: string; role: string; viaLinkedIdentity: boolean }) => [item.userId, item.role, item.viaLinkedIdentity]).sort(),
  [[fixture.personDdc, "Admin", false], [fixture.personFirstForm, "Director", true]].sort(), "Each membership keeps its own role");
assert.deepEqual((await personMicrosoft.query(api.society.list, {})).map((row: { _id: string }) => row._id).sort(), [fixture.ddc, fixture.firstForm].sort());
assert.deepEqual((await personPassword.query(api.society.list, {})).map((row: { _id: string }) => row._id), [fixture.firstForm]);
assert.equal(await reachable(microsoft("person-pw", { userId: "person-ms" }), fixture.ddc), false, "Another identity's Microsoft proof is never reused");

// Workspace email-domain allowlist, checked against this session's verified address.
await t.mutation(internal.workspaceSignInPolicies.set, { societyId: fixture.firstForm, requiredMethod: "any", allowedEmailDomains: ["FirstForm.example"], reason: "Staff only" });
assert.equal(await reachable(session("ff-user", { email: "owner@firstform.example" }), fixture.firstForm), true);
assert.equal(await reachable(session("ff-user", { email: "owner@elsewhere.example" }), fixture.firstForm), false);
assert.equal(await reachable(session("ff-user", { email: "owner@firstform.example", emailVerified: false }), fixture.firstForm), false);
const domainLookup = await session("ff-user", { email: "owner@elsewhere.example" }).query(api.http.currentPrincipalMemberships, {});
assert.equal(domainLookup.status, "sign-in-required");
assert.equal(domainLookup.lockedWorkspaces[0].reason, "email-domain");

// Clearing restores the default ("any") behaviour; every change is audited.
assert.equal(await t.mutation(internal.workspaceSignInPolicies.clear, { societyId: fixture.ddc, reason: "Rollback rehearsal" }), true);
assert.equal(await reachable(ddcPassword, fixture.ddc), true);
const audit = await t.run((ctx) => ctx.db.query("activity").withIndex("by_society", (q) => q.eq("societyId", fixture.ddc)).collect());
assert.deepEqual(audit.map((row) => [row.actor, row.action]), [["Deployment operator", "sign-in-policy-set"], ["Deployment operator", "sign-in-policy-cleared"]]);

// The evaluator on its own, including fail-closed policies.
const user = (sessionEvidence: object, extra: object = {}): PortablePrincipal =>
  ({ kind: "user", runtime: "test", assurance: "verified-jwt", subject: "s", issuer, sessionEvidence, ...extra }) as PortablePrincipal;
const ms = { microsoft: { tenantId: tenant, objectId, groupIds: [ddcGroup], authenticatedAt: now, expiresAt: now + 1000 } };
assert.deepEqual(evaluateWorkspaceSignIn(null, user({})), { ok: true });
assert.deepEqual(evaluateWorkspaceSignIn({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [ddcGroup.toUpperCase()] }, user(ms), now), { ok: true });
assert.deepEqual(evaluateWorkspaceSignIn({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [ddcGroup] }, user(ms), now + 1000), { ok: false, requirement: "microsoft" });
assert.deepEqual(evaluateWorkspaceSignIn({ requiredMethod: "microsoft" }, user(ms), now), { ok: false, requirement: "microsoft" }, "A policy without tenant/groups can never be met");
assert.deepEqual(evaluateWorkspaceSignIn({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [ddcGroup] }, { kind: "anonymous", runtime: "test", assurance: "none" }), { ok: false, requirement: "microsoft" });
assert.deepEqual(evaluateWorkspaceSignIn({ requiredMethod: "microsoft", microsoftTenantId: tenant, microsoftGroupIds: [ddcGroup], allowedEmailDomains: ["ddcnorth.example"] },
  user(ms, { email: "a@ddcnorth.example", emailVerified: false }), now), { ok: false, requirement: "email-domain" }, "Microsoft evidence doesn't verify the account email");

console.log("Workspace sign-in policy passed: signed session evidence, operator validation, Microsoft and email-domain policies, lock reasons, linked password vs Microsoft sessions, required-SSO compatibility and audit.");

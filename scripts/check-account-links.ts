/**
 * Linking existing login identities into one person (accountLinks:*), how
 * membership resolution follows those links, and Better Auth's explicit
 * provider linking with implicit (same-email) linking still off.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { crossDomain } from "@convex-dev/better-auth/plugins";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { toPortableQueryCtx } from "../convex/lib/portable";
import { resolvePrincipalUser } from "../shared/functions/access";
import { linkedIdentityKeys } from "../shared/functions/identity";
import { createHostedEntraProvider, hostedEntraClaims, hostedEntraConfig, hostedEntraPlugin } from "../shared/hostedMicrosoftSso";
import type { PortablePrincipal } from "../shared/portable/ctx";

const issuer = "https://shared-workspaces-links.convex.site";
const tenant = "220c85f6-1cb1-4bb2-a63b-55d9fd163b55";
const client = "11111111-2222-4333-8444-555555555555";
const group = "815b3b71-596d-48fe-aafd-f5bf34aafa5c";
const assertionKey = await generateKeyPair("PS256", { extractable: true });
const environment = {
  AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", CONVEX_SITE_URL: issuer,
  SITE_URL: "https://app.shared-workspaces.example", BETTER_AUTH_SECRET: "shared-workspaces-links-test-secret-000000000000",
  SOCIETYER_ENTRA_LOGIN: "1", MICROSOFT_LOGIN_TENANT_ID: tenant, MICROSOFT_LOGIN_CLIENT_ID: client, MICROSOFT_LOGIN_GROUP_IDS: group,
  MICROSOFT_LOGIN_PRIVATE_KEY: await exportPKCS8(assertionKey.privateKey), MICROSOFT_LOGIN_CERT_SHA256: "A".repeat(43),
};
Object.assign(process.env, environment);
for (const key of ["SOCIETYER_ENTRA_SSO_REQUIRED", "SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS", "SOCIETYER_AUTH_MANUAL_PROVISIONING"]) delete process.env[key];

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api"),
  "./_generated/server.js": () => import("../convex/_generated/server"),
  "./http.js": () => import("../convex/http"),
  "./society.js": () => import("../convex/society"),
  "./users.js": () => import("../convex/users"),
  "./invitations.js": () => import("../convex/invitations"),
  "./authEmails.js": () => import("../convex/authEmails"),
  "./accountLinks.js": () => import("../convex/accountLinks"),
});

type Claims = Record<string, string | number | boolean>;
function claims(subject: string, authenticatedAgoMs = 60_000, extra: Claims = {}): Claims {
  return {
    issuer, subject, tokenIdentifier: `${issuer}|${subject}`, email: `${subject}@example.test`, emailVerified: true,
    "societyer_session.id": `session-${subject}`, "societyer_session.createdAt": Date.now() - authenticatedAgoMs, ...extra,
  };
}
const as = (subject: string, authenticatedAgoMs?: number, extra?: Claims) => t.withIdentity(claims(subject, authenticatedAgoMs, extra));
const stale = (subject: string) => as(subject, 16 * 60_000);

const fixture = await t.run(async (ctx) => {
  const workspace = (name: string) => ctx.db.insert("societies", { name, isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const [alpha, beta, gamma, omega, mergeA, mergeB] = await Promise.all(["Alpha", "Beta", "Gamma", "Omega", "Merge A", "Merge B"].map(workspace));
  const member = async (societyId: typeof alpha, subject: string, role: string, status = "Active") => {
    const externalIdentityId = await ctx.db.insert("externalIdentities", { issuer, subject, status: "Active", createdAtISO: new Date(0).toISOString() });
    return ctx.db.insert("users", {
      societyId, email: `${subject}@example.test`, displayName: subject, role, status, authIssuer: issuer, authSubject: subject,
      authProvider: "convex", externalIdentityId, createdAtISO: new Date(0).toISOString(),
    });
  };
  const aAlpha = await member(alpha, "a", "Owner");
  const aGamma = await ctx.db.insert("users", { societyId: gamma, email: "a@example.test", displayName: "a", role: "Viewer", status: "Disabled",
    authIssuer: issuer, authSubject: "a", authProvider: "convex", createdAtISO: new Date(0).toISOString() });
  const bBeta = await member(beta, "b", "Owner");
  await member(alpha, "c", "Viewer").then((id) => ctx.db.delete(id)); // c has an identity row but no memberships
  await member(omega, "x", "Admin");
  await member(omega, "y", "Viewer", "Disabled");
  await member(beta, "z", "Viewer");
  await member(mergeA, "m1", "Owner");
  await member(mergeB, "m4", "Member");
  for (const subject of ["m2", "m3", "w"]) await ctx.db.insert("externalIdentities", { issuer, subject, status: "Active", createdAtISO: new Date(0).toISOString() });
  return { alpha, beta, gamma, omega, mergeA, mergeB, aAlpha, aGamma, bBeta };
});

type Client = ReturnType<typeof as>;
const reachable = async (client: Client, id: string) => {
  try { return (await client.query(api.society.getById, { id: id as typeof fixture.alpha }))._id === id; } catch { return false; }
};
const begin = async (subject: string) => {
  const started = await as(subject).mutation(api.accountLinks.begin, {});
  assert.equal(started.status, "started", `${subject} begins`);
  return started.code as string;
};
const link = async (initiator: string, target: string) => {
  assert.deepEqual(await as(target).mutation(api.accountLinks.confirm, { code: await begin(initiator) }), { status: "linked" });
};
const events = () => t.run((ctx) => ctx.db.query("accountLinkEvents").collect());

// Beginning needs a deployment-signed session that signed in within 15 minutes.
assert.deepEqual(await t.mutation(api.accountLinks.begin, {}), { status: "unauthenticated" });
assert.deepEqual(await t.withIdentity({ issuer, subject: "a", tokenIdentifier: `${issuer}|a` }).mutation(api.accountLinks.begin, {}), { status: "unauthenticated" },
  "A token without session evidence can't start a link");
assert.deepEqual(await stale("a").mutation(api.accountLinks.begin, {}), { status: "reauthentication-required" });
assert.deepEqual(await as("a", -5 * 60_000).mutation(api.accountLinks.begin, {}), { status: "reauthentication-required" }, "A sign-in time in the future is not fresh");

// The code is single-use, short-lived, and only its SHA-256 is stored. A new begin cancels the old code.
const superseded = await begin("a");
const code = await begin("a");
assert.match(code, /^[A-Za-z0-9_-]{43}$/);
assert.deepEqual(await as("b").query(api.accountLinks.preview, { code: superseded }), { status: "invalid" });
const requests = await t.run((ctx) => ctx.db.query("accountLinkRequests").collect());
const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))).toString("hex");
assert.ok(requests.some((row) => row.codeHash === digest && row.status === "pending"));
assert.ok(!JSON.stringify(requests).includes(code), "The code itself is never stored");
const pending = requests.find((row) => row.codeHash === digest)!;
assert.ok(pending.expiresAtMs - pending.createdAtMs === 10 * 60_000);

// Preview: both parties, their workspaces, nothing else.
assert.deepEqual(await as("a").query(api.accountLinks.preview, { code }), { status: "same-account" });
assert.deepEqual(await stale("b").query(api.accountLinks.preview, { code }), { status: "reauthentication-required" });
assert.deepEqual(await as("b").query(api.accountLinks.preview, { code: "not-a-code" }), { status: "invalid" });
assert.deepEqual(await t.query(api.accountLinks.preview, { code }), { status: "unauthenticated" });
const preview = await as("b").query(api.accountLinks.preview, { code });
assert.equal(preview.status, "ready");
assert.deepEqual(preview.initiator, { email: "a@example.test", workspaces: [{ name: "Alpha", role: "Owner", status: "Active" }, { name: "Gamma", role: "Viewer", status: "Disabled" }] });
assert.deepEqual(preview.current, { email: "b@example.test", workspaces: [{ name: "Beta", role: "Owner", status: "Active" }] });
assert.deepEqual(preview.conflicts, []);

// Confirm: stale and same-account sessions can't consume the code; the first fresh confirm does.
assert.deepEqual(await stale("b").mutation(api.accountLinks.confirm, { code }), { status: "reauthentication-required" });
assert.deepEqual(await as("a").mutation(api.accountLinks.confirm, { code }), { status: "same-account" });
assert.deepEqual(await as("b").mutation(api.accountLinks.confirm, { code }), { status: "linked" });
assert.deepEqual(await as("b").mutation(api.accountLinks.confirm, { code }), { status: "invalid" }, "A consumed code can't be replayed");
assert.deepEqual(await as("c").mutation(api.accountLinks.confirm, { code }), { status: "invalid" }, "A third identity can't reuse a confirmed code");
assert.equal(await reachable(as("c"), fixture.alpha), false);
assert.equal(await reachable(as("c"), fixture.beta), false);
const linkedEvent = (await events()).find((event) => event.action === "linked")!;
assert.deepEqual(linkedEvent.identities.map((identity) => identity.subject).sort(), ["a", "b"]);
assert.deepEqual([linkedEvent.actorIssuer, linkedEvent.actorSubject], [issuer, "b"]);

// Either session reaches the other's Active memberships, each with its own role. Disabled stays Disabled.
assert.equal(await reachable(as("b"), fixture.alpha), true);
assert.equal(await reachable(as("a"), fixture.beta), true);
assert.equal(await reachable(as("b"), fixture.gamma), false);
assert.equal((await t.run((ctx) => ctx.db.get(fixture.aGamma)))?.status, "Disabled");
assert.deepEqual(await as("b").mutation(api.users.ensureCurrentMembership, { societyId: fixture.gamma }), { status: "membership-disabled" });
const bLookup = await as("b").query(api.http.currentPrincipalMemberships, {});
assert.deepEqual(bLookup.memberships.map((item: { userId: string; viaLinkedIdentity: boolean }) => [item.userId, item.viaLinkedIdentity]).sort(),
  [[fixture.aAlpha, true], [fixture.bBeta, false]].sort());
assert.equal(bLookup.linkedIdentityCount, 1);
assert.deepEqual(await as("b").mutation(api.users.ensureCurrentMembership, { societyId: fixture.alpha }),
  { status: "bound", societyId: fixture.alpha, userId: fixture.aAlpha }, "A linked membership counts as existing and is not rebound");
const aAlphaRow = await t.run((ctx) => ctx.db.get(fixture.aAlpha));
assert.deepEqual([aAlphaRow?.authSubject, aAlphaRow?.email, aAlphaRow?.displayName], ["a", "a@example.test", "a"]);

// Only deployment-signed user sessions follow links.
assert.equal(await reachable(t.withIdentity({ issuer, subject: "b", tokenIdentifier: `${issuer}|b`, email: "b@example.test", emailVerified: true }), fixture.alpha), false,
  "A principal without a session id stays on its own identity");
assert.equal(await reachable(t.withIdentity({ issuer, subject: "b", tokenIdentifier: `${issuer}|b` }), fixture.beta), true);
await t.run(async (ctx) => {
  const portable = await toPortableQueryCtx({ ...ctx, auth: { getUserIdentity: async () => null } });
  const base = { kind: "user", runtime: "convex-hosted", assurance: "verified-jwt", subject: "b", issuer, sessionEvidence: { sessionId: "s", authenticatedAt: Date.now() } } as const;
  const gateway: PortablePrincipal = { ...base, gatewayService: true };
  const service: PortablePrincipal = { kind: "service", runtime: "convex-hosted", assurance: "trusted-internal", subject: "api-token", actorUserId: fixture.bBeta, scopes: [] };
  assert.equal(await resolvePrincipalUser({ ...portable, principal: gateway }, fixture.alpha), null, "Gateway/API-token principals don't follow links");
  assert.equal((await resolvePrincipalUser({ ...portable, principal: gateway }, fixture.beta))?._id, fixture.bBeta);
  assert.equal(await resolvePrincipalUser({ ...portable, principal: service }, fixture.alpha), null);
  assert.deepEqual(await linkedIdentityKeys({ ...portable, principal: gateway }), [{ issuer, subject: "b" }]);
  assert.deepEqual(await linkedIdentityKeys({ ...portable, principal: { ...base, assurance: "trusted-workspace" } }), []);
  assert.deepEqual((await linkedIdentityKeys({ ...portable, principal: base })).map((key) => key.subject), ["b", "a"]);
});

// Overview describes only identities in the caller's own person.
const overview = await as("b").query(api.accountLinks.overview, {});
assert.deepEqual(overview.identities.map((identity: { subject: string; current: boolean }) => [identity.subject, identity.current]), [["b", true], ["a", false]]);
assert.deepEqual(overview.identities[1].workspaces.map((workspace: { name: string; status: string }) => [workspace.name, workspace.status]), [["Alpha", "Active"], ["Gamma", "Disabled"]]);
assert.deepEqual((await as("c").query(api.accountLinks.overview, {})).identities.map((identity: { subject: string }) => identity.subject), ["c"]);
assert.deepEqual(await t.query(api.accountLinks.overview, {}), { identities: [] });

// An invitation accepted through a linked identity never adds a second membership.
const invitation = await as("a").mutation(api.invitations.create, { societyId: fixture.alpha, email: "b@example.test", role: "Admin" });
const accepted = await as("b").mutation(api.invitations.acceptForAccount, { id: invitation.id });
assert.equal(accepted.status, "invitation-accepted");
assert.equal(accepted.userId, fixture.aAlpha);
const alphaMembers = await t.run((ctx) => ctx.db.query("users").withIndex("by_society", (q) => q.eq("societyId", fixture.alpha)).collect());
assert.deepEqual(alphaMembers.map((row) => [row.authSubject, row.role]), [["a", "Owner"]], "No duplicate and no role change");

// A forced overlap (operator error) makes that workspace ambiguous: nobody gets in, nobody picks the higher role.
const overlap = await t.run((ctx) => ctx.db.insert("users", { societyId: fixture.alpha, email: "b@example.test", displayName: "b", role: "Viewer", status: "Active",
  authIssuer: issuer, authSubject: "b", authProvider: "convex", createdAtISO: new Date().toISOString() }));
assert.equal(await reachable(as("a"), fixture.alpha), false);
assert.equal(await reachable(as("b"), fixture.alpha), false);
const ambiguousLookup = await as("a").query(api.http.currentPrincipalMemberships, {});
assert.deepEqual(ambiguousLookup.memberships.map((item: { userId: string }) => item.userId), [fixture.bBeta]);
assert.deepEqual(await as("a").mutation(api.users.ensureCurrentMembership, { societyId: fixture.alpha }), { status: "ambiguous-binding" });
assert.deepEqual((await as("b").query(api.society.list, {})).map((row: { _id: string }) => row._id), [fixture.beta]);
await t.run((ctx) => ctx.db.delete(overlap));

// Conflicts across the union, Disabled memberships included, are refused and audited.
const conflictCode = await begin("x");
assert.deepEqual(await as("y").query(api.accountLinks.preview, { code: conflictCode }), { status: "conflict", conflicts: [{ workspaceName: "Omega" }] });
assert.deepEqual(await as("y").mutation(api.accountLinks.confirm, { code: conflictCode }), { status: "conflict", conflicts: [{ workspaceName: "Omega" }] });
assert.deepEqual(await as("y").mutation(api.accountLinks.confirm, { code: conflictCode }), { status: "invalid" }, "A refused code is spent");
const refused = (await events()).filter((event) => event.action === "refused");
assert.deepEqual(refused.map((event) => [event.reason, event.identities.map((identity) => identity.subject).sort().join()]), [["conflict", "x,y"]]);
// Already-linked people count toward the union: z (Beta Viewer) can't join the person that already holds Beta.
assert.equal((await as("z").mutation(api.accountLinks.confirm, { code: await begin("a") })).status, "conflict");
assert.equal((await as("a").mutation(api.accountLinks.confirm, { code: await begin("z") })).status, "conflict");
assert.equal(await reachable(as("x"), fixture.omega), true, "A refused link changes nothing");

// Disabled external identities can neither start nor complete a link.
await t.run(async (ctx) => {
  const row = await ctx.db.query("externalIdentities").withIndex("by_issuer_subject", (q) => q.eq("issuer", issuer).eq("subject", "w")).unique();
  await ctx.db.patch(row!._id, { status: "Disabled" });
});
assert.deepEqual(await as("w").mutation(api.accountLinks.begin, {}), { status: "identity-disabled" });
assert.deepEqual(await as("w").mutation(api.accountLinks.confirm, { code: await begin("m2") }), { status: "identity-disabled" });
assert.equal((await events()).filter((event) => event.action === "refused" && event.reason === "identity-disabled").length, 1);

// Expiry and cancellation.
const expiring = await begin("m2");
await t.run(async (ctx) => {
  const row = (await ctx.db.query("accountLinkRequests").collect()).find((request) => request.status === "pending" && request.initiatorSubject === "m2");
  await ctx.db.patch(row!._id, { expiresAtMs: Date.now() - 1 });
});
assert.deepEqual(await as("m1").query(api.accountLinks.preview, { code: expiring }), { status: "expired" });
assert.deepEqual(await as("m1").mutation(api.accountLinks.confirm, { code: expiring }), { status: "expired" });
const cancelled = await begin("m2");
assert.deepEqual(await as("m1").mutation(api.accountLinks.cancel, { code: cancelled }), { status: "cancelled" });
assert.deepEqual(await as("m1").mutation(api.accountLinks.confirm, { code: cancelled }), { status: "invalid" });
assert.deepEqual(await as("m1").mutation(api.accountLinks.cancel, { code: cancelled }), { status: "invalid" });

// Merging two existing people: B's person's links move to A's person and B's person is retired.
await link("m1", "m2");
await link("m3", "m4");
assert.deepEqual(await as("m2").query(api.accountLinks.preview, { code: await begin("m1") }), { status: "already-linked" });
assert.equal(await reachable(as("m4"), fixture.mergeA), false);
await link("m2", "m3");
const people = await t.run((ctx) => ctx.db.query("personAccounts").collect());
const mergedLinks = await t.run((ctx) => ctx.db.query("personIdentityLinks").collect());
const mergedPerson = mergedLinks.find((row) => row.subject === "m1")!.personAccountId;
assert.deepEqual(mergedLinks.filter((row) => row.personAccountId === mergedPerson && row.status === "Active").map((row) => row.subject).sort(), ["m1", "m2", "m3", "m4"]);
assert.equal(people.filter((person) => person.status === "Disabled").length, 1, "The absorbed person is disabled");
assert.equal(await reachable(as("m4"), fixture.mergeA), true);
assert.equal(await reachable(as("m1"), fixture.mergeB), true);
assert.deepEqual((await events()).at(-1)?.identities.map((identity) => identity.subject).sort(), ["m1", "m2", "m3", "m4"]);

// Unlinking removes access through the other identity; a person left with one identity is removed.
assert.deepEqual(await as("m2").mutation(api.accountLinks.unlink, { issuer, subject: "m1" }), { status: "unlinked" });
assert.equal(await reachable(as("m1"), fixture.mergeB), false);
assert.equal(await reachable(as("m4"), fixture.mergeA), false);
assert.equal(await reachable(as("m1"), fixture.mergeA), true, "Each identity keeps its own memberships");
assert.deepEqual(await as("m1").mutation(api.accountLinks.unlink, { issuer, subject: "m2" }), { status: "not-linked" });
assert.deepEqual(await as("c").mutation(api.accountLinks.unlink, { issuer, subject: "b" }), { status: "not-linked" }, "Only an identity in the same person can unlink");
assert.deepEqual(await as("b").mutation(api.accountLinks.unlink, { issuer, subject: "a" }), { status: "unlinked" });
assert.equal(await reachable(as("b"), fixture.alpha), false);
assert.equal(await reachable(as("a"), fixture.beta), false);
const abPerson = (await t.run((ctx) => ctx.db.query("personIdentityLinks").collect())).find((row) => row.subject === "a")!.personAccountId;
assert.equal((await t.run((ctx) => ctx.db.get(abPerson)))?.status, "Disabled");
assert.equal((await events()).at(-1)?.reason, "person-removed");
assert.deepEqual((await as("b").query(api.accountLinks.overview, {})).identities.length, 1);
await link("a", "b");
assert.equal(await reachable(as("b"), fixture.alpha), true, "Identities can be linked again after unlinking");

console.log("Account links passed: fresh-session proof, hashed single-use codes, replay/expiry/cancel/cross-person denial, conflicts incl. Disabled and linked people, identity-disabled refusal, merges, unlink, disabled and ambiguous memberships, invitations and non-session principals.");

// Better Auth: explicit provider linking with implicit linking off.
const keys = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...await exportJWK(keys.publicKey), kid: "fixture", alg: "RS256", use: "sig" };
const objectId = "5c45d5ce-1834-4779-b001-3ae5df851335";
async function idToken(changes: Record<string, unknown> = {}) {
  return new SignJWT({ tid: tenant, oid: objectId, sub: "app-subject", email: "member@example.test", name: "Member", groups: [group], acct: 0,
    auth_time: Math.floor(Date.now() / 1000), ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
    .setAudience(client).setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
}
const realFetch = globalThis.fetch;
let callbackToken = "";
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.endsWith("/discovery/v2.0/keys")) return Response.json({ keys: [jwk] });
  return Response.json({ access_token: "unused", token_type: "Bearer", expires_in: 300, id_token: callbackToken });
};
const database = new DatabaseSync(":memory:");
const portal = environment.SITE_URL;
try {
  const config = hostedEntraConfig({ ...environment, CONVEX_SITE_URL: "https://auth.shared-workspaces.example" })!;
  const baseURL = config.baseURL;
  const auth = betterAuth({
    baseURL, secret: environment.BETTER_AUTH_SECRET, database, trustedOrigins: [portal],
    emailAndPassword: { enabled: true },
    socialProviders: { microsoft: createHostedEntraProvider(config) }, plugins: [hostedEntraPlugin(config), crossDomain({ siteUrl: portal })],
    // Exactly convex/hostedAuth.ts.
    account: { accountLinking: { enabled: false, disableImplicitLinking: true, trustedProviders: [] } },
    session: { expiresIn: 8 * 3600, disableSessionRefresh: true },
  });
  await (await getMigrations(auth.options)).runMigrations();
  const context = await auth.$context;
  const cookiesOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
  const post = (path: string, body: unknown, cookie = "") => auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    method: "POST", headers: { "content-type": "application/json", Origin: portal, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  }));
  async function oauth(path: string, body: Record<string, unknown>, cookie: string, token: string) {
    callbackToken = token;
    const started = await post(path, { provider: "microsoft", callbackURL: `${portal}/done`, errorCallbackURL: `${portal}/failed`, ...body }, cookie);
    if (started.status !== 200) return { started, location: null };
    const state = new URL((await started.json()).url).searchParams.get("state")!;
    const callback = await auth.handler(new Request(`${baseURL}/api/auth/callback/microsoft?code=fixture&state=${encodeURIComponent(state)}`, {
      headers: { cookie: [cookie, ...cookiesOf(started)].filter(Boolean).join("; ") },
    }));
    return { started, location: new URL(callback.headers.get("location")!), callback };
  }
  const signUp = await post("/sign-up/email", { email: "member@example.test", password: "correct horse battery", name: "Member" });
  assert.equal(signUp.status, 200);
  const passwordCookie = cookiesOf(signUp).join("; ");
  const member = (await context.internalAdapter.findUserByEmail("member@example.test"))!.user;
  await context.internalAdapter.updateUser(member.id, { emailVerified: true });
  const passwordSession = (await context.internalAdapter.listSessions(member.id))[0];

  // Same email, verified at Microsoft, no explicit link: no implicit linking and no session.
  const implicit = await oauth("/sign-in/social", {}, "", await idToken({ email_verified: true }));
  assert.equal(implicit.location?.searchParams.get("error"), "account_not_linked");
  assert.deepEqual((await context.internalAdapter.findAccounts(member.id)).map((account) => account.providerId), ["credential"]);
  assert.equal((await context.internalAdapter.listSessions(member.id)).length, 1);

  // Provider linking is off. The cross-domain plugin skips the OAuth state
  // cookie, so a link started by one person could be completed in another
  // person's browser; refusing it at the callback closes that path.
  const cookieless = await post("/link-social", { provider: "microsoft", callbackURL: `${portal}/done`, errorCallbackURL: `${portal}/failed` }, passwordCookie);
  if (cookieless.status === 200) {
    callbackToken = await idToken({ oid: "6d56e6df-2945-4880-b112-4ffb0f0a1a11", email: "victim@example.test" });
    const state = new URL((await cookieless.json()).url).searchParams.get("state")!;
    // Completed without the starting browser's cookies, as a victim would.
    const callback = await auth.handler(new Request(`${baseURL}/api/auth/callback/microsoft?code=fixture&state=${encodeURIComponent(state)}`));
    assert.ok(new URL(callback.headers.get("location")!).searchParams.get("error"), "A link callback is refused");
  } else {
    assert.ok(cookieless.status >= 400, "linkSocial is refused up front");
  }
  const linked = await oauth("/link-social", {}, passwordCookie, await idToken());
  assert.ok(linked.started.status >= 400 || linked.location?.searchParams.get("error"), "Even the account's own browser can't link a provider");
  assert.deepEqual((await context.internalAdapter.findAccounts(member.id)).map((account) => account.providerId), ["credential"], "No provider account was added");
  assert.equal((await context.internalAdapter.listSessions(member.id)).length, 1, "Linking attempts create no session");
  assert.deepEqual(await hostedEntraClaims(context.adapter, member.id, passwordSession.id, config), {}, "A password session never gains Microsoft proof");
  console.log("Better Auth linking passed: no implicit same-email linking, provider linking refused (including cross-browser completion), no session upgrade.");
} finally { database.close(); globalThis.fetch = realFetch; }

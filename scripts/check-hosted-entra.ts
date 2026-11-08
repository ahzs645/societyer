import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { generateKeyPair, exportJWK, exportPKCS8, SignJWT, jwtVerify } from "jose";
import { createHostedEntraProvider, hostedEntraConfig, hostedEntraPlugin, hostedEntraClaims, validEntraProof } from "../shared/hostedMicrosoftSso";
import { hostedPrincipal } from "../convex/lib/authIdentity";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { crossDomain } from "@convex-dev/better-auth/plugins";
import { makeSignature } from "better-auth/crypto";
import { createOAuthHandoff } from "../shared/completeHostedOAuth";

const tenant = "220c85f6-1cb1-4bb2-a63b-55d9fd163b55";
const client = "11111111-2222-4333-8444-555555555555";
const group = "815b3b71-596d-48fe-aafd-f5bf34aafa5c";
const objectId = "5c45d5ce-1834-4779-b001-3ae5df851335";
const baseURL = "https://auth.example.test";
const portal = "https://portal.example.test";
const assertionKey = await generateKeyPair("PS256", { extractable: true });
const environment = {
  SOCIETYER_ENTRA_LOGIN: "1", MICROSOFT_LOGIN_TENANT_ID: tenant, MICROSOFT_LOGIN_CLIENT_ID: client,
  MICROSOFT_LOGIN_GROUP_IDS: group, CONVEX_SITE_URL: baseURL,
  MICROSOFT_LOGIN_PRIVATE_KEY: await exportPKCS8(assertionKey.privateKey), MICROSOFT_LOGIN_CERT_SHA256: "A".repeat(43),
};
assert.equal(hostedEntraConfig({}), undefined);
for (const key of ["MICROSOFT_LOGIN_TENANT_ID", "MICROSOFT_LOGIN_CLIENT_ID", "MICROSOFT_LOGIN_GROUP_IDS", "MICROSOFT_LOGIN_PRIVATE_KEY", "MICROSOFT_LOGIN_CERT_SHA256"]) {
  assert.throws(() => hostedEntraConfig({ ...environment, [key]: "" }), key);
}
const config = hostedEntraConfig(environment)!;
const assertion = await config.clientAssertion!();
const assertionData = await jwtVerify(assertion, assertionKey.publicKey, {
  algorithms: ["PS256"], issuer: client, subject: client, audience: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
});
assert.equal(assertionData.protectedHeader["x5t#S256"], environment.MICROSOFT_LOGIN_CERT_SHA256);
assert.ok(assertionData.payload.exp! - assertionData.payload.iat! <= 300);
assert.notEqual((await jwtVerify(await config.clientAssertion!(), assertionKey.publicKey)).payload.jti, assertionData.payload.jti);

const keys = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...await exportJWK(keys.publicKey), kid: "fixture", alg: "RS256", use: "sig" };
const now = Math.floor(Date.now() / 1000);
const claims = { tid: tenant, oid: objectId, sub: "application-subject", email: "member@example.test", name: "Existing member", groups: [group], acct: 0, auth_time: now };
async function token(changes: Record<string, unknown> = {}) {
  return new SignJWT({ ...claims, ...changes }).setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(client).setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);
}
const realFetch = globalThis.fetch;
let callbackToken = await token();
let exchanges = 0;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`) return Response.json({ keys: [jwk] });
  assert.equal(url, `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, "No directory, Graph or photo requests");
  const body = new URLSearchParams(String(init?.body ?? (input instanceof Request ? await input.text() : "")));
  assert.equal(body.has("client_secret"), false);
  assert.ok(body.get("code_verifier"));
  assert.equal(body.get("client_assertion_type"), "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
  await jwtVerify(body.get("client_assertion")!, assertionKey.publicKey, { audience: url });
  exchanges++;
  return Response.json({ access_token: "fixture-unused-access-token", token_type: "Bearer", expires_in: 300, id_token: callbackToken });
};
const database = new DatabaseSync(":memory:");
try {
  const provider = createHostedEntraProvider(config);
  assert.ok(await provider.getUserInfo({ idToken: await token() }));
  assert.ok(await provider.getUserInfo({ idToken: await token({ acct: "0" }) }), "Entra member claim also supports the string representation");
  for (const invalid of [
    { groups: [] }, { groups: ["99999999-2222-4333-8444-555555555555"] }, { groups: undefined, _claim_names: { groups: "src1" } },
    { acct: 1 }, { acct: "1" }, { acct: false }, { acct: "00" }, { acct: undefined }, { oid: undefined }, { auth_time: now - 3600 }, { auth_time: undefined }, { auth_time: now + 3600 },
  ]) assert.equal(await provider.getUserInfo({ idToken: await token(invalid) }), null);

  const auth = betterAuth({
    baseURL, secret: "synthetic-hosted-entra-test-secret-0000000000000000", database, trustedOrigins: [portal],
    emailAndPassword: { enabled: true },
    socialProviders: { microsoft: provider }, plugins: [hostedEntraPlugin(config), crossDomain({ siteUrl: portal })],
    account: { accountLinking: { enabled: false, disableImplicitLinking: true } },
    session: { expiresIn: 8 * 3600, disableSessionRefresh: true },
  });
  await (await getMigrations(auth.options)).runMigrations();
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({ name: "Existing member", email: claims.email, emailVerified: true });
  await context.internalAdapter.createAccount({ userId: user.id, accountId: objectId, providerId: "microsoft" });
  async function login() {
    const response = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST", headers: { "content-type": "application/json", Origin: portal },
      body: JSON.stringify({ provider: "microsoft", callbackURL: `${portal}/dashboard`, errorCallbackURL: `${portal}/login?sso=failed` }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    const url = new URL((await response.json()).url);
    assert.equal(url.searchParams.get("max_age"), null, "Entra must not receive max_age=0, which expires this tenant's tokens immediately");
    assert.equal(url.searchParams.get("prompt"), "login");
    assert.deepEqual(url.searchParams.get("scope")?.split(" ").sort(), ["email", "openid", "profile"]);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const cookies = response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    return auth.handler(new Request(`${baseURL}/api/auth/callback/microsoft?code=fixture&state=${encodeURIComponent(url.searchParams.get("state")!)}`, { headers: { cookie: cookies } }));
  }
  const callback = await login();
  assert.equal(callback.status, 302);
  const destination = new URL(callback.headers.get("location")!);
  assert.equal(destination.origin + destination.pathname, `${portal}/dashboard`);
  assert.ok(destination.searchParams.get("ott"), "Convex cross-domain flow returns its one-time token");
  let callbackHref = destination.href;
  let verifiedCookie = "";
  let handoffVerifications = 0;
  let handoffRefreshes = 0;
  const completeHandoff = createOAuthHandoff({
    verify: async token => {
      handoffVerifications++;
      const response = await auth.handler(new Request(`${baseURL}/api/auth/cross-domain/one-time-token/verify`, {
        method: "POST", headers: { "content-type": "application/json", Origin: portal, "better-auth-cookie": "" }, body: JSON.stringify({ token }),
      }));
      assert.equal(response.status, 200);
      verifiedCookie = response.headers.get("set-better-auth-cookie") ?? "";
      return (await response.json()).session?.token ?? null;
    },
    establishSession: async sessionToken => {
      const cookie = verifiedCookie.split(";")[0];
      assert.ok(cookie, "The cross-domain endpoint returns the signed session cookie");
      const checked = await auth.api.getSession({ headers: new Headers({ cookie }) });
      assert.equal(checked?.session.token, sessionToken);
      assert.equal(checked?.user.id, user.id);
    },
    refreshSession: () => { handoffRefreshes++; },
  }, { href: () => callbackHref, replace: url => { callbackHref = url.href; } });
  await Promise.all([completeHandoff(), completeHandoff()]);
  assert.equal(handoffVerifications, 1, "Concurrent frontend mounts redeem the one-time token once");
  assert.equal(handoffRefreshes, 1);
  assert.equal(new URL(callbackHref).searchParams.has("ott"), false);
  const sessions = await context.internalAdapter.listSessions(user.id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].userId, user.id, "Operator binding preserves the existing account ID");
  assert.ok(sessions[0].expiresAt.getTime() - Date.now() <= 8 * 3600_000);
  const proof = await hostedEntraClaims(context.adapter, user.id, sessions[0].id, config);
  assert.ok(proof.societyer_entra, "A real callback records proof for the exact new session");
  assert.deepEqual(await hostedEntraClaims(context.adapter, "other-user", sessions[0].id, config), {});
  assert.deepEqual(await hostedEntraClaims(context.adapter, user.id, "other-session", config), {});
  assert.equal(validEntraProof(proof.societyer_entra, config, Date.now() + 9 * 3600_000), false);
  const previousEnvironment = { ...process.env };
  try {
    Object.assign(process.env, { ...environment, AUTH_MODE: "convex", VITE_AUTH_MODE: "convex", SOCIETYER_ENTRA_SSO_REQUIRED: "1", SOCIETYER_AUTH_ALLOWED_EMAIL_DOMAINS: "example.test" });
    const identity = { issuer: baseURL, subject: user.id, tokenIdentifier: `${baseURL}|${user.id}`, email: claims.email, emailVerified: false };
    // Match Convex's verified custom-JWT identity boundary, not the raw JWT.
    // Nested object fields become dotted keys; arrays/scalars retain JSON types.
    const entraIdentity = Object.fromEntries(Object.entries(proof.societyer_entra!).map(([key, value]) => [`societyer_entra.${key}`, value]));
    assert.equal(hostedPrincipal(identity).kind, "anonymous", "Password/legacy sessions cannot bypass required SSO");
    assert.equal(hostedPrincipal({ ...identity, ...entraIdentity }).kind, "user", "A bound directory identity need not claim mailbox verification");
    assert.equal(hostedPrincipal({ ...identity, ...proof }).kind, "anonymous", "Raw nested claims must not stand in for Convex's verified identity format");
    assert.equal(hostedPrincipal({ ...identity, ...entraIdentity, subject: "other-account" }).kind, "anonymous");
    assert.equal(hostedPrincipal({ ...identity, ...entraIdentity, issuer: "https://other.example.test" }).kind, "anonymous");
    for (const invalid of [
      { "societyer_entra.expiresAt": Date.now() - 1 },
      { "societyer_entra.authenticatedAt": String(Date.now()) },
      { "societyer_entra.tenantId": "other-tenant" },
      { "societyer_entra.objectId": "not-an-object-id" },
      { "societyer_entra.groupIds": [] },
      { "societyer_entra.groupIds": JSON.stringify([group]) },
    ]) assert.equal(hostedPrincipal({ ...identity, ...entraIdentity, ...invalid }).kind, "anonymous");
  } finally { for (const key of Object.keys(process.env)) if (!(key in previousEnvironment)) delete process.env[key]; Object.assign(process.env, previousEnvironment); }
  callbackToken = await token({ groups: [] });
  const rejected = await login();
  assert.match(rejected.headers.get("location")!, /sso=failed/);
  assert.equal((await context.internalAdapter.listSessions(user.id)).length, 1, "Group rejection creates no additional session");
  callbackToken = await token({ oid: "99999999-2222-4333-8444-555555555555", email: "unprovisioned@example.test" });
  const unprovisioned = await login();
  assert.match(unprovisioned.headers.get("location")!, /sso=failed/);
  assert.equal(await context.internalAdapter.findUserByEmail("unprovisioned@example.test"), null, "Group login alone does not provision an account");
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${sessions[0].token}.${await makeSignature(sessions[0].token, context.secret)}`)}`;
  const headers = new Headers({ cookie });
  await context.internalAdapter.updateSession(sessions[0].token, { updatedAt: new Date(Date.now() - 86400_000) });
  const checked = await auth.api.getSession({ headers });
  assert.equal(new Date(checked!.session.expiresAt).getTime(), sessions[0].expiresAt.getTime(), "Session checks never slide the eight-hour deadline");
  await context.internalAdapter.updateSession(sessions[0].token, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal(await auth.api.getSession({ headers }), null, "An expired app session requires another login");
  const recoverySession = await context.internalAdapter.createSession(user.id);
  assert.deepEqual(await hostedEntraClaims(context.adapter, user.id, recoverySession.id, config), {}, "A password/recovery session has no Microsoft proof");
  await context.internalAdapter.deleteSession(recoverySession.token);
  assert.equal((await context.internalAdapter.listSessions(user.id)).length, 0);
  assert.equal(exchanges, 3);
  console.log("Hosted Entra passed: certificate assertions, real OAuth callback/PKCE, immutable account binding, group/member/age checks, per-session proof, fixed eight-hour sessions, backend SSO enforcement and revocation.");
} finally { database.close(); globalThis.fetch = realFetch; }

const test = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./entraProvisioning.js": () => import("../convex/entraProvisioning"),
});
const previousIssuer = process.env.CONVEX_SITE_URL;
process.env.CONVEX_SITE_URL = baseURL;
try {
  const societyId = await test.run(ctx => ctx.db.insert("societies", { name: "Entra fixture", isCharity: false, isMemberFunded: false, updatedAt: Date.now() }));
  const args = { societyId, authUserId: "directory-auth-user", email: "new@example.test", name: "New member" };
  const created = await test.mutation(internal.entraProvisioning.ensureDirectoryMembership, args);
  assert.equal(created.role, "Viewer");
  assert.equal((await test.mutation(internal.entraProvisioning.ensureDirectoryMembership, args)).membershipId, created.membershipId);
  await test.run(ctx => ctx.db.patch(created.membershipId, { role: "Owner" }));
  assert.equal((await test.mutation(internal.entraProvisioning.ensureDirectoryMembership, args)).role, "Owner", "Provisioning preserves existing authority");
  await test.run(ctx => ctx.db.patch(created.membershipId, { status: "Disabled" }));
  await assert.rejects(() => test.mutation(internal.entraProvisioning.ensureDirectoryMembership, args), /Disabled memberships/);
  const entries = await test.run(ctx => ctx.db.query("activity").withIndex("by_society", q => q.eq("societyId", societyId)).take(10));
  assert.equal(entries.length, 1, "Provisioning is idempotent and records the new membership");
  console.log("Entra provisioning passed: Viewer defaults, stable membership IDs, preserved Owner authority, disabled-account rejection and audit evidence.");
} finally {
  if (previousIssuer === undefined) delete process.env.CONVEX_SITE_URL; else process.env.CONVEX_SITE_URL = previousIssuer;
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { microsoft } from "better-auth/social-providers";
import {
  createMicrosoftSsoProvider,
  getMicrosoftSsoConfig,
  microsoftProviderDiscovery,
} from "../server/microsoft-sso";

// Local fixtures only. No tenant discovery, Microsoft account, or live credential
// is required: the provider's signing-key request is intercepted below.
const tenantId = "11111111-2222-4333-8444-555555555555";
const clientId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const clientSecret = "local-test-secret-that-must-not-be-public";
const environment = {
  AUTH_MODE: "better-auth",
  NODE_ENV: "production",
  MICROSOFT_TENANT_ID: tenantId,
  MICROSOFT_CLIENT_ID: clientId,
  MICROSOFT_CLIENT_SECRET: clientSecret,
  BETTER_AUTH_BASE_URL: "https://societyer.example",
};

assert.equal(getMicrosoftSsoConfig({}), undefined);
for (const absent of ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"] as const) {
  const partial: Record<string, string> = { ...environment };
  delete partial[absent];
  assert.throws(() => getMicrosoftSsoConfig(partial), /Microsoft|MICROSOFT/,
    `Partial Microsoft configuration must fail closed when ${absent} is absent`);
}
for (const invalidTenant of ["common", "organizations", "consumers", "1stform.sharepoint.com", "not-a-tenant", "9188040d-6c67-4c5b-b112-36a304b66dad"]) {
  assert.throws(() => getMicrosoftSsoConfig({ ...environment, MICROSOFT_TENANT_ID: invalidTenant }),
    /tenant|MICROSOFT_TENANT_ID/i, `Reject unpinned or personal tenant ${invalidTenant}`);
}
assert.throws(() => getMicrosoftSsoConfig({ ...environment, MICROSOFT_CLIENT_ID: "not-an-app-id" }), /client|MICROSOFT_CLIENT_ID/i);
for (const unsafeURL of [
  "http://societyer.example", "http://127.0.0.1:5173", "https://user:password@societyer.example",
  "https://societyer.example/application", "https://societyer.example?callback=https://other.example",
  "https://societyer.example#callback", "javascript:alert(1)",
]) {
  assert.throws(() => getMicrosoftSsoConfig({ ...environment, BETTER_AUTH_BASE_URL: unsafeURL }),
    /URL|origin|HTTPS|https/i, `Reject unsafe production callback origin ${unsafeURL}`);
}
for (const localURL of ["http://127.0.0.1:5173", "http://localhost:5173"]) {
  assert.ok(getMicrosoftSsoConfig({ ...environment, NODE_ENV: "development", BETTER_AUTH_BASE_URL: localURL }));
}
assert.throws(() => getMicrosoftSsoConfig({ ...environment, NODE_ENV: "development", BETTER_AUTH_BASE_URL: "http://company.example:5173" }), /URL|origin|loopback|HTTPS|https/i);

const config = getMicrosoftSsoConfig(environment);
assert.ok(config);
assert.equal(config.tenantId, tenantId);
assert.equal(config.clientId, clientId);
assert.equal(config.baseURL, environment.BETTER_AUTH_BASE_URL);
assert.deepEqual(getMicrosoftSsoConfig({
  ...environment, MICROSOFT_TENANT_ID: tenantId.toUpperCase(), MICROSOFT_CLIENT_ID: clientId.toUpperCase(),
  MICROSOFT_CLIENT_SECRET: ` ${clientSecret} `, BETTER_AUTH_BASE_URL: `${environment.BETTER_AUTH_BASE_URL}/`,
}), config, "Copied GUIDs, surrounding whitespace, and root trailing slash normalize safely");
for (const mode of ["none", "clerk"] as const) {
  assert.deepEqual(microsoftProviderDiscovery(mode, config), { mode, microsoft: { enabled: false } });
}
assert.deepEqual(microsoftProviderDiscovery("better-auth", undefined), { mode: "better-auth", microsoft: { enabled: false } });
const publicDiscovery = microsoftProviderDiscovery("better-auth", config);
assert.deepEqual(publicDiscovery, { mode: "better-auth", microsoft: { enabled: true } });
for (const privateValue of [clientSecret, clientId, tenantId]) {
  assert.equal(JSON.stringify(publicDiscovery).includes(privateValue), false, "Provider discovery exposes only capability flags");
}

// Import the actual server configuration in isolated processes so modes cannot
// share module cache or create/modify the developer's authentication database.
const fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), "societyer-microsoft-sso-"));
const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
try {
  for (const mode of ["none", "clerk", "better-auth"] as const) {
    const checkServerConfiguration = `
      import assert from 'node:assert/strict';
      const { auth, microsoftSsoConfig, getAuthMode } = await import('./server/auth-config.ts');
      assert.equal(getAuthMode(), ${JSON.stringify(mode)});
      assert.equal(Boolean(microsoftSsoConfig), ${mode === "better-auth"});
      assert.equal(Boolean(auth.options.socialProviders?.microsoft), ${mode === "better-auth"});
      assert.equal(auth.options.account.accountLinking.enabled, false);
      assert.equal(auth.options.account.accountLinking.disableImplicitLinking, true);
    `;
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", checkServerConfiguration], {
      cwd: projectDirectory,
      env: {
        ...process.env, ...environment, AUTH_MODE: mode, VITE_AUTH_MODE: mode, NODE_ENV: "development",
        BETTER_AUTH_SECRET: "isolated-local-test-session-secret-at-least-32-characters",
        AUTH_DB_PATH: path.join(fixtureDirectory, `${mode}.sqlite`),
        // Disabled modes must not start failing because dormant provider
        // credentials are incomplete or copied incorrectly.
        MICROSOFT_CLIENT_ID: mode === "better-auth" ? clientId : "",
        MICROSOFT_CLIENT_SECRET: mode === "better-auth" ? clientSecret : "",
        MICROSOFT_TENANT_ID: mode === "better-auth" ? tenantId : "invalid-dormant-tenant",
      },
      stdio: "pipe",
    });
  }
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}

const providerOptions = createMicrosoftSsoProvider(config);
const provider = microsoft(providerOptions);
assert.equal(await provider.verifyIdToken("a-directly-submitted-id-token", "nonce"), false,
  "Direct ID-token sign-in stays disabled; use browser authorization-code, state, and PKCE");
const redirectURI = `${config.baseURL}/api/auth/callback/microsoft`;
const authorizeURL = await provider.createAuthorizationURL({
  state: "local-test-state", codeVerifier: "local-test-code-verifier-at-least-43-characters", redirectURI,
});
assert.equal(authorizeURL.origin, "https://login.microsoftonline.com");
assert.equal(authorizeURL.pathname, `/${tenantId}/oauth2/v2.0/authorize`);
assert.equal(authorizeURL.searchParams.get("client_id"), clientId);
assert.equal(authorizeURL.searchParams.get("redirect_uri"), redirectURI);
assert.equal(authorizeURL.searchParams.get("state"), "local-test-state");
assert.equal(authorizeURL.searchParams.get("response_type"), "code");
assert.equal(authorizeURL.searchParams.get("code_challenge_method"), "S256");
assert.ok(authorizeURL.searchParams.get("code_challenge"));
assert.deepEqual(authorizeURL.searchParams.get("scope")?.split(" ").sort(), ["email", "openid", "profile"]);
assert.equal(authorizeURL.toString().includes(clientSecret), false);

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const otherKeys = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "local-test-key", alg: "RS256", use: "sig" };
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const jwksURL = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
const baseClaims: JWTPayload = {
  tid: tenantId, sub: "microsoft-app-subject", name: "Workspace Member",
  email: "member@example.org", preferred_username: "different@example.org", roles: ["Admin"],
};
const originalFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  requests.push(url);
  assert.equal(url, jwksURL, "Sign-in may fetch only the pinned Microsoft public signing keys; never Graph documents or photos");
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
};

async function signedToken(claims: JWTPayload = {}, options: { issuer?: string; audience?: string; expired?: boolean; forged?: boolean; noExpiration?: boolean; noIssuedAt?: boolean; oldIssuedAt?: boolean } = {}) {
  const token = new SignJWT({ ...baseClaims, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "local-test-key" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? clientId);
  if (!options.noIssuedAt) token.setIssuedAt(options.oldIssuedAt ? Math.floor(Date.now() / 1000) - 7200 : undefined);
  if (!options.noExpiration) token.setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 60 : "5m");
  return token.sign(options.forged ? otherKeys.privateKey : privateKey);
}

try {
  const authenticated = await provider.getUserInfo({ idToken: await signedToken(), accessToken: "unused-test-access-token" });
  assert.ok(authenticated);
  assert.equal(authenticated.user.id, baseClaims.sub);
  assert.equal(authenticated.user.email, baseClaims.email, "UPN never replaces the token email");
  assert.equal(authenticated.user.emailVerified, false, "Tenant authentication alone does not verify mailbox ownership");
  assert.equal(authenticated.user.appRoleHint, undefined, "Entra roles must not become Societyer workspace roles");
  assert.equal(authenticated.user.role, undefined);
  const verified = await provider.getUserInfo({ idToken: await signedToken({ email_verified: true }) });
  assert.equal(verified?.user.emailVerified, true);
  const unverified = await provider.getUserInfo({ idToken: await signedToken({ email_verified: false }) });
  assert.equal(unverified?.user.emailVerified, false);
  const stringVerified = await provider.getUserInfo({ idToken: await signedToken({ email_verified: "true" }) });
  assert.equal(stringVerified?.user.emailVerified, false, "A truthy string is not a verified-email claim");
  const verifiedPrimary = await provider.getUserInfo({ idToken: await signedToken({ verified_primary_email: [baseClaims.email] }) });
  assert.equal(verifiedPrimary?.user.emailVerified, true);
  const unrelatedVerified = await provider.getUserInfo({ idToken: await signedToken({ verified_primary_email: ["different@example.org"] }) });
  assert.equal(unrelatedVerified?.user.emailVerified, false, "A different verified address cannot verify the login email");

  const invalidTokens = [
    ["wrong tenant", await signedToken({ tid: "99999999-2222-4333-8444-555555555555" })],
    ["missing tenant", await signedToken({ tid: undefined })],
    ["wrong issuer", await signedToken({}, { issuer: "https://login.microsoftonline.com/other/v2.0" })],
    ["wrong audience", await signedToken({}, { audience: "other-client-id" })],
    ["expired token", await signedToken({}, { expired: true })],
    ["missing expiration", await signedToken({}, { noExpiration: true })],
    ["missing issue time", await signedToken({}, { noIssuedAt: true })],
    ["token issued more than one hour ago", await signedToken({}, { oldIssuedAt: true })],
    ["forged signature", await signedToken({}, { forged: true })],
    ["UPN without email", await signedToken({ email: undefined })],
    ["missing subject", await signedToken({ sub: undefined })],
    ["malformed token", "not.a.jwt"],
    ["HMAC algorithm substitution", await new SignJWT(baseClaims)
      .setProtectedHeader({ alg: "HS256", kid: "local-test-key" }).setIssuer(issuer).setAudience(clientId)
      .setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(clientSecret))],
  ] as const;
  for (const [name, idToken] of invalidTokens) {
    assert.equal(await provider.getUserInfo({ idToken }), null, `Reject ${name} before creating an application session`);
  }
  assert.equal(await provider.getUserInfo({ accessToken: "test-access-token-with-no-id-token" }), null);
  assert.ok(requests.length > 0, "Signature checks must consult the test Microsoft signing keys");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Microsoft SSO checks passed: pinned tenant, callback origins, OIDC-only scopes, private discovery, signed token rejection, conservative email claims, and no Graph access.");

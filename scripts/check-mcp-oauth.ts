/**
 * OAuth 2.1 for the remote MCP endpoint, end to end through the real Convex
 * HTTP routes, internal functions and the consent actions (convex-test):
 *
 *   - discovery: protected-resource and authorization-server metadata, the
 *     401 challenge from /mcp, and everything off with SOCIETYER_MCP_OAUTH=0;
 *   - clients: Client ID Metadata Documents (mocked fetch, cached, private
 *     hosts refused before any fetch), dynamic registration (redirect policy,
 *     confidential clients, rate limit);
 *   - the authorization endpoint: error page vs. redirect, PKCE S256 only,
 *     resource, exact redirect matching (loopback port-agnostic);
 *   - consent: sign-in, membership, the workspace opt-in, scopes within the role;
 *   - code + PKCE → tokens → /mcp initialize, tools/list, tools/call;
 *   - wrong verifier, reused code, expired code, wrong redirect, wrong
 *     resource/audience and wrong client all fail;
 *   - refresh rotation; a reused refresh token revokes the family;
 *   - revoking the grant, RFC 7009 revocation, the opt-in and a demotion
 *     apply on the next call; secrets are stored as hashes; audit rows;
 *   - security review fixes: consent is bound to the browser that started it
 *     (a forwarded consent link can't be approved or denied by someone else,
 *     M1/L3); each consent is its own session, listed and revocable (M1); a
 *     metadata document that answers 404/410 removes the client, a 5xx keeps
 *     the stale copy (L2); throttles without a client IP and by IPv6 /64, and
 *     the daily clean-up (L1); invisible characters in names and the
 *     unverified client_uri (L4); audit of denials, RFC 7009, failed code
 *     exchanges (L6); malformed Basic auth, replay by another client and
 *     streamed oversized bodies (info);
 *   - final QA: connector status wording (Paused while the opt-in is off,
 *     Revoked/Disconnected with their date) and the consent page naming a
 *     self-registered app by its redirect host, not its self-declared name.
 *
 * Run: node --import tsx scripts/check-mcp-oauth.ts
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { CONNECTOR_READ_SCOPES } from "../shared/mcp/connectorPolicy";
import { listPermissionsForRole } from "../shared/functions/permissions";
import { MCP_LATEST_PROTOCOL_VERSION } from "../shared/mcp/server";
import {
  clientMetadataCacheSeconds,
  clientPublisherHost,
  declaredClientHost,
  hashOpaque,
  isClientMetadataUrl,
  parseRegistrationRequest,
  redirectUriAllowed,
  redirectUriMatches,
  requestedConnectorScopes,
  s256Challenge,
  throttleIpKey,
  unknownIpBuckets,
} from "../shared/mcp/oauth";
import { connectorStatus, consentIdentity } from "../src/features/aiConnectors/connectorDisplay";

const SITE = "https://oauth-test.convex.site";
const APP = "https://app.example.test";
const RESOURCE = `${SITE}/mcp`;
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
Object.assign(process.env, {
  AUTH_MODE: "convex", CONVEX_SITE_URL: SITE, SITE_URL: APP,
  BETTER_AUTH_SECRET: "fixture-only-societyer-secret-that-is-not-real", SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT: "1",
});

// --- Pure rules --------------------------------------------------------------------------
assert.ok(redirectUriAllowed(CLAUDE_CALLBACK, { extraRedirectUris: [] }));
assert.ok(redirectUriAllowed("https://chatgpt.com/connector_platform_oauth_redirect", { extraRedirectUris: [] }));
assert.ok(redirectUriAllowed("https://chatgpt.com/connector/oauth/abc_123", { extraRedirectUris: [] }));
assert.ok(redirectUriAllowed("http://127.0.0.1:43123/callback", { extraRedirectUris: [] }));
assert.ok(redirectUriAllowed("http://localhost/callback", { extraRedirectUris: [] }));
for (const refused of ["https://evil.example/cb", "http://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback#x", "https://claude.ai/api/mcp/auth_callback/extra", "http://10.0.0.1/cb", "javascript:alert(1)", "https://chatgpt.com/connector/oauth/../x"]) {
  assert.equal(redirectUriAllowed(refused, { extraRedirectUris: [] }), false, refused);
}
assert.ok(redirectUriAllowed("https://ops.example.org/cb", { extraRedirectUris: ["https://ops.example.org/cb"] }), "operator-listed URIs");
assert.ok(redirectUriMatches(["http://localhost/callback"], "http://localhost:51234/callback"), "loopback ignores the port");
assert.ok(redirectUriMatches(["http://127.0.0.1/callback"], "http://127.0.0.1:8080/callback"));
assert.equal(redirectUriMatches(["http://localhost/callback"], "http://127.0.0.1:51234/callback"), false, "localhost and 127.0.0.1 are distinct");
assert.equal(redirectUriMatches(["http://localhost/callback"], "http://localhost:51234/other"), false);
assert.equal(redirectUriMatches([CLAUDE_CALLBACK], `${CLAUDE_CALLBACK}?x=1`), false, "https redirects match exactly");
assert.ok(isClientMetadataUrl("https://claude.ai/oauth/claude-code-client-metadata"));
for (const bad of ["http://client.example/meta.json", "https://client.example", "https://client.example/", "https://client.example/a?b=1", "https://u:p@client.example/m", "https://client.example/a/../b"]) {
  assert.equal(isClientMetadataUrl(bad), false, bad);
}
assert.deepEqual(requestedConnectorScopes("offline_access meetings:read minutes:write"), ["meetings:read"], "unknown scopes are dropped");
assert.deepEqual(requestedConnectorScopes(undefined), [...CONNECTOR_READ_SCOPES], "no scope means the read set");
assert.equal(clientMetadataCacheSeconds("max-age=10"), 300);
assert.equal(clientMetadataCacheSeconds("public, max-age=999999"), 86_400);

// L4: names and hosts can't hide or reorder text (bidi overrides, zero-width characters).
const spoof = parseRegistrationRequest({ client_name: "Claude\u202e (verified)\u200b\u2066x\u2069\ufeff", client_uri: "https://claude.ai", redirect_uris: ["http://localhost/callback"] }, { extraRedirectUris: [] });
assert.equal(spoof.clientName, "Claude (verified)x", "format characters are stripped from client names");
assert.ok(!/[\p{Cc}\p{Cf}]/u.test(spoof.clientName));
assert.equal(clientPublisherHost("soc_dcr_x"), undefined, "a registered client has no verified publisher, whatever its client_uri says");
assert.equal(declaredClientHost(spoof.clientUri), "claude.ai", "its client_uri is only a self-declared host");
assert.equal(clientPublisherHost("https://claude.ai/oauth/claude-code-client-metadata"), "claude.ai");

// L1: IPv6 callers are throttled by /64; IPv4-mapped addresses as IPv4.
assert.equal(throttleIpKey("2001:db8:1:2:aaaa::1"), throttleIpKey("2001:db8:1:2:ffff:ffff:ffff:ffff"), "one /64, one bucket");
assert.notEqual(throttleIpKey("2001:db8:1:2::1"), throttleIpKey("2001:db8:1:3::1"));
assert.equal(throttleIpKey("[2001:DB8:1:2::1]"), "v6:2001:0db8:0001:0002::/64");
assert.equal(throttleIpKey("::ffff:192.0.2.1"), "v4:192.0.2.1");
assert.equal(throttleIpKey("203.0.113.9"), "v4:203.0.113.9");
// Round 2, item 4: the shared unknown-address buckets are configurable, never unlimited.
assert.deepEqual(unknownIpBuckets({}), { authorize: { capacity: 60, perHour: 600 }, register: { capacity: 20, perHour: 200 } });
assert.deepEqual(unknownIpBuckets({ SOCIETYER_MCP_OAUTH_UNKNOWN_IP_AUTHORIZE_PER_HOUR: "3000", SOCIETYER_MCP_OAUTH_UNKNOWN_IP_REGISTER_PER_HOUR: "5" }), { authorize: { capacity: 300, perHour: 3000 }, register: { capacity: 1, perHour: 5 } });
for (const bad of ["0", "-5", "lots", "1.5"]) assert.deepEqual(unknownIpBuckets({ SOCIETYER_MCP_OAUTH_UNKNOWN_IP_AUTHORIZE_PER_HOUR: bad }).authorize, { capacity: 60, perHour: 600 }, `${bad} falls back to the default`);

// Final QA item 3/11: what Settings → AI connectors says about a token or a connected app.
{
  const NOW = Date.parse("2026-10-18T12:00:00.000Z");
  const live = { expiresAtISO: "2027-01-04T12:00:00.000Z", connectorsEnabled: true };
  const revokedAtISO = "2026-10-17T09:00:00.000Z";
  assert.deepEqual(
    pick(connectorStatus({ kind: "token", ...live }, NOW)),
    { state: "active", label: "Active", live: true, dateLabel: "Expires", dateISO: live.expiresAtISO },
  );
  for (const kind of ["token", "oauth"] as const) {
    const paused = connectorStatus({ kind, ...live, connectorsEnabled: false }, NOW);
    assert.equal(`${paused.label} — ${paused.note?.toLowerCase()}`, "Paused — connectors are off for this workspace", `${kind}: not "Active" while the opt-in is off`);
    assert.equal(paused.live, true, `${kind}: a paused one can still be revoked`);
  }
  assert.deepEqual(
    pick(connectorStatus({ kind: "token", ...live, revokedAtISO }, NOW)),
    { state: "revoked", label: "Revoked", live: false, dateLabel: "Revoked", dateISO: revokedAtISO },
    "a revoked token shows when it was revoked, not \"Expires …\"",
  );
  assert.deepEqual(
    pick(connectorStatus({ kind: "oauth", ...live, revokedAtISO, connectorsEnabled: false }, NOW)),
    { state: "revoked", label: "Disconnected", live: false, dateLabel: "Disconnected", dateISO: revokedAtISO },
    "\"Disconnect\" leaves a \"Disconnected\" app, opt-in or not",
  );
  assert.equal(connectorStatus({ kind: "token", expiresAtISO: "2026-10-01T00:00:00.000Z", connectorsEnabled: false }, NOW).label, "Expired", "expired beats paused");
}
function pick({ state, label, live, dateLabel, dateISO }: ReturnType<typeof connectorStatus>) {
  return { state, label, live, dateLabel, dateISO };
}

// Final QA item 4: an unverified app is named by where it returns, not by what it calls itself.
{
  const dcr = { name: "Claude (verified)", host: null, registration: "dcr" as const, redirectHost: "claude.ai", loopback: false };
  assert.deepEqual(consentIdentity(dcr), { title: "Connect an app at claude.ai", name: "the app at claude.ai", secondary: "Calls itself “Claude (verified)”", verified: false });
  assert.deepEqual(
    consentIdentity({ ...dcr, redirectHost: "localhost (this computer)", loopback: true }),
    { title: "Connect an app on this computer", name: "the app on this computer", secondary: "Calls itself “Claude (verified)”", verified: false },
  );
  assert.equal(consentIdentity({ ...dcr, name: "Cla‮ude​", redirectHost: "evil​.example" }).secondary, "Calls itself “Claude”", "format characters stay out");
  assert.equal(consentIdentity({ ...dcr, redirectHost: "evil​.example" }).title, "Connect an app at evil.example");
  assert.deepEqual(
    consentIdentity({ name: "Claude", host: "claude.ai", registration: "cimd", redirectHost: "claude.ai", loopback: false }),
    { title: "Connect Claude", name: "Claude", secondary: "Published by claude.ai", verified: true },
    "a metadata document's name is backed by its host",
  );
}

// --- Fixture ---------------------------------------------------------------------------------
const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
  "./http.js": () => import("../convex/http"),
  "./agentConnectors.js": () => import("../convex/agentConnectors"),
  "./mcpOAuth.js": () => import("../convex/mcpOAuth"),
  "./authThrottle.js": () => import("../convex/authThrottle"),
  "./authorization.js": () => import("../convex/authorization"),
};
const test = convexTest(schema, modules);

const ROLES = ["Owner", "Admin", "Member"] as const;
type Role = (typeof ROLES)[number] | "Outsider";
const at = "2026-09-01T19:00:00.000Z";
const seeded = await test.run(async (ctx) => {
  const societyId = await ctx.db.insert("societies", { name: "OAuth test society", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const otherId = await ctx.db.insert("societies", { name: "Another society", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users = {} as Record<(typeof ROLES)[number], Id<"users">>;
  for (const role of ROLES) {
    users[role] = await ctx.db.insert("users", {
      societyId, role, status: "Active", email: `${role.toLowerCase()}@oauth.test`, displayName: `${role} person`,
      authIssuer: SITE, authSubject: role.toLowerCase(), createdAtISO: at,
    });
  }
  // The Owner also belongs to a workspace whose connectors stay off.
  await ctx.db.insert("users", { societyId: otherId, role: "Owner", status: "Active", email: "owner@oauth.test", displayName: "Owner person", authIssuer: SITE, authSubject: "owner", createdAtISO: at });
  // Someone who isn't a member of the first workspace at all.
  await ctx.db.insert("users", { societyId: otherId, role: "Owner", status: "Active", email: "outsider@oauth.test", displayName: "Outsider", authIssuer: SITE, authSubject: "outsider", createdAtISO: at });
  await ctx.db.insert("meetings", { societyId, type: "Board", title: "October board meeting", scheduledAt: "2026-10-01T19:00:00.000Z", electronic: false, status: "Held", attendeeIds: [] });
  await ctx.db.insert("deadlines", { societyId, title: "Annual report", dueDate: "2026-01-31", category: "Filing", status: "open", done: false });
  return { societyId, otherId, users };
});
const { societyId, otherId, users } = seeded;
const as = (role: Role) => test.withIdentity({ issuer: SITE, subject: role.toLowerCase(), email: `${role.toLowerCase()}@oauth.test`, emailVerified: true });

// Client ID Metadata Documents, served by a mocked fetch.
const CIMD = "https://claude-client.example.com/oauth/client-metadata";
const CLI_CIMD = "https://cli.example.com/client.json";
const MISMATCH_CIMD = "https://mismatch.example.com/client.json";
const BAD_REDIRECT_CIMD = "https://badredirect.example.com/client.json";
const documents: Record<string, unknown> = {
  [CIMD]: { client_id: CIMD, client_name: "Claude", client_uri: "https://claude-client.example.com", redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: "none" },
  [CLI_CIMD]: { client_id: CLI_CIMD, client_name: "Claude Code", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"] },
  [MISMATCH_CIMD]: { client_id: "https://someone-else.example.com/client.json", client_name: "Impostor", redirect_uris: [CLAUDE_CALLBACK] },
  [BAD_REDIRECT_CIMD]: { client_id: BAD_REDIRECT_CIMD, client_name: "Leaky", redirect_uris: ["https://evil.example.test/cb"] },
};
const fetched: string[] = [];
/** Metadata URLs that answer 503 for now. */
const serverErrors = new Set<string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetched.push(url);
  if (serverErrors.has(url)) return new Response("unavailable", { status: 503 });
  const document = documents[url];
  if (!document) return new Response("not found", { status: 404 });
  return new Response(JSON.stringify(document), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" } });
}) as typeof fetch;

// --- HTTP helpers ---------------------------------------------------------------------------------
type Json = Record<string, unknown>;
const getJson = async (path: string) => {
  const response = await test.fetch(path, { method: "GET" });
  return { status: response.status, headers: response.headers, body: await response.json() as Json };
};
const form = async (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const response = await test.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : {}) as Json };
};
const rpc = async (token: string | null, method: string, params?: Json) => {
  const response = await test.fetch("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "MCP-Protocol-Version": MCP_LATEST_PROTOCOL_VERSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : null) as Json | null };
};
const toolNames = async (token: string) => {
  const response = await rpc(token, "tools/list");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return ((response.body?.result as Json).tools as { name: string }[]).map((tool) => tool.name);
};

let verifierCount = 0;
async function pkce() {
  const verifier = `verifier-${String(++verifierCount).padStart(4, "0")}-${"x".repeat(40)}`;
  return { verifier, challenge: await s256Challenge(verifier) };
}

type AuthorizeParams = Record<string, string | undefined>;
async function authorize(params: AuthorizeParams) {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const response = await test.fetch(`/oauth/authorize?${query.toString()}`, { method: "GET" });
  return { status: response.status, location: response.headers.get("location"), headers: response.headers, text: await response.text() };
}

/** The `name=value` part of the binding cookie /oauth/authorize set: what the browser sends back. */
function bindingCookieOf(headers: Headers): string {
  const header = headers.get("set-cookie") ?? "";
  assert.match(header, /^__Host-soc-oauth-[A-Za-z0-9]+=soc_mab_/, "authorize binds the request to the browser");
  // SameSite=None: the completion is a cross-site POST, which never carries Lax cookies. Never Partitioned: it is first-party there.
  for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=None", "Max-Age=600"]) assert.ok(header.includes(attribute), `binding cookie: ${attribute}`);
  assert.ok(!/Domain=|Partitioned/i.test(header), "a __Host- cookie has no Domain and isn't partitioned");
  return header.split(";")[0];
}

type Flow = { clientId: string; redirectUri: string; verifier: string; challenge: string; state: string; request: string; cookie: string };
async function startFlow(clientId: string, redirectUri: string, extra: AuthorizeParams = {}): Promise<Flow> {
  const { verifier, challenge } = await pkce();
  const state = `state-${verifierCount}`;
  const response = await authorize({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256",
    state, resource: RESOURCE, scope: [...CONNECTOR_READ_SCOPES, "offline_access"].join(" "), ...extra,
  });
  assert.equal(response.status, 302, response.text);
  const location = new URL(response.location ?? "");
  assert.equal(`${location.origin}${location.pathname}`, `${APP}/oauth/consent`, "the browser goes to the app's consent page");
  return { clientId, redirectUri, verifier, challenge, state, request: location.searchParams.get("request") ?? "", cookie: bindingCookieOf(response.headers) };
}

type Consent = {
  status: string;
  client: { name: string; host: string | null; declaredHost: string | null; registration: string; redirectHost: string; loopback: boolean } | null;
  requestedScopes: string[];
  workspaces: { societyId: string; name: string; connectorsEnabled: boolean; scopeOptions: { permission: string; held: boolean }[]; connectedScopes?: string[]; connectedSessions?: number }[];
};
const details = (role: Role, request: string) => as(role).action(api.mcpOAuth.consentDetails, { request }) as Promise<Consent>;
/** What the consent page ticks by default: the read scopes the role holds. */
const heldReads = (role: Role) => CONNECTOR_READ_SCOPES.filter((scope) => (listPermissionsForRole(role === "Outsider" ? "Owner" : role) as readonly string[]).includes(scope));
const approve = (role: Role, flow: Flow, scopes: string[] = heldReads(role), workspace: Id<"societies"> = societyId) =>
  as(role).action(api.mcpOAuth.approve, { request: flow.request, societyId: workspace, scopes }) as Promise<Completion>;

/** What approve and deny return: the form the consent page posts back to the issuer. */
type Completion = { action: string; fields: { request: string; completion: string } };
/**
 * The consent page's form post back to the issuer (a top-level POST
 * navigation from the app's origin), with or without the binding cookie.
 */
async function complete(completion: Completion, cookie?: string, origin: string | null = APP) {
  assert.equal(completion.action, `${SITE}/oauth/authorize/complete`, "a decision goes back to the issuer, never straight to the app");
  assert.deepEqual(Object.keys(completion.fields).sort(), ["completion", "request"], "and carries no code");
  const response = await test.fetch("/oauth/authorize/complete", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(completion.fields).toString(),
  });
  return { status: response.status, location: response.headers.get("location"), setCookie: response.headers.get("set-cookie"), text: await response.text() };
}

async function codeFor(role: Role, flow: Flow, scopes?: string[]) {
  const completed = await complete(await approve(role, flow, scopes), flow.cookie);
  assert.equal(completed.status, 303, completed.text);
  const url = new URL(completed.location ?? "");
  assert.equal(`${url.origin}${url.pathname}`, new URL(flow.redirectUri).origin + new URL(flow.redirectUri).pathname);
  assert.equal(url.searchParams.get("state"), flow.state, "state comes back");
  assert.equal(url.searchParams.get("iss"), SITE, "RFC 9207 iss");
  assert.match(completed.setCookie ?? "", /Max-Age=0/, "the binding cookie is cleared");
  return url.searchParams.get("code") ?? "";
}
const exchange = (flow: Flow, code: string, overrides: Record<string, string> = {}) => form("/oauth/token", {
  grant_type: "authorization_code", code, redirect_uri: flow.redirectUri, client_id: flow.clientId, code_verifier: flow.verifier, resource: RESOURCE, ...overrides,
});
const refresh = (clientId: string, refreshToken: string, overrides: Record<string, string> = {}) =>
  form("/oauth/token", { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource: RESOURCE, ...overrides });
type Tokens = { access_token: string; refresh_token: string; expires_in: number; scope: string; token_type: string };
async function connect(role: Role, clientId = CIMD, redirectUri = CLAUDE_CALLBACK, scopes?: string[]) {
  const flow = await startFlow(clientId, redirectUri);
  const response = await exchange(flow, await codeFor(role, flow, scopes));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body as Tokens;
}

// --- Discovery --------------------------------------------------------------------------------------
for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
  const metadata = await getJson(path);
  assert.equal(metadata.status, 200, path);
  assert.equal(metadata.body.resource, RESOURCE);
  assert.deepEqual(metadata.body.authorization_servers, [SITE]);
  assert.deepEqual(metadata.body.scopes_supported, [...CONNECTOR_READ_SCOPES], "clients ask for the read set by default");
  assert.equal(metadata.headers.get("access-control-allow-origin"), "*");
}
const asMetadata = await getJson("/.well-known/oauth-authorization-server");
assert.equal(asMetadata.status, 200);
assert.equal(asMetadata.body.issuer, SITE);
assert.equal(asMetadata.body.authorization_endpoint, `${SITE}/oauth/authorize`);
assert.equal(asMetadata.body.token_endpoint, `${SITE}/oauth/token`);
assert.equal(asMetadata.body.registration_endpoint, `${SITE}/oauth/register`);
assert.deepEqual(asMetadata.body.code_challenge_methods_supported, ["S256"], "S256 only");
assert.equal(asMetadata.body.client_id_metadata_document_supported, true);
assert.ok((asMetadata.body.token_endpoint_auth_methods_supported as string[]).includes("none"), "Claude's CIMD client needs \"none\"");
assert.ok((asMetadata.body.scopes_supported as string[]).includes("offline_access") && (asMetadata.body.scopes_supported as string[]).includes("tasks:write"));
assert.deepEqual((await getJson("/.well-known/oauth-authorization-server/mcp")).body, asMetadata.body, "path-suffixed variant");

const challenge = await rpc(null, "ping");
assert.equal(challenge.status, 401);
const wwwAuthenticate = challenge.headers.get("www-authenticate") ?? "";
assert.match(wwwAuthenticate, /^Bearer realm="societyer-mcp"/);
assert.ok(wwwAuthenticate.includes(`resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp"`), wwwAuthenticate);
assert.ok(wwwAuthenticate.includes(`scope="${CONNECTOR_READ_SCOPES.join(" ")}"`));

process.env.SOCIETYER_MCP_OAUTH = "0";
assert.equal((await getJson("/.well-known/oauth-protected-resource/mcp")).status, 404, "off switch");
assert.equal((await getJson("/.well-known/oauth-authorization-server")).status, 404);
assert.equal((await rpc(null, "ping")).headers.get("www-authenticate"), 'Bearer realm="societyer-mcp"', "no resource_metadata while off");
delete process.env.SOCIETYER_MCP_OAUTH;

// --- Client ID Metadata Documents --------------------------------------------------------------------
const baseParams = (clientId: string, redirectUri = CLAUDE_CALLBACK) => ({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: "A".repeat(43), code_challenge_method: "S256", state: "s1" });
for (const privateId of ["https://127.0.0.1/client.json", "https://10.0.0.5/client.json", "https://169.254.169.254/latest/meta-data", "https://metadata.google.internal/client.json", "https://intranet/client.json"]) {
  const before = fetched.length;
  const refused = await authorize(baseParams(privateId));
  assert.equal(refused.status, 400, `${privateId} is refused`);
  assert.equal(refused.location, null, "never redirected");
  assert.equal(fetched.length, before, `${privateId} is never fetched`);
  assert.match(refused.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
}
assert.equal((await authorize(baseParams("http://claude-client.example.com/meta"))).status, 400, "http client ids are refused");
const mismatch = await authorize(baseParams(MISMATCH_CIMD));
assert.equal(mismatch.status, 400);
assert.match(mismatch.text, /client_id doesn(&#39;|')t match/);
assert.equal((await authorize(baseParams(BAD_REDIRECT_CIMD, "https://evil.example.test/cb"))).status, 400, "a document can't register a redirect outside the policy");
assert.equal((await authorize(baseParams("https://missing.example.com/client.json"))).status, 400, "an unreachable document");
const wrongRedirect = await authorize(baseParams(CIMD, "https://chatgpt.com/connector_platform_oauth_redirect"));
assert.deepEqual([wrongRedirect.status, wrongRedirect.location], [400, null], "a redirect the client didn't register gets an error page, not a redirect");

await startFlow(CIMD, CLAUDE_CALLBACK);
await startFlow(CIMD, CLAUDE_CALLBACK);
assert.equal(fetched.filter((url) => url === CIMD).length, 1, "the document is fetched once and cached");

// Parameter errors after the redirect URI checks out go back to the client.
const redirected = async (params: AuthorizeParams) => {
  const response = await authorize({ ...baseParams(CIMD), resource: RESOURCE, ...params });
  assert.equal(response.status, 302);
  const url = new URL(response.location ?? "");
  assert.equal(`${url.origin}${url.pathname}`, CLAUDE_CALLBACK);
  assert.equal(url.searchParams.get("state"), "s1");
  return url.searchParams.get("error");
};
assert.equal(await redirected({ code_challenge: undefined }), "invalid_request", "PKCE is required");
assert.equal(await redirected({ code_challenge_method: "plain" }), "invalid_request", "plain PKCE is refused");
assert.equal(await redirected({ response_type: "token" }), "unsupported_response_type");
assert.equal(await redirected({ resource: "https://other.example.test/mcp" }), "invalid_target", "wrong resource");
const duplicate = await test.fetch(`/oauth/authorize?client_id=${encodeURIComponent(CIMD)}&client_id=x`, { method: "GET" });
assert.equal(duplicate.status, 400, "repeated parameters");

// Loopback (Claude Code, Codex): any port, same host and path.
await startFlow(CLI_CIMD, "http://localhost:53123/callback");
assert.equal((await authorize(baseParams(CLI_CIMD, "http://localhost:53123/other"))).status, 400);

// --- Dynamic client registration -----------------------------------------------------------------------
const register = async (body: unknown) => {
  const response = await test.fetch("/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Json };
};
const registered = await register({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
assert.equal(registered.status, 201, JSON.stringify(registered.body));
const dcrClientId = String(registered.body.client_id);
assert.match(dcrClientId, /^soc_dcr_/);
assert.equal(registered.body.client_secret, undefined, "public clients get no secret");
assert.equal((await register({ redirect_uris: ["https://evil.example.test/cb"] })).body.error, "invalid_redirect_uri");
assert.equal((await register({ redirect_uris: [] })).status, 400);
assert.equal((await register({ redirect_uris: [CLAUDE_CALLBACK], grant_types: ["client_credentials"] })).body.error, "invalid_client_metadata");
const confidential = await register({ client_name: "Server app", redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: "client_secret_post" });
assert.equal(confidential.status, 201);
const secret = String(confidential.body.client_secret);
assert.match(secret, /^soc_dcs_/);
const storedClient = await test.run((ctx) => ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", String(confidential.body.client_id))).unique());
assert.equal(storedClient?.clientSecretHash, await hashOpaque(secret), "only the secret's hash is stored");
assert.ok(!JSON.stringify(storedClient).includes(secret));
await test.run(async (ctx) => {
  assert.equal(await ctx.db.query("authRateLimits").withIndex("by_key", (q) => q.eq("key", "mcp-oauth-register:all")).unique(), null, "no deployment-wide registration cap for one caller to drain (L1)");
  const bucket = await ctx.db.query("authRateLimits").withIndex("by_key", (q) => q.eq("key", "mcp-oauth-register:unknown-ip")).unique();
  assert.ok(bucket, "without a client IP, registrations share one bucket instead of going unlimited");
  await ctx.db.patch(bucket._id, { tokens: 0, updatedAtMs: Date.now() });
});
const limited = await register({ redirect_uris: [CLAUDE_CALLBACK] });
assert.equal(limited.status, 429, "registration is rate-limited");
await test.run(async (ctx) => {
  const row = await ctx.db.query("authRateLimits").withIndex("by_key", (q) => q.eq("key", "mcp-oauth-register:unknown-ip")).unique();
  if (row) await ctx.db.delete(row._id);
});

// --- Consent ---------------------------------------------------------------------------------------------
const first = await startFlow(CIMD, CLAUDE_CALLBACK);
await assert.rejects(test.action(api.mcpOAuth.consentDetails, { request: first.request }), /Sign in/, "consent needs a signed-in person");
const offView = await details("Owner", first.request);
assert.equal(offView.status, "pending");
assert.deepEqual([offView.client?.name, offView.client?.host, offView.client?.declaredHost, offView.client?.registration, offView.client?.redirectHost], ["Claude", "claude-client.example.com", null, "cimd", "claude.ai"]);
assert.deepEqual(offView.workspaces.map((workspace) => [workspace.name, workspace.connectorsEnabled]), [["Another society", false], ["OAuth test society", false]]);
await assert.rejects(approve("Owner", first), /turned off/, "no consent while the workspace opt-in is off");
await as("Admin").mutation(api.agentConnectors.setEnabled, { societyId, enabled: true });

const outsiderView = await details("Outsider", first.request);
assert.deepEqual(outsiderView.workspaces.map((workspace) => workspace.societyId), [otherId], "only the person's own workspaces are offered");
await assert.rejects(approve("Outsider", first), /aren't an active member/, "consent requires membership");
await assert.rejects(approve("Member", first, ["tasks:write"]), /role doesn't include tasks:write/, "no scope beyond the role");
await assert.rejects(approve("Owner", first, ["minutes:write"]), /can't use minutes:write/);
await assert.rejects(approve("Owner", first, []), /at least one/);
const memberView = await details("Member", first.request);
assert.deepEqual(memberView.requestedScopes.sort(), [...CONNECTOR_READ_SCOPES].sort());
assert.equal(memberView.workspaces[0].scopeOptions.find((scope) => scope.permission === "deadlines:read")?.held, false, "the consent page shows what the role holds");

// --- Full flow: code + PKCE → tokens → /mcp ------------------------------------------------------------------
const code = await codeFor("Owner", first);
assert.match(code, /^soc_mac_/);
await assert.rejects(approve("Owner", first), /already answered/, "a request is decided once");
const tokenResponse = await exchange(first, code);
assert.equal(tokenResponse.status, 200, JSON.stringify(tokenResponse.body));
assert.equal(tokenResponse.headers.get("cache-control"), "no-store");
const tokens = tokenResponse.body as Tokens;
assert.match(tokens.access_token, /^soc_mat_/);
assert.match(tokens.refresh_token, /^soc_mrt_/);
assert.equal(tokens.token_type, "Bearer");
assert.ok(tokens.expires_in > 3500 && tokens.expires_in <= 3600, "one-hour access tokens");
assert.deepEqual(tokens.scope.split(" ").sort(), [...CONNECTOR_READ_SCOPES].sort());

const init = await rpc(tokens.access_token, "initialize", { protocolVersion: MCP_LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "check", version: "1" } });
assert.equal(init.status, 200, JSON.stringify(init.body));
assert.equal(((init.body?.result as Json).serverInfo as Json).name, "societyer");
const ownerTools = await toolNames(tokens.access_token);
assert.ok(ownerTools.includes("list_meetings") && ownerTools.includes("list_deadlines"));
assert.ok(!ownerTools.includes("create_governance_tasks"), "read-only unless the draft scope was chosen");
const called = await rpc(tokens.access_token, "tools/call", { name: "list_meetings", arguments: {} });
const callResult = called.body?.result as { isError: boolean; structuredContent: { meetings: { title: unknown }[] } };
assert.equal(callResult.isError, false);
assert.equal(callResult.structuredContent.meetings.length, 1);

const grant = await test.run((ctx) => ctx.db.query("agentGrants").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()).then((rows) => rows.find((row) => row.kind === "oauth"));
assert.ok(grant, "approval created an agentGrants row");
assert.deepEqual([grant.kind, grant.userId, grant.oauthClientId, grant.oauthClientHost, grant.tokenHash], ["oauth", users.Owner, CIMD, "claude-client.example.com", undefined]);
const stored = await test.run((ctx) => Promise.all([ctx.db.query("mcpOAuthTokens").collect(), ctx.db.query("mcpOAuthRequests").collect()]));
const storedText = JSON.stringify(stored);
for (const value of [tokens.access_token, tokens.refresh_token, code, first.request, first.verifier]) assert.ok(!storedText.includes(value), "secrets are stored only as hashes");
assert.ok(stored[0].every((row) => /^[a-f0-9]{64}$/.test(row.accessTokenHash) && /^[a-f0-9]{64}$/.test(row.refreshTokenHash)));

const overview = await as("Owner").query(api.agentConnectors.overview, { societyId });
const listedGrant = overview.grants.find((entry: { kind: string }) => entry.kind === "oauth") as { name: string; clientHost?: string } | undefined;
assert.deepEqual([listedGrant?.name, listedGrant?.clientHost], ["Claude", "claude-client.example.com"], "OAuth grants are listed with personal tokens");
assert.equal(overview.oauthAvailable, true);

// --- Code failures ----------------------------------------------------------------------------------------------
const tokenError = (response: { status: number; body: Json }) => [response.status, response.body.error];
const wrongVerifier = await startFlow(CIMD, CLAUDE_CALLBACK);
const wrongVerifierCode = await codeFor("Owner", wrongVerifier);
assert.deepEqual(tokenError(await exchange(wrongVerifier, wrongVerifierCode, { code_verifier: `other-${"y".repeat(50)}` })), [400, "invalid_grant"], "wrong code_verifier");
assert.deepEqual(tokenError(await exchange(wrongVerifier, wrongVerifierCode)), [400, "invalid_grant"], "a failed attempt spends the code");

const wrongRedirectFlow = await startFlow(CLI_CIMD, "http://localhost:50000/callback");
const wrongRedirectCode = await codeFor("Owner", wrongRedirectFlow);
assert.deepEqual(tokenError(await exchange(wrongRedirectFlow, wrongRedirectCode, { redirect_uri: "http://localhost:50001/callback" })), [400, "invalid_grant"], "redirect_uri must match the request exactly");

const wrongResource = await startFlow(CIMD, CLAUDE_CALLBACK);
assert.deepEqual(tokenError(await exchange(wrongResource, await codeFor("Owner", wrongResource), { resource: "https://other.example.test/mcp" })), [400, "invalid_target"], "wrong resource at the token endpoint");

const wrongClient = await startFlow(CIMD, CLAUDE_CALLBACK);
assert.deepEqual(tokenError(await exchange(wrongClient, await codeFor("Owner", wrongClient), { client_id: CLI_CIMD })), [400, "invalid_grant"], "a code is bound to its client");

const expired = await startFlow(CIMD, CLAUDE_CALLBACK);
const expiredCode = await codeFor("Owner", expired);
await test.run(async (ctx) => {
  const request = (await ctx.db.query("mcpOAuthRequests").collect()).find((entry) => entry.state === expired.state);
  if (request) await ctx.db.patch(request._id, { codeExpiresAtMs: Date.now() - 1 });
});
assert.deepEqual(tokenError(await exchange(expired, expiredCode)), [400, "invalid_grant"], "expired code");

const replay = await startFlow(CIMD, CLAUDE_CALLBACK);
const replayCode = await codeFor("Owner", replay);
const replayTokens = (await exchange(replay, replayCode)).body as Tokens;
assert.equal((await rpc(replayTokens.access_token, "ping")).status, 200);
assert.deepEqual(tokenError(await exchange(replay, replayCode)), [400, "invalid_grant"], "a code works once");
assert.equal((await rpc(replayTokens.access_token, "ping")).status, 401, "replaying a code revokes what it issued");
assert.equal((await form("/oauth/token", { grant_type: "authorization_code", code: replayCode })).status, 401, "no client_id");
assert.deepEqual(tokenError(await form("/oauth/token", { grant_type: "password", client_id: CIMD })), [400, "unsupported_grant_type"]);
const jsonBody = await test.fetch("/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
assert.equal(jsonBody.status, 400, "the token endpoint takes form posts");

// Confidential DCR clients authenticate.
const confidentialId = String(confidential.body.client_id);
const confidentialFlow = await startFlow(confidentialId, CLAUDE_CALLBACK);
const confidentialCode = await codeFor("Owner", confidentialFlow);
assert.deepEqual(tokenError(await exchange(confidentialFlow, confidentialCode)), [401, "invalid_client"], "a confidential client needs its secret");
const dcrFlow = await startFlow(dcrClientId, "https://chatgpt.com/connector_platform_oauth_redirect");
const dcrView = (await details("Owner", dcrFlow.request)).client;
assert.equal(dcrView?.registration, "dcr", "the consent page marks self-registered clients");
assert.equal(dcrView?.host, null, "a self-registered client has no verified publisher (L4)");

// --- Refresh rotation and reuse detection ----------------------------------------------------------------------------
const rotated = await refresh(CIMD, tokens.refresh_token);
assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
const second = rotated.body as Tokens;
assert.notEqual(second.refresh_token, tokens.refresh_token, "refresh tokens rotate");
assert.equal((await rpc(second.access_token, "ping")).status, 200);
assert.deepEqual(tokenError(await refresh(CIMD, second.refresh_token, { scope: "tasks:write" })), [400, "invalid_scope"], "a refresh can't add scopes");
assert.deepEqual(tokenError(await refresh(CIMD, second.refresh_token, { resource: "https://other.example.test/mcp" })), [400, "invalid_target"]);
assert.deepEqual(tokenError(await refresh(CLI_CIMD, second.refresh_token)), [400, "invalid_grant"], "a refresh token is bound to its client");
assert.deepEqual(tokenError(await refresh(CIMD, tokens.refresh_token)), [400, "invalid_grant"], "a rotated refresh token is refused");
assert.equal((await rpc(second.access_token, "ping")).status, 401, "reuse revokes the whole family");
assert.deepEqual(tokenError(await refresh(CIMD, second.refresh_token)), [400, "invalid_grant"]);

// --- Audience, expiry and RFC 7009 -------------------------------------------------------------------------------------
const audience = await connect("Owner");
assert.equal((await rpc(audience.access_token, "ping")).status, 200);
await test.run(async (ctx) => {
  const hash = await hashOpaque(audience.access_token);
  const token = await ctx.db.query("mcpOAuthTokens").withIndex("by_access_hash", (q) => q.eq("accessTokenHash", hash)).unique();
  if (token) await ctx.db.patch(token._id, { resource: "https://other.example.test/mcp" });
});
const wrongAudience = await rpc(audience.access_token, "ping");
assert.equal(wrongAudience.status, 401, "a token for another resource is refused");
assert.match(wrongAudience.headers.get("www-authenticate") ?? "", /error="invalid_token"/);

const expiring = await connect("Owner");
await test.run(async (ctx) => {
  const hash = await hashOpaque(expiring.access_token);
  const row = await ctx.db.query("mcpOAuthTokens").withIndex("by_access_hash", (q) => q.eq("accessTokenHash", hash)).unique();
  if (row) await ctx.db.patch(row._id, { accessExpiresAtMs: Date.now() - 1 });
});
assert.equal((await rpc(expiring.access_token, "ping")).status, 401, "expired access token");
const renewed = (await refresh(CIMD, expiring.refresh_token)).body as Tokens;
assert.equal((await rpc(renewed.access_token, "ping")).status, 200, "the client refreshes after expiry");

const revocable = await connect("Owner");
const revocation = await form("/oauth/revoke", { token: revocable.access_token, client_id: CIMD });
assert.equal(revocation.status, 200);
assert.equal((await rpc(revocable.access_token, "ping")).status, 401, "RFC 7009 revocation");
assert.equal((await form("/oauth/revoke", { token: "soc_mat_unknown", client_id: CIMD })).status, 200, "unknown tokens aren't an error");

// --- Opt-in, demotion and revoking the grant ------------------------------------------------------------------------------
const live = await connect("Owner");
await as("Owner").mutation(api.agentConnectors.setEnabled, { societyId, enabled: false });
const off = await rpc(live.access_token, "tools/list");
assert.equal(off.status, 403, "the workspace opt-in gates OAuth tokens too");
assert.deepEqual(tokenError(await refresh(CIMD, live.refresh_token)), [400, "invalid_grant"], "no refresh while connectors are off");
await as("Owner").mutation(api.agentConnectors.setEnabled, { societyId, enabled: true });

const admin = await connect("Admin", CLI_CIMD, "http://127.0.0.1:41000/callback");
assert.ok((await toolNames(admin.access_token)).includes("list_deadlines"));
await test.run((ctx) => ctx.db.patch(users.Admin, { role: "Member" }));
assert.ok(!(await toolNames(admin.access_token)).includes("list_deadlines"), "a demotion narrows an OAuth grant on the next call");
await test.run((ctx) => ctx.db.patch(users.Admin, { role: "Admin" }));

const before = await connect("Member");
assert.equal((await rpc(before.access_token, "ping")).status, 200);
const memberGrant = (await as("Member").query(api.agentConnectors.overview, { societyId })).grants.find((entry: { kind: string }) => entry.kind === "oauth") as { _id: Id<"agentGrants"> };
await as("Member").mutation(api.agentConnectors.revokeToken, { grantId: memberGrant._id });
assert.equal((await rpc(before.access_token, "ping")).status, 401, "disconnecting stops the access token");
assert.deepEqual(tokenError(await refresh(CIMD, before.refresh_token)), [400, "invalid_grant"], "and the refresh token");

// Reconnecting the same client to the same workspace updates one grant, and adds a visible session.
type ListedGrant = { _id: Id<"agentGrants">; kind: string; revokedAtISO?: string; scopes: string[]; sessions?: { familyId: string; clientName: string; redirectHost: string; createdAtISO: string; lastUsedAtISO?: string }[] };
const liveOAuthGrants = async (role: Role) => ((await as(role).query(api.agentConnectors.overview, { societyId })).grants as ListedGrant[]).filter((entry) => entry.kind === "oauth" && !entry.revokedAtISO);
const ownerGrantsBefore = await liveOAuthGrants("Owner");
const claudeSessionsBefore = ownerGrantsBefore.find((entry) => entry.sessions?.some((session) => session.clientName === "Claude"))?.sessions?.length ?? 0;
const reconnected = await connect("Owner", CIMD, CLAUDE_CALLBACK, ["meetings:read", "tasks:write"]);
const ownerGrants = await liveOAuthGrants("Owner");
assert.equal(ownerGrants.length, ownerGrantsBefore.length, "one grant per person, workspace and app");
assert.ok(ownerGrants.some((entry) => entry.scopes.includes("tasks:write")), "the draft scope only when chosen");
const claudeGrant = ownerGrants.find((entry) => entry.sessions?.some((session) => session.clientName === "Claude"));
assert.ok(claudeGrant?.sessions, "the card lists the app's sessions");
assert.equal(claudeGrant.sessions.length, claudeSessionsBefore + 1, "a new consent shows up as a new session, not merged out of sight (M1)");
assert.deepEqual(Object.keys(claudeGrant.sessions[0]).sort(), ["clientName", "createdAtISO", "expiresAtISO", "familyId", "redirectHost"], "sessions show when, which app and where; never token hashes");
assert.equal(claudeGrant.sessions[0].redirectHost, "claude.ai");
await rpc(reconnected.access_token, "ping");
const usedSession = (await liveOAuthGrants("Owner")).find((entry) => entry._id === claudeGrant._id)?.sessions?.[0];
assert.ok(usedSession?.lastUsedAtISO, "a session records when it was last used");

// Revoking one session leaves the app's other sessions working.
const otherSession = await connect("Owner");
const target = (await liveOAuthGrants("Owner")).find((entry) => entry._id === claudeGrant._id)?.sessions?.[0];
assert.ok(target);
await as("Owner").mutation(api.agentConnectors.revokeToken, { grantId: claudeGrant._id, familyId: target.familyId });
assert.equal((await rpc(otherSession.access_token, "ping")).status, 401, "the revoked session stops at once");
assert.equal((await rpc(reconnected.access_token, "ping")).status, 200, "the app's other sessions keep working");
assert.ok(!(await liveOAuthGrants("Owner")).find((entry) => entry._id === claudeGrant._id)?.sessions?.some((session) => session.familyId === target.familyId), "and it leaves the list");
await assert.rejects(as("Member").mutation(api.agentConnectors.revokeToken, { grantId: claudeGrant._id, familyId: target.familyId }), /not found/, "only the owner of a grant (or an Admin) revokes its sessions");

// --- Security review fixes ------------------------------------------------------------------------------------------------------
// M1: an attacker starts a flow (their client holds the verifier and the binding cookie) and forwards the consent
// link. The victim approves it in their own browser, which has no binding cookie: nothing is granted.
const auditCount = async (eventType: string) => (await test.run((ctx) => ctx.db.query("aiAgentAuditEvents").withIndex("by_society_agent", (q) => q.eq("societyId", societyId).eq("agentKey", "mcp_connector")).collect()))
  .filter((row) => row.eventType === eventType).length;
const grantsBeforePhish = (await liveOAuthGrants("Member")).length;
const phished = await startFlow(CIMD, CLAUDE_CALLBACK);
const phishedApproval = await approve("Member", phished);
assert.ok(!JSON.stringify(phishedApproval).includes("soc_mac_"), "approving returns no code (M1)");
const bindingFailuresBefore = await auditCount("oauth_consent_binding_failed");
const victimBrowser = await complete(phishedApproval);
assert.deepEqual([victimBrowser.status, victimBrowser.location], [400, null], "a browser without the binding cookie can't complete the request");
assert.match(victimBrowser.text, /browser where you started/);
assert.equal(await auditCount("oauth_consent_binding_failed"), bindingFailuresBefore + 1, "and it is audited as a possible forwarded link");
assert.equal((await liveOAuthGrants("Member")).length, grantsBeforePhish, "no grant was created");
const attackerBrowser = await complete(phishedApproval, phished.cookie);
assert.deepEqual([attackerBrowser.status, /out of date/.test(attackerBrowser.text)], [400, true], "the victim's approval was discarded: the starting browser can't use it either");
const wrongCookie = await startFlow(CIMD, CLAUDE_CALLBACK);
const otherBinding = await startFlow(CIMD, CLAUDE_CALLBACK);
assert.equal((await complete(await approve("Member", wrongCookie), `${wrongCookie.cookie.split("=")[0]}=${otherBinding.cookie.split("=")[1]}`)).status, 400, "another request's nonce doesn't bind");
const staleDecision = await startFlow(CIMD, CLAUDE_CALLBACK);
const firstChoice = await approve("Member", staleDecision);
await approve("Member", staleDecision);
const outdated = await complete(firstChoice, staleDecision.cookie);
assert.deepEqual([outdated.status, /out of date/.test(outdated.text), outdated.setCookie], [400, true, null], "only the latest decision completes; the binding survives");

// L3: someone who learns a pending request's handle can't deny it for the person who started it.
const pendingFlow = await startFlow(CIMD, CLAUDE_CALLBACK);
const strangerDeny = await as("Outsider").action(api.mcpOAuth.deny, { request: pendingFlow.request });
const strangerCompletion = await complete(strangerDeny);
assert.deepEqual([strangerCompletion.status, strangerCompletion.location], [400, null], "a denial without the binding cookie sends nothing to the app");
assert.equal((await details("Member", pendingFlow.request)).status, "pending", "the request stays open for the person who started it");
assert.match(await codeFor("Member", pendingFlow), /^soc_mac_/, "who can still approve it");
await assert.rejects(as("Outsider").action(api.mcpOAuth.deny, { request: (await startFlow(CIMD, CLAUDE_CALLBACK)).request, societyId }), /aren't an active member/, "a denial names only the decider's own workspace");
const deniedBefore = await auditCount("oauth_consent_denied");
const declined = await startFlow(CIMD, CLAUDE_CALLBACK);
const declinedCompletion = await complete(await as("Member").action(api.mcpOAuth.deny, { request: declined.request, societyId }), declined.cookie);
assert.equal(declinedCompletion.status, 303);
const deniedRedirect = new URL(declinedCompletion.location ?? "");
assert.deepEqual([deniedRedirect.searchParams.get("error"), deniedRedirect.searchParams.get("state"), deniedRedirect.searchParams.get("iss")], ["access_denied", declined.state, SITE]);
assert.equal(await auditCount("oauth_consent_denied"), deniedBefore + 1, "a denial is audited (L6)");

// --- Security review round 2 ------------------------------------------------------------------------------------------------
const deploymentEvents = async (eventType: string) => (await test.run((ctx) => ctx.db.query("mcpOAuthEvents").collect())).filter((row) => row.eventType === eventType);

// Item 2a: completion is a POST from the app's origin; any other origin (or none, or "null") is refused and logged.
const csrfFlow = await startFlow(CIMD, CLAUDE_CALLBACK);
const csrfApproval = await approve("Member", csrfFlow);
const crossSiteBefore = (await deploymentEvents("completion_cross_site")).length;
for (const origin of ["https://evil.example.test", "null", null]) {
  const forged = await complete(csrfApproval, csrfFlow.cookie, origin);
  assert.deepEqual([forged.status, forged.location], [403, null], `a completion posted from ${origin ?? "no origin"} is refused, even with the cookie and token`);
}
const crossSiteRows = await deploymentEvents("completion_cross_site");
assert.equal(crossSiteRows.length, crossSiteBefore + 1, "cross-site completions are logged at the deployment level (item 5), once per caller per hour (round 3)");
assert.equal(crossSiteRows.at(-1)?.count, 3, "with a count of the rest");
assert.ok(crossSiteRows.every((row) => row.throttleKeyHash && /^[a-f0-9]{64}$/.test(row.throttleKeyHash)), "keyed by a hash, never the caller's address");
for (let i = 0; i < 20; i += 1) await complete(csrfApproval, undefined, "https://evil.example.test");
assert.deepEqual([(await deploymentEvents("completion_cross_site")).length, (await deploymentEvents("completion_cross_site")).at(-1)?.count], [crossSiteBefore + 1, 23], "a flood of bad POSTs adds no rows");
await test.run(async (ctx) => {
  const row = (await ctx.db.query("mcpOAuthEvents").collect()).filter((entry) => entry.eventType === "completion_cross_site").at(-1);
  if (row) await ctx.db.patch(row._id, { createdAtMs: row.createdAtMs - 2 * 3_600_000 });
});
await complete(csrfApproval, undefined, "https://evil.example.test");
assert.equal((await deploymentEvents("completion_cross_site")).length, crossSiteBefore + 2, "the next hour logs again");
const getCompletion = await test.fetch(`/oauth/authorize/complete?${new URLSearchParams(csrfApproval.fields)}`, { method: "GET", headers: { Cookie: csrfFlow.cookie } });
assert.ok(getCompletion.status >= 400 && !getCompletion.headers.get("location"), "there is no GET completion a link could trigger");
assert.match(await codeFor("Member", csrfFlow), /^soc_mac_/, "from the consent page itself it completes");

// Item 2b/c (retest B): someone who learns a pending request's link decides first, into their own workspace. Their
// decision can't be replaced by, or completed in, the browser that started it; the starter's own decision is refused.
await as("Outsider").mutation(api.agentConnectors.setEnabled, { societyId: otherId, enabled: true });
const leaked = await startFlow(CIMD, CLAUDE_CALLBACK);
const hijack = await as("Outsider").action(api.mcpOAuth.approve, { request: leaked.request, societyId: otherId, scopes: ["meetings:read"] });
assert.deepEqual([(await complete(hijack, leaked.cookie, "https://evil.example.test")).status], [403], "the attacker can't make the starting browser post their decision");
await assert.rejects(approve("Member", leaked), /Someone else already answered/, "the first decision belongs to its decider (item 2b)");
await assert.rejects(as("Member").action(api.mcpOAuth.deny, { request: leaked.request, societyId }), /Someone else already answered/);
await test.run(async (ctx) => {
  const row = (await ctx.db.query("mcpOAuthRequests").collect()).find((entry) => entry.state === leaked.state);
  assert.ok(row?.decision?.deciderSubject === "outsider" && row.decision.userId, "the decision records who decided");
});
await approve("Member", wrongCookie, ["meetings:read", "minutes:read"]);
assert.equal((await complete(await approve("Member", wrongCookie), wrongCookie.cookie)).status, 303, "the decider may change their own decision before completing");

// Item 3: requests last ten minutes.
await test.run(async (ctx) => {
  const row = (await ctx.db.query("mcpOAuthRequests").collect()).find((entry) => entry.state === leaked.state);
  assert.equal((row?.expiresAtMs ?? 0) - (row?.createdAtMs ?? 0), 10 * 60_000, "a request lasts ten minutes");
});

// Item 5: a decline or a binding failure with no workspace to audit in is kept at the deployment level.
const declinedNoWorkspace = (await deploymentEvents("consent_denied")).length;
const noWorkspaceFlow = await startFlow(CIMD, CLAUDE_CALLBACK);
assert.equal((await complete(await as("Outsider").action(api.mcpOAuth.deny, { request: noWorkspaceFlow.request }), noWorkspaceFlow.cookie)).status, 303);
assert.equal((await deploymentEvents("consent_denied")).length, declinedNoWorkspace + 1, "a decline with no workspace is logged");
const strayBefore = (await deploymentEvents("consent_binding_failed")).length;
const strayFlow = await startFlow(CIMD, CLAUDE_CALLBACK);
await complete(await as("Outsider").action(api.mcpOAuth.deny, { request: strayFlow.request }));
assert.equal((await deploymentEvents("consent_binding_failed")).length, strayBefore + 1, "a binding failure with no workspace is logged");
assert.ok((await deploymentEvents("client_registered")).length >= 2, "registrations are logged");
const eventText = JSON.stringify(await test.run((ctx) => ctx.db.query("mcpOAuthEvents").collect()));
for (const value of [strayFlow.request, strayFlow.cookie.split("=")[1], hijack.fields.completion]) assert.ok(!eventText.includes(value), "no secrets in deployment events");

// L6 and info: failed exchanges are audited as possible interception; a replay by another client doesn't revoke.
const failedBefore = await auditCount("oauth_code_exchange_failed");
const intercepted = await startFlow(CIMD, CLAUDE_CALLBACK);
assert.deepEqual(tokenError(await exchange(intercepted, await codeFor("Owner", intercepted), { code_verifier: `stolen-${"z".repeat(50)}` })), [400, "invalid_grant"]);
assert.equal(await auditCount("oauth_code_exchange_failed"), failedBefore + 1, "a wrong verifier is audited (L6)");
const failedRow = (await test.run((ctx) => ctx.db.query("aiAgentAuditEvents").withIndex("by_society_agent", (q) => q.eq("societyId", societyId).eq("agentKey", "mcp_connector")).collect()))
  .filter((row) => row.eventType === "oauth_code_exchange_failed").at(-1);
assert.deepEqual([failedRow?.metadata?.reason, failedRow?.metadata?.possibleInterception], ["wrong_verifier", true]);
const replayedElsewhere = await startFlow(CIMD, CLAUDE_CALLBACK);
const replayedCode = await codeFor("Owner", replayedElsewhere);
const replayedTokens = (await exchange(replayedElsewhere, replayedCode)).body as Tokens;
assert.deepEqual(tokenError(await exchange(replayedElsewhere, replayedCode, { client_id: CLI_CIMD })), [400, "invalid_grant"]);
assert.equal((await rpc(replayedTokens.access_token, "ping")).status, 200, "a used code presented by another client doesn't revoke the real client's tokens");
assert.deepEqual(tokenError(await exchange(replayedElsewhere, replayedCode)), [400, "invalid_grant"]);
assert.equal((await rpc(replayedTokens.access_token, "ping")).status, 401, "presented again by its own client, it does (RFC 6749 §4.1.2)");
const revokedBefore = await auditCount("oauth_token_revoked");
const selfRevoked = await connect("Owner");
await form("/oauth/revoke", { token: selfRevoked.refresh_token, client_id: CIMD });
assert.equal(await auditCount("oauth_token_revoked"), revokedBefore + 1, "RFC 7009 revocation is audited (L6)");
const badBasic = await form("/oauth/token", { grant_type: "refresh_token", refresh_token: selfRevoked.refresh_token }, { Authorization: `Basic ${btoa("%E0%A4%A:secret")}` });
assert.deepEqual(tokenError(badBasic), [401, "invalid_client"], "malformed percent-encoding in Basic auth is invalid_client, not a 500");
const streamed = await test.fetch("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=refresh_token&pad=${"x".repeat(20_000)}` });
assert.equal(streamed.status, 400, "a body past the limit is refused while it is read, with no Content-Length");
assert.match(String(((await streamed.json()) as Json).error_description), /too large/);

// L2: a metadata document that now answers 404 (or 410) removes the cached client; a 5xx keeps the stale copy.
const GONE_CIMD = "https://gone.example.com/client.json";
const FLAKY_CIMD = "https://flaky.example.com/client.json";
documents[GONE_CIMD] = { client_id: GONE_CIMD, client_name: "Gone", redirect_uris: [CLAUDE_CALLBACK] };
documents[FLAKY_CIMD] = { client_id: FLAKY_CIMD, client_name: "Flaky", redirect_uris: [CLAUDE_CALLBACK] };
await startFlow(GONE_CIMD, CLAUDE_CALLBACK);
await startFlow(FLAKY_CIMD, CLAUDE_CALLBACK);
await test.run(async (ctx) => {
  for (const clientId of [GONE_CIMD, FLAKY_CIMD]) {
    const row = await ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", clientId)).unique();
    if (row) await ctx.db.patch(row._id, { refreshAfterMs: Date.now() - 1 });
  }
});
delete documents[GONE_CIMD];
const gone = await authorize(baseParams(GONE_CIMD));
assert.deepEqual([gone.status, gone.location], [400, null], "a removed metadata document is refused, not served from the cache");
assert.match(gone.text, /no longer exists/);
assert.equal(await test.run((ctx) => ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", GONE_CIMD)).unique()), null, "and its cached copy is deleted");
serverErrors.add(FLAKY_CIMD);
assert.equal((await authorize({ ...baseParams(FLAKY_CIMD), resource: RESOURCE })).status, 302, "a 5xx while the cache is stale still uses the stale copy");
serverErrors.delete(FLAKY_CIMD);

// L1: without a client IP, authorization requests share one bucket instead of going unlimited.
await test.run(async (ctx) => {
  const bucket = await ctx.db.query("authRateLimits").withIndex("by_key", (q) => q.eq("key", "mcp-oauth-authorize:unknown-ip")).unique();
  assert.ok(bucket, "authorize spends from the unknown-IP bucket when Convex can't say who is calling");
  await ctx.db.patch(bucket._id, { tokens: 1, updatedAtMs: Date.now() });
});
assert.equal((await authorize(baseParams(CIMD))).status, 302);
assert.equal((await authorize(baseParams(CIMD))).status, 429, "an empty bucket refuses with 429");
await test.run(async (ctx) => {
  const row = await ctx.db.query("authRateLimits").withIndex("by_key", (q) => q.eq("key", "mcp-oauth-authorize:unknown-ip")).unique();
  if (row) await ctx.db.delete(row._id);
});

// L1: the daily clean-up drops ended rows and unused clients, and keeps what's live.
const WEEK_MS = 7 * 86_400_000;
const stale = await test.run(async (ctx) => {
  const long = Date.now() - WEEK_MS - 86_400_000;
  const unused = await ctx.db.insert("mcpOAuthClients", { clientId: "soc_dcr_unused", registration: "dcr", clientName: "Never used", redirectUris: [CLAUDE_CALLBACK], tokenEndpointAuthMethod: "none", createdAtISO: new Date(long).toISOString(), lastActiveAtMs: long });
  const usedClient = await ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", CIMD)).unique();
  if (usedClient) await ctx.db.patch(usedClient._id, { lastActiveAtMs: long });
  const event = await ctx.db.insert("mcpOAuthEvents", { eventType: "consent_denied", createdAtMs: long - 30 * 86_400_000 });
  const request = await ctx.db.insert("mcpOAuthRequests", { requestHash: "stale", bindingHash: "stale", clientId: CIMD, redirectUri: CLAUDE_CALLBACK, codeChallenge: "A".repeat(43), requestedScopes: [], resource: RESOURCE, createdAtMs: long, expiresAtMs: long, status: "pending" });
  const grantId = (await ctx.db.query("agentGrants").withIndex("by_oauth_client", (q) => q.eq("oauthClientId", CIMD)).first())!._id;
  const token = (rotated: boolean) => ctx.db.insert("mcpOAuthTokens", { grantId, clientId: CIMD, familyId: "stale-family", accessTokenHash: `a-${rotated}`, accessExpiresAtMs: long, refreshTokenHash: `r-${rotated}`, refreshExpiresAtMs: rotated ? Date.now() + 86_400_000 : long, resource: RESOURCE, scopes: [], createdAtMs: long, ...(rotated ? { rotatedAtMs: long } : {}) });
  return { unused, request, event, rotated: await token(true), expired: await token(false) };
});
const swept = await test.mutation(internal.mcpOAuth.purgeStale, {});
assert.ok(swept.requests >= 1 && swept.tokens >= 2 && swept.clients >= 1, JSON.stringify(swept));
await test.run(async (ctx) => {
  for (const id of [stale.unused, stale.request, stale.rotated, stale.expired, stale.event]) assert.equal(await ctx.db.get(id), null, "ended rows, unused clients and old events are gone");
  const kept = await ctx.db.query("mcpOAuthClients").withIndex("by_client_id", (q) => q.eq("clientId", CIMD)).unique();
  assert.ok(kept && kept.lastActiveAtMs > Date.now() - 60_000, "a client someone connected stays");
});
assert.equal((await rpc(reconnected.access_token, "ping")).status, 200, "live sessions survive the clean-up");

// Round 3, item 2: a backlog bigger than one batch drains in the same hourly run: a full batch chains another
// round at once, up to a cap.
const seedEndedTokens = (count: number) => test.run(async (ctx) => {
  const grantId = (await ctx.db.query("agentGrants").withIndex("by_oauth_client", (q) => q.eq("oauthClientId", CIMD)).first())!._id;
  const long = Date.now() - 30 * 86_400_000;
  for (let i = 0; i < count; i += 1) {
    await ctx.db.insert("mcpOAuthTokens", { grantId, clientId: CIMD, familyId: "backlog", accessTokenHash: `backlog-a-${i}-${Math.random()}`, accessExpiresAtMs: long, refreshTokenHash: `backlog-r-${i}-${Math.random()}`, refreshExpiresAtMs: Date.now() + 86_400_000, resource: RESOURCE, scopes: [], createdAtMs: long, rotatedAtMs: long });
  }
});
const backlogLeft = () => test.run(async (ctx) => (await ctx.db.query("mcpOAuthTokens").withIndex("by_family", (q) => q.eq("familyId", "backlog")).collect()).length);
await seedEndedTokens(450);
const firstRound = await test.mutation(internal.mcpOAuth.purgeStale, {});
assert.deepEqual([firstRound.tokens, firstRound.round, firstRound.continued], [200, 1, true], "a full batch schedules another round");
for (let pump = 0; pump < 20 && (await backlogLeft()) > 0; pump += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await test.finishInProgressScheduledFunctions();
}
assert.equal(await backlogLeft(), 0, "the chained rounds drain the backlog in one run");
await seedEndedTokens(200);
const capped = await test.mutation(internal.mcpOAuth.purgeStale, { round: 25 });
assert.equal(capped.continued, false, "a run stops chaining at its cap; the next hourly run continues");
await test.mutation(internal.mcpOAuth.purgeStale, {});

// --- Audit ----------------------------------------------------------------------------------------------------------------------
const audit = await test.run((ctx) => ctx.db.query("aiAgentAuditEvents").withIndex("by_society_agent", (q) => q.eq("societyId", societyId).eq("agentKey", "mcp_connector")).collect());
for (const eventType of ["oauth_grant_created", "oauth_grant_updated", "oauth_token_issued", "oauth_code_reused", "oauth_refresh_reused", "oauth_grant_revoked", "oauth_session_revoked", "oauth_consent_denied", "oauth_consent_binding_failed", "oauth_code_exchange_failed", "oauth_token_revoked", "tool_call"]) {
  assert.ok(audit.some((row) => row.eventType === eventType), `audited: ${eventType}`);
}
const auditText = JSON.stringify(audit);
for (const value of [tokens.access_token, tokens.refresh_token, code, secret, first.request, phished.request, phished.cookie.split("=")[1], phishedApproval.fields.completion]) {
  assert.ok(!auditText.includes(value), "no secrets in the audit log");
}

globalThis.fetch = realFetch;
console.log(`MCP OAuth checks passed: discovery, CIMD (cached, private hosts refused, removed documents forgotten), DCR, PKCE S256, consent (membership, opt-in, role scopes, bound to the starting browser), sessions per consent, code/refresh failures, rotation with reuse detection, audience, revocation, demotion, throttles and clean-up, ${audit.length} audit rows.`);

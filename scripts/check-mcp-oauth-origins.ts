/**
 * AI connector OAuth on a shared deployment (several `SITE_URL` origins), end
 * to end through the real Convex HTTP routes and consent actions (convex-test):
 *
 *   - each origin's server URL (`<site>/mcp/<host>`) has its own RFC 9728
 *     metadata and 401 challenge, and its sign-in lands on that origin's
 *     consent page;
 *   - the completion is accepted only from the origin stored with the
 *     request: another trusted origin is refused and changes nothing;
 *   - an untrusted or malformed origin in the URL is refused everywhere;
 *   - no hint behaves as before (first `SITE_URL` origin);
 *     SOCIETYER_MCP_OAUTH_CONSENT_URL still wins;
 *   - an access token works only at the URL it was issued for (or anywhere
 *     when bound to `<site>/mcp`);
 *   - Settings → AI connectors shows the URL for the origin it's on.
 *
 * Run: tsx scripts/check-mcp-oauth-origins.ts
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { CONNECTOR_READ_SCOPES } from "../shared/mcp/connectorPolicy";
import { MCP_LATEST_PROTOCOL_VERSION } from "../shared/mcp/server";
import { consentOrigins, mcpOAuthConfig, mcpResource, mcpServerUrlFor, s256Challenge } from "../shared/mcp/oauth";

const SITE = "https://origins-test.convex.site";
const DDC = "https://portal.ddc.test";
const FF = "https://firstform.test";
const BASE = `${SITE}/mcp`;
const DDC_URL = `${SITE}/mcp/portal.ddc.test`;
const FF_URL = `${SITE}/mcp/firstform.test`;
const OVERRIDE = "https://consent.example.test/oauth/consent";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
Object.assign(process.env, {
  AUTH_MODE: "convex", CONVEX_SITE_URL: SITE, SITE_URL: `${DDC},${FF}`,
  BETTER_AUTH_SECRET: "fixture-only-societyer-secret-that-is-not-real", SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT: "1",
});

// --- Pure rules --------------------------------------------------------------------------
{
  const config = mcpOAuthConfig(process.env);
  assert.ok(config);
  assert.deepEqual(config.appOrigins, [DDC, FF]);
  assert.deepEqual([config.consentUrl, config.appOrigin, config.resource, config.consentOverride], [`${DDC}/oauth/consent`, DDC, BASE, false], "no hint: the first origin, as before");
  assert.deepEqual(consentOrigins(config), [DDC, FF]);
  assert.deepEqual(mcpResource(config, FF_URL), { resource: FF_URL, resourceMetadataUrl: `${SITE}/.well-known/oauth-protected-resource/mcp/firstform.test`, consentUrl: `${FF}/oauth/consent`, appOrigin: FF });
  assert.equal(mcpResource(config, `${SITE}/MCP/FirstForm.test/`)?.resource, undefined, "the path is case-sensitive");
  assert.equal(mcpResource(config, `${SITE.toUpperCase()}/mcp/FirstForm.TEST/`)?.resource, FF_URL, "the host hint is case-insensitive; a trailing slash is ignored");
  assert.equal(mcpResource(config, SITE)?.resource, BASE, "the bare issuer is the default");
  for (const refused of [`${SITE}/mcp/evil.test`, `${SITE}/mcp/firstform.test/x`, `${SITE}/mcp/firstform.test?x=1`, `${SITE}/mcp/firstform%2Etest`, `${SITE}/mcp/firstform.test:443`, `${SITE}/mcpx`, "https://other.convex.site/mcp/firstform.test", "not a url"]) {
    assert.equal(mcpResource(config, refused), null, refused);
  }
  assert.equal(mcpServerUrlFor(config, FF), FF_URL);
  assert.equal(mcpServerUrlFor(config, DDC), DDC_URL);
  for (const other of [undefined, "https://evil.test", `${FF}/`, "http://firstform.test"]) assert.equal(mcpServerUrlFor(config, other), BASE, String(other));

  const single = mcpOAuthConfig({ ...process.env, SITE_URL: FF });
  assert.ok(single);
  assert.equal(mcpServerUrlFor(single, FF), BASE, "one origin: the URL stays /mcp");
  assert.equal(mcpResource(single, FF_URL)?.consentUrl, `${FF}/oauth/consent`, "and the per-origin URL still works");

  const overridden = mcpOAuthConfig({ ...process.env, SOCIETYER_MCP_OAUTH_CONSENT_URL: OVERRIDE });
  assert.ok(overridden);
  assert.deepEqual([mcpResource(overridden, FF_URL)?.consentUrl, mcpResource(overridden, FF_URL)?.appOrigin], [OVERRIDE, "https://consent.example.test"], "the override wins for every URL");
  assert.deepEqual(consentOrigins(overridden), ["https://consent.example.test"]);
  assert.equal(mcpServerUrlFor(overridden, FF), BASE);

  const ambiguous = mcpOAuthConfig({ ...process.env, SITE_URL: "http://localhost:5173,https://localhost:5173" });
  assert.equal(ambiguous && mcpResource(ambiguous, `${SITE}/mcp/localhost:5173`), null, "two origins with one host: refused");
  const withPath = mcpOAuthConfig({ ...process.env, SITE_URL: `${DDC},${FF}/app` });
  assert.deepEqual(withPath?.appOrigins, [DDC], "only bare origins can be named");
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
const at = "2026-11-01T19:00:00.000Z";
const { ddcId, ffId } = await test.run(async (ctx) => {
  const ddcId = await ctx.db.insert("societies", { name: "DDC North", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const ffId = await ctx.db.insert("societies", { name: "First Form", isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [societyId, subject] of [[ddcId, "ddc"], [ffId, "ff"]] as const) {
    await ctx.db.insert("users", { societyId, role: "Owner", status: "Active", email: `${subject}@origins.test`, displayName: subject, authIssuer: SITE, authSubject: subject, createdAtISO: at });
  }
  return { ddcId, ffId };
});
type Person = "ddc" | "ff";
const as = (person: Person) => test.withIdentity({ issuer: SITE, subject: person, email: `${person}@origins.test`, emailVerified: true });
await as("ddc").mutation(api.agentConnectors.setEnabled, { societyId: ddcId, enabled: true });
await as("ff").mutation(api.agentConnectors.setEnabled, { societyId: ffId, enabled: true });

const CIMD = "https://claude-client.example.com/oauth/client-metadata";
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url !== CIMD) return new Response("not found", { status: 404 });
  return new Response(JSON.stringify({ client_id: CIMD, client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" }), {
    status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" },
  });
}) as typeof fetch;

// --- HTTP helpers ---------------------------------------------------------------------------------
type Json = Record<string, unknown>;
const getJson = async (path: string) => {
  const response = await test.fetch(path, { method: "GET" });
  return { status: response.status, body: await response.json() as Json };
};
const rpc = async (path: string, token: string | null, method = "tools/list") => {
  const response = await test.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "MCP-Protocol-Version": MCP_LATEST_PROTOCOL_VERSION, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
  });
  return { status: response.status, challenge: response.headers.get("www-authenticate") ?? "", text: await response.text() };
};

let flows = 0;
type Flow = { verifier: string; request: string; cookie: string; consent: URL };
async function authorize(resource: string | undefined) {
  const verifier = `verifier-${String(++flows).padStart(4, "0")}-${"x".repeat(40)}`;
  const query = new URLSearchParams({
    response_type: "code", client_id: CIMD, redirect_uri: CALLBACK, code_challenge: await s256Challenge(verifier), code_challenge_method: "S256",
    state: `s${flows}`, scope: CONNECTOR_READ_SCOPES.join(" "), ...(resource ? { resource } : {}),
  });
  const response = await test.fetch(`/oauth/authorize?${query}`, { method: "GET" });
  return { verifier, response, location: response.headers.get("location") };
}
async function startFlow(resource: string | undefined): Promise<Flow> {
  const { verifier, response, location } = await authorize(resource);
  assert.equal(response.status, 302, await response.text());
  const consent = new URL(location ?? "");
  return { verifier, request: consent.searchParams.get("request") ?? "", cookie: (response.headers.get("set-cookie") ?? "").split(";")[0], consent };
}
const consentPage = (flow: Flow) => `${flow.consent.origin}${flow.consent.pathname}`;
type Completion = { action: string; fields: Record<string, string> };
const approve = (person: Person, flow: Flow, societyId: Id<"societies">) =>
  as(person).action(api.mcpOAuth.approve, { request: flow.request, societyId, scopes: ["meetings:read"] }) as Promise<Completion>;
async function complete(completion: Completion, flow: Flow, origin: string) {
  const response = await test.fetch("/oauth/authorize/complete", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: flow.cookie },
    body: new URLSearchParams(completion.fields).toString(),
  });
  return { status: response.status, location: response.headers.get("location") };
}
async function tokensFor(flow: Flow, location: string | null, resource?: string) {
  const code = new URL(location ?? "").searchParams.get("code") ?? "";
  const response = await test.fetch("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: CIMD, code_verifier: flow.verifier, ...(resource ? { resource } : {}) }).toString(),
  });
  const body = await response.json() as Json;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.access_token as string;
}
const requestRow = (flow: Flow) => test.run(async (ctx) => {
  const rows = await ctx.db.query("mcpOAuthRequests").collect();
  const { hashOpaque } = await import("../shared/mcp/oauth");
  const hash = await hashOpaque(flow.request);
  return rows.find((row) => row.requestHash === hash) ?? null;
});
const events = async (eventType: string) => (await test.run((ctx) => ctx.db.query("mcpOAuthEvents").collect())).filter((row) => row.eventType === eventType);

// --- Discovery: consistent for each resource URL ------------------------------------------------------
for (const [url, path] of [[BASE, "/mcp"], [DDC_URL, "/mcp/portal.ddc.test"], [FF_URL, "/mcp/firstform.test"]] as const) {
  const metadataUrl = `${SITE}/.well-known/oauth-protected-resource${path}`;
  const metadata = await getJson(`/.well-known/oauth-protected-resource${path}`);
  assert.equal(metadata.status, 200, path);
  assert.equal(metadata.body.resource, url, "the metadata names the URL the client connected to");
  assert.deepEqual(metadata.body.authorization_servers, [SITE], "one authorization server for every URL");
  const unauthenticated = await rpc(path, null, "ping");
  assert.equal(unauthenticated.status, 401, path);
  assert.ok(unauthenticated.challenge.includes(`resource_metadata="${metadataUrl}"`), `${path}: the 401 points at its own metadata: ${unauthenticated.challenge}`);
  const server = await getJson(`/.well-known/oauth-authorization-server${path}`);
  assert.deepEqual([server.status, server.body.issuer], [200, SITE]);
}
assert.equal((await getJson("/.well-known/oauth-protected-resource")).body.resource, BASE, "the root metadata is unchanged");
for (const path of ["/mcp/evil.test", "/mcp/firstform.test/x", "/mcp/firstform%2Etest"]) {
  assert.equal((await getJson(`/.well-known/oauth-protected-resource${path}`)).status, 404, `metadata ${path}`);
  assert.equal((await getJson(`/.well-known/oauth-authorization-server${path}`)).status, 404, `server metadata ${path}`);
  assert.equal((await rpc(path, null, "ping")).status, 404, `endpoint ${path}`);
}

// --- Each origin's flow lands on its own consent page; only that origin can finish it ---------------
const ffFlow = await startFlow(FF_URL);
assert.equal(consentPage(ffFlow), `${FF}/oauth/consent`, "First Form's URL: First Form's consent page");
assert.deepEqual([(await requestRow(ffFlow))?.resource, (await requestRow(ffFlow))?.consentOrigin], [FF_URL, FF], "the consent origin is stored with the request");
const ffDetails = await as("ff").action(api.mcpOAuth.consentDetails, { request: ffFlow.request }) as { consentOrigin: string };
assert.equal(ffDetails.consentOrigin, FF, "the page learns which origin may decide");
const ffApproval = await approve("ff", ffFlow, ffId);
const wrongOriginBefore = (await events("completion_wrong_origin")).length;
const fromDdc = await complete(ffApproval, ffFlow, DDC);
assert.deepEqual([fromDdc.status, fromDdc.location], [403, null], "an approval posted from the other trusted origin is refused");
assert.equal((await events("completion_wrong_origin")).length, wrongOriginBefore + 1, "and logged");
assert.deepEqual([(await requestRow(ffFlow))?.status, (await requestRow(ffFlow))?.decision?.kind], ["pending", "approve"], "and changes nothing");
assert.equal((await complete(ffApproval, ffFlow, "https://evil.test")).status, 403, "an untrusted origin is refused");
const fromFf = await complete(ffApproval, ffFlow, FF);
assert.equal(fromFf.status, 303, "its own origin finishes it");
const ffToken = await tokensFor(ffFlow, fromFf.location, FF_URL);
assert.equal((await rpc("/mcp/firstform.test", ffToken)).status, 200, "the token works at the URL it was issued for");
for (const path of ["/mcp", "/mcp/portal.ddc.test"]) {
  const elsewhere = await rpc(path, ffToken);
  assert.equal(elsewhere.status, 401, `and not at ${path}`);
  assert.match(elsewhere.text + elsewhere.challenge, /another resource/);
}

const ddcFlow = await startFlow(DDC_URL);
assert.equal(consentPage(ddcFlow), `${DDC}/oauth/consent`, "DDC's URL: DDC's consent page");
const ddcApproval = await approve("ddc", ddcFlow, ddcId);
assert.equal((await complete(ddcApproval, ddcFlow, FF)).status, 403, "the other way round too");
assert.equal((await complete(ddcApproval, ddcFlow, DDC)).status, 303);

// --- Untrusted hints are refused at /authorize and /token --------------------------------------------
for (const resource of [`${SITE}/mcp/evil.test`, `${SITE}/mcp/firstform.test/x`, `${SITE}/mcp?app=firstform.test`, `https://evil.test/mcp/firstform.test`]) {
  const { response, location } = await authorize(resource);
  assert.equal(response.status, 302, resource);
  assert.deepEqual([new URL(location ?? "").origin + new URL(location ?? "").pathname, new URL(location ?? "").searchParams.get("error")], [CALLBACK, "invalid_target"], resource);
}
{
  const flow = await startFlow(FF_URL);
  const done = await complete(await approve("ff", flow, ffId), flow, FF);
  const code = new URL(done.location ?? "").searchParams.get("code") ?? "";
  const response = await test.fetch("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: CIMD, code_verifier: flow.verifier, resource: `${SITE}/mcp/evil.test` }).toString(),
  });
  assert.deepEqual([response.status, ((await response.json()) as Json).error], [400, "invalid_target"], "an untrusted hint at the token endpoint");
}

// --- No hint: unchanged ------------------------------------------------------------------------------
for (const resource of [undefined, BASE, SITE]) {
  const flow = await startFlow(resource);
  assert.equal(consentPage(flow), `${DDC}/oauth/consent`, `${resource ?? "no resource"}: the first SITE_URL origin, as before`);
  assert.deepEqual([(await requestRow(flow))?.resource, (await requestRow(flow))?.consentOrigin], [BASE, DDC]);
  if (resource !== undefined) continue;
  const approval = await approve("ff", flow, ffId);
  assert.equal((await complete(approval, flow, FF)).status, 403, "only the first origin can finish it");
  const done = await complete(approval, flow, DDC);
  assert.equal(done.status, 303);
  const token = await tokensFor(flow, done.location);
  for (const path of ["/mcp", "/mcp/firstform.test"]) assert.equal((await rpc(path, token)).status, 200, `a token bound to /mcp (a client that sent no resource) works at ${path}`);
}

// Requests stored before the consent origin was: the default origin only.
{
  const flow = await startFlow(FF_URL);
  await test.run(async (ctx) => {
    const row = (await ctx.db.query("mcpOAuthRequests").collect()).find((entry) => entry.consentOrigin === FF && entry.status === "pending");
    if (row) await ctx.db.replace(row._id, { ...Object.fromEntries(Object.entries(row).filter(([key]) => !["_id", "_creationTime", "consentOrigin"].includes(key))) } as typeof row);
  });
  const approval = await approve("ff", flow, ffId);
  assert.equal((await complete(approval, flow, FF)).status, 403, "an older request falls back to the default origin");
  assert.equal((await complete(approval, flow, DDC)).status, 303);
}

// --- SOCIETYER_MCP_OAUTH_CONSENT_URL still wins ------------------------------------------------------
process.env.SOCIETYER_MCP_OAUTH_CONSENT_URL = OVERRIDE;
{
  const flow = await startFlow(FF_URL);
  assert.equal(consentPage(flow), OVERRIDE, "the override is the consent page for a per-origin URL too");
  const approval = await approve("ff", flow, ffId);
  assert.equal((await complete(approval, flow, FF)).status, 403, "and only its origin can finish");
  assert.equal((await complete(approval, flow, "https://consent.example.test")).status, 303);
  assert.equal(consentPage(await startFlow(undefined)), OVERRIDE);
}
delete process.env.SOCIETYER_MCP_OAUTH_CONSENT_URL;

// --- Settings → AI connectors shows the URL for the origin it's on ------------------------------------
const shown = async (origin?: string) => ((await as("ff").query(api.agentConnectors.overview, { societyId: ffId, ...(origin ? { origin } : {}) })) as { endpointUrl: string }).endpointUrl;
assert.equal(await shown(FF), FF_URL);
assert.equal(await shown(DDC), DDC_URL);
assert.equal(await shown("https://evil.test"), BASE);
assert.equal(await shown(), BASE);

console.log("MCP OAuth origin checks passed: per-origin metadata and challenges, each origin's own consent page, completion only from the bound origin, untrusted hints refused, no-hint and override unchanged, token audience per URL, Settings URL per origin.");

/**
 * OAuth 2.1 routes for the remote MCP endpoint, on this deployment's HTTP
 * actions origin (the issuer):
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]    RFC 9728 metadata for /mcp
 *   GET  /.well-known/oauth-authorization-server[/mcp]  RFC 8414 metadata
 *   GET  /oauth/authorize   checks the request, binds it to this browser (a cookie), then sends it to the app's consent page
 *   POST /oauth/authorize/complete  the consent page's form after a decision: checks Origin, token and binding, then redirects to the app
 *   POST /oauth/token       authorization_code (PKCE S256) and refresh_token (rotating)
 *   POST /oauth/register    dynamic client registration (RFC 7591), rate-limited
 *   POST /oauth/revoke      RFC 7009
 *
 * Every route answers 404 while OAuth is off (no app URL, or SOCIETYER_MCP_OAUTH=0).
 * Rules: shared/mcp/oauth.ts. Storage: convex/mcpOAuth.ts. Docs: docs/mcp-connector.md.
 */
import type { HttpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { fetchConvexOutbound } from "./lib/outboundUrlPolicy";
import { OutboundUrlPolicyError } from "../shared/outboundUrlPolicy";
import { readBodyWithin } from "../shared/mcp/server";
import {
  AUTHORIZATION_REQUEST_SECONDS,
  CLIENT_METADATA_MAX_BYTES,
  CLIENT_METADATA_TIMEOUT_MS,
  MAX_STATE_LENGTH,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_BINDING_PREFIX,
  OAUTH_CLIENT_SECRET_PREFIX,
  OAUTH_CODE_PREFIX,
  OAUTH_DCR_CLIENT_PREFIX,
  OAUTH_COMPLETION_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REQUEST_PREFIX,
  OAuthError,
  authorizationResponseUrl,
  authorizationServerMetadata,
  bindingCookie,
  bindingCookieName,
  clientMetadataCacheSeconds,
  generateOpaque,
  hasOpaqueShape,
  hashOpaque,
  isClientMetadataUrl,
  isCodeVerifier,
  isS256Challenge,
  mcpOAuthConfig,
  parseClientMetadataDocument,
  parseRegistrationRequest,
  protectedResourceMetadata,
  readCookie,
  redirectUriMatches,
  requestedConnectorScopes,
  resourceMatches,
  s256Challenge,
  scopeIsIgnorable,
  throttleIpKey,
  unknownIpBuckets,
  type ClientMetadata,
  type McpOAuthConfig,
} from "../shared/mcp/oauth";

const MAX_FORM_BYTES = 16 * 1024;
/** Stale cached client metadata is used only while its URL can't be reached, for up to a week. */
const STALE_CLIENT_METADATA_MS = 7 * 86_400_000;
/**
 * Rate limits, per client address (an IPv6 address by its /64). When Convex
 * can't tell who is calling, those requests share one bucket per route
 * (`unknownIpBuckets`, configurable) rather than going unlimited.
 * Registration has no deployment-wide cap, which one caller could drain for
 * everyone; unused registrations are cleaned up instead.
 */
const PER_IP_THROTTLES = {
  /** Authorization requests (each may fetch a metadata document and stores a pending request). */
  authorize: { capacity: 30, perHour: 120 },
  /** Dynamic client registrations. */
  register: { capacity: 10, perHour: 20 },
} as const;
/** Once per deployment instance: a missing client address is worth knowing about, not worth a log line per request. */
let warnedMissingIp = false;

type Headers = Record<string, string>;

const CORS: Headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
};

function json(body: unknown, status = 200, headers: Headers = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...CORS, ...headers },
  });
}

function oauthError(error: OAuthError, headers: Headers = {}): Response {
  return json({ error: error.error, error_description: error.description }, error.status, headers);
}

function notFound(): Response {
  return json({ error: "not_found", error_description: "OAuth sign-in isn't enabled on this deployment." }, 404);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Shown instead of redirecting when the client or redirect URI can't be trusted (RFC 6749 §4.1.2.1). */
function errorPage(message: string, status = 400, extraHeaders: Headers = {}): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Can't connect to Societyer</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2328}h1{font-size:1.25rem}</style></head>
<body><h1>Can't connect this app to Societyer</h1><p>${escapeHtml(message)}</p><p>Close this tab and try connecting again from the app. If it keeps happening, contact your workspace administrator.</p></body></html>`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

/** Parameters must not repeat (RFC 6749 §3.1). */
function singleParams(params: URLSearchParams): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of params) {
    if (result.has(key)) throw new OAuthError("invalid_request", `The ${key} parameter appears more than once.`);
    result.set(key, value);
  }
  return result;
}

async function readForm(request: Request): Promise<Map<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/x-www-form-urlencoded\b/i.test(type)) {
    throw new OAuthError("invalid_request", "Send the request as application/x-www-form-urlencoded.");
  }
  const bytes = await readBodyWithin(request, MAX_FORM_BYTES);
  if (!bytes) throw new OAuthError("invalid_request", "The request is too large.");
  return singleParams(new URLSearchParams(new TextDecoder().decode(bytes)));
}

/** The caller's IP from Convex request metadata, or null where it isn't available (tests, older runtimes). */
async function clientIp(ctx: ActionCtx): Promise<string | null> {
  const meta = (ctx as { meta?: { getRequestMetadata?: () => Promise<{ ip: string | null }> } }).meta;
  try {
    return meta?.getRequestMetadata ? (await meta.getRequestMetadata()).ip : null;
  } catch {
    return null;
  }
}

/** Spend from the caller's bucket for `route`: its address's, or the shared unknown-address one. */
/** The caller's throttle key for `route`: its address (IPv6 by /64), or the shared unknown-address key. */
async function callerKey(ctx: ActionCtx, route: string): Promise<{ key: string; known: boolean }> {
  const ip = await clientIp(ctx);
  if (!ip && !warnedMissingIp) {
    warnedMissingIp = true;
    console.warn("mcp_oauth_client_ip_unavailable", { route, note: "OAuth requests without a client address share one rate-limit bucket per route; see SOCIETYER_MCP_OAUTH_UNKNOWN_IP_*_PER_HOUR." });
  }
  return ip ? { key: `mcp-oauth-${route}:ip:${throttleIpKey(ip)}`, known: true } : { key: `mcp-oauth-${route}:unknown-ip`, known: false };
}

async function throttle(ctx: ActionCtx, route: keyof typeof PER_IP_THROTTLES) {
  const { key, known } = await callerKey(ctx, route);
  const bucket = known ? { key, ...PER_IP_THROTTLES[route] } : { key, ...unknownIpBuckets(process.env)[route] };
  return ctx.runMutation(internal.authThrottle.take, { buckets: [bucket] });
}

// --- Clients ---------------------------------------------------------------------------------

type KnownClient = Pick<Doc<"mcpOAuthClients">, "clientId" | "redirectUris" | "tokenEndpointAuthMethod" | "clientSecretHash">;

/** The metadata URL answered, but not with 2xx. */
class ClientMetadataStatus extends Error {
  constructor(readonly status: number) {
    super(`metadata fetch answered ${status}`);
  }
}

/** Worth falling back to a stale copy: the URL couldn't be reached, timed out or failed on the server's side. */
function transientMetadataFailure(error: unknown): boolean {
  if (error instanceof ClientMetadataStatus) return error.status >= 500;
  return !(error instanceof OutboundUrlPolicyError);
}

async function fetchClientMetadata(clientId: string, config: McpOAuthConfig): Promise<{ metadata: ClientMetadata; cacheSeconds: number }> {
  // The outbound URL policy: https only, no private, loopback or internal hosts, bounded time and size, no redirects.
  const response = await fetchConvexOutbound(clientId, { method: "GET", headers: { Accept: "application/json" } }, {
    source: "tenant",
    operation: "mcp_oauth_client_metadata",
    maxResponseBytes: CLIENT_METADATA_MAX_BYTES,
    timeoutMs: CLIENT_METADATA_TIMEOUT_MS,
    maxRedirects: 0,
  });
  if (!response.ok) throw new ClientMetadataStatus(response.status);
  let document: unknown;
  try {
    document = JSON.parse(response.text);
  } catch {
    throw new OAuthError("invalid_client", "The client metadata document isn't valid JSON.");
  }
  return { metadata: parseClientMetadataDocument(clientId, document, config), cacheSeconds: clientMetadataCacheSeconds(response.headers.get("cache-control")) };
}

/** A client by id: a cached or freshly fetched metadata document, or a registered client. */
async function resolveClient(ctx: ActionCtx, clientId: string, config: McpOAuthConfig, nowMs: number): Promise<KnownClient> {
  const cached = await ctx.runQuery(internal.mcpOAuth.getClient, { clientId });
  if (clientId.startsWith(OAUTH_DCR_CLIENT_PREFIX)) {
    if (cached?.registration === "dcr") return cached;
    throw new OAuthError("invalid_client", "This app isn't registered with Societyer.");
  }
  if (!isClientMetadataUrl(clientId)) throw new OAuthError("invalid_client", "This app's client_id isn't one Societyer recognises.");
  if (cached?.registration === "cimd" && (cached.refreshAfterMs ?? 0) > nowMs) return cached;
  try {
    const { metadata, cacheSeconds } = await fetchClientMetadata(clientId, config);
    await ctx.runMutation(internal.mcpOAuth.saveClientMetadata, { clientId, metadata, fetchedAtMs: nowMs, refreshAfterMs: nowMs + cacheSeconds * 1000 });
    return { clientId, ...metadata };
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    // The publisher took the document down: the client no longer exists.
    if (error instanceof ClientMetadataStatus && (error.status === 404 || error.status === 410)) {
      await ctx.runMutation(internal.mcpOAuth.forgetClientMetadata, { clientId });
      throw new OAuthError("invalid_client", "This app's client metadata document no longer exists, so Societyer can't connect it.");
    }
    if (transientMetadataFailure(error) && cached?.registration === "cimd" && nowMs - (cached.fetchedAtMs ?? 0) < STALE_CLIENT_METADATA_MS) return cached;
    console.warn("mcp_oauth_client_metadata_unavailable", { host: new URL(clientId).host, status: error instanceof ClientMetadataStatus ? error.status : null });
    throw new OAuthError("invalid_client", "Societyer couldn't read this app's client metadata document.");
  }
}

/** Client authentication at the token and revocation endpoints: public clients send only client_id. */
async function authenticateClient(ctx: ActionCtx, request: Request, form: Map<string, string>): Promise<KnownClient> {
  let clientId = form.get("client_id");
  let secret = form.get("client_secret");
  let usedBasic = false;
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
    if (!match) throw new OAuthError("invalid_client", "Unsupported client authentication.", 401);
    let decoded: string;
    try {
      decoded = atob(match[1]);
    } catch {
      throw new OAuthError("invalid_client", "Unsupported client authentication.", 401);
    }
    const colon = decoded.indexOf(":");
    if (colon < 0) throw new OAuthError("invalid_client", "Unsupported client authentication.", 401);
    let headerId: string;
    let headerSecret: string;
    try {
      // RFC 6749 §2.3.1: both parts are form-urlencoded.
      headerId = decodeURIComponent(decoded.slice(0, colon));
      headerSecret = decodeURIComponent(decoded.slice(colon + 1));
    } catch {
      throw new OAuthError("invalid_client", "Unsupported client authentication.", 401);
    }
    if (clientId && clientId !== headerId) throw new OAuthError("invalid_client", "client_id doesn't match the Authorization header.", 401);
    if (secret) throw new OAuthError("invalid_request", "Send the client secret one way only.");
    clientId = headerId;
    secret = headerSecret;
    usedBasic = true;
  }
  if (!clientId) throw new OAuthError("invalid_client", "client_id is required.", 401);
  const client = await ctx.runQuery(internal.mcpOAuth.getClient, { clientId });
  if (!client) throw new OAuthError("invalid_client", "This client isn't known. Connect again.", 401);
  if (client.tokenEndpointAuthMethod !== "none") {
    if (!secret || !client.clientSecretHash || await hashOpaque(secret) !== client.clientSecretHash) {
      throw new OAuthError("invalid_client", "Client authentication failed.", 401);
    }
    if (usedBasic !== (client.tokenEndpointAuthMethod === "client_secret_basic")) {
      throw new OAuthError("invalid_client", `This client authenticates with ${client.tokenEndpointAuthMethod}.`, 401);
    }
  }
  return client;
}

// --- Routes ------------------------------------------------------------------------------------

function withConfig(handler: (ctx: ActionCtx, request: Request, config: McpOAuthConfig) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    const config = mcpOAuthConfig(process.env);
    if (!config) return notFound();
    return handler(ctx, request, config);
  });
}

const resourceMetadata = withConfig(async (_ctx, _request, config) =>
  json(protectedResourceMetadata(config), 200, { "Cache-Control": "public, max-age=300" }));

const serverMetadata = withConfig(async (_ctx, _request, config) =>
  json(authorizationServerMetadata(config), 200, { "Cache-Control": "public, max-age=300" }));

const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

const authorize = withConfig(async (ctx, request, config) => {
  const nowMs = Date.now();
  let params: Map<string, string>;
  try {
    params = singleParams(new URL(request.url).searchParams);
  } catch (error) {
    return errorPage(error instanceof OAuthError ? error.description : "The sign-in request is malformed.");
  }
  // Until the client and redirect URI check out, errors are shown here, never redirected.
  const clientId = params.get("client_id");
  if (!clientId) return errorPage("The request has no client_id.");
  if (!(await throttle(ctx, "authorize")).ok) return errorPage("Too many connection attempts from this network. Wait a few minutes and try again.", 429);
  let client: KnownClient;
  try {
    client = await resolveClient(ctx, clientId, config, nowMs);
  } catch (error) {
    return errorPage(error instanceof OAuthError ? error.description : "This app isn't registered with Societyer.");
  }
  const redirectUri = params.get("redirect_uri");
  if (!redirectUri) return errorPage("The request has no redirect_uri.");
  if (!redirectUriMatches(client.redirectUris, redirectUri)) return errorPage("The redirect_uri isn't one this app registered.");

  const state = params.get("state");
  const redirect = (location: string, headers: Headers = {}) =>
    new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers } });
  const fail = (error: string, description: string) =>
    redirect(authorizationResponseUrl(redirectUri, { error, error_description: description, state, iss: config.issuer }));
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = params.get("code_challenge");
  if (!challenge) return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
  if (params.get("code_challenge_method") !== "S256") return fail("invalid_request", "Only code_challenge_method=S256 is supported.");
  if (!isS256Challenge(challenge)) return fail("invalid_request", "code_challenge must be a 43-character base64url S256 value.");
  if (state && state.length > MAX_STATE_LENGTH) return fail("invalid_request", "state is too long.");
  const resource = params.get("resource");
  if (resource !== undefined && !resourceMatches(config, resource)) return fail("invalid_target", `resource must be ${config.resource}.`);

  const handle = generateOpaque(OAUTH_REQUEST_PREFIX);
  const requestHash = await hashOpaque(handle);
  // Bind the request to this browser: only it can complete the consent (see shared/mcp/oauth.ts).
  const binding = generateOpaque(OAUTH_BINDING_PREFIX);
  await ctx.runMutation(internal.mcpOAuth.createRequest, {
    requestHash,
    bindingHash: await hashOpaque(binding),
    clientId: client.clientId,
    redirectUri,
    codeChallenge: challenge,
    ...(state ? { state } : {}),
    requestedScopes: requestedConnectorScopes(params.get("scope")),
    resource: config.resource,
    nowMs,
  });
  const consent = new URL(config.consentUrl);
  consent.searchParams.set("request", handle);
  return redirect(consent.toString(), { "Set-Cookie": bindingCookie(bindingCookieName(requestHash), binding, AUTHORIZATION_REQUEST_SECONDS) });
});

/**
 * The consent page's form after a decision (a top-level POST navigation from
 * the app's origin). Three checks before the app gets its code or
 * access_denied: the request's `Origin` is the app's (so no other site can
 * post it: CSRF), the one-time completion token matches the decision (only
 * the decider received it), and the binding cookie is the one
 * /oauth/authorize set on this browser for this request. The cookie is
 * SameSite=None because Lax isn't sent on a cross-site POST; it is
 * first-party here, since the issuer is the site being navigated to.
 */
const complete = withConfig(async (ctx, request, config) => {
  if (request.headers.get("origin") !== config.appOrigin) {
    // Unauthenticated, so logged once per caller (address or /64, or the shared unknown key) per hour, with a count.
    const { key } = await callerKey(ctx, "complete-rejected");
    await ctx.runMutation(internal.mcpOAuth.recordEvent, {
      eventType: "completion_cross_site",
      detail: { origin: (request.headers.get("origin") ?? "none").slice(0, 200) },
      throttleKeyHash: await hashOpaque(key),
      nowMs: Date.now(),
    });
    return errorPage("This connection can only be finished from Societyer's consent page. Start connecting again from the app.", 403);
  }
  let params: Map<string, string>;
  try {
    params = await readForm(request);
  } catch {
    return errorPage("The sign-in request is malformed.");
  }
  const handle = params.get("request") ?? "";
  const decision = params.get("completion") ?? "";
  if (!hasOpaqueShape(handle, OAUTH_REQUEST_PREFIX) || !hasOpaqueShape(decision, OAUTH_COMPLETION_PREFIX)) {
    return errorPage("This connection link isn't valid. Start connecting again from the app.");
  }
  const requestHash = await hashOpaque(handle);
  const cookieName = bindingCookieName(requestHash);
  const binding = readCookie(request.headers.get("cookie"), cookieName);
  const code = generateOpaque(OAUTH_CODE_PREFIX);
  const result = await ctx.runMutation(internal.mcpOAuth.completeDecision, {
    requestHash,
    ...(binding && hasOpaqueShape(binding, OAUTH_BINDING_PREFIX) ? { bindingHash: await hashOpaque(binding) } : {}),
    decisionHash: await hashOpaque(decision),
    codeHash: await hashOpaque(code),
    nowMs: Date.now(),
  });
  const clearBinding = { "Set-Cookie": bindingCookie(cookieName, "", 0) };
  if (!result.ok) return errorPage(result.message, 400, result.ended ? clearBinding : {});
  const location = result.outcome === "approved"
    ? authorizationResponseUrl(result.redirectUri, { code, state: result.state, iss: config.issuer })
    : authorizationResponseUrl(result.redirectUri, { error: "access_denied", error_description: "The person declined to connect this app.", state: result.state, iss: config.issuer });
  // 303: the browser follows with a GET, whatever method brought it here.
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...clearBinding } });
});

async function issueTokens(
  ctx: ActionCtx,
  form: Map<string, string>,
  client: KnownClient,
  config: McpOAuthConfig,
): Promise<Response> {
  const grantType = form.get("grant_type");
  const resource = form.get("resource");
  if (resource !== undefined && !resourceMatches(config, resource)) throw new OAuthError("invalid_target", `resource must be ${config.resource}.`);
  const accessToken = generateOpaque(OAUTH_ACCESS_TOKEN_PREFIX);
  const refreshToken = generateOpaque(OAUTH_REFRESH_TOKEN_PREFIX);
  const issued = {
    accessTokenHash: await hashOpaque(accessToken),
    refreshTokenHash: await hashOpaque(refreshToken),
    familyId: crypto.randomUUID(),
    nowMs: Date.now(),
  };
  let outcome;
  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const verifier = form.get("code_verifier");
    if (!code || !redirectUri || !verifier) throw new OAuthError("invalid_request", "code, redirect_uri and code_verifier are required.");
    if (!isCodeVerifier(verifier)) throw new OAuthError("invalid_grant", "code_verifier doesn't match the code_challenge.");
    if (!hasOpaqueShape(code, OAUTH_CODE_PREFIX)) throw new OAuthError("invalid_grant", "The authorization code isn't recognised.");
    outcome = await ctx.runMutation(internal.mcpOAuth.exchangeCode, {
      codeHash: await hashOpaque(code),
      clientId: client.clientId,
      redirectUri,
      verifierChallenge: await s256Challenge(verifier),
      ...issued,
    });
  } else if (grantType === "refresh_token") {
    const presented = form.get("refresh_token");
    if (!presented) throw new OAuthError("invalid_request", "refresh_token is required.");
    if (!hasOpaqueShape(presented, OAUTH_REFRESH_TOKEN_PREFIX)) throw new OAuthError("invalid_grant", "The refresh token isn't recognised.");
    // A refresh may name the granted scopes again but never add one (RFC 6749 §6).
    const askedScopes = (form.get("scope") ?? "").split(/\s+/).filter((scope) => scope && !scopeIsIgnorable(scope));
    outcome = await ctx.runMutation(internal.mcpOAuth.refreshTokens, {
      presentedRefreshHash: await hashOpaque(presented),
      clientId: client.clientId,
      askedScopes,
      ...issued,
    });
  } else {
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }
  if (!outcome.ok) throw new OAuthError(outcome.error, outcome.description);
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: outcome.expiresInSeconds,
    refresh_token: refreshToken,
    scope: outcome.scopes.join(" "),
  });
}

const token = withConfig(async (ctx, request, config) => {
  try {
    const form = await readForm(request);
    const client = await authenticateClient(ctx, request, form);
    return await issueTokens(ctx, form, client, config);
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error, error.status === 401 ? { "WWW-Authenticate": 'Basic realm="societyer-oauth"' } : {});
    console.error("mcp_oauth_token_failed", error instanceof Error ? error.message : String(error));
    return oauthError(new OAuthError("server_error", "The token request couldn't be completed. Try again.", 500));
  }
});

const register = withConfig(async (ctx, request, config) => {
  try {
    if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
      throw new OAuthError("invalid_client_metadata", "Send the client metadata as application/json.");
    }
    const bytes = await readBodyWithin(request, MAX_FORM_BYTES);
    if (!bytes) throw new OAuthError("invalid_client_metadata", "The client metadata is too large.");
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new OAuthError("invalid_client_metadata", "The body isn't valid JSON.");
    }
    const metadata = parseRegistrationRequest(body, config);
    const allowance = await throttle(ctx, "register");
    if (!allowance.ok) {
      return json({ error: "too_many_requests", error_description: "Too many client registrations. Try again later." }, 429, {
        "Retry-After": String(Math.max(1, Math.ceil(allowance.retryAfterMs / 1000))),
      });
    }
    const clientId = generateOpaque(OAUTH_DCR_CLIENT_PREFIX);
    const secret = metadata.tokenEndpointAuthMethod === "none" ? undefined : generateOpaque(OAUTH_CLIENT_SECRET_PREFIX);
    const nowMs = Date.now();
    await ctx.runMutation(internal.mcpOAuth.registerClient, {
      clientId,
      metadata,
      ...(secret ? { clientSecretHash: await hashOpaque(secret) } : {}),
      nowMs,
    });
    return json({
      client_id: clientId,
      client_id_issued_at: Math.floor(nowMs / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: metadata.clientName,
      ...(metadata.clientUri ? { client_uri: metadata.clientUri } : {}),
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }, 201);
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error);
    console.error("mcp_oauth_register_failed", error instanceof Error ? error.message : String(error));
    return oauthError(new OAuthError("server_error", "Registration couldn't be completed. Try again.", 500));
  }
});

const revoke = withConfig(async (ctx, request) => {
  try {
    const form = await readForm(request);
    const client = await authenticateClient(ctx, request, form);
    const value = form.get("token");
    if (!value) throw new OAuthError("invalid_request", "token is required.");
    if (hasOpaqueShape(value, OAUTH_ACCESS_TOKEN_PREFIX) || hasOpaqueShape(value, OAUTH_REFRESH_TOKEN_PREFIX)) {
      await ctx.runMutation(internal.mcpOAuth.revokeToken, { tokenHash: await hashOpaque(value), clientId: client.clientId, nowMs: Date.now() });
    }
    // RFC 7009 §2.2: unknown tokens are not an error.
    return new Response(null, { status: 200, headers: { ...CORS, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error);
    return oauthError(new OAuthError("server_error", "Revocation couldn't be completed. Try again.", 500));
  }
});

export function registerMcpOAuthRoutes(http: HttpRouter) {
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    http.route({ path, method: "GET", handler: resourceMetadata });
    http.route({ path, method: "OPTIONS", handler: preflight });
  }
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"]) {
    http.route({ path, method: "GET", handler: serverMetadata });
    http.route({ path, method: "OPTIONS", handler: preflight });
  }
  http.route({ path: "/oauth/authorize", method: "GET", handler: authorize });
  http.route({ path: "/oauth/authorize/complete", method: "POST", handler: complete });
  for (const [path, handler] of [["/oauth/token", token], ["/oauth/register", register], ["/oauth/revoke", revoke]] as const) {
    http.route({ path, method: "POST", handler });
    http.route({ path, method: "OPTIONS", handler: preflight });
  }
}

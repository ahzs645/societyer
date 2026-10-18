/**
 * OAuth 2.1 for the remote MCP endpoint: the rules, with no I/O, so they can be
 * tested on their own. The authorization server itself is convex/mcpOAuthHttp.ts
 * (HTTP routes) and convex/mcpOAuth.ts (storage). See docs/mcp-connector.md.
 *
 * - Authorization code + PKCE (S256 only); refresh tokens rotate, and a reused
 *   refresh token or code revokes its whole token family.
 * - Clients: Client ID Metadata Documents (an https `client_id` whose JSON we
 *   fetch) and dynamic client registration (RFC 7591), public by default.
 * - Redirect URIs: claude.ai's and ChatGPT's callbacks, loopback for CLI
 *   clients (any port), and exact URIs an operator adds.
 * - Tokens are opaque, stored as SHA-256 hashes, and bound to the MCP
 *   resource (RFC 8707). Every grant is an `agentGrants` row, so `/mcp`
 *   checks an OAuth token exactly like a personal token.
 */
import { CONNECTOR_READ_SCOPES, CONNECTOR_SCOPES, hashConnectorToken } from "./connectorPolicy";

export const OAUTH_ACCESS_TOKEN_PREFIX = "soc_mat_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "soc_mrt_";
export const OAUTH_CODE_PREFIX = "soc_mac_";
export const OAUTH_REQUEST_PREFIX = "soc_mar_";
export const OAUTH_DCR_CLIENT_PREFIX = "soc_dcr_";
export const OAUTH_CLIENT_SECRET_PREFIX = "soc_dcs_";
/** The browser binding: a nonce in a cookie on the issuer, set by /oauth/authorize. */
export const OAUTH_BINDING_PREFIX = "soc_mab_";
/** One consent decision's completion token (approve or deny), given only to the person deciding and redeemed once by POST /oauth/authorize/complete. */
export const OAUTH_COMPLETION_PREFIX = "soc_mad_";

/** Short-lived: a leaked access token is good for an hour at most. */
export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_SECONDS = 5 * 60;
/** Time to sign in and decide on the consent page. Short, so a forwarded authorize link goes stale quickly. */
export const AUTHORIZATION_REQUEST_SECONDS = 10 * 60;
/** Like a personal token's default: the person approves again after 90 days. */
export const OAUTH_GRANT_DAYS = 90;
/** Connected apps one person may hold in one workspace. */
export const MAX_ACTIVE_OAUTH_GRANTS_PER_USER = 10;
/** Rotated, revoked and expired token rows (and ended sessions) are kept this long, so reuse is still detected. */
export const ENDED_TOKEN_RETENTION_DAYS = 7;
/** A client nobody has connected (no grant) and that hasn't been used for this long is deleted. */
export const UNUSED_CLIENT_DAYS = 7;

/** Client ID Metadata Documents: fetch limits and how long a copy is trusted. */
export const CLIENT_METADATA_MAX_BYTES = 16 * 1024;
export const CLIENT_METADATA_TIMEOUT_MS = 4_000;
export const CLIENT_METADATA_MIN_CACHE_SECONDS = 5 * 60;
export const CLIENT_METADATA_MAX_CACHE_SECONDS = 24 * 60 * 60;
export const MAX_CLIENT_NAME_LENGTH = 100;
export const MAX_REDIRECT_URIS = 10;
export const MAX_STATE_LENGTH = 2048;

/** Scopes OAuth clients may ask for but that grant nothing here; refresh tokens are always issued. */
const IGNORED_SCOPES = new Set(["offline_access", "openid", "profile", "email"]);

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";
/** ChatGPT's newer per-connector callbacks: https://chatgpt.com/connector/oauth/{callback_id}. */
const CHATGPT_CALLBACK_PATTERN = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An OAuth error, as RFC 6749 §5.2 names them. `description` is safe to show the client. */
export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) {
    super(description);
    this.name = "OAuthError";
  }
}

export type McpOAuthConfig = {
  /** The authorization server's issuer: this deployment's HTTP actions origin. */
  issuer: string;
  /** The protected resource every token is bound to: `<issuer>/mcp`. */
  resource: string;
  resourceMetadataUrl: string;
  /** The app's consent page, which the authorization endpoint redirects to. */
  consentUrl: string;
  /** The consent page's origin: the only `Origin` a completion POST may come from. */
  appOrigin: string;
  /** Extra exact redirect URIs an operator allows (SOCIETYER_MCP_OAUTH_REDIRECT_URIS). */
  extraRedirectUris: string[];
};

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalOrigin(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

function httpsOrLocal(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return null;
    return url.protocol === "https:" || isLocalOrigin(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * OAuth is on when the deployment knows its own URL and the app's (for the
 * consent page). `SOCIETYER_MCP_OAUTH=0` turns it off; personal tokens keep working.
 */
export function mcpOAuthConfig(env: Record<string, string | undefined>): McpOAuthConfig | null {
  if (env.SOCIETYER_MCP_OAUTH === "0") return null;
  const site = httpsOrLocal(env.CONVEX_SITE_URL);
  if (!site) return null;
  const appOrigin = (env.SITE_URL ?? "").split(",").map((value) => value.trim()).find(Boolean);
  const consent = httpsOrLocal(env.SOCIETYER_MCP_OAUTH_CONSENT_URL)
    ?? (httpsOrLocal(appOrigin) ? new URL("/oauth/consent", trimSlash(appOrigin as string)) : null);
  if (!consent) return null;
  const issuer = trimSlash(site.origin);
  return {
    issuer,
    resource: `${issuer}/mcp`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    consentUrl: consent.toString(),
    appOrigin: consent.origin,
    extraRedirectUris: (env.SOCIETYER_MCP_OAUTH_REDIRECT_URIS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => httpsOrLocal(value) !== null),
  };
}

/** RFC 9728 metadata for `/mcp`. `scopes_supported` is the read set: what a client should ask for by default. */
export function protectedResourceMetadata(config: McpOAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...CONNECTOR_READ_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Societyer",
  };
}

/** RFC 8414 metadata. `offline_access` is listed so clients that look for it ask for a refresh token. */
export function authorizationServerMetadata(config: McpOAuthConfig) {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [...CONNECTOR_SCOPES.map((scope) => scope.permission), "offline_access"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** The `WWW-Authenticate` value for a 401 from `/mcp` when OAuth is on. */
export function bearerChallenge(config: McpOAuthConfig, error?: { error: string; description: string }): string {
  const parts = [
    'Bearer realm="societyer-mcp"',
    `resource_metadata="${config.resourceMetadataUrl}"`,
    `scope="${CONNECTOR_READ_SCOPES.join(" ")}"`,
  ];
  if (error) parts.push(`error="${error.error}"`, `error_description="${error.description.replace(/["\\]/g, "'")}"`);
  return parts.join(", ");
}

/**
 * RFC 8707: the `resource` a client names must be this MCP server. Its origin
 * is accepted too (some clients send the origin), and both bind to `/mcp`.
 * Scheme and host compare case-insensitively; a trailing slash is ignored.
 */
export function resourceMatches(config: McpOAuthConfig, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.search || url.username || url.password) return false;
  const normalized = trimSlash(`${url.origin}${url.pathname}`);
  return normalized === config.resource || normalized === config.issuer;
}

// --- Redirect URIs --------------------------------------------------------------------

function parseRedirect(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.hash || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** A loopback redirect for a native or CLI client (RFC 8252 §7.3): plain http on localhost, 127.0.0.1 or [::1]. */
export function isLoopbackRedirect(raw: string): boolean {
  const url = parseRedirect(raw);
  return url !== null && isLocalOrigin(url);
}

/** The deployment-wide allow-list every client's redirect URIs must pass. */
export function redirectUriAllowed(raw: string, config: Pick<McpOAuthConfig, "extraRedirectUris">): boolean {
  const url = parseRedirect(raw);
  if (!url) return false;
  if (isLocalOrigin(url)) return true;
  if (url.protocol !== "https:") return false;
  return raw === CLAUDE_CALLBACK || raw === CHATGPT_CALLBACK || CHATGPT_CALLBACK_PATTERN.test(raw) || config.extraRedirectUris.includes(raw);
}

/**
 * Does the redirect URI in a request match one the client registered? Exact
 * string match, except that a loopback URI's port is ignored (RFC 8252 §7.3;
 * Claude Code registers `http://localhost/callback` and listens on any port).
 */
export function redirectUriMatches(registered: readonly string[], presented: string): boolean {
  if (registered.includes(presented)) return true;
  const url = parseRedirect(presented);
  if (!url || !isLocalOrigin(url)) return false;
  return registered.some((entry) => {
    const candidate = parseRedirect(entry);
    return candidate !== null && isLocalOrigin(candidate)
      && candidate.hostname === url.hostname
      && candidate.pathname === url.pathname
      && candidate.search === url.search;
  });
}

/** What the consent page shows as "you'll return to": the host, or "this computer" for loopback. */
export function redirectHost(raw: string): string {
  const url = parseRedirect(raw);
  if (!url) return "unknown";
  return isLocalOrigin(url) ? `${url.hostname} (this computer)` : withoutInvisibleCharacters(url.host);
}

/** The authorization response URL: the registered redirect plus code (or error), state and iss (RFC 9207). */
export function authorizationResponseUrl(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

// --- Browser binding ------------------------------------------------------------------
//
// /oauth/authorize (a top-level navigation from the AI app) sets a cookie on
// the issuer holding a random nonce; the request stores the nonce's hash. The
// consent page is on the app's origin and can't read it. After a decision the
// page submits a form (a top-level POST navigation) to the issuer's
// /oauth/authorize/complete with a one-time completion token only the decider
// received. The issuer checks the request's `Origin` is the app, the token
// and the cookie. SameSite=Lax cookies aren't sent on a cross-site POST, so
// the cookie is SameSite=None; it is still first-party in that navigation
// (the issuer is the top-level site being navigated to), so third-party
// cookie blocking doesn't apply, and it's never Partitioned. The Origin check,
// not SameSite, is what stops another site posting the form.

const BINDING_COOKIE_PREFIX = "__Host-soc-oauth-";

/** One cookie per request, so two connections started in one browser don't clash. */
export function bindingCookieName(requestHash: string): string {
  return `${BINDING_COOKIE_PREFIX}${requestHash.slice(0, 16)}`;
}

/** `__Host-` requires Secure, Path=/ and no Domain; HttpOnly keeps it from scripts; SameSite=None so the completion POST carries it. */
export function bindingCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; Secure; HttpOnly; SameSite=None`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/** The form the consent page submits after a decision: a POST back to the issuer, which checks Origin, token and binding. */
export type AuthorizationCompletion = { action: string; fields: { request: string; completion: string } };

export function authorizationCompletion(config: Pick<McpOAuthConfig, "issuer">, request: string, completion: string): AuthorizationCompletion {
  return { action: new URL("/oauth/authorize/complete", config.issuer).toString(), fields: { request, completion } };
}

// --- Throttles when the client address is unknown ------------------------------------------

export type ThrottleBucket = { capacity: number; perHour: number };

function bucketFromEnv(raw: string | undefined, fallback: ThrottleBucket): ThrottleBucket {
  const perHour = Number(raw);
  if (!raw || !Number.isInteger(perHour) || perHour < 1) return fallback;
  return { capacity: Math.max(1, Math.round(perHour / 10)), perHour };
}

/**
 * When Convex can't give the caller's address, every such request shares one
 * bucket per route. Self-hosted deployments behind a proxy that hides client
 * addresses can raise the hourly allowance; it is never unlimited.
 */
export function unknownIpBuckets(env: Record<string, string | undefined>): { authorize: ThrottleBucket; register: ThrottleBucket } {
  return {
    authorize: bucketFromEnv(env.SOCIETYER_MCP_OAUTH_UNKNOWN_IP_AUTHORIZE_PER_HOUR, { capacity: 60, perHour: 600 }),
    register: bucketFromEnv(env.SOCIETYER_MCP_OAUTH_UNKNOWN_IP_REGISTER_PER_HOUR, { capacity: 20, perHour: 200 }),
  };
}

// --- Throttle keys ------------------------------------------------------------------------

/** An IPv6 address as eight four-digit hextets (an IPv4 tail becomes two), or null if it isn't one. */
function ipv6Hextets(address: string): string[] | null {
  let value = address.toLowerCase();
  const ipv4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4Tail) {
    const [a, b, c, d] = ipv4Tail.slice(1).map(Number);
    if ([a, b, c, d].some((octet) => octet > 255)) return null;
    value = `${value.slice(0, ipv4Tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const hextets = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...tail];
  return hextets.every((hextet) => /^[0-9a-f]{1,4}$/.test(hextet)) ? hextets.map((hextet) => hextet.padStart(4, "0")) : null;
}

/**
 * The throttle key for a client address: IPv4 as is, IPv6 by its /64 (one
 * subscriber usually holds a whole /64), and IPv4-mapped IPv6 as IPv4.
 */
export function throttleIpKey(ip: string): string {
  const address = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!address.includes(":")) return `v4:${address}`;
  const hextets = ipv6Hextets(address);
  if (!hextets) return `v6:${address.toLowerCase()}`;
  if (hextets.slice(0, 5).every((hextet) => hextet === "0000") && hextets[5] === "ffff") {
    const [high, low] = [parseInt(hextets[6], 16), parseInt(hextets[7], 16)];
    return `v4:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `v6:${hextets.slice(0, 4).join(":")}::/64`;
}

// --- Scopes -----------------------------------------------------------------------------

/** Connector scopes named in a `scope` parameter. Unknown values are dropped; none known means the read set. */
export function requestedConnectorScopes(scope: string | null | undefined): string[] {
  const known = new Set(CONNECTOR_SCOPES.map((entry) => entry.permission));
  const named = (scope ?? "").split(/\s+/).filter(Boolean);
  const chosen = [...new Set(named.filter((value) => known.has(value)))];
  return chosen.length ? chosen : [...CONNECTOR_READ_SCOPES];
}

export function scopeIsIgnorable(value: string): boolean {
  return IGNORED_SCOPES.has(value);
}

// --- PKCE ------------------------------------------------------------------------------------

const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isCodeVerifier(value: string): boolean {
  return PKCE_VALUE.test(value);
}

export function isS256Challenge(value: string): boolean {
  return S256_CHALLENGE.test(value);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** BASE64URL(SHA256(verifier)), RFC 7636 §4.6. */
export async function s256Challenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

// --- Opaque values ---------------------------------------------------------------------------

/** A random opaque value with a recognisable prefix. Call only from an action or HTTP action (a real CSPRNG). */
export function generateOpaque(prefix: string): string {
  return `${prefix}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

const OPAQUE_BODY = "[A-Za-z0-9_-]{43}";
export function hasOpaqueShape(value: string, prefix: string): boolean {
  return new RegExp(`^${prefix}${OPAQUE_BODY}$`).test(value);
}

/** What the database stores for every token, code and request handle. */
export const hashOpaque = hashConnectorToken;

// --- Clients ---------------------------------------------------------------------------------

export type TokenEndpointAuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export type ClientMetadata = {
  clientName: string;
  clientUri?: string;
  logoUri?: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new OAuthError("invalid_client_metadata", `${field} must be an array of strings.`);
  }
  return value as string[];
}

/**
 * Control and format characters (bidi overrides and isolates, zero-width
 * spaces and joiners, the BOM, soft hyphens) removed, so a name or host can't
 * reorder or hide what the consent page shows.
 */
export function withoutInvisibleCharacters(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = withoutInvisibleCharacters(value.replace(/\s+/g, " ")).replace(/\s+/g, " ").trim();
  return name ? name.slice(0, MAX_CLIENT_NAME_LENGTH) : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = httpsOrLocal(value);
  return url && url.protocol === "https:" ? url.toString() : undefined;
}

function checkRedirects(value: unknown, config: Pick<McpOAuthConfig, "extraRedirectUris">, errorCode: string): string[] {
  const uris = [...new Set(stringArray(value, "redirect_uris"))];
  if (!uris.length) throw new OAuthError(errorCode, "redirect_uris must list at least one URI.");
  if (uris.length > MAX_REDIRECT_URIS) throw new OAuthError(errorCode, `List at most ${MAX_REDIRECT_URIS} redirect URIs.`);
  const refused = uris.filter((uri) => !redirectUriAllowed(uri, config));
  if (refused.length) {
    throw new OAuthError(errorCode, `This server doesn't accept the redirect URI ${refused[0]}. Allowed: the claude.ai and ChatGPT callbacks, loopback (http://localhost or http://127.0.0.1) and URIs the operator lists.`);
  }
  return uris;
}

function checkGrantAndResponseTypes(body: JsonRecord, errorCode: string) {
  if (body.grant_types !== undefined) {
    const unsupported = stringArray(body.grant_types, "grant_types").filter((type) => type !== "authorization_code" && type !== "refresh_token");
    if (unsupported.length) throw new OAuthError(errorCode, `Unsupported grant type ${unsupported[0]}. Use authorization_code and refresh_token.`);
  }
  if (body.response_types !== undefined) {
    const unsupported = stringArray(body.response_types, "response_types").filter((type) => type !== "code");
    if (unsupported.length) throw new OAuthError(errorCode, `Unsupported response type ${unsupported[0]}. Use code.`);
  }
}

/**
 * A `client_id` that names a Client ID Metadata Document: https, a path, no
 * query, fragment, credentials or dot segments.
 */
export function isClientMetadataUrl(clientId: string): boolean {
  if (!clientId.startsWith("https://") || clientId.length > 2048) return false;
  try {
    const url = new URL(clientId);
    if (url.toString() !== clientId) return false;
    if (url.username || url.password || url.hash || url.search) return false;
    if (url.pathname === "/" || /\/\.\.?(\/|$)/.test(url.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Validate a fetched Client ID Metadata Document. Its `client_id` must be the URL it came from. */
export function parseClientMetadataDocument(clientId: string, document: unknown, config: Pick<McpOAuthConfig, "extraRedirectUris">): ClientMetadata {
  if (!isRecord(document)) throw new OAuthError("invalid_client", "The client metadata document isn't a JSON object.");
  if (document.client_id !== clientId) throw new OAuthError("invalid_client", "The client metadata document's client_id doesn't match its URL.");
  const clientName = cleanName(document.client_name);
  if (!clientName) throw new OAuthError("invalid_client", "The client metadata document has no client_name.");
  if (document.client_secret !== undefined || document.client_secret_expires_at !== undefined) {
    throw new OAuthError("invalid_client", "A client metadata document can't carry a client secret.");
  }
  // CIMD clients are public here (no private_key_jwt). ChatGPT also lists its methods in a plural field.
  const single = document.token_endpoint_auth_method;
  const plural = Array.isArray(document.token_endpoint_auth_methods_supported) ? document.token_endpoint_auth_methods_supported : undefined;
  const publicClient = plural ? plural.includes("none") : single === undefined || single === "none";
  if (!publicClient) throw new OAuthError("invalid_client", "This server only accepts public clients (token_endpoint_auth_method \"none\") from client metadata documents.");
  checkGrantAndResponseTypes(document, "invalid_client");
  return {
    clientName,
    clientUri: httpsUrl(document.client_uri),
    logoUri: httpsUrl(document.logo_uri),
    redirectUris: checkRedirects(document.redirect_uris, config, "invalid_client"),
    tokenEndpointAuthMethod: "none",
  };
}

/** Validate an RFC 7591 registration request. Only the fields this server uses are kept. */
export function parseRegistrationRequest(body: unknown, config: Pick<McpOAuthConfig, "extraRedirectUris">): ClientMetadata {
  if (!isRecord(body)) throw new OAuthError("invalid_client_metadata", "Send the client metadata as a JSON object.");
  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none" && method !== "client_secret_post" && method !== "client_secret_basic") {
    throw new OAuthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
  }
  checkGrantAndResponseTypes(body, "invalid_client_metadata");
  return {
    clientName: cleanName(body.client_name) ?? "Unnamed MCP client",
    clientUri: httpsUrl(body.client_uri),
    logoUri: httpsUrl(body.logo_uri),
    redirectUris: checkRedirects(body.redirect_uris, config, "invalid_redirect_uri"),
    tokenEndpointAuthMethod: method,
  };
}

/** How long to trust a fetched metadata document: its max-age, kept between 5 minutes and a day. */
export function clientMetadataCacheSeconds(cacheControl: string | null): number {
  const header = (cacheControl ?? "").toLowerCase();
  if (/\b(no-store|no-cache)\b/.test(header)) return CLIENT_METADATA_MIN_CACHE_SECONDS;
  const maxAge = /\bmax-age=(\d+)/.exec(header);
  const seconds = maxAge ? Number(maxAge[1]) : 60 * 60;
  return Math.min(CLIENT_METADATA_MAX_CACHE_SECONDS, Math.max(CLIENT_METADATA_MIN_CACHE_SECONDS, seconds));
}

function displayHost(raw: string): string | undefined {
  try {
    const host = withoutInvisibleCharacters(new URL(raw).host).toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

/** Who publishes a client, as far as Societyer can tell: the host of its metadata document URL. Registered clients have none. */
export function clientPublisherHost(clientId: string): string | undefined {
  return isClientMetadataUrl(clientId) ? displayHost(clientId) : undefined;
}

/** A registered client's own `client_uri` host: self-declared and unverified, shown only as such. */
export function declaredClientHost(clientUri: string | undefined): string | undefined {
  return clientUri ? displayHost(clientUri) : undefined;
}

/**
 * AI connector tokens: what a personal access token for the remote MCP
 * endpoint (`/mcp`) may do. Scopes are permission strings taken from the
 * agent-tool registry, so a new read tool brings its permissions with it.
 *
 * A token never adds access. At every call its effective permissions are the
 * creator's current role permissions intersected with the token's scopes, so
 * a demotion or removal narrows or ends access at once. See docs/mcp-connector.md.
 */
import { AGENT_TOOLS, agentToolsFor, toolRunsOn, type AgentTool } from "../agentTools";

export const CONNECTOR_TOKEN_PREFIX = "soc_mcp_";
/** 32 random bytes, base64url without padding. */
const TOKEN_PATTERN = /^soc_mcp_[A-Za-z0-9_-]{43}$/;

export const DEFAULT_TOKEN_DAYS = 90;
export const MAX_TOKEN_DAYS = 365;
export const MAX_TOKEN_NAME_LENGTH = 80;
/** Active tokens one person may hold in one workspace. */
export const MAX_ACTIVE_TOKENS_PER_USER = 10;

/** Requests per token per minute (fixed window). Operators can lower or raise it. */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export type ConnectorScopeKind = "read" | "write";
export type ConnectorScope = { permission: string; kind: ConnectorScopeKind; label: string; description: string };

const SCOPE_TEXT: Record<string, { label: string; description: string }> = {
  "society:read": { label: "Workspace overview", description: "The governance snapshot: compliance flags and what needs attention." },
  "meetings:read": { label: "Meetings", description: "Meeting dates, titles and status." },
  "minutes:read": { label: "Minutes and transcripts", description: "Draft and approved minutes and motions, and working transcripts if your role keeps the minutes. In-camera sessions stay hidden." },
  "documents:read": { label: "Documents", description: "Documents your role can open, and their extracted text." },
  "tasks:read": { label: "Tasks", description: "Task titles, status, due dates and descriptions." },
  "deadlines:read": { label: "Deadlines", description: "Compliance deadlines and what is overdue." },
  "filings:read": { label: "Filings", description: "Filing due dates and status, in the snapshot." },
  "commitments:read": { label: "Commitments", description: "Recurring obligations from contracts, grants and policies." },
  "tasks:write": { label: "Create tasks", description: "Propose up to eight tasks per call. Nothing is added until someone approves the draft in AI agents → AI tool drafts." },
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function remoteTools(): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => toolRunsOn(tool, "remote"));
}

/** Permissions the remote read tools use. A read-only token holds a subset of these. */
export const CONNECTOR_READ_SCOPES: readonly string[] = Object.freeze(unique(
  remoteTools().filter((tool) => tool.kind === "read").flatMap((tool) => [...tool.requires, ...(tool.enrichesWith ?? [])]),
));

/** Extra permissions the remote write and draft tools need. Off unless chosen. */
export const CONNECTOR_WRITE_SCOPES: readonly string[] = Object.freeze(unique(
  remoteTools().filter((tool) => tool.kind !== "read").flatMap((tool) => [...tool.requires, ...(tool.enrichesWith ?? [])]),
).filter((permission) => !CONNECTOR_READ_SCOPES.includes(permission)));

export const CONNECTOR_SCOPES: readonly ConnectorScope[] = Object.freeze([
  ...CONNECTOR_READ_SCOPES.map((permission) => scope(permission, "read")),
  ...CONNECTOR_WRITE_SCOPES.map((permission) => scope(permission, "write")),
]);

function scope(permission: string, kind: ConnectorScopeKind): ConnectorScope {
  const text = SCOPE_TEXT[permission] ?? { label: permission, description: permission };
  return { permission, kind, ...text };
}

/** The read-only preset: every read scope the person's role holds. */
export function defaultConnectorScopes(rolePermissions: readonly string[]): string[] {
  return CONNECTOR_READ_SCOPES.filter((permission) => rolePermissions.includes(permission));
}

/**
 * Current role permissions ∩ token scopes. No scope grants in-camera reads
 * (`minutes:write` is never a connector scope; decision A5).
 */
export function effectiveConnectorPermissions(rolePermissions: readonly string[], scopes: readonly string[]): string[] {
  return rolePermissions.filter((permission) => scopes.includes(permission));
}

/**
 * The tools a token may list and call right now. `rolePermissions` (the
 * creator's current role) unlocks role-only tools such as `get_transcript`;
 * without it they stay hidden.
 */
export function connectorToolsFor(permissions: readonly string[], allowedTools?: readonly string[], rolePermissions: readonly string[] = permissions): AgentTool[] {
  return agentToolsFor({ surface: "remote", permissions, rolePermissions }).filter((tool) => !allowedTools || allowedTools.includes(tool.name));
}

export type GrantRequest = { name: string; scopes: readonly string[]; expiresInDays: number; allowedTools?: readonly string[] };
export type ValidGrantRequest = { name: string; scopes: string[]; expiresInDays: number; allowedTools?: string[] };

/** Check a mint request against the creator's role. Throws a readable message. */
export function validateGrantRequest(request: GrantRequest, rolePermissions: readonly string[]): ValidGrantRequest {
  const name = request.name.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Name the token so you can recognise it later.");
  if (name.length > MAX_TOKEN_NAME_LENGTH) throw new Error(`Keep the token name under ${MAX_TOKEN_NAME_LENGTH} characters.`);
  if (!Number.isInteger(request.expiresInDays) || request.expiresInDays < 1 || request.expiresInDays > MAX_TOKEN_DAYS) {
    throw new Error(`Choose an expiry between 1 and ${MAX_TOKEN_DAYS} days.`);
  }
  const scopes = unique(request.scopes);
  if (!scopes.length) throw new Error("Choose at least one scope.");
  const known = CONNECTOR_SCOPES.map((entry) => entry.permission);
  const unknown = scopes.filter((permission) => !known.includes(permission));
  if (unknown.length) throw new Error(`AI connectors can't use ${unknown.join(", ")}.`);
  const notHeld = scopes.filter((permission) => !rolePermissions.includes(permission));
  if (notHeld.length) throw new Error(`Your role doesn't include ${notHeld.join(", ")}, so the token can't either.`);
  let allowedTools: string[] | undefined;
  if (request.allowedTools) {
    allowedTools = unique(request.allowedTools);
    const remote = remoteTools().map((tool) => tool.name);
    const unknownTools = allowedTools.filter((tool) => !remote.includes(tool));
    if (unknownTools.length) throw new Error(`Unknown tools: ${unknownTools.join(", ")}.`);
    if (!connectorToolsFor(scopes, allowedTools, rolePermissions).length) throw new Error("None of the chosen tools works with the chosen scopes.");
  }
  return { name, scopes, expiresInDays: request.expiresInDays, ...(allowedTools ? { allowedTools } : {}) };
}

export function isConnectorTokenShape(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A new token. Only call this where `crypto.getRandomValues` is a real CSPRNG (an action, not a query or mutation). */
export function generateConnectorToken(): string {
  return `${CONNECTOR_TOKEN_PREFIX}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/** What the database stores: the hex SHA-256 of the whole token. */
export async function hashConnectorToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Enough of the token to recognise it in a list: the prefix and its last four characters. */
export function connectorTokenHint(token: string): string {
  return `${CONNECTOR_TOKEN_PREFIX}…${token.slice(-4)}`;
}

export function rateLimitPerMinute(env: Record<string, string | undefined>): number {
  const configured = Number(env.SOCIETYER_MCP_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_RATE_LIMIT_PER_MINUTE;
}

/** Browser origins allowed to call /mcp (comma-separated). Requests without an Origin header (CLI clients) don't need one. */
export function allowedConnectorOrigins(env: Record<string, string | undefined>): string[] {
  return (env.SOCIETYER_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

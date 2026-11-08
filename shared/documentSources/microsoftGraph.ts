import { MICROSOFT_DOCUMENT_SOURCE_CAPABILITIES } from "./configuration";
import {
  assertReferenceMatchesSource,
  DocumentSourceError,
  microsoftSiteIdentity,
  validateDocumentSourceActor,
  validateMicrosoftDocumentLocator,
  validateMicrosoftDocumentSource,
  validateMicrosoftDocumentWebUrl,
  validateMicrosoftResourceId,
} from "./policy";
import {
  MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
  type DocumentSourceActor,
  type DocumentSourceAdapter,
  type DocumentSourceErrorCode,
  type DocumentSourcePage,
  type ExternalDocumentItem,
  type MicrosoftDocumentLocator,
  type MicrosoftDocumentSource,
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_METADATA_BYTES = 1024 * 1024;
const PAGE_SIZE = 100;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const ITEM_FIELDS = "id,name,file,folder,package,size,lastModifiedDateTime,webUrl,eTag,parentReference,remoteItem,deleted,sharepointIds";
const ALLOWED_SCOPES = new Set(["user.read", "sites.selected", "openid", "profile", "email", "offline_access"]);

export type MicrosoftGraphDocumentSourceDependencies = {
  fetch?: typeof fetch;
  /** Called once per operation with the server-authenticated actor and approved source. */
  getDelegatedToken(actor: DocumentSourceActor, source: MicrosoftDocumentSource): Promise<string>;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) {
    throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
  }
  return value;
}

function jwtObject(segment: string): Record<string, unknown> {
  if (!/^[a-z\d_-]+$/i.test(segment)) throw new Error("Unsupported token encoding.");
  const bytes = Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Unsupported token claims.");
  return parsed as Record<string, unknown>;
}

/**
 * These unverified claims only constrain the accepted token's tenant, client,
 * user and scopes. This is NOT JWT signature or audience validation. The SAME
 * bearer must subsequently succeed at Graph /me; Graph performs token
 * validation. No metadata request runs before that succeeds and oid matches.
 *
 * Fail closed for opaque/encrypted tokens. A future server-side OBO connector
 * can support those formats without accepting tokens issued to other clients.
 */
function constrainTokenBinding(token: unknown, source: MicrosoftDocumentSource): { token: string; oid: string } {
  try {
    if (typeof token !== "string" || !token || token.length > 32_768 || /\s/.test(token)) throw new Error("Invalid token.");
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every(part => /^[a-z\d_-]+$/i.test(part))) throw new Error("Unsupported token format.");
    const header = jwtObject(parts[0]);
    const claims = jwtObject(parts[1]);
    if (typeof header.alg !== "string" || header.alg.toLowerCase() === "none"
        || typeof claims.tid !== "string" || claims.tid.toLowerCase() !== source.config.tenantId
        || typeof claims.oid !== "string" || !UUID.test(claims.oid)
        || typeof claims.scp !== "string" || "roles" in claims
        || (claims.idtyp !== undefined && claims.idtyp !== "user")) throw new Error("Invalid delegated binding.");
    const clientClaims = [claims.azp, claims.appid].filter(value => value !== undefined);
    if (!clientClaims.length || clientClaims.some(value => typeof value !== "string" || value.toLowerCase() !== source.config.clientId)) {
      throw new Error("Invalid client binding.");
    }
    const scopes = new Set(claims.scp.toLowerCase().split(/\s+/).filter(Boolean));
    if (!scopes.has("user.read") || !scopes.has("sites.selected") || [...scopes].some(scope => !ALLOWED_SCOPES.has(scope))) {
      throw new Error("Unsupported delegated scopes.");
    }
    return { token, oid: claims.oid.toLowerCase() };
  } catch {
    throw new DocumentSourceError("DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED");
  }
}

async function cancel(response: Response) {
  try { await response.body?.cancel(); } catch { /* Never surface transport errors or bearer URLs. */ }
}

async function metadataJson(response: Response): Promise<unknown> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_METADATA_BYTES || !response.body) {
    await cancel(response);
    throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_METADATA_BYTES) {
        try { await reader.cancel(); } catch { /* Bounded failure. */ }
        throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
  } finally { reader.releaseLock(); }
}

function metadataUrl(path: string, select: string): string {
  const url = new URL(GRAPH + path);
  url.searchParams.set("$select", select);
  return url.href;
}

function childrenUrl(source: MicrosoftDocumentSource, parentItemId?: string): string {
  const parent = parentItemId ? "items/" + encodeURIComponent(parentItemId) : "root";
  const url = new URL(metadataUrl("/drives/" + encodeURIComponent(source.config.driveId) + "/" + parent + "/children", ITEM_FIELDS));
  url.searchParams.set("$top", String(PAGE_SIZE));
  return url.href;
}

/** A cursor can only continue this exact folder, with bounded metadata selection. */
function continuation(value: unknown, initialUrl: string): string {
  const code = "DOCUMENT_SOURCE_OUT_OF_SCOPE";
  if (typeof value !== "string" || !value || value.length > 16_384 || /[\x00-\x20\x7f\\]/.test(value)) throw new DocumentSourceError(code);
  let incoming: URL;
  const expected = new URL(initialUrl);
  try { incoming = new URL(value); } catch { throw new DocumentSourceError(code); }
  let path: string;
  try { path = decodeURIComponent(incoming.pathname); } catch { throw new DocumentSourceError(code); }
  if (incoming.origin !== expected.origin || incoming.username || incoming.password || incoming.hash
      || path !== decodeURIComponent(expected.pathname) || /[%\\]/.test(path)) throw new DocumentSourceError(code);
  const seen = new Set<string>();
  let hasPosition = false;
  for (const [key, value] of incoming.searchParams) {
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) throw new DocumentSourceError(code);
    seen.add(normalized);
    if (normalized === "$select") {
      const fields = value.split(",").map(field => field.trim().toLowerCase()).sort().join(",");
      if (fields !== ITEM_FIELDS.toLowerCase().split(",").sort().join(",")) throw new DocumentSourceError(code);
    } else if (normalized === "$top") {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > PAGE_SIZE) throw new DocumentSourceError(code);
    } else if (normalized === "$skiptoken") {
      if (!value || value.length > 12_000 || /[\x00-\x1f\x7f]/.test(value)) throw new DocumentSourceError(code);
      expected.searchParams.set("$skiptoken", value);
      hasPosition = true;
    } else if (normalized === "$skip") {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new DocumentSourceError(code);
      expected.searchParams.set("$skip", value);
      hasPosition = true;
    } else throw new DocumentSourceError(code);
  }
  if (!hasPosition) throw new DocumentSourceError(code);
  return expected.href;
}

function itemMetadata(value: unknown, source: MicrosoftDocumentSource, expectedItemId?: string): ExternalDocumentItem {
  const item = record(value);
  if (item.remoteItem !== undefined && item.remoteItem !== null) throw new DocumentSourceError("DOCUMENT_SOURCE_OUT_OF_SCOPE");
  if (item.deleted !== undefined && item.deleted !== null) throw new DocumentSourceError("DOCUMENT_SOURCE_NOT_FOUND");
  let id: string;
  try { id = validateMicrosoftResourceId(item.id); } catch { throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE"); }
  const parent = record(item.parentReference);
  if ((expectedItemId && id !== expectedItemId) || parent.driveId !== source.config.driveId
      || (parent.siteId !== undefined && String(parent.siteId).toLowerCase() !== source.config.siteId)) {
    throw new DocumentSourceError("DOCUMENT_SOURCE_OUT_OF_SCOPE");
  }
  if (item.sharepointIds !== undefined && item.sharepointIds !== null) {
    const ids = record(item.sharepointIds);
    const site = microsoftSiteIdentity(source.config.siteId);
    if ((ids.tenantId !== undefined && String(ids.tenantId).toLowerCase() !== source.config.tenantId)
        || (ids.siteId !== undefined && String(ids.siteId).toLowerCase() !== site.siteCollectionId)
        || (ids.webId !== undefined && String(ids.webId).toLowerCase() !== site.webId)) {
      throw new DocumentSourceError("DOCUMENT_SOURCE_OUT_OF_SCOPE");
    }
  }
  const isFile = item.file !== undefined && item.file !== null;
  const isFolder = item.folder !== undefined && item.folder !== null;
  if (isFile === isFolder) throw new DocumentSourceError("DOCUMENT_SOURCE_UNSUPPORTED");
  const facet = record(isFile ? item.file : item.folder);
  const name = optionalText(item.name, 1024);
  if (!name) throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
  const result: ExternalDocumentItem = {
    locator: { tenantId: source.config.tenantId, siteId: source.config.siteId, driveId: source.config.driveId, itemId: id },
    kind: isFile ? "file" : "folder",
    name,
  };
  const mimeType = isFile ? optionalText(facet.mimeType, 255) : undefined;
  if (mimeType !== undefined) result.mimeType = mimeType;
  if (item.size !== undefined) {
    if (typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size < 0) throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
    result.sizeBytes = item.size;
  }
  if (item.lastModifiedDateTime !== undefined) {
    const timestamp = optionalText(item.lastModifiedDateTime, 128);
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
    result.modifiedAtISO = new Date(timestamp).toISOString();
  }
  const eTag = optionalText(item.eTag, 2048);
  if (eTag !== undefined) result.eTag = eTag;
  if (item.webUrl !== undefined) result.webUrl = validateMicrosoftDocumentWebUrl(item.webUrl, source.config);
  // Explicit projection excludes download URLs, permissions, raw payloads and tokens.
  return result;
}

/** No app-only fallback, persistent tokens, file bytes, sharing links or writes. */
export function createMicrosoftGraphDocumentSource(
  dependencies: MicrosoftGraphDocumentSourceDependencies,
): DocumentSourceAdapter<MicrosoftDocumentSource, MicrosoftDocumentLocator> {
  const request = dependencies.fetch ?? fetch;

  async function get(url: string, token: string, userProbe = false): Promise<unknown> {
    let response: Response;
    try {
      response = await request(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new DocumentSourceError("DOCUMENT_SOURCE_UNAVAILABLE"); }
    if (!response.ok || response.redirected) {
      let code: DocumentSourceErrorCode = "DOCUMENT_SOURCE_UNAVAILABLE";
      if (response.status === 401 || (userProbe && response.status === 400)) code = "DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED";
      else if (response.status === 403) code = "DOCUMENT_SOURCE_FORBIDDEN";
      else if (response.status === 404 || response.status === 410) code = "DOCUMENT_SOURCE_NOT_FOUND";
      else if (response.status === 429) code = "DOCUMENT_SOURCE_RATE_LIMITED";
      await cancel(response);
      throw new DocumentSourceError(code);
    }
    return metadataJson(response);
  }

  async function authorizedContext(sourceValue: MicrosoftDocumentSource, actorValue: DocumentSourceActor) {
    const source = validateMicrosoftDocumentSource(sourceValue);
    if (!source.enabled) throw new DocumentSourceError("DOCUMENT_SOURCE_DISABLED");
    const actor = validateDocumentSourceActor(actorValue);
    let supplied: string;
    try { supplied = await dependencies.getDelegatedToken(actor, source); }
    catch { throw new DocumentSourceError("DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED"); }
    const binding = constrainTokenBinding(supplied, source);
    // Graph, not the unverified local claims, validates this bearer.
    const me = record(await get(metadataUrl("/me", "id"), binding.token, true));
    if (typeof me.id !== "string" || !UUID.test(me.id) || me.id.toLowerCase() !== binding.oid) {
      throw new DocumentSourceError("DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED");
    }
    const drive = record(await get(metadataUrl("/drives/" + encodeURIComponent(source.config.driveId), "id,driveType,sharepointIds,webUrl"), binding.token));
    if (drive.id !== source.config.driveId || drive.driveType !== "documentLibrary") {
      throw new DocumentSourceError("DOCUMENT_SOURCE_OUT_OF_SCOPE");
    }
    const ids = record(drive.sharepointIds);
    const site = microsoftSiteIdentity(source.config.siteId);
    if (typeof ids.tenantId !== "string" || ids.tenantId.toLowerCase() !== source.config.tenantId
        || typeof ids.siteId !== "string" || ids.siteId.toLowerCase() !== site.siteCollectionId
        || typeof ids.webId !== "string" || ids.webId.toLowerCase() !== site.webId) {
      throw new DocumentSourceError("DOCUMENT_SOURCE_OUT_OF_SCOPE");
    }
    validateMicrosoftDocumentWebUrl(drive.webUrl, source.config);
    if (ids.siteUrl !== undefined) {
      const actual = new URL(validateMicrosoftDocumentWebUrl(ids.siteUrl, source.config));
      const approved = new URL(source.config.siteUrl);
      if (decodeURIComponent(actual.pathname).replace(/\/+$/, "").toLowerCase()
          !== decodeURIComponent(approved.pathname).replace(/\/+$/, "").toLowerCase() || actual.search) {
        throw new DocumentSourceError("DOCUMENT_SOURCE_OUT_OF_SCOPE");
      }
    }
    return { source, token: binding.token };
  }

  return {
    providerId: MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
    capabilities: MICROSOFT_DOCUMENT_SOURCE_CAPABILITIES,
    async browse({ source: sourceValue, actor, parentItemId: parentValue, cursor }): Promise<DocumentSourcePage> {
      const source = validateMicrosoftDocumentSource(sourceValue);
      if (!source.enabled) throw new DocumentSourceError("DOCUMENT_SOURCE_DISABLED");
      const parentItemId = parentValue === undefined ? undefined : validateMicrosoftResourceId(parentValue);
      const initialUrl = childrenUrl(source, parentItemId);
      const url = cursor === undefined ? initialUrl : continuation(cursor, initialUrl);
      const authorized = await authorizedContext(source, actor);
      if (parentItemId) {
        const parent = itemMetadata(await get(metadataUrl("/drives/" + encodeURIComponent(source.config.driveId) + "/items/" + encodeURIComponent(parentItemId), ITEM_FIELDS), authorized.token), source, parentItemId);
        if (parent.kind !== "folder") throw new DocumentSourceError("DOCUMENT_SOURCE_UNSUPPORTED");
      }
      const page = record(await get(url, authorized.token));
      if (!Array.isArray(page.value) || page.value.length > PAGE_SIZE) throw new DocumentSourceError("DOCUMENT_SOURCE_INVALID_RESPONSE");
      const nextCursor = page["@odata.nextLink"] === undefined ? undefined : continuation(page["@odata.nextLink"], initialUrl);
      const items: ExternalDocumentItem[] = [];
      for (const value of page.value) {
        const entry = record(value);
        // Shortcuts can point into employee drives; never display or follow them.
        if (entry.remoteItem !== undefined && entry.remoteItem !== null) continue;
        if (entry.deleted !== undefined && entry.deleted !== null) continue;
        if (entry.package !== undefined && entry.package !== null) continue;
        items.push(itemMetadata(entry, source));
      }
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
    async resolve({ source: sourceValue, actor, locator: locatorValue }) {
      const source = validateMicrosoftDocumentSource(sourceValue);
      if (!source.enabled) throw new DocumentSourceError("DOCUMENT_SOURCE_DISABLED");
      const locator = validateMicrosoftDocumentLocator(locatorValue);
      assertReferenceMatchesSource({ providerId: source.providerId, sourceId: source.id, locator, mode: "latest" }, source);
      const authorized = await authorizedContext(source, actor);
      const url = metadataUrl("/drives/" + encodeURIComponent(locator.driveId) + "/items/" + encodeURIComponent(locator.itemId), ITEM_FIELDS);
      return itemMetadata(await get(url, authorized.token), source, locator.itemId);
    },
  };
}

import {
  MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
  type DocumentSourceActor,
  type DocumentSourceErrorCode,
  type ExternalDocumentReference,
  type MicrosoftDocumentLocator,
  type MicrosoftDocumentSource,
  type MicrosoftDocumentSourceConfig,
} from "./types";

const MESSAGES: Record<DocumentSourceErrorCode, string> = {
  DOCUMENT_SOURCE_DISABLED: "This external document source is disabled.",
  DOCUMENT_SOURCE_INVALID_CONFIGURATION: "Check the source label, tenant, application, site, library and organizational site URL.",
  DOCUMENT_SOURCE_INVALID_REFERENCE: "This external document reference is invalid.",
  DOCUMENT_SOURCE_OUT_OF_SCOPE: "The document is outside this source's approved SharePoint site or library.",
  DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED: "Connect your Microsoft account for this source and try again.",
  DOCUMENT_SOURCE_FORBIDDEN: "Your Microsoft account or application does not have access to this source.",
  DOCUMENT_SOURCE_NOT_FOUND: "This document is unavailable or your Microsoft account cannot access it.",
  DOCUMENT_SOURCE_RATE_LIMITED: "Microsoft is limiting requests. Try again shortly.",
  DOCUMENT_SOURCE_UNAVAILABLE: "The external document source is temporarily unavailable.",
  DOCUMENT_SOURCE_INVALID_RESPONSE: "Microsoft returned document metadata that could not be verified.",
  DOCUMENT_SOURCE_UNSUPPORTED: "This document source or reference type is not supported.",
};

/** Fixed public messages never include provider response bodies or credentials. */
export class DocumentSourceError extends Error {
  constructor(readonly code: DocumentSourceErrorCode) {
    super(MESSAGES[code]);
    this.name = "DocumentSourceError";
  }
  toJSON() { return { code: this.code, message: this.message }; }
}

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const RESOURCE_ID = /^[a-z\d!._-]+$/i;
const SOURCE_ID = /^[a-z\d][a-z\d._:-]*$/i;
const CONFIG_ERROR = "DOCUMENT_SOURCE_INVALID_CONFIGURATION" as const;
const REFERENCE_ERROR = "DOCUMENT_SOURCE_INVALID_REFERENCE" as const;
const SECRET_TEXT = /\b(?:Bearer\s+\S+|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+|(?:client_secret|access_token|refresh_token|password)\s*[:=])/i;

function object(value: unknown, fields: readonly string[], code: DocumentSourceErrorCode): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !fields.includes(key))) throw new DocumentSourceError(code);
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, code: DocumentSourceErrorCode): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum
      || /[\x00-\x1f\x7f]/.test(value) || SECRET_TEXT.test(value)) throw new DocumentSourceError(code);
  return value.trim();
}

function uuid(value: unknown, code: DocumentSourceErrorCode): string {
  const result = text(value, 36, code).toLowerCase();
  if (!UUID.test(result)) throw new DocumentSourceError(code);
  return result;
}

export function validateMicrosoftResourceId(value: unknown, code: DocumentSourceErrorCode = REFERENCE_ERROR): string {
  const result = text(value, 512, code);
  if (!RESOURCE_ID.test(result) || result === "." || result === "..") throw new DocumentSourceError(code);
  return result;
}

function sourceId(value: unknown, code: DocumentSourceErrorCode): string {
  const result = text(value, 256, code);
  if (!SOURCE_ID.test(result)) throw new DocumentSourceError(code);
  return result;
}

function organizationalHost(hostname: string): boolean {
  return /^[a-z\d](?:[a-z\d-]*[a-z\d])?\.sharepoint\.com$/i.test(hostname)
    && !/-my\.sharepoint\.com$/i.test(hostname);
}

function safePath(url: URL, code: DocumentSourceErrorCode): string {
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { throw new DocumentSourceError(code); }
  if (/[\\\x00-\x1f\x7f]/.test(path) || /%(?:25)*(?:2e|2f|5c)/i.test(path)
      || path.split("/").some(part => part === "." || part === "..")
      || /^\/personal(?:\/|$)/i.test(path)) throw new DocumentSourceError(code);
  return path.replace(/\/+$/, "") || "/";
}

function siteUrl(value: unknown, code: DocumentSourceErrorCode): URL {
  const input = text(value, 2048, code);
  let url: URL;
  try { url = new URL(input); } catch { throw new DocumentSourceError(code); }
  if (url.protocol !== "https:" || !organizationalHost(url.hostname) || url.port
      || url.username || url.password || url.search || url.hash || input.includes("\\")) throw new DocumentSourceError(code);
  safePath(url, code);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

/** Canonical site identity binds the host, site collection and web. */
export function microsoftSiteIdentity(value: unknown, code: DocumentSourceErrorCode = REFERENCE_ERROR) {
  const result = text(value, 512, code).toLowerCase();
  const [hostname, siteCollectionId, webId, extra] = result.split(",");
  if (extra !== undefined || !hostname || !organizationalHost(hostname)
      || !UUID.test(siteCollectionId ?? "") || !UUID.test(webId ?? "")) throw new DocumentSourceError(code);
  return { siteId: result, hostname, siteCollectionId, webId };
}

export function validateMicrosoftDocumentSourceConfig(value: unknown): MicrosoftDocumentSourceConfig {
  const input = object(value, ["tenantId", "clientId", "siteId", "driveId", "siteUrl"], CONFIG_ERROR);
  const tenantId = uuid(input.tenantId, CONFIG_ERROR);
  if (tenantId === CONSUMER_TENANT) throw new DocumentSourceError(CONFIG_ERROR);
  const site = microsoftSiteIdentity(input.siteId, CONFIG_ERROR);
  const url = siteUrl(input.siteUrl, CONFIG_ERROR);
  if (site.hostname !== url.hostname) throw new DocumentSourceError(CONFIG_ERROR);
  return Object.freeze({
    tenantId,
    clientId: uuid(input.clientId, CONFIG_ERROR),
    siteId: site.siteId,
    driveId: validateMicrosoftResourceId(input.driveId, CONFIG_ERROR),
    siteUrl: url.href.replace(/\/$/, ""),
  });
}

export function validateMicrosoftDocumentSource(value: unknown): MicrosoftDocumentSource {
  const input = object(value, ["id", "providerId", "label", "enabled", "config"], CONFIG_ERROR);
  if (input.providerId !== MICROSOFT_DOCUMENT_SOURCE_PROVIDER) throw new DocumentSourceError("DOCUMENT_SOURCE_UNSUPPORTED");
  if (typeof input.enabled !== "boolean") throw new DocumentSourceError(CONFIG_ERROR);
  return Object.freeze({
    id: sourceId(input.id, CONFIG_ERROR),
    providerId: MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
    label: text(input.label, 160, CONFIG_ERROR),
    enabled: input.enabled,
    config: validateMicrosoftDocumentSourceConfig(input.config),
  });
}

export function validateDocumentSourceActor(value: unknown): DocumentSourceActor {
  const code = "DOCUMENT_SOURCE_AUTHENTICATION_REQUIRED";
  const input = object(value, ["userId", "societyId"], code);
  return Object.freeze({ userId: sourceId(input.userId, code), societyId: sourceId(input.societyId, code) });
}

export function validateMicrosoftDocumentLocator(value: unknown): MicrosoftDocumentLocator {
  const input = object(value, ["tenantId", "siteId", "driveId", "itemId"], REFERENCE_ERROR);
  const tenantId = uuid(input.tenantId, REFERENCE_ERROR);
  if (tenantId === CONSUMER_TENANT) throw new DocumentSourceError(REFERENCE_ERROR);
  return Object.freeze({
    tenantId,
    siteId: microsoftSiteIdentity(input.siteId).siteId,
    driveId: validateMicrosoftResourceId(input.driveId),
    itemId: validateMicrosoftResourceId(input.itemId),
  });
}

export function validateExternalDocumentReference(value: unknown): ExternalDocumentReference {
  const input = object(value, ["providerId", "sourceId", "locator", "mode"], REFERENCE_ERROR);
  if (input.providerId !== MICROSOFT_DOCUMENT_SOURCE_PROVIDER || input.mode !== "latest") throw new DocumentSourceError("DOCUMENT_SOURCE_UNSUPPORTED");
  return Object.freeze({
    providerId: MICROSOFT_DOCUMENT_SOURCE_PROVIDER,
    sourceId: sourceId(input.sourceId, REFERENCE_ERROR),
    locator: validateMicrosoftDocumentLocator(input.locator),
    mode: "latest",
  });
}

export function assertReferenceMatchesSource(reference: ExternalDocumentReference, source: MicrosoftDocumentSource): void {
  const ref = validateExternalDocumentReference(reference);
  const approved = validateMicrosoftDocumentSource(source);
  if (ref.sourceId !== approved.id || ref.providerId !== approved.providerId
      || ref.locator.tenantId !== approved.config.tenantId || ref.locator.siteId !== approved.config.siteId
      || ref.locator.driveId !== approved.config.driveId) throw new DocumentSourceError("DOCUMENT_SOURCE_OUT_OF_SCOPE");
}

/** Only ordinary Microsoft web URLs inside the approved site may leave the adapter. */
export function validateMicrosoftDocumentWebUrl(value: unknown, config: MicrosoftDocumentSourceConfig): string {
  const code = "DOCUMENT_SOURCE_OUT_OF_SCOPE";
  const input = text(value, 8192, code);
  let url: URL;
  try { url = new URL(input); } catch { throw new DocumentSourceError(code); }
  const approved = new URL(config.siteUrl);
  const path = safePath(url, code).toLowerCase();
  const approvedPath = safePath(approved, code).toLowerCase();
  if (url.origin !== approved.origin || url.protocol !== "https:" || url.username || url.password || url.port
      || url.hash || input.includes("\\")
      || (approvedPath !== "/" && path !== approvedPath && !path.startsWith(approvedPath + "/"))
      || [...url.searchParams.keys()].some(key => /^(access_token|refresh_token|id_token|client_secret|authorization|authkey|tempauth|token|sig|signature|download)$/i.test(key))) {
    throw new DocumentSourceError(code);
  }
  return url.href;
}

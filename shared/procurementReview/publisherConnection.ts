/**
 * The one-time connection string an administrator copies from Societyer into
 * Zoer → Societyer publishing. Zoer implements the same decoder, so keep the
 * format small and strict:
 *
 *   societyer-publisher:v1:<base64url(JSON { endpoint, key, societyId, folder })>
 *
 * base64url has no padding. The JSON has exactly those four string fields.
 * `key` is the raw 64-hex bearer key; Societyer stores only its SHA-256.
 */
import { validateWorkspaceProcurementReviewFolder } from "./paths";

export const PUBLISHER_CONNECTION_PREFIX = "societyer-publisher:v1:";
export const PUBLISHER_ENDPOINT_PATH = "/procurement-publisher";
export const PUBLISHER_KEY_PATTERN = /^[a-f0-9]{64}$/;
export type PublisherConnection = { endpoint: string; key: string; societyId: string; folder: string };

const FIELDS = ["endpoint", "key", "societyId", "folder"] as const;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** HTTPS only, except plain HTTP to this machine for local backends and tests. */
export function validatePublisherEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The publisher endpoint is not a URL."); }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(PUBLISHER_ENDPOINT_PATH) || url.href !== value)
    throw new Error("The publisher endpoint must be an exact HTTPS URL ending in " + PUBLISHER_ENDPOINT_PATH + ".");
  return value;
}

function validate(value: PublisherConnection): PublisherConnection {
  validatePublisherEndpoint(value.endpoint);
  if (!PUBLISHER_KEY_PATTERN.test(value.key)) throw new Error("The publisher key must be 64 lowercase hex characters.");
  validateWorkspaceProcurementReviewFolder(value.societyId, value.folder);
  return value;
}

const toBase64Url = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error("The connection string is not valid base64url.");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function encodePublisherConnection(value: PublisherConnection): string {
  validate(value);
  // Fixed field order so the same connection always encodes to the same text.
  const json = JSON.stringify(Object.fromEntries(FIELDS.map(field => [field, value[field]])));
  return PUBLISHER_CONNECTION_PREFIX + toBase64Url(new TextEncoder().encode(json));
}

export function decodePublisherConnection(text: string): PublisherConnection {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PUBLISHER_CONNECTION_PREFIX) || trimmed.length > 4000) throw new Error("This is not a Societyer publisher connection string.");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(trimmed.slice(PUBLISHER_CONNECTION_PREFIX.length)))); }
  catch { throw new Error("The connection string is damaged. Copy it again from Societyer."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The connection string is damaged. Copy it again from Societyer.");
  const record = parsed as Record<string, unknown>, keys = Object.keys(record);
  if (keys.length !== FIELDS.length || !FIELDS.every(field => typeof record[field] === "string")) throw new Error("The connection string has missing or extra fields.");
  return validate({ endpoint: record.endpoint as string, key: record.key as string, societyId: record.societyId as string, folder: record.folder as string });
}

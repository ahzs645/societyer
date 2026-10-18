import { SharePointAdapter, validateSharePointConnection, type SharePointConnection, type SharePointLocator } from "./sharePointAdapter";

type Environment = Record<string, string | undefined>;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
/** Bounded buffering keeps the first broker implementation inside Convex's 64 MiB memory budget. */
export const SHAREPOINT_MAX_FILE_BYTES = 8 * 1024 * 1024;

export function sharePointDeploymentConfigured(env: Environment): boolean {
  return ["SHAREPOINT_TENANT_ID", "SHAREPOINT_CLIENT_ID", "SHAREPOINT_CLIENT_SECRET", "SHAREPOINT_SITE_ID", "SHAREPOINT_DRIVE_ID", "SHAREPOINT_TRANSFER_HOSTS"].every(key => Boolean(env[key]?.trim()));
}

export function sharePointDeployment(env: Environment): SharePointConnection {
  if (!sharePointDeploymentConfigured(env)) throw new Error("SharePoint storage requires the approved tenant, application credentials, site, drive and transfer hosts.");
  const maxFileBytes = Number(env.SHAREPOINT_MAX_FILE_BYTES ?? SHAREPOINT_MAX_FILE_BYTES);
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > SHAREPOINT_MAX_FILE_BYTES) throw new Error("SharePoint broker files must be at most 8 MiB.");
  if (!UUID.test(env.SHAREPOINT_CLIENT_ID!)) throw new Error("SharePoint requires an application client UUID.");
  return validateSharePointConnection({
    tenantId: env.SHAREPOINT_TENANT_ID!, siteId: env.SHAREPOINT_SITE_ID!, driveId: env.SHAREPOINT_DRIVE_ID!,
    authorizationMode: "application", maxFileBytes,
    transferHosts: env.SHAREPOINT_TRANSFER_HOSTS!.split(",").map(host => host.trim()).filter(Boolean),
  });
}

/** Graph application token: never use an administrator's password or a browser token. */
export function createSharePointTokenSupplier(env: Environment, request: typeof fetch = fetch) {
  const connection = sharePointDeployment(env);
  let cached: { accessToken: string; expiresAt: number } | undefined;
  return async (binding: { tenantId: string; authorizationMode: string; audience: string }) => {
    if (binding.tenantId !== connection.tenantId || binding.authorizationMode !== "application" || binding.audience !== "https://graph.microsoft.com") throw new Error("Graph token request is outside the approved connection.");
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
    let response: Response;
    try {
      response = await request(`https://login.microsoftonline.com/${connection.tenantId}/oauth2/v2.0/token`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.SHAREPOINT_CLIENT_ID!, client_secret: env.SHAREPOINT_CLIENT_SECRET!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
      });
    } catch { throw new Error("Microsoft application authentication failed."); }
    if (!response.ok) throw new Error(`Microsoft application authentication rejected (${response.status}).`);
    const data = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown; token_type?: unknown } | null;
    if (!data || typeof data.access_token !== "string" || !data.access_token || /[\r\n]/.test(data.access_token) || data.token_type?.toString().toLowerCase() !== "bearer" || typeof data.expires_in !== "number" || data.expires_in <= 60) throw new Error("Microsoft returned an invalid application token.");
    cached = { accessToken: data.access_token, expiresAt: Date.now() + Math.min(data.expires_in, 86400) * 1000 };
    return cached.accessToken;
  };
}

export function createDeploymentSharePointAdapter(env: Environment, request: typeof fetch = fetch) {
  return new SharePointAdapter(sharePointDeployment(env), { token: createSharePointTokenSupplier(env, request), fetch: request });
}

export function encodeSharePointLocator(locator: SharePointLocator): string {
  return `sharepoint:${JSON.stringify(locator)}`;
}

export function decodeSharePointLocator(key: string, connection: SharePointConnection): SharePointLocator {
  if (!key.startsWith("sharepoint:") || key.length > 4096) throw new Error("Invalid SharePoint document locator.");
  let value: SharePointLocator;
  try { value = JSON.parse(key.slice("sharepoint:".length)); } catch { throw new Error("Invalid SharePoint document locator."); }
  if (!value || value.provider !== "sharepoint" || value.tenantId !== connection.tenantId || value.siteId !== connection.siteId || value.driveId !== connection.driveId || typeof value.itemId !== "string" || !/^[a-z\d!._-]+$/i.test(value.itemId) || value.itemId.length > 512 || (value.versionId !== undefined && (typeof value.versionId !== "string" || !value.versionId || value.versionId.length > 512 || /[\x00-\x1f]/.test(value.versionId)))) throw new Error("SharePoint document is outside the approved connection.");
  return value;
}

/** Never buffer an unbounded request, even when Content-Length is missing or forged. */
export async function readBoundedSharePointUpload(request: Request, expectedSize: number, maximum: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > maximum) throw new Error("SharePoint upload exceeds the configured file limit.");
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) !== expectedSize) throw new Error("SharePoint upload size does not match its handle.");
  if (!request.body) throw new Error("A file body is required.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > expectedSize || length > maximum) { await reader.cancel(); throw new Error("SharePoint upload exceeds its authorized size."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (length !== expectedSize) throw new Error("SharePoint upload size does not match its handle.");
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

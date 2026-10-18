import { createSharePointTokenSupplier, sharePointDeployment } from "./sharePointDeployment";
import { validateTransferUrl } from "./meetingSourceProtocol";

/** Server only. Graph forbids /versions/{id}/content for the CURRENT version. */
export async function meetingSourceDownloadUrl(env: Record<string, string | undefined>, source: { itemId?: string; versionId?: string; eTag?: string; size: number }) {
  if (!source.itemId || !source.versionId || !source.eTag) throw new Error("Verified storage binding required.");
  const connection = sharePointDeployment(env);
  const token = await createSharePointTokenSupplier(env)({ tenantId: connection.tenantId, authorizationMode: "application", audience: "https://graph.microsoft.com" });
  const base = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(connection.driveId)}/items/${encodeURIComponent(source.itemId)}`;
  const init = { redirect: "manual" as const, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) };
  const metadata = await fetch(base, init);
  if (!metadata.ok) throw new Error("Stored file unavailable.");
  const item = await metadata.json();
  if (item.id !== source.itemId || item.parentReference?.driveId !== connection.driveId || !item.file) throw new Error("Stored file binding changed.");
  // Each delivered chunk is additionally checked against its original digest.
  const path = item.eTag === source.eTag ? "/content" : `/versions/${encodeURIComponent(source.versionId)}/content`;
  const response = await fetch(`${base}${path}`, init);
  if (response.status !== 302) throw new Error("Pinned file content unavailable.");
  return validateTransferUrl(response.headers.get("location")!, connection.transferHosts);
}

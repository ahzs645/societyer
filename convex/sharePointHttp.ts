import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { HttpRouter } from "convex/server";
import { hostedPrincipal } from "./lib/authIdentity";
import { createDeploymentSharePointAdapter, decodeSharePointLocator, encodeSharePointLocator, readBoundedSharePointUpload, sharePointDeployment, sharePointDeploymentConfigured } from "../shared/storage/sharePointDeployment";
import type { EffectiveWorkspaceStorage } from "../shared/workspaceStoragePolicy";
import { verifyUploadBytes } from "../shared/storage/uploadVerification";

/** Pinned CORS origins and JWTs, with no Microsoft tokens or bearer transfer URLs returned to clients. */
export function pinnedSiteCors(request: Request, methods: string): Headers | null {
  const origin = request.headers.get("origin");
  const allowed = (process.env.SITE_URL ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) return null;
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin" });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", methods);
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Expose-Headers", "Content-Disposition");
  return headers;
}

const cors = (request: Request) => pinnedSiteCors(request, "GET, PUT, OPTIONS");

/** The broker serves only workspaces whose effective version provider is SharePoint. */
async function workspaceUsesSharePoint(ctx: Pick<ActionCtx, "runQuery">, societyId: Id<"societies">): Promise<boolean> {
  const storage: EffectiveWorkspaceStorage = await ctx.runQuery(internal.workspaceStoragePolicies.effective, { societyId });
  return storage.documentVersionProvider === "sharepoint";
}

export function registerSharePointRoutes(http: HttpRouter) {
  for (const path of ["/document-storage/sharepoint/upload", "/document-storage/sharepoint/download"]) {
    http.route({ path, method: "OPTIONS", handler: httpAction(async (_ctx, request) => {
      const headers = cors(request); return new Response(null, { status: headers ? 204 : 403, headers: headers ?? {} });
    }) });
  }
  http.route({ path: "/document-storage/sharepoint/upload", method: "PUT", handler: httpAction(async (ctx, request) => {
    const headers = cors(request);
    if (!headers) return new Response("Origin denied.", { status: 403 });
    if (hostedPrincipal(await ctx.auth.getUserIdentity()).kind !== "user") return new Response("Authentication required.", { status: 401, headers });
    if (!sharePointDeploymentConfigured(process.env)) return new Response("SharePoint is not connected.", { status: 503, headers });
    try {
      const uploadHandleId = new URL(request.url).searchParams.get("uploadHandleId") as Id<"documentUploadHandles"> | null;
      if (!uploadHandleId) return new Response("Upload handle required.", { status: 400, headers });
      const handle = await ctx.runQuery(internal.documentVersions.uploadStatus, { uploadHandleId });
      if (!await workspaceUsesSharePoint(ctx, handle.societyId)) return new Response("SharePoint storage is not enabled for this workspace.", { status: 403, headers });
      if (handle.provider !== "sharepoint" || handle.status !== "pending") throw new Error("Invalid upload handle.");
      const connection = sharePointDeployment(process.env);
      const bytes = await readBoundedSharePointUpload(request, handle.fileSizeBytes, connection.maxFileBytes);
      const sha256 = await verifyUploadBytes(bytes.buffer as ArrayBuffer, handle.fileSizeBytes);
      // Recheck permission and atomically consume the pending transfer before sending bytes.
      await ctx.runMutation(internal.documentVersions.claimUploadHandle, { uploadHandleId, requiredProvider: "sharepoint" });
      const adapter = createDeploymentSharePointAdapter(process.env);
      const item = await adapter.upload(handle.stagingKey, bytes, { mimeType: handle.mimeType });
      const stored = await adapter.download(item.locator);
      if (await verifyUploadBytes(stored.buffer as ArrayBuffer, handle.fileSizeBytes) !== sha256) throw new Error("Stored checksum mismatch.");
      await ctx.runMutation(internal.documentVersions.markUploadVerified, { uploadHandleId, sha256, storageKey: encodeSharePointLocator(item.locator) });
      return Response.json({ verified: true }, { headers });
    } catch {
      return new Response("File transfer was not completed. Check access and storage configuration before starting a new upload.", { status: 400, headers });
    }
  }) });
  http.route({ path: "/document-storage/sharepoint/download", method: "GET", handler: httpAction(async (ctx, request) => {
    const headers = cors(request);
    if (!headers) return new Response("Origin denied.", { status: 403 });
    if (hostedPrincipal(await ctx.auth.getUserIdentity()).kind !== "user") return new Response("Authentication required.", { status: 401, headers });
    try {
      const versionId = new URL(request.url).searchParams.get("versionId") as Id<"documentVersions"> | null;
      if (!versionId) return new Response("Document version required.", { status: 400, headers });
      // The existing query enforces workspace membership and current document ACL.
      const version = await ctx.runQuery(api.documentVersions.get, { id: versionId });
      if (version.storageProvider !== "sharepoint" || !version.sha256 || !Number.isSafeInteger(version.fileSizeBytes)) throw new Error("Invalid version.");
      if (!await workspaceUsesSharePoint(ctx, version.societyId)) throw new Error("SharePoint storage is not enabled for this workspace.");
      const locator = decodeSharePointLocator(version.storageKey, sharePointDeployment(process.env));
      const bytes = await createDeploymentSharePointAdapter(process.env).download(locator);
      if (await verifyUploadBytes(bytes.buffer as ArrayBuffer, version.fileSizeBytes!) !== version.sha256) throw new Error("Stored checksum mismatch.");
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(version.fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`);
      return new Response(bytes as BodyInit, { headers });
    } catch {
      return new Response("Document is unavailable or access was denied.", { status: 403, headers });
    }
  }) });
}

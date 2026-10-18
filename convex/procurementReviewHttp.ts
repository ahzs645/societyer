import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { HttpRouter } from "convex/server";
import { hostedPrincipal } from "./lib/authIdentity";
import { pinnedSiteCors } from "./sharePointHttp";
import { createProcurementSharePointAdapter } from "../shared/procurementReview/storage";
import { deploymentCapabilities, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";
import { isProcurementReviewBlobPath, procurementReviewDrivePath } from "../shared/procurementReview/paths";

const BLOB_ROUTE = "/procurement-review/blob";
const cors = (request: Request) => pinnedSiteCors(request, "GET, OPTIONS");

/**
 * Read-only access to one workspace's published procurement snapshot: the
 * manifest, catalog parts and document blobs under its configured folder,
 * nothing else on the drive. Bytes are proxied with the deployment's
 * SharePoint application connection; no Microsoft token or transfer URL
 * reaches the browser. Integrity is checked by the reader against the manifest.
 */
export function registerProcurementReviewRoutes(http: HttpRouter) {
  http.route({ path: BLOB_ROUTE, method: "OPTIONS", handler: httpAction(async (_ctx, request) => {
    const headers = cors(request); return new Response(null, { status: headers ? 204 : 403, headers: headers ?? {} });
  }) });
  http.route({ path: BLOB_ROUTE, method: "GET", handler: httpAction(async (ctx, request) => {
    const headers = cors(request);
    if (!headers) return new Response("Origin denied.", { status: 403 });
    if (hostedPrincipal(await ctx.auth.getUserIdentity()).kind !== "user") return new Response("Authentication required.", { status: 401, headers });
    if (!deploymentCapabilities(process.env).procurementReview) return new Response(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE, { status: 503, headers });
    const params = new URL(request.url).searchParams;
    const societyId = params.get("societyId");
    const path = params.get("path");
    if (!societyId || !isProcurementReviewBlobPath(path)) return new Response("That file is not part of a published procurement snapshot.", { status: 400, headers });
    let folder: string | null;
    try {
      // The query checks membership, documents:read and that the module is on for this workspace.
      ({ folder } = await ctx.runQuery(api.procurementReview.folder, { societyId: societyId as Id<"societies"> }));
    } catch {
      return new Response("Procurement review is unavailable or access was denied.", { status: 403, headers });
    }
    if (!folder) return new Response("No SharePoint folder is set up for procurement review.", { status: 409, headers });
    try {
      const bytes = await createProcurementSharePointAdapter(process.env).downloadByPath(procurementReviewDrivePath(folder, path));
      if (!bytes) return new Response("Not published.", { status: 404, headers });
      headers.set("Content-Type", path === "manifest.json" ? "application/json" : "application/octet-stream");
      // The manifest moves on every publish and documents are workspace records: never cache in shared or browser caches.
      headers.set("Cache-Control", "private, no-store");
      return new Response(bytes as BodyInit, { headers });
    } catch {
      return new Response("SharePoint couldn't be read. Check the deployment's SharePoint connection and the folder's permissions.", { status: 502, headers });
    }
  }) });
}

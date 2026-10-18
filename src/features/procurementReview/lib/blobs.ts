/**
 * Reads snapshot files through the deployment's procurement review route
 * (convex/procurementReviewHttp.ts), or, in the no-login demo, from the
 * snapshot bundled with the app (scripts/build-procurement-review-demo.ts).
 */
import { authenticatedFetch } from "../../../lib/authToken";
import { convexAuthSiteUrl } from "../../../lib/convexSite";
import { isStaticDemoRuntime } from "../../../lib/staticRuntime";
import { DEMO_PROCUREMENT_REVIEW_DIRECTORY } from "../../../../shared/procurementReview/demo";
import { isProcurementReviewBlobPath } from "../../../../shared/procurementReview/paths";

/** Snapshot-relative path → bytes, or null when nothing is published there. */
export type BlobReader = (path: string) => Promise<Uint8Array | null>;

/** The route refused or couldn't reach SharePoint; `status` is the HTTP status. */
export class SnapshotAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function createBlobReader(
  societyId: string,
  options: { siteUrl?: string; fetch?: (input: string, init?: RequestInit) => Promise<Response> } = {},
): BlobReader {
  const siteUrl = options.siteUrl ?? convexAuthSiteUrl();
  const request = options.fetch ?? authenticatedFetch;
  return async (path) => {
    const url = `${siteUrl}/procurement-review/blob?${new URLSearchParams({ societyId, path })}`;
    let response: Response;
    try {
      // The route returns bytes directly; never forward the session token through a redirect.
      response = await request(url, { redirect: "error", cache: "no-store" });
    } catch (error) {
      throw new SnapshotAccessError(error instanceof Error && error.message === "Sign in again to continue." ? error.message : "Couldn't reach the Societyer server to read the snapshot.", 0);
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      const message = (await response.text().catch(() => "")).slice(0, 500);
      throw new SnapshotAccessError(message || `The snapshot couldn't be read (${response.status}).`, response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}

/**
 * The demo workspace's bundled snapshot, served as static files beside the app.
 * Same paths and integrity checks as a published folder; a missing file reads
 * as unpublished, including the app shell a static host serves in its place.
 */
export function createDemoBlobReader(
  options: { baseUrl?: string; fetch?: (input: string, init?: RequestInit) => Promise<Response> } = {},
): BlobReader {
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
  const root = `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${DEMO_PROCUREMENT_REVIEW_DIRECTORY}`;
  const request = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  return async (path) => {
    if (!isProcurementReviewBlobPath(path)) throw new SnapshotAccessError("That file is not part of a published procurement snapshot.", 400);
    let response: Response;
    try {
      response = await request(`${root}${path}`, { credentials: "same-origin" });
    } catch {
      throw new SnapshotAccessError("Couldn't load the demo snapshot.", 0);
    }
    if (response.status === 404 || (response.headers.get("content-type") ?? "").includes("text/html")) return null;
    if (!response.ok) throw new SnapshotAccessError(`The demo snapshot couldn't be read (${response.status}).`, response.status);
    return new Uint8Array(await response.arrayBuffer());
  };
}

/** Where this workspace's snapshot is read from in the current runtime. */
export function blobReaderFor(societyId: string): BlobReader {
  return isStaticDemoRuntime() ? createDemoBlobReader() : createBlobReader(societyId);
}

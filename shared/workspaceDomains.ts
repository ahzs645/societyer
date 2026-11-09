/**
 * Verified frontend origins for workspaces (table `workspaceDomains`).
 *
 * A mapping only chooses which workspace a domain opens first and how its
 * sign-in page looks. It never grants access: membership and the workspace's
 * sign-in policy remain the boundary. See docs/shared-workspaces/architecture.md.
 */
import type { PortableDbReader, PortableDoc } from "./portable/ctx";

export type WorkspaceDomainRow = PortableDoc & {
  origin: string;
  hostname: string;
  societyId: string;
  status: "Active" | "Disabled";
  primary: boolean;
};

/**
 * Exact origin (scheme://host[:port]) or null. Hostnames are lowercased by URL
 * parsing; paths, queries, fragments and credentials are rejected so a stored
 * value can be compared byte-for-byte with `window.location.origin`.
 */
export function normalizeWorkspaceOrigin(value: string): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) return null;
  return url.origin;
}

export function workspaceOriginHostname(origin: string): string {
  return new URL(origin).host.toLowerCase();
}

/** Active mapping for an exact origin, or null when the origin is unmapped or ambiguous. */
export async function activeWorkspaceDomain(db: PortableDbReader, origin: string): Promise<WorkspaceDomainRow | null> {
  const normalized = normalizeWorkspaceOrigin(origin);
  if (!normalized) return null;
  const rows = await db.query<WorkspaceDomainRow>("workspaceDomains")
    .withIndex("by_origin", (q) => q.eq("origin", normalized))
    .collect();
  const active = rows.filter((row) => row.status === "Active");
  // Two workspaces claiming one origin is an operator error: fail closed.
  return active.length === 1 ? active[0] : null;
}

/**
 * Origin for links sent on a workspace's behalf (provisioning, reset,
 * invitations): its canonical origin while that is still a trusted SITE_URL
 * entry, else the first SITE_URL entry. `siteUrls` is the parsed SITE_URL list.
 */
export async function workspaceLinkOrigin(db: PortableDbReader, societyId: string | undefined, siteUrls: readonly string[]): Promise<string> {
  return chooseLinkOrigin(societyId ? await primaryWorkspaceOrigin(db, societyId) : undefined, siteUrls);
}

export function chooseLinkOrigin(canonicalOrigin: string | undefined, siteUrls: readonly string[]): string {
  return canonicalOrigin && siteUrls.includes(canonicalOrigin) ? canonicalOrigin : siteUrls[0];
}

/** The workspace's canonical (primary, Active) origin, if one is configured. */
export async function primaryWorkspaceOrigin(db: PortableDbReader, societyId: string): Promise<string | undefined> {
  const rows = await db.query<WorkspaceDomainRow>("workspaceDomains")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const primary = rows.filter((row) => row.status === "Active" && row.primary);
  return primary.length === 1 ? primary[0].origin : undefined;
}

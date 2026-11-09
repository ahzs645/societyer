/**
 * Verified frontend origins per workspace (table `workspaceDomains`).
 * See docs/shared-workspaces/architecture.md and shared/workspaceDomains.ts.
 *
 *   npx convex run workspaceDomains:upsert '{"origin":"https://portal.ddcnorth.com","societyId":"…","primary":true,"status":"Active"}'
 *   npx convex run workspaceDomains:audit
 *
 * A mapping only picks the workspace a domain opens first, its sign-in page
 * branding and the origin used in links. It never grants access.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, query, type DatabaseReader } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authorizedQuery } from "./lib/authorizedServer";
import { convexPortableDb } from "./lib/portable";
import { resolveConvexAuthSiteUrls } from "../shared/authConfiguration";
import { activeWorkspaceDomain, normalizeWorkspaceOrigin, workspaceLinkOrigin, workspaceOriginHostname } from "../shared/workspaceDomains";

const statusValidator = v.union(v.literal("Active"), v.literal("Disabled"));

/** Parsed SITE_URL, or none when it is missing or malformed: callers then refuse or fall back. */
function trustedSiteOrigins(): string[] {
  try { return resolveConvexAuthSiteUrls(process.env); } catch { return []; }
}

export const upsert = internalMutation({
  args: { origin: v.string(), societyId: v.id("societies"), primary: v.boolean(), status: statusValidator, note: v.optional(v.string()) },
  returns: v.id("workspaceDomains"),
  handler: async (ctx, args) => {
    const origin = normalizeWorkspaceOrigin(args.origin);
    if (!origin) throw new Error("Give an exact origin such as https://portal.example.org, without a path, query or credentials.");
    // Better Auth only trusts SITE_URL origins, so an unlisted origin could never sign in.
    if (!resolveConvexAuthSiteUrls(process.env).includes(origin)) throw new Error(`${origin} is not in this deployment's SITE_URL. Add it there first.`);
    if (!await ctx.db.get(args.societyId)) throw new Error("Workspace not found.");
    const note = args.note?.trim();
    if (note && note.length > 500) throw new Error("Keep the note under 500 characters.");

    const sameOrigin = await ctx.db.query("workspaceDomains").withIndex("by_origin", (q) => q.eq("origin", origin)).collect();
    if (args.status === "Active" && sameOrigin.some((row) => row.status === "Active" && row.societyId !== args.societyId)) {
      throw new Error(`${origin} already opens another workspace. Disable that mapping first.`);
    }
    const now = new Date().toISOString();
    if (args.primary && args.status === "Active") {
      const others = await ctx.db.query("workspaceDomains").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
      for (const row of others) {
        if (row.origin !== origin && row.primary) await ctx.db.patch(row._id, { primary: false, updatedAtISO: now });
      }
    }
    const value = { hostname: workspaceOriginHostname(origin), primary: args.primary, status: args.status, updatedAtISO: now, note: note || undefined };
    const [existing, ...duplicates] = sameOrigin.filter((row) => row.societyId === args.societyId);
    for (const row of duplicates) await ctx.db.delete(row._id);
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return ctx.db.insert("workspaceDomains", { origin, societyId: args.societyId, createdAtISO: now, ...value });
  },
});

export const list = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("workspaceDomains").collect();
    return Promise.all(rows.map(async (row) => ({ ...row, workspaceName: (await ctx.db.get(row.societyId))?.name ?? null })));
  },
});

type DomainAuditIssue = { kind: string; origin?: string; societyId?: string; detail: string };

/** Mismatches between SITE_URL and the mappings. Each one resolves to "unmapped" at runtime. */
export const audit = internalQuery({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    siteUrls: v.array(v.string()),
    issues: v.array(v.object({ kind: v.string(), origin: v.optional(v.string()), societyId: v.optional(v.string()), detail: v.string() })),
  }),
  handler: async (ctx) => {
    const siteUrls = trustedSiteOrigins();
    const rows = await ctx.db.query("workspaceDomains").collect();
    const active = rows.filter((row) => row.status === "Active");
    const issues: DomainAuditIssue[] = [];
    if (!siteUrls.length) issues.push({ kind: "site-url-missing", detail: "SITE_URL is missing or invalid; no mapping can resolve." });
    for (const origin of siteUrls) {
      if (!active.some((row) => row.origin === origin)) issues.push({ kind: "site-url-unmapped", origin, detail: "Trusted origin with no Active mapping; it opens the remembered workspace." });
    }
    const byOrigin = new Map<string, Doc<"workspaceDomains">[]>();
    const primaries = new Map<string, Doc<"workspaceDomains">[]>();
    for (const row of active) {
      byOrigin.set(row.origin, [...(byOrigin.get(row.origin) ?? []), row]);
      if (row.primary) primaries.set(row.societyId, [...(primaries.get(row.societyId) ?? []), row]);
      if (!siteUrls.includes(row.origin)) issues.push({ kind: "mapping-not-trusted", origin: row.origin, societyId: row.societyId, detail: "Active mapping whose origin is no longer in SITE_URL; it resolves to nothing." });
      if (normalizeWorkspaceOrigin(row.origin) !== row.origin) issues.push({ kind: "origin-not-normalized", origin: row.origin, societyId: row.societyId, detail: "Stored origin is not in exact normalized form." });
      if (!await ctx.db.get(row.societyId)) issues.push({ kind: "missing-workspace", origin: row.origin, societyId: row.societyId, detail: "Mapping names a workspace that no longer exists." });
    }
    for (const [origin, list] of byOrigin) {
      if (list.length > 1) issues.push({ kind: "ambiguous-origin", origin, detail: `${list.length} Active mappings; the origin resolves to nothing until one remains.` });
    }
    for (const [societyId, list] of primaries) {
      if (list.length > 1) issues.push({ kind: "multiple-primaries", societyId, detail: `${list.length} Active primary origins; links fall back to the first SITE_URL.` });
    }
    return { ok: issues.length === 0, siteUrls, issues };
  },
});

/** Canonical link origin for a workspace (see workspaceLinkOrigin). For actions without a database. */
export const linkOrigin = internalQuery({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.string(),
  handler: async (ctx, { societyId }) => workspaceLinkOrigin(convexPortableDb(ctx.db), societyId, resolveConvexAuthSiteUrls(process.env)),
});

async function signInSummary(db: DatabaseReader, societyId: Id<"societies">) {
  const rows = await db.query("workspaceSignInPolicies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  // Package A's evaluator enforces the policy; this only labels the sign-in page.
  // Duplicate rows show the strictest method and no contact details.
  if (rows.length !== 1) return { requiredMethod: rows.some((row) => row.requiredMethod === "microsoft") ? "microsoft" as const : "any" as const };
  return { requiredMethod: rows[0].requiredMethod, ...(rows[0].supportEmail ? { supportEmail: rows[0].supportEmail } : {}) };
}

/**
 * Sign-in page presentation for the origin the browser is on. Anonymous, so it
 * returns only what that page shows anyway, and null for unknown, disabled,
 * ambiguous or no-longer-trusted origins.
 */
export const resolveOrigin = authorizedQuery("workspaceDomains:resolveOrigin", query)({
  args: { origin: v.string() },
  returns: v.union(v.null(), v.object({
    societyId: v.id("societies"),
    workspaceName: v.string(),
    origin: v.string(),
    logoUrl: v.optional(v.string()),
    logoDarkUrl: v.optional(v.string()),
    signIn: v.object({ requiredMethod: v.union(v.literal("any"), v.literal("microsoft")), supportEmail: v.optional(v.string()) }),
  })),
  handler: async (ctx, args) => {
    if (args.origin.length > 300) return null;
    const origin = normalizeWorkspaceOrigin(args.origin);
    if (!origin || !trustedSiteOrigins().includes(origin)) return null;
    const mapping = await activeWorkspaceDomain(convexPortableDb(ctx.db), origin);
    if (!mapping) return null;
    const society = await ctx.db.get(mapping.societyId as Id<"societies">);
    if (!society) return null;
    const [logoUrl, logoDarkUrl] = await Promise.all([
      society.logoStorageId ? ctx.storage.getUrl(society.logoStorageId) : null,
      society.logoDarkStorageId ? ctx.storage.getUrl(society.logoDarkStorageId) : null,
    ]);
    return {
      societyId: society._id,
      workspaceName: society.name,
      origin,
      ...(logoUrl ? { logoUrl } : {}),
      ...(logoDarkUrl ? { logoDarkUrl } : {}),
      signIn: await signInSummary(ctx.db, society._id),
    };
  },
});

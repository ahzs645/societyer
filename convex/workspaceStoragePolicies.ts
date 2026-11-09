/**
 * Operator-set storage policy per workspace (table `workspaceStoragePolicies`).
 * See docs/shared-workspaces/architecture.md and shared/workspaceStoragePolicy.ts.
 *
 *   npx convex run workspaceStoragePolicies:set '{"societyId":"…","nativeUploads":"disabled","documentVersionProvider":"sharepoint","reason":"DDC keeps files in SharePoint"}'
 *
 * Writes are internal: only someone with deployment access sets them. Members
 * read the effective result through `forWorkspace` to hide upload controls;
 * the upload guards in convex/providers/env.ts are what enforce it.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { authorizedQuery } from "./lib/authorizedServer";
import { toPortableQueryCtx } from "./lib/portable";
import { requireSocietyMembership } from "../shared/functions/access";
import { sharePointDeploymentConfigured } from "../shared/storage/sharePointDeployment";
import { deploymentNativeUploadsDisabled, effectiveWorkspaceStorage, singleStoragePolicyRow } from "../shared/workspaceStoragePolicy";
import { workspaceStorage } from "./providers/env";

const nativeUploadsValidator = v.union(v.literal("allowed"), v.literal("disabled"));
const providerValidator = v.union(v.literal("deployment-default"), v.literal("native"), v.literal("sharepoint"));
const effectiveValidator = v.object({ nativeUploads: v.boolean(), documentVersionProvider: v.union(v.literal("native"), v.literal("sharepoint")) });

export const set = internalMutation({
  args: { societyId: v.id("societies"), nativeUploads: nativeUploadsValidator, documentVersionProvider: providerValidator, reason: v.string() },
  returns: effectiveValidator,
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason || reason.length > 500) throw new Error("Give a reason of at most 500 characters.");
    if (!await ctx.db.get(args.societyId)) throw new Error("Workspace not found.");
    if (args.documentVersionProvider === "sharepoint") {
      if (!sharePointDeploymentConfigured(process.env)) throw new Error("SharePoint is not configured on this deployment.");
      // SharePoint workspaces never write native storage; say so instead of silently overriding.
      if (args.nativeUploads === "allowed") throw new Error("A SharePoint workspace must set nativeUploads to disabled.");
    }
    if (deploymentNativeUploadsDisabled(process.env) && (args.nativeUploads === "allowed" || args.documentVersionProvider === "native")) {
      throw new Error("Native file storage is disabled on this deployment (SOCIETYER_DISABLE_NATIVE_FILE_STORAGE); a workspace can't allow it.");
    }
    const rows = await ctx.db.query("workspaceStoragePolicies").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
    const value = { nativeUploads: args.nativeUploads, documentVersionProvider: args.documentVersionProvider, reason, updatedAtISO: new Date().toISOString() };
    // Collapse any duplicate an earlier bug or import left behind into one row.
    for (const extra of rows.slice(1)) await ctx.db.delete(extra._id);
    if (rows[0]) await ctx.db.patch(rows[0]._id, value);
    else await ctx.db.insert("workspaceStoragePolicies", { societyId: args.societyId, ...value });
    return effectiveWorkspaceStorage(value, process.env);
  },
});

export const get = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db.query("workspaceStoragePolicies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    let effective: unknown = null;
    try { effective = effectiveWorkspaceStorage(singleStoragePolicyRow(rows), process.env); } catch (error) { effective = { error: (error as Error).message }; }
    return { rows, effective };
  },
});

/** Effective policy for actions, which have no database of their own. Throws on an ambiguous policy. */
export const effective = internalQuery({
  args: { societyId: v.id("societies") },
  returns: effectiveValidator,
  handler: async (ctx, { societyId }) => workspaceStorage(ctx.db, societyId),
});

export const list = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("workspaceStoragePolicies").collect();
    return Promise.all(rows.map(async (row) => ({
      ...row,
      workspaceName: (await ctx.db.get(row.societyId))?.name ?? null,
      effective: effectiveWorkspaceStorage(row, process.env),
    })));
  },
});

type StorageAuditIssue = { kind: string; societyId?: string; detail: string };

/** Rows the deployment can't honour as written. Every issue resolves to the stricter behaviour at runtime. */
export const audit = internalQuery({
  args: {},
  returns: v.object({ ok: v.boolean(), issues: v.array(v.object({ kind: v.string(), societyId: v.optional(v.string()), detail: v.string() })) }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("workspaceStoragePolicies").collect();
    const issues: StorageAuditIssue[] = [];
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.societyId, (counts.get(row.societyId) ?? 0) + 1);
    for (const [societyId, count] of counts) {
      if (count > 1) issues.push({ kind: "duplicate-policy", societyId, detail: `${count} rows; storage guards refuse uploads until one remains.` });
    }
    const ceiling = deploymentNativeUploadsDisabled(process.env);
    const sharePoint = sharePointDeploymentConfigured(process.env);
    for (const row of rows) {
      const societyId = row.societyId;
      if (!await ctx.db.get(row.societyId)) issues.push({ kind: "missing-workspace", societyId, detail: "The policy names a workspace that no longer exists." });
      if (ceiling && row.nativeUploads === "allowed") issues.push({ kind: "native-above-ceiling", societyId, detail: "Allows native uploads, but the deployment disables them." });
      if (ceiling && row.documentVersionProvider === "native") issues.push({ kind: "native-versions-above-ceiling", societyId, detail: "Uses native document versions, which the deployment disables." });
      if (row.documentVersionProvider === "sharepoint" && !sharePoint) issues.push({ kind: "sharepoint-unconfigured", societyId, detail: "Uses SharePoint, but the deployment connection is not configured; versions can't be stored." });
      if (row.documentVersionProvider === "sharepoint" && row.nativeUploads === "allowed") issues.push({ kind: "sharepoint-native-allowed", societyId, detail: "SharePoint workspaces never store native files; nativeUploads is ignored." });
    }
    return { ok: issues.length === 0, issues };
  },
});

/** What the signed-in member's workspace may upload. Display only; the server guards decide. */
export const forWorkspace = authorizedQuery("workspaceStoragePolicies:forWorkspace", query)({
  args: { societyId: v.id("societies") },
  returns: effectiveValidator,
  handler: async (ctx, { societyId }) => {
    await requireSocietyMembership(await toPortableQueryCtx(ctx), societyId);
    // Duplicate rows make every upload guard refuse; show that as "no uploads"
    // rather than failing the page that asked.
    return workspaceStorage(ctx.db, societyId).catch(() => ({ nativeUploads: false, documentVersionProvider: "native" as const }));
  },
});

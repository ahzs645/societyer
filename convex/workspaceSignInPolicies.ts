/**
 * Deployment-operator tooling for per-workspace sign-in requirements.
 * Internal only: workspace Owners can't change how their own members must
 * authenticate. See docs/shared-workspaces/architecture.md.
 *
 *   npx convex run workspaceSignInPolicies:set '{"societyId":"…","requiredMethod":"microsoft",
 *     "microsoftTenantId":"…","microsoftGroupIds":["…"],"supportEmail":"it@example.org","reason":"…"}'
 */
import { v } from "convex/values";
import { z } from "zod";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hostedEntraConfig } from "../shared/hostedMicrosoftSso";
import { normalizeDirectoryId, normalizeEmailDomain } from "../shared/workspaceSignInPolicy";

const policyFields = {
  requiredMethod: v.union(v.literal("any"), v.literal("microsoft")),
  microsoftTenantId: v.optional(v.string()),
  microsoftGroupIds: v.optional(v.array(v.string())),
  allowedEmailDomains: v.optional(v.array(v.string())),
  supportEmail: v.optional(v.string()),
};

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 500) throw new Error("Give a reason of at most 500 characters for the audit log.");
  return trimmed;
}

/** The deployment's Entra login, or a clear refusal. A broken configuration is not "off". */
function deploymentEntra() {
  let config: ReturnType<typeof hostedEntraConfig>;
  try { config = hostedEntraConfig(); } catch {
    throw new Error("This deployment's Microsoft login configuration is invalid; fix it before requiring Microsoft sign-in.");
  }
  if (!config) throw new Error("Microsoft login isn't enabled on this deployment (SOCIETYER_ENTRA_LOGIN=1), so no session could meet this policy.");
  return config;
}

async function audit(ctx: MutationCtx, societyId: Id<"societies">, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId, actor: "Deployment operator", entityType: "society", entityId: societyId, subjectId: societyId,
    action, summary: summary.slice(0, 2000), createdAtISO: new Date().toISOString(),
  });
}

async function policyRows(ctx: MutationCtx, societyId: Id<"societies">) {
  return ctx.db.query("workspaceSignInPolicies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
}

export const set = internalMutation({
  args: { societyId: v.id("societies"), ...policyFields, reason: v.string() },
  returns: v.id("workspaceSignInPolicies"),
  handler: async (ctx, args) => {
    const society = await ctx.db.get(args.societyId);
    if (!society) throw new Error("Workspace not found.");
    const reason = requireReason(args.reason);

    let microsoftTenantId: string | undefined;
    let microsoftGroupIds: string[] | undefined;
    if (args.requiredMethod === "microsoft") {
      const entra = deploymentEntra();
      microsoftTenantId = normalizeDirectoryId(args.microsoftTenantId ?? "") ?? undefined;
      if (!microsoftTenantId || microsoftTenantId !== entra.tenantId) {
        throw new Error("The Microsoft tenant must be the deployment's MICROSOFT_LOGIN_TENANT_ID.");
      }
      const groups = (args.microsoftGroupIds ?? []).map(normalizeDirectoryId);
      if (!groups.length || groups.some((id) => !id || !entra.groupIds.includes(id))) {
        throw new Error("Each Microsoft group must be a UUID listed in the deployment's MICROSOFT_LOGIN_GROUP_IDS.");
      }
      microsoftGroupIds = [...new Set(groups as string[])];
    } else if (args.microsoftTenantId !== undefined || args.microsoftGroupIds !== undefined) {
      throw new Error("A Microsoft tenant or group only applies when requiredMethod is \"microsoft\".");
    }

    const domains = (args.allowedEmailDomains ?? []).map(normalizeEmailDomain);
    if (domains.some((domain) => !domain)) {
      throw new Error("Allowed email domains must be domain names, without @ or wildcards.");
    }
    const allowedEmailDomains = [...new Set(domains as string[])];
    const supportEmail = args.supportEmail?.trim();
    if (supportEmail !== undefined && !z.string().email().max(320).safeParse(supportEmail).success) {
      throw new Error("Enter a valid support email address.");
    }

    const policy = {
      societyId: args.societyId,
      requiredMethod: args.requiredMethod,
      ...(microsoftTenantId ? { microsoftTenantId, microsoftGroupIds } : {}),
      ...(allowedEmailDomains.length ? { allowedEmailDomains } : {}),
      ...(supportEmail ? { supportEmail } : {}),
      updatedAtISO: new Date().toISOString(),
      reason,
    };
    // Replace (not patch) so a field left out of this call is really cleared.
    const [existing, ...duplicates] = await policyRows(ctx, args.societyId);
    for (const row of duplicates) await ctx.db.delete(row._id);
    if (existing) await ctx.db.replace(existing._id, policy);
    const id = existing?._id ?? await ctx.db.insert("workspaceSignInPolicies", policy);
    // AI connector tokens act without a session, so the policy can't be
    // checked when they are used; it is checked when they are minted. Tokens
    // minted before a requirement existed are revoked, and members mint new
    // ones from a session that meets it.
    let revokedGrants = 0;
    if (args.requiredMethod !== "any" || allowedEmailDomains.length) {
      const nowISO = new Date().toISOString();
      for (const grant of await ctx.db.query("agentGrants").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect()) {
        if (grant.revokedAtISO) continue;
        await ctx.db.patch(grant._id, { revokedAtISO: nowISO });
        revokedGrants += 1;
      }
    }
    const requirement = args.requiredMethod === "microsoft"
      ? `Microsoft sign-in (tenant ${microsoftTenantId}, groups ${microsoftGroupIds!.join(", ")})` : "any sign-in method";
    await audit(ctx, args.societyId, "sign-in-policy-set",
      `Workspace sign-in now requires ${requirement}${allowedEmailDomains.length ? ` from ${allowedEmailDomains.map((d) => `@${d}`).join(", ")}` : ""}.${revokedGrants ? ` Revoked ${revokedGrants} AI connector token${revokedGrants === 1 ? "" : "s"} minted before the requirement.` : ""} Reason: ${reason}`);
    return id;
  },
});

export const clear = internalMutation({
  args: { societyId: v.id("societies"), reason: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const reason = requireReason(args.reason);
    const rows = await policyRows(ctx, args.societyId);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length) await audit(ctx, args.societyId, "sign-in-policy-cleared", `Workspace sign-in policy removed; any sign-in method is accepted. Reason: ${reason}`);
    return rows.length > 0;
  },
});

export const get = internalQuery({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db.query("workspaceSignInPolicies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    return rows.length === 1 ? rows[0] : rows.length ? { error: "Duplicate policy rows; run set or clear to repair.", rows } : null;
  },
});

export const list = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("workspaceSignInPolicies").take(1000);
    return Promise.all(rows.map(async (row) => ({ ...row, workspaceName: (await ctx.db.get(row.societyId))?.name ?? null })));
  },
});

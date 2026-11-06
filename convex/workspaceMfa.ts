import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { toPortableQueryCtx } from "./lib/portable";
import { hasVerifiedSecondFactor, requireSocietyMembership, workspaceMfaPolicy } from "../shared/functions/access";
import type { PortableQueryCtx } from "../shared/portable/ctx";
import { CLERK_MFA_PROOF_REFRESH_MS } from "../shared/workspaceMfa";

const policyValidator = v.union(v.literal("optional"), v.literal("owners-admins"), v.literal("everyone"));

async function requireOwner(ctx: PortableQueryCtx, societyId: string) {
  const actor = ctx.principal;
  if (actor.kind !== "user" || actor.assurance !== "verified-jwt" || actor.gatewayService ||
      (await requireSocietyMembership(ctx, societyId)).role !== "Owner") {
    throw new Error("Only a signed-in workspace Owner can manage this setting.");
  }
}

export const getPolicy = authorizedQuery("workspaceMfa:getPolicy", query)({
  args: { societyId: v.id("societies") },
  returns: policyValidator,
  handler: async (ctx, { societyId }) => {
    const portable = await toPortableQueryCtx(ctx);
    await requireOwner(portable, societyId);
    return (await workspaceMfaPolicy(portable, societyId))?.policy ?? "optional";
  },
});

export const setPolicy = authorizedMutation("workspaceMfa:setPolicy", mutation)({
  args: { societyId: v.id("societies"), policy: policyValidator },
  returns: v.null(),
  handler: async (ctx, { societyId, policy }) => {
    const portable = await toPortableQueryCtx(ctx);
    await requireOwner(portable, societyId);
    const existing = await ctx.db.query("workspaceMfaPolicies")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .unique();
    if (policy === (existing?.policy ?? "optional")) return null;
    if (!await hasVerifiedSecondFactor(portable)) {
      throw new Error("Verify two-factor authentication in this session before changing the workspace policy.");
    }
    if (policy === "optional") {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { policy });
    } else {
      await ctx.db.insert("workspaceMfaPolicies", { societyId, policy });
    }
    return null;
  },
});

const proofLifetimeMs = 24 * 60 * 60 * 1000;

export const recordClerkSession = internalMutation({
  args: { issuer: v.string(), subject: v.string(), sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, proof) => {
    const now = Date.now();
    const existing = await ctx.db.query("clerkMfaSessions")
      .withIndex("by_issuer_subject_sessionId", (q) => q
        .eq("issuer", proof.issuer).eq("subject", proof.subject).eq("sessionId", proof.sessionId))
      .unique();
    const expiresAt = now + proofLifetimeMs;
    if (!existing) await ctx.db.insert("clerkMfaSessions", { ...proof, expiresAt });
    else if (expiresAt - existing.expiresAt >= CLERK_MFA_PROOF_REFRESH_MS) await ctx.db.patch(existing._id, { expiresAt });
    return null;
  },
});

export const purgeExpiredClerkSessions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db.query("clerkMfaSessions")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now())).take(500);
    await Promise.all(expired.map((proof) => ctx.db.delete(proof._id)));
    return null;
  },
});

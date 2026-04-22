import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { canActAs, type Role } from "./users";

export const listForEntity = query({
  args: { entityType: v.string(), entityId: v.string() },
  handler: async (ctx, { entityType, entityId }) =>
    ctx.db
      .query("signatures")
      .withIndex("by_entity", (q) => q.eq("entityType", entityType).eq("entityId", entityId))
      .collect(),
});

export const sign = mutation({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    userId: v.optional(v.id("users")),
    signerName: v.string(),
    signerRole: v.optional(v.string()),
    method: v.string(),
    typedName: v.optional(v.string()),
    demo: v.optional(v.boolean()),
    actingUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actingUserId);
    if (!actor || actor.societyId !== args.societyId) throw new Error("Signature actor is not part of this society.");
    if (args.userId && args.userId !== args.actingUserId && !canActAs(actor.role as Role, "Admin")) {
      throw new Error("Only an admin can sign on behalf of another user.");
    }
    const id = await ctx.db.insert("signatures", {
      societyId: args.societyId,
      entityType: args.entityType,
      entityId: args.entityId,
      userId: args.userId,
      signerName: args.signerName,
      signerRole: args.signerRole,
      method: args.method,
      typedName: args.typedName,
      signedAtISO: new Date().toISOString(),
      demo: args.demo ?? true,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: args.signerName,
      entityType: args.entityType,
      entityId: args.entityId,
      action: "signed",
      summary: `Signed ${args.entityType} via ${args.method}${args.demo ? " (demo)" : ""}`,
      createdAtISO: new Date().toISOString(),
    });
    await ctx.db.insert("notifications", {
      societyId: args.societyId,
      kind: "signature",
      severity: "success",
      title: `Signature captured on ${args.entityType}`,
      body: `${args.signerName} signed via ${args.method}.`,
      linkHref: args.entityType === "minutes" ? `/minutes` : `/${args.entityType}s`,
      createdAtISO: new Date().toISOString(),
    });
    return id;
  },
});

export const revoke = mutation({
  args: { id: v.id("signatures"), actingUserId: v.id("users") },
  handler: async (ctx, { id, actingUserId }) => {
    const sig = await ctx.db.get(id);
    if (!sig) return;
    const actor = await ctx.db.get(actingUserId);
    if (!actor || actor.societyId !== sig.societyId) throw new Error("Signature actor is not part of this society.");
    if (sig.userId && sig.userId !== actingUserId && !canActAs(actor.role as Role, "Admin")) {
      throw new Error("Only an admin can revoke another user's signature.");
    }
    await ctx.db.delete(id);
    await ctx.db.insert("activity", {
      societyId: sig.societyId,
      actor: sig.signerName,
      entityType: sig.entityType,
      entityId: sig.entityId,
      action: "signature-revoked",
      summary: `Revoked signature on ${sig.entityType}`,
      createdAtISO: new Date().toISOString(),
    });
  },
});

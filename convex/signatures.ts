import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { canActAs, type Role } from "./users";

function normalizeSignerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

async function assertSignatureActor(
  ctx: MutationCtx,
  args: { societyId: Id<"societies">; actingUserId?: Id<"users">; userId?: Id<"users"> },
) {
  if (!args.actingUserId) return;
  const actor = await ctx.db.get(args.actingUserId);
  if (!actor || actor.societyId !== args.societyId) throw new Error("Signature actor is not part of this society.");
  if (args.userId && args.userId !== args.actingUserId && !canActAs(actor.role as Role, "Admin")) {
    throw new Error("Only an admin can sign on behalf of another user.");
  }
}

async function findExistingProfile(
  ctx: MutationCtx,
  args: {
    societyId: any;
    userId?: any;
    directorId?: any;
    memberId?: any;
    normalizedSignerName: string;
  },
) {
  const profiles = await ctx.db
    .query("signatureProfiles")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  return (
    profiles.find((profile) => args.userId && profile.userId === args.userId) ??
    profiles.find((profile) => args.directorId && profile.directorId === args.directorId) ??
    profiles.find((profile) => args.memberId && profile.memberId === args.memberId) ??
    profiles.find((profile) => profile.normalizedSignerName === args.normalizedSignerName) ??
    null
  );
}

async function upsertSignatureProfile(
  ctx: MutationCtx,
  args: {
    societyId: any;
    userId?: any;
    directorId?: any;
    memberId?: any;
    signerName: string;
    signerRole?: string;
    method: string;
    typedName?: string;
    imageDataUrl?: string;
    imageMimeType?: string;
    actingUserId?: any;
  },
) {
  const normalizedSignerName = normalizeSignerName(args.signerName);
  const now = new Date().toISOString();
  const existing = await findExistingProfile(ctx, {
    societyId: args.societyId,
    userId: args.userId,
    directorId: args.directorId,
    memberId: args.memberId,
    normalizedSignerName,
  });
  const patch = {
    societyId: args.societyId,
    userId: args.userId,
    directorId: args.directorId,
    memberId: args.memberId,
    signerName: args.signerName,
    normalizedSignerName,
    signerRole: args.signerRole,
    method: args.method,
    typedName: args.typedName,
    imageDataUrl: args.imageDataUrl,
    imageMimeType: args.imageMimeType,
    updatedAtISO: now,
    updatedByUserId: args.actingUserId,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return ctx.db.insert("signatureProfiles", {
    ...patch,
    createdAtISO: now,
    createdByUserId: args.actingUserId,
  });
}

export const listForEntity = query({
  args: { entityType: v.string(), entityId: v.string() },
  returns: v.any(),
  handler: async (ctx, { entityType, entityId }) =>
    ctx.db
      .query("signatures")
      .withIndex("by_entity", (q) => q.eq("entityType", entityType).eq("entityId", entityId))
      .collect(),
});

export const listProfilesForSociety = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("signatureProfiles")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const saveProfile = mutation({
  args: {
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    signerName: v.string(),
    signerRole: v.optional(v.string()),
    method: v.string(),
    typedName: v.optional(v.string()),
    imageDataUrl: v.optional(v.string()),
    imageMimeType: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertSignatureActor(ctx, args);
    return upsertSignatureProfile(ctx, args);
  },
});

export const sign = mutation({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    entityId: v.string(),
    userId: v.optional(v.id("users")),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
    signatureProfileId: v.optional(v.id("signatureProfiles")),
    signerName: v.string(),
    signerRole: v.optional(v.string()),
    method: v.string(),
    typedName: v.optional(v.string()),
    imageDataUrl: v.optional(v.string()),
    imageMimeType: v.optional(v.string()),
    saveToProfile: v.optional(v.boolean()),
    demo: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Signatures are kiosk-style: anyone can type/draw their own name. We only
    // enforce the actor check when one is provided AND a userId link is being
    // claimed — that's where the "admin can sign for another user" rule matters.
    await assertSignatureActor(ctx, args);

    let signatureProfileId = args.signatureProfileId;
    if (args.saveToProfile) {
      signatureProfileId = await upsertSignatureProfile(ctx, args);
    }

    const id = await ctx.db.insert("signatures", {
      societyId: args.societyId,
      entityType: args.entityType,
      entityId: args.entityId,
      userId: args.userId,
      directorId: args.directorId,
      memberId: args.memberId,
      signatureProfileId,
      signerName: args.signerName,
      signerRole: args.signerRole,
      method: args.method,
      typedName: args.typedName,
      imageDataUrl: args.imageDataUrl,
      imageMimeType: args.imageMimeType,
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
    return { signatureId: id, signatureProfileId };
  },
});

export const revoke = mutation({
  args: { id: v.id("signatures"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const sig = await ctx.db.get(id);
    if (!sig) return;
    // Symmetric with sign(): only enforce the actor check when one is given
    // AND the signature is linked to a specific user. Without an actor we
    // assume kiosk-style usage where revoking is local-session housekeeping.
    if (actingUserId) {
      const actor = await ctx.db.get(actingUserId);
      if (!actor || actor.societyId !== sig.societyId) throw new Error("Signature actor is not part of this society.");
      if (sig.userId && sig.userId !== actingUserId && !canActAs(actor.role as Role, "Admin")) {
        throw new Error("Only an admin can revoke another user's signature.");
      }
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

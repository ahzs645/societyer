import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  listForEntityPortable,
  listProfilesForSocietyPortable,
  saveProfilePortable,
  signPortable,
  revokePortable,
  deleteProfilePortable,
} from "../shared/functions/signatures";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listForEntity = query({
  args: {
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => listForEntityPortable(await toPortableQueryCtx(ctx), args),
});

export const listProfilesForSociety = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listProfilesForSocietyPortable(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => saveProfilePortable(await toPortableMutationCtx(ctx), args),
});

export const sign = mutation({
  args: {
    societyId: v.id("societies"),
    entityType: v.string(),
    subjectId: v.optional(v.string()),
    entityId: v.optional(v.string()),
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
  handler: async (ctx, args) => signPortable(await toPortableMutationCtx(ctx), args),
});

export const revoke = mutation({
  args: { id: v.id("signatures"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => revokePortable(await toPortableMutationCtx(ctx), args),
});

export const deleteProfile = mutation({
  args: { id: v.id("signatureProfiles"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => deleteProfilePortable(await toPortableMutationCtx(ctx), args),
});

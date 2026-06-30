import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { getEffectivePortable, setStatusPortable, upsertPortable } from "../shared/functions/aiSettings";

export const getEffective = query({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => getEffectivePortable(toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    id: v.optional(v.id("aiProviderSettings")),
    scope: v.string(),
    provider: v.string(),
    label: v.string(),
    modelId: v.string(),
    baseUrl: v.optional(v.string()),
    secretVaultItemId: v.optional(v.id("secretVaultItems")),
    temperature: v.optional(v.number()),
    maxSteps: v.optional(v.number()),
    validationStatus: v.optional(v.string()),
    validationMessage: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
});

export const setStatus = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    id: v.id("aiProviderSettings"),
    status: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => setStatusPortable(toPortableMutationCtx(ctx), args),
});

export const _getModelCatalogCache = internalQuery({
  args: {
    provider: v.string(),
    cacheKey: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query("aiModelCatalogCache")
      .withIndex("by_provider_cache", (q: any) => q.eq("provider", args.provider).eq("cacheKey", args.cacheKey))
      .first();
  },
});

export const _upsertModelCatalogCache = internalMutation({
  args: {
    provider: v.string(),
    cacheKey: v.string(),
    models: v.any(),
    fetchedAtISO: v.string(),
    expiresAtISO: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("aiModelCatalogCache")
      .withIndex("by_provider_cache", (q: any) => q.eq("provider", args.provider).eq("cacheKey", args.cacheKey))
      .first();
    const patch = {
      provider: args.provider,
      cacheKey: args.cacheKey,
      models: args.models,
      fetchedAtISO: args.fetchedAtISO,
      expiresAtISO: args.expiresAtISO,
      updatedAtISO: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return ctx.db.insert("aiModelCatalogCache", {
      ...patch,
      createdAtISO: now,
    });
  },
});

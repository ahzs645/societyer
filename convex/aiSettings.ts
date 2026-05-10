import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./lib/untypedServer";
import { requireRole } from "./users";

export const getEffective = query({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, actingUserId }) => {
    const personal = actingUserId
      ? await ctx.db
          .query("aiProviderSettings")
          .withIndex("by_society_user", (q: any) => q.eq("societyId", societyId).eq("userId", actingUserId))
          .collect()
      : [];
    const workspace = await ctx.db
      .query("aiProviderSettings")
      .withIndex("by_society_scope", (q: any) => q.eq("societyId", societyId).eq("scope", "workspace"))
      .collect();
    const activePersonal = personal.find((row: any) => row.status === "active");
    const activeWorkspace = workspace.find((row: any) => row.status === "active");
    const effective = activePersonal ?? activeWorkspace ?? null;
    return {
      effective: effective ? publicSetting(effective) : null,
      personal: personal.map(publicSetting),
      workspace: workspace.map(publicSetting),
    };
  },
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
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, {
      societyId: args.societyId,
      actingUserId: args.actingUserId,
      required: args.scope === "workspace" ? "Admin" : "Viewer",
    });
    const now = new Date().toISOString();
    const provider = normalizeProvider(args.provider);
    const scope = args.scope === "workspace" ? "workspace" : "personal";
    const status = args.validationStatus === "ok" ? "active" : "needs_validation";
    const patch = {
      societyId: args.societyId,
      scope,
      userId: scope === "personal" ? args.actingUserId : undefined,
      provider,
      label: args.label.trim() || labelForProvider(provider),
      modelId: args.modelId.trim() || defaultModelForProvider(provider),
      baseUrl: cleanBaseUrl(args.baseUrl),
      secretVaultItemId: args.secretVaultItemId,
      temperature: args.temperature,
      maxSteps: args.maxSteps,
      status,
      validationStatus: args.validationStatus,
      validationMessage: args.validationMessage,
      validatedAtISO: args.validationStatus === "ok" ? now : undefined,
      updatedAtISO: now,
    };
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.societyId !== args.societyId) throw new Error("AI provider setting not found.");
      if (existing.scope === "personal" && existing.userId !== args.actingUserId) throw new Error("Cannot edit another user's AI provider setting.");
      await ctx.db.patch(args.id, patch);
      return args.id;
    }
    const id = await ctx.db.insert("aiProviderSettings", {
      ...patch,
      createdByUserId: args.actingUserId,
      createdAtISO: now,
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: user?.displayName ?? "AI setup",
      entityType: "aiProviderSettings",
      entityId: String(id),
      action: "configured",
      summary: `Configured ${scope} AI provider ${patch.label}.`,
      createdAtISO: now,
    });
    return id;
  },
});

export const setStatus = mutation({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    id: v.id("aiProviderSettings"),
    status: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.societyId !== args.societyId) throw new Error("AI provider setting not found.");
    await requireRole(ctx, {
      societyId: args.societyId,
      actingUserId: args.actingUserId,
      required: existing.scope === "workspace" ? "Admin" : "Viewer",
    });
    if (existing.scope === "personal" && existing.userId !== args.actingUserId) throw new Error("Cannot edit another user's AI provider setting.");
    await ctx.db.patch(args.id, { status: args.status, updatedAtISO: new Date().toISOString() });
    return args.id;
  },
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

function publicSetting(row: any) {
  return {
    ...row,
    secretVaultItemId: row.secretVaultItemId,
    hasSecret: Boolean(row.secretVaultItemId),
  };
}

function normalizeProvider(provider: string) {
  const value = provider.trim().toLowerCase();
  if (value === "openrouter") return "openrouter";
  return value === "openai-compatible" ? value : "openai";
}

function labelForProvider(provider: string) {
  if (provider === "openrouter") return "OpenRouter";
  return provider === "openai-compatible" ? "OpenAI-compatible" : "OpenAI";
}

function defaultModelForProvider(provider: string) {
  if (provider === "openrouter") return "openai/gpt-4.1-mini";
  return provider === "openai-compatible" ? "gpt-4.1-mini" : "gpt-4.1-mini";
}

function cleanBaseUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertApiPlatformServiceToken, serviceTokenValidator } from "./lib/serviceAuth";
import { requireRole } from "./users";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import {
  listClientsPortable,
  createClientPortable,
  updateClientPortable,
  listTokensPortable,
  listPluginInstallationsPortable,
  listIntegrationCatalogPortable,
  installIntegrationPortable,
  updateIntegrationHealthPortable,
  upsertPluginInstallationPortable,
  listIntegrationSyncStatesPortable,
} from "../shared/functions/apiPlatform";

const idString = v.string();

const apiClientReturn = v.object({
  _id: v.id("apiClients"),
  _creationTime: v.number(),
  societyId: v.id("societies"),
  name: v.string(),
  description: v.optional(v.string()),
  kind: v.string(),
  status: v.string(),
  createdByUserId: v.optional(v.id("users")),
  createdAtISO: v.string(),
  updatedAtISO: v.string(),
});

const apiTokenPublicReturn = v.object({
  _id: v.id("apiTokens"),
  _creationTime: v.number(),
  societyId: v.id("societies"),
  clientId: v.id("apiClients"),
  name: v.string(),
  tokenStart: v.string(),
  scopes: v.array(v.string()),
  status: v.string(),
  expiresAtISO: v.optional(v.string()),
  createdByUserId: v.optional(v.id("users")),
  createdAtISO: v.string(),
  lastUsedAtISO: v.optional(v.string()),
  revokedAtISO: v.optional(v.string()),
});

const pluginInstallationReturn = v.object({
  _id: v.id("pluginInstallations"),
  _creationTime: v.number(),
  societyId: v.id("societies"),
  clientId: v.optional(v.id("apiClients")),
  name: v.string(),
  slug: v.string(),
  status: v.string(),
  capabilities: v.array(v.string()),
  configJson: v.optional(v.string()),
  installedByUserId: v.optional(v.id("users")),
  createdAtISO: v.string(),
  updatedAtISO: v.string(),
});

const webhookSubscriptionReturn = v.object({
  _id: v.id("webhookSubscriptions"),
  _creationTime: v.number(),
  societyId: v.id("societies"),
  clientId: v.optional(v.id("apiClients")),
  pluginInstallationId: v.optional(v.id("pluginInstallations")),
  name: v.string(),
  targetUrl: v.string(),
  eventTypes: v.array(v.string()),
  hasSecret: v.boolean(),
  status: v.string(),
  createdByUserId: v.optional(v.id("users")),
  createdAtISO: v.string(),
  updatedAtISO: v.string(),
});

const webhookSubscriptionPrivateReturn = webhookSubscriptionReturn.extend({
  secretEncrypted: v.string(),
});

const webhookDeliveryReturn = v.object({
  _id: v.id("webhookDeliveries"),
  _creationTime: v.number(),
  societyId: v.id("societies"),
  subscriptionId: v.id("webhookSubscriptions"),
  eventId: v.string(),
  eventType: v.string(),
  payloadJson: v.string(),
  status: v.string(),
  attempts: v.number(),
  attemptHistoryJson: v.optional(v.string()),
  nextAttemptAtISO: v.optional(v.string()),
  lastAttemptAtISO: v.optional(v.string()),
  lastStatusCode: v.optional(v.number()),
  lastError: v.optional(v.string()),
  createdAtISO: v.string(),
  deliveredAtISO: v.optional(v.string()),
});

const integrationSyncStateReturn = v.object({
  _id: v.id("integrationSyncStates"),
  _creationTime: v.number(),
  societyId: v.id("societies"),
  pluginInstallationId: v.optional(v.id("pluginInstallations")),
  provider: v.string(),
  resourceType: v.string(),
  resourceId: v.optional(v.string()),
  externalResourceId: v.optional(v.string()),
  syncToken: v.optional(v.string()),
  deltaLink: v.optional(v.string()),
  webhookChannelId: v.optional(v.string()),
  webhookSubscriptionId: v.optional(v.string()),
  webhookResourceId: v.optional(v.string()),
  webhookExpiresAtISO: v.optional(v.string()),
  lastFullSyncAtISO: v.optional(v.string()),
  lastIncrementalSyncAtISO: v.optional(v.string()),
  lastWebhookAtISO: v.optional(v.string()),
  status: v.string(),
  lastError: v.optional(v.string()),
  metadataJson: v.optional(v.string()),
  createdAtISO: v.string(),
  updatedAtISO: v.string(),
});

const integrationManifestReturn = v.object({
  slug: v.string(),
  name: v.string(),
  kind: v.string(),
  category: v.string(),
  summary: v.string(),
  description: v.string(),
  status: v.string(),
  capabilities: v.array(v.string()),
  requiredSecrets: v.array(v.string()),
  dataMappings: v.array(v.string()),
  auditEvents: v.array(v.string()),
  healthChecks: v.array(v.string()),
  actions: v.array(v.object({
    id: v.string(),
    label: v.string(),
    description: v.string(),
    kind: v.string(),
    scope: v.string(),
  })),
});

const integrationCatalogItemReturn = integrationManifestReturn.extend({
  installation: v.optional(pluginInstallationReturn),
  installed: v.boolean(),
  health: v.object({
    status: v.string(),
    checkedAtISO: v.optional(v.string()),
    messages: v.array(v.string()),
  }),
});

function nowISO() {
  return new Date().toISOString();
}

function redactToken(row: any) {
  const { tokenHash: _tokenHash, ...rest } = row;
  return rest;
}

function redactWebhookSubscription(row: any) {
  const { secretEncrypted, ...rest } = row;
  return {
    ...rest,
    hasSecret: Boolean(secretEncrypted),
  };
}

function privateWebhookSubscription(row: any) {
  return {
    ...redactWebhookSubscription(row),
    secretEncrypted: row.secretEncrypted,
  };
}

function parseConfigJson(value?: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function assertCanManageApiPlatform(
  ctx: any,
  societyId: any,
  actingUserId?: any,
  serviceToken?: string,
) {
  if (serviceToken) {
    await assertApiPlatformServiceToken(serviceToken);
    return;
  }
  if (!actingUserId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Admin role required.",
    });
  }
  await requireRole(ctx, { societyId, actingUserId, required: "Admin" });
}

function scopeAllows(scopes: string[], requiredScope?: string) {
  if (!requiredScope) return true;
  if (scopes.includes("*") || scopes.includes(requiredScope)) return true;
  const [resource] = requiredScope.split(":");
  return scopes.includes(`${resource}:*`);
}

function invalidToken(reason: string) {
  return { valid: false as const, reason };
}

export const listClients = query({
  args: { societyId: v.id("societies") },
  returns: v.array(apiClientReturn),
  handler: (ctx, args) => listClientsPortable(toPortableQueryCtx(ctx), args),
});

export const createClient = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    kind: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.id("apiClients"),
  handler: (ctx, args) => createClientPortable(toPortableMutationCtx(ctx), args),
});

export const updateClient = mutation({
  args: {
    id: v.id("apiClients"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      kind: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: (ctx, args) => updateClientPortable(toPortableMutationCtx(ctx), args),
});

export const listTokens = query({
  args: {
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
  },
  returns: v.array(apiTokenPublicReturn),
  handler: (ctx, args) => listTokensPortable(toPortableQueryCtx(ctx), args),
});

export const createToken = mutation({
  args: {
    societyId: v.id("societies"),
    clientId: v.id("apiClients"),
    name: v.string(),
    tokenHash: v.string(),
    tokenStart: v.string(),
    scopes: v.array(v.string()),
    expiresAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    serviceToken: serviceTokenValidator,
  },
  returns: v.id("apiTokens"),
  handler: async (ctx, args) => {
    await assertCanManageApiPlatform(
      ctx,
      args.societyId,
      args.createdByUserId,
      args.serviceToken,
    );
    const { serviceToken: _serviceToken, ...rest } = args;
    return await ctx.db.insert("apiTokens", {
      ...rest,
      status: "active",
      createdAtISO: nowISO(),
    });
  },
});

export const verifyToken = mutation({
  args: {
    tokenHash: v.string(),
    requiredScope: v.optional(v.string()),
    serviceToken: serviceTokenValidator,
  },
  returns: v.union(
    v.object({
      valid: v.literal(false),
      reason: v.string(),
    }),
    v.object({
      valid: v.literal(true),
      token: apiTokenPublicReturn,
      client: apiClientReturn,
      societyId: v.id("societies"),
      scopes: v.array(v.string()),
      userId: v.optional(v.id("users")),
    }),
  ),
  handler: async (ctx, { tokenHash, requiredScope, serviceToken }) => {
    await assertApiPlatformServiceToken(serviceToken);
    const rows = await ctx.db
      .query("apiTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .collect();
    const token = rows[0];
    if (!token) return invalidToken("unknown_token");
    if (token.status !== "active") return invalidToken("token_revoked");
    if (token.expiresAtISO && token.expiresAtISO <= nowISO()) {
      return invalidToken("token_expired");
    }
    const client = await ctx.db.get(token.clientId);
    if (!client || client.status !== "active") {
      return invalidToken("client_disabled");
    }
    if (!scopeAllows(token.scopes, requiredScope)) {
      return invalidToken("insufficient_scope");
    }
    await ctx.db.patch(token._id, { lastUsedAtISO: nowISO() });
    return {
      valid: true as const,
      token: redactToken(token),
      client,
      societyId: token.societyId,
      scopes: token.scopes,
      userId: token.createdByUserId,
    };
  },
});

export const revokeToken = mutation({
  args: { id: v.id("apiTokens") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "revoked", revokedAtISO: nowISO() });
    return null;
  },
});

export const listPluginInstallations = query({
  args: { societyId: v.id("societies") },
  returns: v.array(pluginInstallationReturn),
  handler: (ctx, args) => listPluginInstallationsPortable(toPortableQueryCtx(ctx), args),
});

export const listIntegrationCatalog = query({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.array(integrationCatalogItemReturn),
  handler: (ctx, args) => listIntegrationCatalogPortable(toPortableQueryCtx(ctx), args),
});

export const installIntegration = mutation({
  args: {
    societyId: v.id("societies"),
    slug: v.string(),
    status: v.optional(v.string()),
    installedByUserId: v.optional(v.id("users")),
  },
  returns: v.id("pluginInstallations"),
  handler: (ctx, args) => installIntegrationPortable(toPortableMutationCtx(ctx), args),
});

export const updateIntegrationHealth = mutation({
  args: {
    id: v.id("pluginInstallations"),
    secretStatus: v.optional(v.record(v.string(), v.boolean())),
    envStatus: v.optional(v.record(v.string(), v.boolean())),
    healthMessages: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
  },
  returns: v.null(),
  handler: (ctx, args) => updateIntegrationHealthPortable(toPortableMutationCtx(ctx), args),
});

export const upsertPluginInstallation = mutation({
  args: {
    id: v.optional(v.id("pluginInstallations")),
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    name: v.string(),
    slug: v.string(),
    status: v.optional(v.string()),
    capabilities: v.array(v.string()),
    configJson: v.optional(v.string()),
    installedByUserId: v.optional(v.id("users")),
  },
  returns: v.id("pluginInstallations"),
  handler: (ctx, args) => upsertPluginInstallationPortable(toPortableMutationCtx(ctx), args),
});

export const listWebhookSubscriptions = query({
  args: { societyId: v.id("societies") },
  returns: v.array(webhookSubscriptionReturn),
  handler: async (ctx, { societyId }) =>
    (await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect()).map(redactWebhookSubscription),
});

export const listWebhookSubscriptionsForEvent = query({
  args: {
    societyId: v.id("societies"),
    eventType: v.string(),
    serviceToken: serviceTokenValidator,
  },
  returns: v.array(webhookSubscriptionPrivateReturn),
  handler: async (ctx, { societyId, eventType, serviceToken }) => {
    await assertApiPlatformServiceToken(serviceToken);
    const rows = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_society_status", (q) =>
        q.eq("societyId", societyId).eq("status", "active"),
      )
      .collect();
    return rows
      .filter((row) => row.eventTypes.includes("*") || row.eventTypes.includes(eventType))
      .map(privateWebhookSubscription);
  },
});

export const upsertWebhookSubscription = mutation({
  args: {
    id: v.optional(v.id("webhookSubscriptions")),
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    pluginInstallationId: v.optional(v.id("pluginInstallations")),
    name: v.string(),
    targetUrl: v.string(),
    eventTypes: v.array(v.string()),
    secretEncrypted: v.string(),
    status: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    serviceToken: serviceTokenValidator,
  },
  returns: v.id("webhookSubscriptions"),
  handler: async (ctx, args) => {
    await assertCanManageApiPlatform(
      ctx,
      args.societyId,
      args.createdByUserId,
      args.serviceToken,
    );
    const at = nowISO();
    const { id, serviceToken: _serviceToken, ...rest } = args;
    if (id) {
      await ctx.db.patch(id, {
        ...rest,
        status: rest.status ?? "active",
        updatedAtISO: at,
      });
      return id;
    }
    return await ctx.db.insert("webhookSubscriptions", {
      ...rest,
      status: rest.status ?? "active",
      createdAtISO: at,
      updatedAtISO: at,
    });
  },
});

export const setWebhookSubscriptionStatus = mutation({
  args: {
    id: v.id("webhookSubscriptions"),
    societyId: v.id("societies"),
    status: v.string(), // active | disabled
    actingUserId: v.optional(v.id("users")),
    serviceToken: serviceTokenValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertCanManageApiPlatform(ctx, args.societyId, args.actingUserId, args.serviceToken);
    await ctx.db.patch(args.id, { status: args.status, updatedAtISO: nowISO() });
    return null;
  },
});

export const createWebhookDelivery = mutation({
  args: {
    societyId: v.id("societies"),
    subscriptionId: v.id("webhookSubscriptions"),
    eventId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    status: v.optional(v.string()),
    attempts: v.optional(v.number()),
    attemptHistoryJson: v.optional(v.string()),
    nextAttemptAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
    serviceToken: serviceTokenValidator,
  },
  returns: v.id("webhookDeliveries"),
  handler: async (ctx, args) => {
    await assertApiPlatformServiceToken(args.serviceToken);
    return await ctx.db.insert("webhookDeliveries", {
      societyId: args.societyId,
      subscriptionId: args.subscriptionId,
      eventId: args.eventId,
      eventType: args.eventType,
      payloadJson: args.payloadJson,
      status: args.status ?? "pending",
      attempts: args.attempts ?? 0,
      attemptHistoryJson: args.attemptHistoryJson ?? "[]",
      nextAttemptAtISO: args.nextAttemptAtISO,
      lastError: args.lastError,
      createdAtISO: nowISO(),
    });
  },
});

export const updateWebhookDelivery = mutation({
  args: {
    id: v.id("webhookDeliveries"),
    status: v.string(),
    attempts: v.number(),
    nextAttemptAtISO: v.optional(v.string()),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAtISO: v.optional(v.string()),
    serviceToken: serviceTokenValidator,
  },
  returns: v.null(),
  handler: async (ctx, { id, serviceToken, ...patch }) => {
    await assertApiPlatformServiceToken(serviceToken);
    const existing = await ctx.db.get(id);
    const at = nowISO();
    const history = existing?.attemptHistoryJson
      ? JSON.parse(existing.attemptHistoryJson)
      : [];
    history.push({
      attempt: patch.attempts,
      status: patch.status,
      atISO: at,
      statusCode: patch.lastStatusCode,
      error: patch.lastError,
      nextAttemptAtISO: patch.nextAttemptAtISO,
    });
    await ctx.db.patch(id, {
      ...patch,
      attemptHistoryJson: JSON.stringify(history),
      lastAttemptAtISO: at,
    });
    return null;
  },
});

export const listWebhookDeliveries = query({
  args: { societyId: v.id("societies"), subscriptionId: v.optional(v.id("webhookSubscriptions")) },
  returns: v.array(webhookDeliveryReturn),
  handler: async (ctx, { societyId, subscriptionId }) => {
    const rows = subscriptionId
      ? await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_subscription", (q) => q.eq("subscriptionId", subscriptionId))
          .order("desc")
          .take(100)
      : await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .order("desc")
          .take(100);
    return rows.filter((row) => row.societyId === societyId);
  },
});

export const listIntegrationSyncStates = query({
  args: {
    societyId: v.id("societies"),
    provider: v.optional(v.string()),
    resourceType: v.optional(v.string()),
  },
  returns: v.array(integrationSyncStateReturn),
  handler: (ctx, args) => listIntegrationSyncStatesPortable(toPortableQueryCtx(ctx), args),
});

export const upsertIntegrationSyncState = mutation({
  args: {
    id: v.optional(v.id("integrationSyncStates")),
    societyId: v.id("societies"),
    pluginInstallationId: v.optional(v.id("pluginInstallations")),
    provider: v.string(),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    externalResourceId: v.optional(v.string()),
    syncToken: v.optional(v.string()),
    deltaLink: v.optional(v.string()),
    webhookChannelId: v.optional(v.string()),
    webhookSubscriptionId: v.optional(v.string()),
    webhookResourceId: v.optional(v.string()),
    webhookExpiresAtISO: v.optional(v.string()),
    lastFullSyncAtISO: v.optional(v.string()),
    lastIncrementalSyncAtISO: v.optional(v.string()),
    lastWebhookAtISO: v.optional(v.string()),
    status: v.optional(v.string()),
    lastError: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    serviceToken: serviceTokenValidator,
  },
  returns: v.id("integrationSyncStates"),
  handler: async (ctx, { id, actingUserId, serviceToken, ...args }) => {
    await assertCanManageApiPlatform(ctx, args.societyId, actingUserId, serviceToken);
    const now = nowISO();
    const payload = {
      ...args,
      status: args.status ?? "active",
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    const existing = (await ctx.db
      .query("integrationSyncStates")
      .withIndex("by_society_provider_resource", (q) =>
        q.eq("societyId", args.societyId).eq("provider", args.provider).eq("resourceType", args.resourceType),
      )
      .collect()).find((row) =>
        (row.resourceId ?? "") === (args.resourceId ?? "") &&
        (row.externalResourceId ?? "") === (args.externalResourceId ?? ""),
      );
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("integrationSyncStates", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const actorForBetterAuthSubject = query({
  args: { societyId: v.id("societies"), authSubject: idString },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      role: v.string(),
      societyId: v.id("societies"),
    }),
  ),
  handler: async (ctx, { societyId, authSubject }) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
      .collect();
    const user = rows.find((row) => row.societyId === societyId);
    return user ? { userId: user._id, role: user.role, societyId: user.societyId } : null;
  },
});

export const devActorForSociety = query({
  args: { societyId: v.optional(v.id("societies")) },
  returns: v.union(
    v.null(),
    v.object({
      societyId: v.id("societies"),
      userId: v.optional(v.id("users")),
      role: v.string(),
    }),
  ),
  handler: async (ctx, { societyId }) => {
    const society = societyId
      ? await ctx.db.get(societyId)
      : await ctx.db.query("societies").first();
    if (!society) return null;
    const users = await ctx.db
      .query("users")
      .withIndex("by_society", (q) => q.eq("societyId", society._id))
      .collect();
    const actor =
      users.find((user) => user.role === "Owner") ??
      users.find((user) => user.role === "Admin") ??
      users[0];
    return {
      societyId: society._id,
      userId: actor?._id,
      role: actor?.role ?? "Owner",
    };
  },
});

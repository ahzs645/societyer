import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertApiPlatformServiceToken, serviceTokenValidator } from "./lib/serviceAuth";
import { requireRole } from "./users";

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
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("apiClients")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
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
  handler: async (ctx, args) => {
    const at = nowISO();
    return await ctx.db.insert("apiClients", {
      societyId: args.societyId,
      name: args.name,
      description: args.description,
      kind: args.kind ?? "plugin",
      status: "active",
      createdByUserId: args.createdByUserId,
      createdAtISO: at,
      updatedAtISO: at,
    });
  },
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
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: nowISO() });
    return null;
  },
});

export const listTokens = query({
  args: {
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
  },
  returns: v.array(apiTokenPublicReturn),
  handler: async (ctx, { societyId, clientId }) => {
    const rows = clientId
      ? await ctx.db
          .query("apiTokens")
          .withIndex("by_client", (q) => q.eq("clientId", clientId))
          .collect()
      : await ctx.db
          .query("apiTokens")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect();
    return rows.filter((row) => row.societyId === societyId).map(redactToken);
  },
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
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("pluginInstallations")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
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
  handler: async (ctx, args) => {
    const at = nowISO();
    const { id, ...rest } = args;
    if (id) {
      await ctx.db.patch(id, {
        ...rest,
        status: rest.status ?? "installed",
        updatedAtISO: at,
      });
      return id;
    }
    return await ctx.db.insert("pluginInstallations", {
      ...rest,
      status: rest.status ?? "installed",
      createdAtISO: at,
      updatedAtISO: at,
    });
  },
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

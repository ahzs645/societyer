import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Platform/admin tables (users, api clients/tokens, plugin installs, webhooks, integration sync states).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const platformTables = {
  users: defineTable({
    societyId: v.id("societies"),
    email: v.string(),
    phone: v.optional(v.string()), // E.164, for opt-in SMS digests
    displayName: v.string(),
    role: v.string(), // Owner | Admin | Director | Member | Viewer
    authProvider: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    directorId: v.optional(v.id("directors")),
    status: v.string(), // Active | Invited | Disabled
    avatarColor: v.optional(v.string()),
    createdAtISO: v.string(),
    emailVerifiedAtISO: v.optional(v.string()),
    lastLoginAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_email", ["email"])
    .index("by_auth_subject", ["authSubject"]),

  apiClients: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    kind: v.string(), // plugin | integration | service
    status: v.string(), // active | disabled
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  apiTokens: defineTable({
    societyId: v.id("societies"),
    clientId: v.id("apiClients"),
    name: v.string(),
    tokenHash: v.string(),
    tokenStart: v.string(),
    scopes: v.array(v.string()),
    status: v.string(), // active | revoked
    expiresAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    lastUsedAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_client", ["clientId"])
    .index("by_token_hash", ["tokenHash"]),

  pluginInstallations: defineTable({
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    name: v.string(),
    slug: v.string(),
    status: v.string(), // installed | disabled | removed
    capabilities: v.array(v.string()),
    configJson: v.optional(v.string()),
    installedByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_slug", ["societyId", "slug"]),

  webhookSubscriptions: defineTable({
    societyId: v.id("societies"),
    clientId: v.optional(v.id("apiClients")),
    pluginInstallationId: v.optional(v.id("pluginInstallations")),
    name: v.string(),
    targetUrl: v.string(),
    eventTypes: v.array(v.string()),
    secretEncrypted: v.string(),
    status: v.string(), // active | disabled
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  webhookDeliveries: defineTable({
    societyId: v.id("societies"),
    subscriptionId: v.id("webhookSubscriptions"),
    eventId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    status: v.string(), // pending | delivered | failed
    attempts: v.number(),
    attemptHistoryJson: v.optional(v.string()),
    nextAttemptAtISO: v.optional(v.string()),
    lastAttemptAtISO: v.optional(v.string()),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAtISO: v.string(),
    deliveredAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_subscription", ["subscriptionId"])
    .index("by_event", ["eventId"])
    .index("by_status_next", ["status", "nextAttemptAtISO"]),

  integrationSyncStates: defineTable({
    societyId: v.id("societies"),
    pluginInstallationId: v.optional(v.id("pluginInstallations")),
    provider: v.string(),
    resourceType: v.string(), // calendar_events | deadline_events | drive_files | connector_actions
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
    status: v.string(), // active | needs_renewal | error | disabled
    lastError: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_provider", ["societyId", "provider"])
    .index("by_society_provider_resource", ["societyId", "provider", "resourceType"])
    .index("by_webhook_channel", ["webhookChannelId"])
    .index("by_webhook_subscription", ["webhookSubscriptionId"]),

  // Token-scoped read-only portals for external parties (auditors, lawyers,
  // bankers). The token is the bearer (no app account); `scopes` controls which
  // sections they can read and `allowDownload` whether they can pull files.
  partyPortals: defineTable({
    societyId: v.id("societies"),
    token: v.string(),
    label: v.string(), // party / auditor name
    partyEmail: v.optional(v.string()),
    scopes: v.array(v.string()), // board | publications | documents
    allowDownload: v.boolean(),
    createdAtISO: v.string(),
    expiresAtISO: v.optional(v.string()),
    revokedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_token", ["token"]),
};

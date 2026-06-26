import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Notifications + communications tables (notifications, prefs, segments, templates, campaigns, deliveries, financial connections).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const communicationsTables = {
  notifications: defineTable({
    societyId: v.id("societies"),
    userId: v.optional(v.id("users")), // null = broadcast to whole society
    kind: v.string(), // deadline | filing | minutes | signature | billing | bot | general
    severity: v.string(), // info | warn | success | err
    title: v.string(),
    body: v.optional(v.string()),
    linkHref: v.optional(v.string()),
    readAt: v.optional(v.string()),
    // Set when the user clears the notification from the bell. Hidden from the
    // bell + unread count immediately, but kept visible on the Notifications
    // page until the daily purge removes it after the retention window.
    dismissedAt: v.optional(v.string()),
    // Hidden from the bell + unread count + digest until this ISO time passes.
    // Unlike dismiss, the row resurfaces on its own when the snooze elapses.
    snoozedUntilISO: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_user", ["userId"]),

  notificationPrefs: defineTable({
    userId: v.id("users"),
    channel: v.string(), // email | sms | inApp | slack
    kind: v.string(), // deadline | filing | minutes | billing | bot | general | all
    enabled: v.boolean(),
  }).index("by_user", ["userId"]),

  memberCommunicationPrefs: defineTable({
    societyId: v.id("societies"),
    memberId: v.id("members"),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    transactionalEmailEnabled: v.boolean(),
    noticeEmailEnabled: v.boolean(),
    newsletterEmailEnabled: v.boolean(),
    smsEnabled: v.boolean(),
    mailEnabled: v.optional(v.boolean()),
    preferredChannel: v.string(), // email | sms | mail
    newsletterConsentAtISO: v.optional(v.string()),
    smsConsentAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
    unsubscribeReason: v.optional(v.string()),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"]),

  communicationSegments: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    includeAudience: v.string(), // all_members | voting_members | directors | overdue_subscribers | volunteers | custom
    memberStatus: v.optional(v.string()),
    membershipClass: v.optional(v.string()),
    votingRightsOnly: v.optional(v.boolean()),
    hasEmail: v.optional(v.boolean()),
    hasPhone: v.optional(v.boolean()),
    volunteerStatus: v.optional(v.string()),
    updatedAtISO: v.string(),
  }).index("by_society", ["societyId"]),

  communicationTemplates: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    slug: v.string(),
    kind: v.string(), // notice | renewal | digest | newsletter | reminder
    channel: v.string(), // email | inApp | sms
    audience: v.string(), // all_members | voting_members | directors | overdue_subscribers
    subject: v.string(),
    bodyText: v.string(),
    bodyHtml: v.optional(v.string()),
    system: v.boolean(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_slug", ["societyId", "slug"]),

  communicationCampaigns: defineTable({
    societyId: v.id("societies"),
    templateId: v.optional(v.id("communicationTemplates")),
    segmentId: v.optional(v.id("communicationSegments")),
    meetingId: v.optional(v.id("meetings")),
    kind: v.string(),
    channel: v.string(),
    audience: v.string(),
    customAudienceLabel: v.optional(v.string()),
    subject: v.string(),
    bodyText: v.string(),
    status: v.string(), // draft | sending | sent | partial | failed
    memberCount: v.number(),
    deliveredCount: v.number(),
    openedCount: v.number(),
    bouncedCount: v.number(),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    sentAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_meeting", ["meetingId"]),

  communicationDeliveries: defineTable({
    societyId: v.id("societies"),
    campaignId: v.optional(v.id("communicationCampaigns")),
    templateId: v.optional(v.id("communicationTemplates")),
    meetingId: v.optional(v.id("meetings")),
    memberId: v.optional(v.id("members")),
    recipientName: v.string(),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    recipientAddress: v.optional(v.string()),
    channel: v.string(),
    provider: v.string(),
    providerMessageId: v.optional(v.string()),
    subject: v.optional(v.string()),
    status: v.string(), // queued | sent | opened | bounced | failed | skipped | unsubscribed
    proofOfNotice: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    providerEventType: v.optional(v.string()),
    providerPayload: v.optional(v.string()),
    sentAtISO: v.string(),
    openedAtISO: v.optional(v.string()),
    bouncedAtISO: v.optional(v.string()),
    unsubscribedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_campaign", ["campaignId"])
    .index("by_meeting", ["meetingId"])
    .index("by_provider_message", ["provider", "providerMessageId"]),

  financialConnections: defineTable({
    societyId: v.id("societies"),
    provider: v.string(), // wave | demo
    status: v.string(), // connected | disconnected | error
    accountLabel: v.optional(v.string()),
    externalBusinessId: v.optional(v.string()),
    syncMode: v.optional(v.string()), // public_api | browser | demo
    connectedAtISO: v.string(),
    lastSyncAtISO: v.optional(v.string()),
    lastError: v.optional(v.string()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),
};

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const subscriptionTables = {
  subscriptionPlans: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.string(), // month | year | one_time
    benefits: v.array(v.string()),
    membershipClass: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_society", ["societyId"]),

  membershipFeePeriods: defineTable({
    societyId: v.id("societies"),
    planId: v.optional(v.id("subscriptionPlans")),
    membershipClass: v.optional(v.string()),
    label: v.string(),
    priceCents: v.number(),
    currency: v.string(),
    interval: v.string(), // month | year | semester | one_time
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    status: v.string(), // planned | active | retired
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_plan", ["planId"])
    .index("by_society_effective_from", ["societyId", "effectiveFrom"]),

  memberSubscriptions: defineTable({
    societyId: v.id("societies"),
    planId: v.id("subscriptionPlans"),
    memberId: v.optional(v.id("members")),
    email: v.string(),
    fullName: v.string(),
    status: v.string(), // active | canceled | past_due | trialing | pending
    startedAtISO: v.string(),
    currentPeriodEndISO: v.optional(v.string()),
    canceledAtISO: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    lastPaymentAtISO: v.optional(v.string()),
    lastPaymentCents: v.optional(v.number()),
    demo: v.boolean(),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"])
    .index("by_email", ["email"]),

  fundingSources: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    sourceType: v.string(), // Member dues | Donor | Grant funder | Sponsor | Government | Program revenue | Other
    status: v.string(), // Active | Prospect | Paused | Ended
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    collectionAgentName: v.optional(v.string()),
    collectionModel: v.optional(v.string()), // direct | third_party | unknown
    memberDisclosureLevel: v.optional(v.string()), // named_members | aggregate_count | aggregate_amount | unknown
    estimatedMemberCount: v.optional(v.number()),
    collectionFrequency: v.optional(v.string()), // annual | semester | monthly | one_time | irregular | unknown
    collectionScheduleNotes: v.optional(v.string()),
    nextExpectedCollectionDate: v.optional(v.string()),
    reconciliationCadence: v.optional(v.string()),
    linkedMemberId: v.optional(v.id("members")),
    linkedGrantId: v.optional(v.id("grants")),
    expectedAnnualCents: v.optional(v.number()),
    committedCents: v.optional(v.number()),
    receivedToDateCents: v.optional(v.number()),
    currency: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    restrictedPurpose: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_type", ["societyId", "sourceType"])
    .index("by_society_status", ["societyId", "status"]),

  fundingSourceEvents: defineTable({
    societyId: v.id("societies"),
    sourceId: v.id("fundingSources"),
    eventDate: v.string(),
    kind: v.string(), // Pledged | Received | Agreement | Report | Renewal | Contact | Other
    label: v.string(),
    amountCents: v.optional(v.number()),
    memberCount: v.optional(v.number()),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    attributionStatus: v.optional(v.string()), // named | aggregate | unknown
    notes: v.optional(v.string()),
    financialTransactionId: v.optional(v.id("financialTransactions")),
    donationReceiptId: v.optional(v.id("donationReceipts")),
    documentId: v.optional(v.id("documents")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_source", ["sourceId"])
    .index("by_society_date", ["societyId", "eventDate"]),
};

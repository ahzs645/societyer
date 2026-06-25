import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Volunteer tables (volunteers, applications, screenings).
 * Extracted from convex/schema.ts (modularization); spread back into defineSchema.
 */
export const volunteerTables = {
  volunteers: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    committeeId: v.optional(v.id("committees")),
    publicApplicationId: v.optional(v.id("volunteerApplications")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: v.string(), // Prospect | Applied | Active | Paused | Inactive | Declined
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    screeningRequired: v.boolean(),
    orientationCompletedAtISO: v.optional(v.string()),
    trainingStatus: v.optional(v.string()), // Pending | InProgress | Complete
    applicationReceivedAtISO: v.optional(v.string()),
    approvedAtISO: v.optional(v.string()),
    renewalDueAtISO: v.optional(v.string()),
    intakeSource: v.optional(v.string()), // public | portal | admin
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_member", ["memberId"])
    .index("by_committee", ["committeeId"]),

  volunteerApplications: defineTable({
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    linkedVolunteerId: v.optional(v.id("volunteers")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    roleWanted: v.optional(v.string()),
    availability: v.optional(v.string()),
    interests: v.array(v.string()),
    notes: v.optional(v.string()),
    source: v.string(), // public | portal | admin
    status: v.string(), // Submitted | Reviewing | Approved | Declined | Converted
    submittedAtISO: v.string(),
    reviewedAtISO: v.optional(v.string()),
    reviewedByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_status", ["societyId", "status"]),

  volunteerScreenings: defineTable({
    societyId: v.id("societies"),
    volunteerId: v.id("volunteers"),
    kind: v.string(), // Orientation | ReferenceCheck | CriminalRecordCheck | PolicyAttestation | Training
    status: v.string(), // needed | requested | clear | failed | expired | waived
    provider: v.optional(v.string()), // BC_CRRP | Manual | Other
    portalUrl: v.optional(v.string()),
    requestedAtISO: v.optional(v.string()),
    completedAtISO: v.optional(v.string()),
    expiresAtISO: v.optional(v.string()),
    referenceNumber: v.optional(v.string()),
    consentDocumentId: v.optional(v.id("documents")),
    resultDocumentId: v.optional(v.id("documents")),
    verifiedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_volunteer", ["volunteerId"]),

  // meetings / minutes — extracted to convex/tables/meetings.ts
};

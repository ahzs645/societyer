import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Self-service "Request access" for a workspace. See
 * docs/shared-workspaces/architecture.md ("Access requests").
 *
 * A request grants nothing. Only an Owner or Admin approving it creates a
 * `users` membership, bound to the exact issuer/subject that asked.
 */
export const accessRequestTables = {
  /** Owner/Admin opt-in for one workspace. No row means requests are off. */
  workspaceAccessRequestSettings: defineTable({
    societyId: v.id("societies"),
    enabled: v.boolean(),
    // Preselected role when approving. Approvers may choose any role they may grant.
    defaultRole: v.union(v.literal("Viewer"), v.literal("Member")),
    // Shown to people asking to join (≤ 500 characters, plain text).
    message: v.optional(v.string()),
    updatedAtISO: v.string(),
    updatedByUserId: v.id("users"),
  }).index("by_society", ["societyId"]),

  /** One person's request to join one workspace. */
  workspaceAccessRequests: defineTable({
    societyId: v.id("societies"),
    // The requesting session's exact verified identity, never client-supplied.
    requesterIssuer: v.string(),
    requesterSubject: v.string(),
    requesterAuthProvider: v.optional(v.string()),
    // Display-only snapshot from the requesting session.
    email: v.optional(v.string()),
    emailVerified: v.boolean(),
    name: v.optional(v.string()),
    note: v.optional(v.string()), // ≤ 500 characters, plain text
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined"), v.literal("withdrawn")),
    createdAtISO: v.string(),
    decidedAtISO: v.optional(v.string()),
    decidedByUserId: v.optional(v.id("users")),
    grantedRole: v.optional(v.string()),
    membershipId: v.optional(v.id("users")),
  })
    .index("by_society_status", ["societyId", "status"])
    .index("by_requester", ["requesterIssuer", "requesterSubject", "createdAtISO"]),
};

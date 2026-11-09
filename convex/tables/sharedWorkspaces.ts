import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Shared-workspace tables: per-workspace sign-in and storage policy, verified
 * frontend domains, and the person account that links several login
 * identities. See docs/shared-workspaces/architecture.md.
 *
 * None of these rows grants workspace access by itself. Access still needs an
 * Active `users` membership in the requested workspace; these tables only
 * add requirements (policies), choose presentation (domains), or let a proven
 * person reach memberships bound to their other proven identities (links).
 */
export const sharedWorkspaceTables = {
  /** Operator-set sign-in requirement for one workspace. No row means "any". */
  workspaceSignInPolicies: defineTable({
    societyId: v.id("societies"),
    requiredMethod: v.union(v.literal("any"), v.literal("microsoft")),
    // Required when requiredMethod is "microsoft"; must be a subset of the
    // deployment's MICROSOFT_LOGIN_TENANT_ID / MICROSOFT_LOGIN_GROUP_IDS.
    microsoftTenantId: v.optional(v.string()),
    microsoftGroupIds: v.optional(v.array(v.string())),
    // Optional workspace-level allowlist checked against the session email.
    allowedEmailDomains: v.optional(v.array(v.string())),
    // Shown on this workspace's sign-in page and lock screens.
    supportEmail: v.optional(v.string()),
    updatedAtISO: v.string(),
    reason: v.string(),
  }).index("by_society", ["societyId"]),

  /** Operator-set storage policy for one workspace. No row means the deployment default. */
  workspaceStoragePolicies: defineTable({
    societyId: v.id("societies"),
    nativeUploads: v.union(v.literal("allowed"), v.literal("disabled")),
    documentVersionProvider: v.union(v.literal("deployment-default"), v.literal("native"), v.literal("sharepoint")),
    updatedAtISO: v.string(),
    reason: v.string(),
  }).index("by_society", ["societyId"]),

  /** Verified frontend origin that opens one workspace by default. */
  workspaceDomains: defineTable({
    origin: v.string(), // exact https origin, e.g. https://portal.ddcnorth.com
    hostname: v.string(), // lowercase host[:port] of origin
    societyId: v.id("societies"),
    status: v.union(v.literal("Active"), v.literal("Disabled")),
    primary: v.boolean(), // canonical origin for the workspace (one Active primary per workspace)
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    note: v.optional(v.string()),
  })
    .index("by_origin", ["origin"])
    .index("by_hostname", ["hostname"])
    .index("by_society", ["societyId"]),

  /** One person who has proven control of every linked login identity. */
  personAccounts: defineTable({
    status: v.union(v.literal("Active"), v.literal("Disabled")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  }),

  /** A login identity (exact issuer + subject) proven to belong to a person account. */
  personIdentityLinks: defineTable({
    personAccountId: v.id("personAccounts"),
    externalIdentityId: v.id("externalIdentities"),
    issuer: v.string(),
    subject: v.string(),
    status: v.union(v.literal("Active"), v.literal("Unlinked")),
    // Display-only snapshot from the proving session; never an identity key.
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    linkedAtISO: v.string(),
    unlinkedAtISO: v.optional(v.string()),
  })
    .index("by_issuer_subject", ["issuer", "subject"])
    .index("by_person", ["personAccountId"]),

  /** Short-lived, single-use proof that a fresh session for identity A started a link. */
  accountLinkRequests: defineTable({
    codeHash: v.string(), // SHA-256 hex of the code; the code itself is never stored
    initiatorIssuer: v.string(),
    initiatorSubject: v.string(),
    initiatorEmail: v.optional(v.string()),
    initiatorName: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("cancelled")),
    createdAtMs: v.number(),
    expiresAtMs: v.number(),
    completedAtISO: v.optional(v.string()),
    targetIssuer: v.optional(v.string()),
    targetSubject: v.optional(v.string()),
  })
    .index("by_code_hash", ["codeHash"])
    .index("by_initiator", ["initiatorIssuer", "initiatorSubject"]),

  /** Append-only audit of link, unlink and refused link attempts. Not workspace data. */
  accountLinkEvents: defineTable({
    action: v.union(v.literal("linked"), v.literal("unlinked"), v.literal("refused")),
    personAccountId: v.optional(v.id("personAccounts")),
    actorIssuer: v.string(),
    actorSubject: v.string(),
    identities: v.array(v.object({ issuer: v.string(), subject: v.string() })),
    reason: v.optional(v.string()),
    createdAtISO: v.string(),
  }).index("by_person", ["personAccountId"]),
};

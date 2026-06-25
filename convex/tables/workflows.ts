import { defineTable } from "convex/server";
import { v } from "convex/values";

export const workflowTables = {
  workflows: defineTable({
    societyId: v.id("societies"),
    recipe: v.string(), // agm_prep | insurance_renewal | annual_report_filing | unbc_affiliate_id_request
    name: v.string(),
    status: v.string(), // active | paused | archived
    provider: v.optional(v.string()), // internal | n8n
    providerConfig: v.optional(
      v.object({
        externalWorkflowId: v.optional(v.string()),
        externalWebhookUrl: v.optional(v.string()),
        externalEditUrl: v.optional(v.string()),
      }),
    ),
    nodePreview: v.optional(
      v.array(
        v.object({
          key: v.string(),
          type: v.string(),
          label: v.string(),
          description: v.optional(v.string()),
          status: v.optional(v.string()),
          config: v.optional(v.any()),
        }),
      ),
    ),
    trigger: v.object({
      kind: v.string(), // cron | manual | date_offset
      cron: v.optional(v.string()),
      offset: v.optional(
        v.object({
          anchor: v.string(), // meetings.scheduledAt | insurancePolicies.renewalDate | filings.dueDate
          anchorId: v.optional(v.string()),
          daysBefore: v.number(),
        }),
      ),
    }),
    config: v.optional(v.any()),
    lastRunAtISO: v.optional(v.string()),
    nextRunAtISO: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_next_run", ["nextRunAtISO"]),

  // Queued manual-send emails (the "outbox"). Used when no live email
  // provider is configured, or when the workflow author explicitly wants a
  // human to send the message from their own inbox.
  pendingEmails: defineTable({
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    nodeKey: v.optional(v.string()),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    to: v.string(),
    cc: v.optional(v.string()),
    bcc: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    attachments: v.array(
      v.object({
        documentId: v.id("documents"),
        fileName: v.string(),
      }),
    ),
    status: v.string(), // draft | ready | sent | cancelled
    createdAtISO: v.string(),
    createdByUserId: v.optional(v.id("users")),
    sentAtISO: v.optional(v.string()),
    sentByUserId: v.optional(v.id("users")),
    sentChannel: v.optional(v.string()), // personal_email | other
    notes: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_society_status", ["societyId", "status"]),

  workflowRuns: defineTable({
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    recipe: v.string(),
    status: v.string(), // queued | running | success | failed | manual_required
    startedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
    steps: v.array(
      v.object({
        key: v.optional(v.string()),
        label: v.string(),
        status: v.string(), // pending | running | ok | fail | skip
        atISO: v.optional(v.string()),
        note: v.optional(v.string()),
        output: v.optional(v.any()),
      }),
    ),
    provider: v.optional(v.string()), // internal | n8n
    externalRunId: v.optional(v.string()),
    externalStatus: v.optional(v.string()),
    generatedDocumentId: v.optional(v.id("documents")),
    generatedDocumentVersionId: v.optional(v.id("documentVersions")),
    output: v.optional(v.any()),
    demo: v.boolean(),
    triggeredBy: v.string(), // cron | manual | event
    triggeredByUserId: v.optional(v.id("users")),
  })
    .index("by_society", ["societyId"])
    .index("by_workflow", ["workflowId"]),

  workflowPackages: defineTable({
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    eventType: v.string(),
    effectiveDate: v.optional(v.string()),
    status: v.string(), // draft | collecting_signatures | ready | filed | cancelled | archived
    packageName: v.string(),
    parts: v.array(v.string()),
    notes: v.optional(v.string()),
    supportingDocumentIds: v.array(v.id("documents")),
    priceItems: v.array(v.string()),
    transactionId: v.optional(v.string()),
    signerRoster: v.array(v.string()),
    signerEmails: v.array(v.string()),
    signingPackageIds: v.array(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_workflow", ["workflowId"])
    .index("by_society_status", ["societyId", "status"])
    .index("by_society_effective", ["societyId", "effectiveDate"]),
};

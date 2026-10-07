import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  conversionPreviewPortable,
  convertGapsPortable,
  createPortable,
  forRecordPortable,
  getPortable,
  listPortable,
  removePortable,
  renewPortable,
  setObligationStatusPortable,
  setRenewalDecisionPortable,
  summaryPortable,
  syncObligationsPortable,
  terminatePortable,
  updatePortable,
} from "../shared/functions/agreements";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";

const party = v.object({
  name: v.string(),
  role: v.string(),
  organizationName: v.optional(v.string()),
  directoryPersonId: v.optional(v.id("peopleDirectory")),
  contact: v.optional(v.string()),
  notes: v.optional(v.string()),
});
const signatory = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  directoryPersonId: v.optional(v.id("peopleDirectory")),
  signedAtISO: v.optional(v.string()),
});
const payment = v.object({ label: v.string(), dueDate: v.optional(v.string()), amountCents: v.optional(v.number()), status: v.optional(v.string()) });
const deliverable = v.object({
  id: v.optional(v.string()),
  text: v.string(),
  dueDate: v.optional(v.string()),
  owner: v.optional(v.string()),
  ownerPersonId: v.optional(v.id("peopleDirectory")),
  status: v.optional(v.string()),
  completedAtISO: v.optional(v.string()),
  notes: v.optional(v.string()),
});
const report = v.object({
  id: v.optional(v.string()),
  text: v.string(),
  dueDate: v.optional(v.string()),
  recurrence: v.optional(v.string()),
  recipient: v.optional(v.string()),
  status: v.optional(v.string()),
  submittedAtISO: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const editableFields = {
  title: v.optional(v.string()),
  kind: v.optional(v.string()),
  status: v.optional(v.string()),
  agreementNumber: v.optional(v.string()),
  summary: v.optional(v.string()),
  parties: v.optional(v.array(party)),
  ourSignatories: v.optional(v.array(signatory)),
  counterpartySignatories: v.optional(v.array(signatory)),
  signedDate: v.optional(v.string()),
  effectiveDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  autoRenew: v.optional(v.boolean()),
  renewalTermMonths: v.optional(v.number()),
  renewalNoticeDays: v.optional(v.number()),
  terminationNoticeDays: v.optional(v.number()),
  terminationTerms: v.optional(v.string()),
  valueCents: v.optional(v.number()),
  currency: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
  paymentSchedule: v.optional(v.array(payment)),
  deliverables: v.optional(v.array(deliverable)),
  reportingObligations: v.optional(v.array(report)),
  confidential: v.optional(v.boolean()),
  governingLaw: v.optional(v.string()),
  signedDocumentId: v.optional(v.id("documents")),
  signedDocumentVersionId: v.optional(v.id("documentVersions")),
  documentIds: v.optional(v.array(v.id("documents"))),
  linkedGrantId: v.optional(v.id("grants")),
  linkedServiceProviderId: v.optional(v.id("serviceProviders")),
  linkedCommitteeId: v.optional(v.id("committees")),
  approvedAtMeetingId: v.optional(v.id("meetings")),
  approvalMotionId: v.optional(v.id("motions")),
  approvalNote: v.optional(v.string()),
  renewalDecision: v.optional(v.object({ decision: v.string(), decidedAtISO: v.optional(v.string()), notes: v.optional(v.string()), motionId: v.optional(v.id("motions")) })),
  reviewStatus: v.optional(v.string()),
  notes: v.optional(v.string()),
  confidence: v.optional(v.string()),
};

export const list = authorizedQuery("agreements:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = authorizedQuery("agreements:get", query)({
  args: { id: v.id("agreements") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const forRecord = authorizedQuery("agreements:forRecord", query)({
  args: { societyId: v.id("societies"), table: v.string(), recordId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => forRecordPortable(await toPortableQueryCtx(ctx), args),
});

export const summary = authorizedQuery("agreements:summary", query)({
  args: { societyId: v.id("societies"), windowDays: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => summaryPortable(await toPortableQueryCtx(ctx), args),
});

export const conversionPreview = authorizedQuery("agreements:conversionPreview", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => conversionPreviewPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("agreements:create", mutation)({
  args: { societyId: v.id("societies"), ...editableFields, title: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("agreements:update", mutation)({
  args: { id: v.id("agreements"), patch: v.object(editableFields), clear: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const terminate = authorizedMutation("agreements:terminate", mutation)({
  args: { id: v.id("agreements"), terminatedAtISO: v.string(), reason: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => terminatePortable(await toPortableMutationCtx(ctx), args),
});

export const renew = authorizedMutation("agreements:renew", mutation)({
  args: {
    id: v.id("agreements"),
    mode: v.union(v.literal("renew"), v.literal("supersede")),
    title: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    valueCents: v.optional(v.number()),
    status: v.optional(v.string()),
    carryObligations: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => renewPortable(await toPortableMutationCtx(ctx), args),
});

export const setRenewalDecision = authorizedMutation("agreements:setRenewalDecision", mutation)({
  args: { id: v.id("agreements"), decision: v.string(), notes: v.optional(v.string()), motionId: v.optional(v.id("motions")), decidedAtISO: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => setRenewalDecisionPortable(await toPortableMutationCtx(ctx), args),
});

export const setObligationStatus = authorizedMutation("agreements:setObligationStatus", mutation)({
  args: { id: v.id("agreements"), list: v.union(v.literal("deliverables"), v.literal("reportingObligations")), rowKey: v.string(), status: v.string(), dateISO: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => setObligationStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("agreements:remove", mutation)({
  args: { id: v.id("agreements") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

export const syncObligations = authorizedMutation("agreements:syncObligations", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => syncObligationsPortable(await toPortableMutationCtx(ctx), args),
});

export const convertGaps = authorizedMutation("agreements:convertGaps", mutation)({
  args: { societyId: v.id("societies"), dryRun: v.optional(v.boolean()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => convertGapsPortable(await toPortableMutationCtx(ctx), args),
});

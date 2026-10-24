import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  roeWorkflowFacts,
  roeWorkflowChecklist,
  roeFollowUpKey,
  roeFollowUpStatus,
} from "./tables/payrollRoeWorkflow";
import * as handlers from "../shared/functions/payrollRoeWorkflow";
const societyId = v.id("societies"),
  id = v.id("payrollRoeWorkflowCases"),
  employeeId = v.id("employees"),
  expectedVersion = v.optional(v.number());
export const workspace = authorizedQuery(
  "payrollRoeWorkflow:workspace",
  query,
)({
  args: {
    societyId,
    collection: v.union(v.literal("cases"), v.literal("registers")),
    employeeId: v.optional(employeeId),
    id: v.optional(id),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    handlers.workspacePortable(await toPortableQueryCtx(ctx), args),
});
export const saveCase = authorizedMutation(
  "payrollRoeWorkflow:saveCase",
  mutation,
)({
  args: {
    societyId,
    id: v.optional(id),
    employeeId,
    registerId: v.optional(v.id("recordsOfEmployment")),
    amendmentOfCaseId: v.optional(id),
    facts: v.object(roeWorkflowFacts),
    expectedVersion,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.saveCasePortable(await toPortableMutationCtx(ctx), args),
});
export const updateChecklist = authorizedMutation(
  "payrollRoeWorkflow:updateChecklist",
  mutation,
)({
  args: {
    societyId,
    id,
    checklist: v.object(roeWorkflowChecklist),
    expectedVersion,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.updateChecklistPortable(await toPortableMutationCtx(ctx), args),
});
export const recordGenerated = authorizedMutation(
  "payrollRoeWorkflow:recordGenerated",
  mutation,
)({
  args: {
    societyId,
    id,
    caseFingerprint: v.string(),
    sha256: v.string(),
    byteLength: v.number(),
    filename: v.string(),
    schemaVersion: v.string(),
    expectedVersion,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.recordGeneratedPortable(await toPortableMutationCtx(ctx), args),
});
export const recordSubmission = authorizedMutation(
  "payrollRoeWorkflow:recordSubmission",
  mutation,
)({
  args: {
    societyId,
    id,
    atISO: v.string(),
    channel: v.union(
      v.literal("roe_web"),
      v.literal("provider"),
      v.literal("paper"),
    ),
    reference: v.string(),
    note: v.string(),
    outcome: v.optional(v.union(v.literal("submitted"), v.literal("rejected"))),
    expectedVersion,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.recordSubmissionPortable(await toPortableMutationCtx(ctx), args),
});
export const recordIssuance = authorizedMutation(
  "payrollRoeWorkflow:recordIssuance",
  mutation,
)({
  args: {
    societyId,
    id,
    atISO: v.string(),
    serialNumber: v.string(),
    acknowledgment: v.string(),
    paperCopiesCompleted: v.optional(v.boolean()),
    expectedVersion,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.recordIssuancePortable(await toPortableMutationCtx(ctx), args),
});
export const saveFollowUp = authorizedMutation(
  "payrollRoeWorkflow:saveFollowUp",
  mutation,
)({
  args: {
    societyId,
    id,
    key: roeFollowUpKey,
    dueDate: v.string(),
    status: roeFollowUpStatus,
    note: v.optional(v.string()),
    expectedVersion,
  },
  returns: id,
  handler: async (ctx, args) =>
    handlers.saveFollowUpPortable(await toPortableMutationCtx(ctx), args),
});
export const closeCase = authorizedMutation(
  "payrollRoeWorkflow:closeCase",
  mutation,
)({
  args: { societyId, id, note: v.string(), expectedVersion },
  returns: id,
  handler: async (ctx, args) =>
    handlers.closeCasePortable(await toPortableMutationCtx(ctx), args),
});

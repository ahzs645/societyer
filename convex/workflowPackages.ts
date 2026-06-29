import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  upsertPortable,
  removePortable,
  createFollowUpTaskPortable,
  markFiledPortable,
  createBoardPackPortable,
} from "../shared/functions/workflowPackages";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: {
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
  },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("workflowPackages")),
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    eventType: v.string(),
    effectiveDate: v.optional(v.string()),
    status: v.optional(v.string()),
    packageName: v.string(),
    parts: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    supportingDocumentIds: v.optional(v.array(v.id("documents"))),
    priceItems: v.optional(v.array(v.string())),
    transactionId: v.optional(v.string()),
    signerRoster: v.optional(v.array(v.string())),
    signerEmails: v.optional(v.array(v.string())),
    signingPackageIds: v.optional(v.array(v.string())),
    stripeCheckoutSessionId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("workflowPackages") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

export const createFollowUpTask = mutation({
  args: {
    packageId: v.id("workflowPackages"),
    title: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createFollowUpTaskPortable(toPortableMutationCtx(ctx), args),
});

export const markFiled = mutation({
  args: {
    packageId: v.id("workflowPackages"),
    transactionId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => markFiledPortable(toPortableMutationCtx(ctx), args),
});

export const createBoardPack = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    workflowId: v.optional(v.id("workflows")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.object({
    packageId: v.id("workflowPackages"),
    taskIds: v.array(v.id("tasks")),
  }),
  handler: (ctx, args) => createBoardPackPortable(toPortableMutationCtx(ctx), args),
});

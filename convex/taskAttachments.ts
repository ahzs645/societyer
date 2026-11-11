/**
 * Things attached to a task (shared/functions/taskAttachments.ts). The action
 * policy gives reads tasks:read and changes tasks:write. Opportunities also
 * need the deployment's procurement review connection, checked here since the
 * portable layer can't see the deployment's settings.
 */
import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { attachToTask, detachFromTask, listByKind as listByKindPortable, listForTask as listForTaskPortable } from "../shared/functions/taskAttachments";
import { deploymentCapabilities, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";

function requireKindAvailable(kind: string) {
  if (kind === "opportunity" && !deploymentCapabilities(process.env).procurementReview)
    throw new Error(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE);
}

const snapshot = v.object({
  title: v.string(),
  subtitle: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  dueText: v.optional(v.string()),
});

export const listForTask = authorizedQuery("taskAttachments:listForTask", query)({
  args: { taskId: v.id("tasks") },
  returns: v.any(),
  handler: async (ctx, args) => listForTaskPortable(await toPortableQueryCtx(ctx), args),
});

export const listByKind = authorizedQuery("taskAttachments:listByKind", query)({
  args: { societyId: v.id("societies"), kind: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    requireKindAvailable(args.kind);
    return listByKindPortable(await toPortableQueryCtx(ctx), args);
  },
});

export const attach = authorizedMutation("taskAttachments:attach", mutation)({
  args: { taskId: v.id("tasks"), kind: v.string(), refKey: v.string(), snapshot: v.optional(snapshot) },
  returns: v.object({ attachmentId: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    requireKindAvailable(args.kind);
    return attachToTask(await toPortableMutationCtx(ctx), args);
  },
});

export const detach = authorizedMutation("taskAttachments:detach", mutation)({
  args: { id: v.id("taskAttachments") },
  returns: v.null(),
  handler: async (ctx, args) => detachFromTask(await toPortableMutationCtx(ctx), args),
});

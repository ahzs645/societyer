/**
 * The workspace's own bid triage of opportunities (shared/procurementTriage.ts):
 * a "reviewed" tick and a classification. Saved here, shared by the
 * workspace's members, never written back to Zoer. Its action items are tasks
 * holding the opportunity as an attachment (taskAttachments): an opportunity
 * may be on several tasks, and a task may hold several opportunities.
 *
 * Nothing here reads the catalog: a workspace may read it from the Convex copy
 * or from the catalog service, and the triage is keyed by record key alone. The
 * reader joins it onto the list in the browser.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { requireEnabledModule } from "./lib/moduleSettings";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { requireSocietyMembership } from "../shared/functions/access";
import { requirePermissionPortable } from "../shared/functions/permissions";
import { taskCreate } from "../shared/functions/tasks";
import { attachToTask } from "../shared/functions/taskAttachments";
import { deploymentCapabilities, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";
import {
  canCreateTriageTask,
  isOpportunityRecordKey,
  isTriageClassification,
  triageClassification,
  triageLabel,
} from "../shared/procurementTriage";

/**
 * At most this many triaged opportunities are listed. Clearing a triage
 * deletes its row, so this bounds a workspace's live triage, not its history.
 */
const LIST_LIMIT = 8000;

async function requireTriage(ctx: Parameters<typeof requireEnabledModule>[0], societyId: Id<"societies">) {
  if (!deploymentCapabilities(process.env).procurementReview) throw new Error(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE);
  await requireEnabledModule(ctx, societyId, "procurementReview");
}

const rowFor = (ctx: MutationCtx, societyId: Id<"societies">, recordKey: string) =>
  ctx.db
    .query("procurementTriage")
    .withIndex("by_record", (q) => q.eq("societyId", societyId).eq("recordKey", recordKey))
    .unique();

const entry = v.object({
  recordKey: v.string(),
  reviewed: v.boolean(),
  classification: v.string(),
  updatedBy: v.union(v.string(), v.null()),
  updatedAt: v.number(),
});

/** Every triaged opportunity of the workspace, for the reader to join onto its list and notice pages. */
export const list = authorizedQuery(
  "procurementTriage:list",
  query,
)({
  args: { societyId: v.id("societies") },
  returns: v.array(entry),
  handler: async (ctx, { societyId }) => {
    await requireTriage(ctx, societyId);
    const rows = await ctx.db
      .query("procurementTriage")
      .withIndex("by_record", (q) => q.eq("societyId", societyId))
      .take(LIST_LIMIT);
    return rows.map((row) => ({
      recordKey: row.recordKey,
      reviewed: row.reviewed,
      classification: triageClassification(row.classification),
      updatedBy: row.updatedBy ?? null,
      updatedAt: row.updatedAt,
    }));
  },
});

/** Save one opportunity's triage. Clearing both removes the row; its action items stay. */
export const set = authorizedMutation(
  "procurementTriage:set",
  mutation,
)({
  args: {
    societyId: v.id("societies"),
    recordKey: v.string(),
    reviewed: v.boolean(),
    classification: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { societyId, recordKey, reviewed, classification }) => {
    if (!isOpportunityRecordKey(recordKey) || (classification !== "" && !isTriageClassification(classification)))
      throw new Error("Invalid triage.");
    await requireTriage(ctx, societyId);
    const member = await requireSocietyMembership(await toPortableQueryCtx(ctx), societyId);
    const updatedBy = [member.displayName, member.name, member.email].find(
      (value): value is string => typeof value === "string" && !!value.trim(),
    );
    const existing = await rowFor(ctx, societyId, recordKey);
    if (!reviewed && !classification) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const row = {
      reviewed,
      classification,
      updatedAt: Date.now(),
      ...(updatedBy ? { updatedBy: updatedBy.trim().slice(0, 200) } : {}),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("procurementTriage", { societyId, recordKey, ...row });
    return null;
  },
});

/**
 * "Create action item": a task holding the opportunity as an attachment, for
 * an opportunity the workspace has reviewed and classified (anything but not
 * doable). Only on request, never as a side effect of classifying. While the
 * opportunity is already on a task, asking again returns that task unless
 * `another` says a second one is meant, so nobody duplicates one by accident.
 * Needs tasks:write as well as the triage's documents:write. The browser sends
 * the notice's facts, since the catalog may not be in Convex.
 */
export const createTask = authorizedMutation(
  "procurementTriage:createTask",
  mutation,
)({
  args: {
    societyId: v.id("societies"),
    recordKey: v.string(),
    notice: v.object({
      title: v.string(),
      buyer: v.string(),
      closes: v.string(),
      closesText: v.string(),
      reference: v.string(),
    }),
    /** Make another action item although the opportunity is already on one. */
    another: v.optional(v.boolean()),
  },
  returns: v.object({ taskId: v.string(), created: v.boolean() }),
  handler: async (ctx, { societyId, recordKey, notice, another }) => {
    if (!isOpportunityRecordKey(recordKey)) throw new Error("Invalid opportunity.");
    if (notice.title.length > 1000 || notice.buyer.length > 500 || notice.closesText.length > 200 || notice.reference.length > 200)
      throw new Error("Invalid opportunity.");
    if (notice.closes && !/^\d{4}-\d{2}-\d{2}$/.test(notice.closes)) throw new Error("Invalid closing date.");
    await requireTriage(ctx, societyId);
    const portable = await toPortableMutationCtx(ctx);
    const member = await requirePermissionPortable(portable, societyId, "tasks:write");
    const row = await rowFor(ctx, societyId, recordKey);
    if (!row || !canCreateTriageTask({ reviewed: row.reviewed, classification: triageClassification(row.classification) }))
      throw new Error("Review and classify the opportunity before creating an action item.");
    if (!another) {
      const holding = await ctx.db
        .query("taskAttachments")
        .withIndex("by_society", (q) => q.eq("societyId", societyId).eq("kind", "opportunity").eq("refKey", recordKey))
        .collect();
      for (const attachment of holding)
        if (await ctx.db.get(attachment.taskId)) return { taskId: String(attachment.taskId), created: false };
    }
    const responsible = ctx.db.normalizeId("users", String(member._id));
    const title = notice.title.trim() || "Untitled notice";
    const taskId = await taskCreate(portable, {
      societyId,
      title: `Prepare bid: ${title}`.slice(0, 300),
      description: [
        notice.buyer.trim() && `Buyer: ${notice.buyer.trim()}`,
        (notice.closesText.trim() || notice.closes) && `Closes: ${notice.closesText.trim() || notice.closes}`,
        `Classification: ${triageLabel(row.classification)}`,
        notice.reference.trim() && `Reference: ${notice.reference.trim()}`,
      ].filter(Boolean).join("\n"),
      status: "Todo",
      priority: "Medium",
      ...(responsible ? { responsibleUserIds: [responsible] } : {}),
      ...(notice.closes ? { dueDate: notice.closes } : {}),
      tags: ["procurement"],
    });
    await attachToTask(portable, {
      taskId,
      kind: "opportunity",
      refKey: recordKey,
      snapshot: {
        title,
        ...(notice.buyer.trim() ? { subtitle: notice.buyer.trim() } : {}),
        ...(notice.closes ? { dueDate: notice.closes } : {}),
        ...(notice.closesText.trim() ? { dueText: notice.closesText.trim() } : {}),
      },
    });
    return { taskId, created: true };
  },
});

/**
 * The workspace's own bid triage of opportunities (shared/procurementTriage.ts):
 * a "reviewed" tick, a classification, and at most one action item (a task)
 * per opportunity. Saved here, shared by the workspace's members, never
 * written back to Zoer.
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
  taskId: v.union(v.string(), v.null()),
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
    return Promise.all(
      rows.map(async (row) => ({
        recordKey: row.recordKey,
        reviewed: row.reviewed,
        classification: triageClassification(row.classification),
        updatedBy: row.updatedBy ?? null,
        updatedAt: row.updatedAt,
        // A task deleted since no longer counts: the action item can be made again.
        taskId: row.taskId && (await ctx.db.get(row.taskId)) ? String(row.taskId) : null,
      })),
    );
  },
});

/** Save one opportunity's triage. Clearing both removes the row, unless it carries an action item. */
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
    // A row that links an action item stays, so the item is never made twice.
    if (!reviewed && !classification && !existing?.taskId) {
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
 * "Create action item": one task for an opportunity the workspace has
 * reviewed and classified (anything but not doable). Only on request, never as
 * a side effect of classifying, and at most one per opportunity: asking again
 * returns the task that exists. Needs tasks:write as well as the triage's
 * documents:write. The browser sends the notice's facts, since the catalog
 * may not be in Convex.
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
  },
  returns: v.object({ taskId: v.string(), created: v.boolean() }),
  handler: async (ctx, { societyId, recordKey, notice }) => {
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
    if (row.taskId && (await ctx.db.get(row.taskId))) return { taskId: String(row.taskId), created: false };
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
        `Opportunity: /app/procurement-review?notice=${encodeURIComponent(recordKey)}`,
      ].filter(Boolean).join("\n"),
      status: "Todo",
      priority: "Medium",
      ...(responsible ? { responsibleUserIds: [responsible] } : {}),
      ...(notice.closes ? { dueDate: notice.closes } : {}),
      tags: ["procurement"],
    });
    const stored = ctx.db.normalizeId("tasks", taskId);
    if (!stored) throw new Error("The action item could not be linked.");
    await ctx.db.patch(row._id, { taskId: stored });
    return { taskId, created: true };
  },
});

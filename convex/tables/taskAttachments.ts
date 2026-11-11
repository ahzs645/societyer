import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Things attached to a task (shared/taskAttachments.ts,
 * shared/functions/taskAttachments.ts): one row per thing, any number per
 * task, and a thing may sit on several tasks. Unlike the task's single
 * "Linked to" slots (where a task came from), these are what the work is
 * about. `refKey` is the thing's key as text: a document id, or an
 * opportunity's record key (the catalog lives outside Convex). The title,
 * subtitle and due date are a snapshot taken when it was attached, so a list
 * reads without the source; documents are read live where they can be.
 */
export const taskAttachmentTables = {
  taskAttachments: defineTable({
    societyId: v.id("societies"),
    taskId: v.id("tasks"),
    // "document" | "opportunity" (TASK_ATTACHMENT_KINDS); a string so more kinds need no migration.
    kind: v.string(),
    refKey: v.string(),
    title: v.string(),
    // The buyer, for an opportunity.
    subtitle: v.optional(v.string()),
    // YYYY-MM-DD, and the date as the source wrote it (an opportunity's closing time).
    dueDate: v.optional(v.string()),
    dueText: v.optional(v.string()),
    attachedByUserId: v.optional(v.id("users")),
    attachedByName: v.optional(v.string()),
    attachedAtISO: v.string(),
  })
    // "Attachments of a task", and whether a thing is already on it.
    .index("by_task", ["taskId", "kind", "refKey"])
    // "Tasks holding this thing", a workspace's attachments of one kind, and the workspace export.
    .index("by_society", ["societyId", "kind", "refKey"]),
};

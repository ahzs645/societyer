// @ts-nocheck
import { mutation } from "./_generated/server";
import { v } from "convex/values";

const remediationArgs = {
  societyId: v.id("societies"),
  ruleId: v.string(),
  flagLevel: v.string(),
  flagText: v.string(),
  evidenceRequired: v.array(v.string()),
};

export const createComplianceReviewTask = mutation({
  args: {
    ...remediationArgs,
    title: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await createReviewTaskForFlag(ctx, {
      ...args,
      title: args.title ?? `Review compliance flag: ${args.flagText}`,
      description: `Dashboard rule ${args.ruleId} needs review.\n\nEvidence expected: ${args.evidenceRequired.join(", ") || "None listed"}`,
      tags: ["compliance", "dashboard-flag", args.ruleId],
    });
  },
});

export const createPrivacyReviewTask = mutation({
  args: {
    ...remediationArgs,
    assignee: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await createReviewTaskForFlag(ctx, {
      ...args,
      title: "Review PIPA remediation workflow",
      description: [
        `Dashboard rule ${args.ruleId} needs a PIPA remediation review.`,
        "",
        "Review the privacy policy, role-based access, retention/disposal, training, breach response, service-provider terms, and member-data access evidence.",
        `Evidence expected: ${args.evidenceRequired.join(", ") || "None listed"}`,
      ].join("\n"),
      tags: ["compliance", "dashboard-flag", "privacy", "pipa", args.ruleId],
    });
  },
});

export const markPrivacyProgramReviewed = mutation({
  args: remediationArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const nowISO = new Date().toISOString();
    await ctx.db.patch(args.societyId, {
      privacyProgramStatus: "Documented",
      privacyProgramReviewedAtISO: nowISO.slice(0, 10),
      updatedAt: Date.now(),
    });
    const remediationId = await upsertRemediation(ctx, {
      ...args,
      status: "resolved",
      resolvedAtISO: nowISO,
      notes: "Marked privacy program reviewed from dashboard remediation action.",
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "society",
      entityId: args.societyId,
      action: "privacy-program-reviewed",
      summary: "Marked PIPA privacy program reviewed from dashboard remediation.",
      createdAtISO: nowISO,
    });
    return { remediationId, reviewedAtISO: nowISO };
  },
});

export const markMemberDataAccessReviewed = mutation({
  args: remediationArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const nowISO = new Date().toISOString();
    await ctx.db.patch(args.societyId, {
      memberDataGapDocumented: true,
      memberDataAccessReviewedAtISO: nowISO.slice(0, 10),
      updatedAt: Date.now(),
    });
    const remediationId = await upsertRemediation(ctx, {
      ...args,
      status: "resolved",
      resolvedAtISO: nowISO,
      notes: "Marked member-data access reviewed from dashboard remediation action.",
    });
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "society",
      entityId: args.societyId,
      action: "member-data-access-reviewed",
      summary: "Marked member-data access reviewed from dashboard remediation.",
      createdAtISO: nowISO,
    });
    return { remediationId, reviewedAtISO: nowISO };
  },
});

async function createReviewTaskForFlag(ctx: any, args: {
  societyId: any;
  ruleId: string;
  flagLevel: string;
  flagText: string;
  evidenceRequired: string[];
  title: string;
  description: string;
  assignee?: string;
  dueDate?: string;
  tags: string[];
}) {
  const nowISO = new Date().toISOString();
  const eventId = `compliance:${args.ruleId}`;
  const existingTasks = await ctx.db
    .query("tasks")
    .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
    .collect();
  const existingTask = existingTasks.find((task: any) =>
    task.eventId === eventId && task.status !== "Done",
  );

  const taskId = existingTask?._id ?? await ctx.db.insert("tasks", {
    societyId: args.societyId,
    title: args.title,
    description: args.description,
    status: "Todo",
    priority: args.flagLevel === "err" ? "High" : "Medium",
    assignee: args.assignee,
    dueDate: args.dueDate,
    eventId,
    tags: Array.from(new Set(args.tags)),
    createdAtISO: nowISO,
  });

  const remediationId = await upsertRemediation(ctx, {
    societyId: args.societyId,
    ruleId: args.ruleId,
    flagLevel: args.flagLevel,
    flagText: args.flagText,
    evidenceRequired: args.evidenceRequired,
    status: "open",
    assignedTo: args.assignee,
    taskId,
    notes: existingTask ? "Existing open remediation task reused." : "Review task created from dashboard remediation action.",
  });

  if (!existingTask) {
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "task",
      entityId: taskId,
      action: "created",
      summary: `Created remediation task "${args.title}"`,
      createdAtISO: nowISO,
    });
  }

  return { taskId, remediationId, reused: Boolean(existingTask) };
}

async function upsertRemediation(ctx: any, args: {
  societyId: any;
  ruleId: string;
  flagLevel: string;
  flagText: string;
  evidenceRequired: string[];
  status: string;
  assignedTo?: string;
  taskId?: any;
  resolvedAtISO?: string;
  notes?: string;
}) {
  const nowISO = new Date().toISOString();
  const existing = await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q: any) => q.eq("societyId", args.societyId).eq("ruleId", args.ruleId))
    .first();
  const patch = {
    flagLevel: args.flagLevel,
    flagText: args.flagText,
    evidenceRequired: args.evidenceRequired,
    status: args.status,
    assignedTo: args.assignedTo,
    taskId: args.taskId,
    resolvedAtISO: args.resolvedAtISO,
    notes: args.notes,
    updatedAtISO: nowISO,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("complianceRemediations", {
    societyId: args.societyId,
    ruleId: args.ruleId,
    createdAtISO: nowISO,
    ...patch,
  });
}

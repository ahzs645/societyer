/**
 * PORTABLE FUNCTIONS: the dashboard-remediation domain
 * (createComplianceReviewTask / createPrivacyReviewTask /
 *  markPrivacyProgramReviewed / markMemberDataAccessReviewed /
 *  dismissItem / restoreItem).
 *
 * Reads/writes `society / tasks / complianceRemediations / activity` over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import { DISMISSED_STATUS, isRecommendationLevel, normalizeDismissalReason } from "../dashboardDismissals";

export async function createComplianceReviewTaskPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
    title?: string;
    assignee?: string;
    dueDate?: string;
  },
) {
  return await createReviewTaskForFlag(ctx, {
    ...args,
    title: args.title ?? `Review compliance flag: ${args.flagText}`,
    description: `Dashboard rule ${args.ruleId} needs review.\n\nEvidence expected: ${args.evidenceRequired.join(", ") || "None listed"}`,
    tags: ["compliance", "dashboard-flag", args.ruleId],
  });
}

export async function createPrivacyReviewTaskPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
    assignee?: string;
    dueDate?: string;
  },
) {
  return await createReviewTaskForFlag(ctx, {
    ...args,
    title: "Review privacy remediation workflow",
    description: [
      `Dashboard rule ${args.ruleId} needs a privacy remediation review.`,
      "",
      "Confirm the applicable law and actual activities, then review privacy practices, access controls, retention/disposal, training, incident handling, provider terms and evidence for the records held.",
      `Evidence expected: ${args.evidenceRequired.join(", ") || "None listed"}`,
    ].join("\n"),
    tags: ["compliance", "dashboard-flag", "privacy", args.ruleId],
  });
}

export async function markPrivacyProgramReviewedPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
  },
) {
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
    subjectId: args.societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: args.societyId,
    action: "privacy-program-reviewed",
    summary: "Marked privacy program reviewed from dashboard remediation.",
    createdAtISO: nowISO,
  });
  return { remediationId, reviewedAtISO: nowISO };
}

export async function markMemberDataAccessReviewedPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
  },
) {
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
    subjectId: args.societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: args.societyId,
    action: "member-data-access-reviewed",
    summary: "Marked member-data access reviewed from dashboard remediation.",
    createdAtISO: nowISO,
  });
  return { remediationId, reviewedAtISO: nowISO };
}

/**
 * Dismiss a dashboard recommendation (a "warn" or "info" compliance flag or
 * continuity check) for the whole workspace. The row keeps the level it was
 * dismissed at, so the item shows again if it escalates; the dashboard reads
 * decide whether an item is dismissable at all (shared/dashboardDismissals.ts).
 */
export async function dismissItemPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    reason?: string;
  },
) {
  if (!isRecommendationLevel(args.flagLevel)) {
    throw new Error("Only recommendations can be dismissed. Requirements stay on the dashboard until they are resolved.");
  }
  const ruleId = dashboardItemId(args.ruleId);
  const user = await requireSocietyMembership(ctx, args.societyId);
  const dismissedByName = typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : undefined;
  const reason = normalizeDismissalReason(args.reason);
  const flagText = String(args.flagText ?? "").trim().slice(0, 1000);
  const nowISO = new Date().toISOString();
  const existing = await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q) => q.eq("societyId", args.societyId).eq("ruleId", ruleId))
    .first();
  const fields = {
    flagLevel: args.flagLevel,
    flagText,
    status: DISMISSED_STATUS,
    dismissedAtISO: nowISO,
    dismissedByUserId: user._id,
    dismissedByName,
    dismissalReason: reason,
    updatedAtISO: nowISO,
  };
  let remediationId: string;
  if (existing) {
    // Re-dismissing keeps the status the row had before its first dismissal.
    const previous = existing.status === DISMISSED_STATUS ? existing.statusBeforeDismissal : existing.status;
    await ctx.db.patch(existing._id, { ...fields, statusBeforeDismissal: previous });
    remediationId = existing._id;
  } else {
    remediationId = await ctx.db.insert("complianceRemediations", {
      societyId: args.societyId,
      ruleId,
      evidenceRequired: [],
      createdAtISO: nowISO,
      ...withoutUndefined(fields),
    });
  }
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: dismissedByName ?? "You",
    entityType: "society",
    subjectId: args.societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: args.societyId,
    action: "dashboard-item-dismissed",
    summary: `Dismissed dashboard recommendation: ${flagText || ruleId}${reason ? ` (${reason})` : ""}`,
    createdAtISO: nowISO,
  });
  return { remediationId, dismissedAtISO: nowISO };
}

/** Bring a dismissed dashboard recommendation back. */
export async function restoreItemPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; ruleId: string },
) {
  const ruleId = dashboardItemId(args.ruleId);
  const user = await requireSocietyMembership(ctx, args.societyId);
  const existing = await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q) => q.eq("societyId", args.societyId).eq("ruleId", ruleId))
    .first();
  if (!existing || existing.status !== DISMISSED_STATUS) return { restored: false };
  const nowISO = new Date().toISOString();
  if (typeof existing.statusBeforeDismissal === "string" && existing.statusBeforeDismissal) {
    // The row held a review task or decision before: return to it.
    await ctx.db.patch(existing._id, {
      status: existing.statusBeforeDismissal,
      statusBeforeDismissal: undefined,
      dismissedAtISO: undefined,
      dismissedByUserId: undefined,
      dismissedByName: undefined,
      dismissalReason: undefined,
      updatedAtISO: nowISO,
    });
  } else {
    // The dismissal made the row; the activity log keeps its history.
    await ctx.db.delete(existing._id);
  }
  const actor = typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : "You";
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor,
    entityType: "society",
    subjectId: args.societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: args.societyId,
    action: "dashboard-item-restored",
    summary: `Restored dashboard recommendation: ${existing.flagText || ruleId}`,
    createdAtISO: nowISO,
  });
  return { restored: true };
}

function dashboardItemId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 200) throw new Error("Unknown dashboard item.");
  return id;
}

function withoutUndefined<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

async function createReviewTaskForFlag(ctx: PortableMutationCtx, args: {
  societyId: string;
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
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  const existingTask = existingTasks.find((task: Record<string, any>) =>
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
      subjectId: taskId,
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: taskId,
      action: "created",
      summary: `Created remediation task "${args.title}"`,
      createdAtISO: nowISO,
    });
  }

  return { taskId, remediationId, reused: Boolean(existingTask) };
}

async function upsertRemediation(ctx: PortableMutationCtx, args: {
  societyId: string;
  ruleId: string;
  flagLevel: string;
  flagText: string;
  evidenceRequired: string[];
  status: string;
  assignedTo?: string;
  taskId?: string;
  resolvedAtISO?: string;
  notes?: string;
}) {
  const nowISO = new Date().toISOString();
  const existing = await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q) => q.eq("societyId", args.societyId).eq("ruleId", args.ruleId))
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

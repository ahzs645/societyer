/**
 * PORTABLE FUNCTIONS: the dashboard-remediation domain
 * (createComplianceReviewTask / createPrivacyReviewTask /
 *  markPrivacyProgramReviewed (deprecated) / markMemberDataAccessReviewed /
 *  dismissItem / acknowledgeItem / restoreItem / snoozeItem / cancelSnooze).
 *
 * Reads/writes `society / tasks / complianceRemediations / activity` over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import {
  ACKNOWLEDGED_STATUS,
  DISMISSED_STATUS,
  normalizeAcknowledgementNote,
  normalizeDismissalReason,
  normalizeSnoozeUntil,
  SNOOZED_STATUS,
} from "../dashboardDismissals";
import { findingPolicy, isProtectedAtEveryLevel, obligationRuleId } from "../dashboardFindingPolicy";
import { todayDateOnly } from "../dateOnly";
import { OPEN_TASK_STATUSES } from "../taskStatus";
import { summaryPortable } from "./dashboard";
import { dashboardChecksPortable } from "./continuity";

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

/**
 * Deprecated: the one-click "Mark reviewed" set the privacy program to
 * Documented without recording what was reviewed, by whom, or where the policy
 * is kept. The route stays registered so a client loaded before the change
 * gets a clear message instead of an unknown-function error; it writes
 * nothing. Use `society:recordPrivacyReview` (shared/functions/governingDocumentEvidence.ts).
 */
export async function markPrivacyProgramReviewedPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
  },
): Promise<never> {
  await requireSocietyMembership(ctx, args.societyId);
  throw new Error("Privacy reviews are now recorded with who reviewed what and where it is kept. Reload Societyer and use Record review.");
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
 * The dashboard item as the server computes it now: the compliance flag or
 * continuity check with this id, with its level, subject and whether it may
 * be dismissed. The client's own copy is never trusted.
 */
async function currentDashboardItem(ctx: PortableMutationCtx, societyId: string, ruleId: string) {
  if (ruleId.startsWith("CONTINUITY-")) {
    const check = (await dashboardChecksPortable(ctx, { societyId })).checks.find((row) => row.id === ruleId);
    return check ? {
      level: check.level,
      text: `${check.title}. ${check.text}`,
      subjectKey: check.subjectKey,
      dismissable: check.dismissable,
      // A check with no basis is unclassified, so a requirement (fail closed).
      requirement: check.requirementBasis !== "recommendation",
      evidenceRequired: [] as string[],
    } : null;
  }
  const flag = (await summaryPortable(ctx, { societyId })).complianceFlags.find((row) => row.ruleId === ruleId);
  return flag ? {
    level: flag.level,
    text: flag.text,
    subjectKey: flag.subjectKey,
    dismissable: Boolean(flag.dismissable),
    requirement: flag.requirementBasis !== "recommendation",
    evidenceRequired: flag.evidenceRequired,
  } : null;
}

const REQUIREMENT_NOT_DISMISSABLE = "This is a requirement, so it can't be dismissed. Acknowledge it or assign a follow-up instead; it stays on the dashboard until it is resolved.";

/** Refuse when the client acted on an item that has changed level since it loaded. */
function assertExpectedLevel(expected: unknown, current: string) {
  if (typeof expected === "string" && expected && expected !== current) {
    throw new Error("This item has changed since the page loaded. Refresh and try again.");
  }
}

function actorName(user: Record<string, unknown>): string | undefined {
  return typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : undefined;
}

/**
 * Dismiss a dashboard recommendation for the whole workspace. The server
 * looks the item up itself: a statutory, bylaw or internal-policy finding
 * (shared/dashboardFindingPolicy.ts), an item at "err", or one that is no
 * longer on the dashboard is refused whatever level the client sends. The row
 * keeps the level and subject key at dismissal, so the item shows again if it
 * escalates or concerns another record.
 */
export async function dismissItemPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    /** The level the client saw; a mismatch is refused as stale. */
    flagLevel?: string;
    /** Ignored: the server records the item's current text. */
    flagText?: string;
    reason?: string;
  },
) {
  const ruleId = dashboardItemId(args.ruleId);
  // A rule that is a requirement at every level is refused before any read;
  // one whose basis depends on its level is checked at its current level.
  if (isProtectedAtEveryLevel(ruleId)) throw new Error(REQUIREMENT_NOT_DISMISSABLE);
  const user = await requireSocietyMembership(ctx, args.societyId);
  const item = await currentDashboardItem(ctx, args.societyId, ruleId);
  if (!item) throw new Error("This item is no longer on the dashboard.");
  assertExpectedLevel(args.flagLevel, item.level);
  if (item.requirement) throw new Error(REQUIREMENT_NOT_DISMISSABLE);
  if (!item.dismissable || !item.subjectKey) {
    throw new Error("Only recommendations can be dismissed. Requirements stay on the dashboard until they are resolved.");
  }
  const dismissedByName = actorName(user);
  const reason = normalizeDismissalReason(args.reason);
  const flagText = item.text.trim().slice(0, 1000);
  const nowISO = new Date().toISOString();
  const existing = await remediationRow(ctx, args.societyId, ruleId);
  const fields = {
    flagLevel: item.level,
    flagText,
    status: DISMISSED_STATUS,
    dismissedAtISO: nowISO,
    dismissedByUserId: user._id,
    dismissedByName,
    dismissalReason: reason,
    dismissedSubjectKey: item.subjectKey,
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
  await logDashboardActivity(ctx, args.societyId, dismissedByName, "dashboard-item-dismissed",
    `Dismissed dashboard recommendation: ${flagText || ruleId}${reason ? ` (${reason})` : ""}`, nowISO);
  return { remediationId, dismissedAtISO: nowISO };
}

/**
 * Acknowledge a dashboard finding: record who has seen it, when, and an
 * optional note. Unlike a dismissal it hides nothing; the item stays on the
 * dashboard and in every count until the evidence resolves it. The
 * acknowledgement holds while the item's subject is unchanged.
 */
export async function acknowledgeItemPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; ruleId: string; flagLevel?: string; note?: string },
) {
  const ruleId = dashboardItemId(args.ruleId);
  const user = await requireSocietyMembership(ctx, args.societyId);
  const item = await currentDashboardItem(ctx, args.societyId, ruleId);
  if (!item || item.level === "ok" || !item.subjectKey) throw new Error("This item is no longer on the dashboard.");
  assertExpectedLevel(args.flagLevel, item.level);
  const acknowledgedByName = actorName(user);
  const note = normalizeAcknowledgementNote(args.note);
  const nowISO = new Date().toISOString();
  const fields = {
    acknowledgedAtISO: nowISO,
    acknowledgedByUserId: user._id,
    acknowledgedByName,
    acknowledgementNote: note,
    acknowledgedSubjectKey: item.subjectKey,
    updatedAtISO: nowISO,
  };
  const existing = await remediationRow(ctx, args.societyId, ruleId);
  let remediationId: string;
  if (existing) {
    // The row's status (an open review task, an old dismissal) is left as it is.
    await ctx.db.patch(existing._id, fields);
    remediationId = existing._id;
  } else {
    remediationId = await ctx.db.insert("complianceRemediations", {
      societyId: args.societyId,
      ruleId,
      flagLevel: item.level,
      flagText: item.text.trim().slice(0, 1000),
      evidenceRequired: item.evidenceRequired,
      status: ACKNOWLEDGED_STATUS,
      createdAtISO: nowISO,
      ...withoutUndefined(fields),
    });
  }
  await logDashboardActivity(ctx, args.societyId, acknowledgedByName, "dashboard-item-acknowledged",
    `Acknowledged dashboard item: ${item.text.trim().slice(0, 300) || ruleId}${note ? ` (${note})` : ""}`, nowISO);
  return { remediationId, acknowledgedAtISO: nowISO };
}

/**
 * Bring a dismissed dashboard recommendation back, or withdraw an
 * acknowledgement. A row the dismissal or acknowledgement created is removed
 * (the activity log keeps its history); otherwise the row returns to its
 * earlier state.
 */
export async function restoreItemPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; ruleId: string },
) {
  const ruleId = dashboardItemId(args.ruleId);
  const user = await requireSocietyMembership(ctx, args.societyId);
  const existing = await remediationRow(ctx, args.societyId, ruleId);
  if (!existing) return { restored: false };
  const nowISO = new Date().toISOString();
  const actor = actorName(user);
  if (existing.status === DISMISSED_STATUS) {
    if (typeof existing.statusBeforeDismissal === "string" && existing.statusBeforeDismissal) {
      // The row held a review task, decision or acknowledgement before: return to it.
      await ctx.db.patch(existing._id, {
        status: existing.statusBeforeDismissal,
        statusBeforeDismissal: undefined,
        dismissedAtISO: undefined,
        dismissedByUserId: undefined,
        dismissedByName: undefined,
        dismissalReason: undefined,
        dismissedSubjectKey: undefined,
        updatedAtISO: nowISO,
      });
    } else {
      await ctx.db.delete(existing._id);
    }
    await logDashboardActivity(ctx, args.societyId, actor, "dashboard-item-restored",
      `Restored dashboard recommendation: ${existing.flagText || ruleId}`, nowISO);
    return { restored: true };
  }
  if (!existing.acknowledgedAtISO) return { restored: false };
  await clearAttention(ctx, existing, {
    acknowledgedAtISO: undefined,
    acknowledgedByUserId: undefined,
    acknowledgedByName: undefined,
    acknowledgementNote: undefined,
    acknowledgedSubjectKey: undefined,
    updatedAtISO: nowISO,
  });
  await logDashboardActivity(ctx, args.societyId, actor, "dashboard-item-acknowledgement-withdrawn",
    `Withdrew acknowledgement: ${existing.flagText || ruleId}`, nowISO);
  return { restored: true };
}

/**
 * "Remind me later" for a requirement: its reminders pause until `untilISO`
 * (a calendar day after today, within a year). It stays on the dashboard,
 * sorted after the others, and in every count; only nudges (the assistant's
 * attention list) leave it out. The snooze ends on that day, when the
 * finding's subject changes, or when it becomes more serious.
 *
 * Dashboard flags and continuity checks are looked up on the server, like
 * acknowledgeItem. An obligation occurrence ("<context>:<ruleId>:<date>") is
 * computed in the browser, so its level comes from the client, and its
 * occurrence key is its subject. Recommendations are dismissed, not snoozed.
 */
export async function snoozeItemPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; ruleId: string; flagLevel?: string; flagText?: string; untilISO: string },
) {
  const ruleId = dashboardItemId(args.ruleId);
  const user = await requireSocietyMembership(ctx, args.societyId);
  const item = await snoozeTarget(ctx, args.societyId, ruleId, args);
  if (!item.requirement) throw new Error("This is a recommendation, so dismiss it instead of snoozing it.");
  const untilISO = normalizeSnoozeUntil(args.untilISO, todayDateOnly(new Date()));
  const snoozedByName = actorName(user);
  const nowISO = new Date().toISOString();
  const fields = {
    snoozedUntilISO: untilISO,
    snoozedByUserId: user._id,
    snoozedByName,
    snoozedSubjectKey: item.subjectKey,
    snoozedLevel: item.level,
    updatedAtISO: nowISO,
  };
  const existing = await remediationRow(ctx, args.societyId, ruleId);
  let remediationId: string;
  if (existing) {
    // The row's status (an open review task, an acknowledgement) is left as it is.
    await ctx.db.patch(existing._id, fields);
    remediationId = existing._id;
  } else {
    remediationId = await ctx.db.insert("complianceRemediations", {
      societyId: args.societyId,
      ruleId,
      flagLevel: item.level,
      flagText: item.text.trim().slice(0, 1000),
      evidenceRequired: item.evidenceRequired,
      status: SNOOZED_STATUS,
      createdAtISO: nowISO,
      ...withoutUndefined(fields),
    });
  }
  await logDashboardActivity(ctx, args.societyId, snoozedByName, "dashboard-item-snoozed",
    `Snoozed reminders until ${untilISO}: ${item.text.trim().slice(0, 300) || ruleId}`, nowISO);
  return { remediationId, snoozedUntilISO: untilISO };
}

/** End a snooze early. A row the snooze created is removed; otherwise only the snooze is cleared. */
export async function cancelSnoozePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; ruleId: string },
) {
  const ruleId = dashboardItemId(args.ruleId);
  const user = await requireSocietyMembership(ctx, args.societyId);
  const existing = await remediationRow(ctx, args.societyId, ruleId);
  if (!existing?.snoozedUntilISO) return { cancelled: false };
  const nowISO = new Date().toISOString();
  await clearAttention(ctx, existing, {
    snoozedUntilISO: undefined,
    snoozedByUserId: undefined,
    snoozedByName: undefined,
    snoozedSubjectKey: undefined,
    snoozedLevel: undefined,
    updatedAtISO: nowISO,
  });
  await logDashboardActivity(ctx, args.societyId, actorName(user), "dashboard-item-snooze-cancelled",
    `Cancelled snooze: ${existing.flagText || ruleId}`, nowISO);
  return { cancelled: true };
}

/** What a snooze applies to: the server's own dashboard item, or an obligation occurrence. */
async function snoozeTarget(
  ctx: PortableMutationCtx,
  societyId: string,
  ruleId: string,
  args: { flagLevel?: string; flagText?: string },
) {
  if (/:\d{4}-\d{2}-\d{2}$/.test(ruleId) && obligationRuleId(ruleId)) {
    const level = args.flagLevel;
    if (level !== "info" && level !== "warn" && level !== "err") throw new Error("Unknown obligation level.");
    return {
      level,
      text: String(args.flagText ?? ruleId),
      subjectKey: ruleId,
      requirement: findingPolicy(ruleId).protected,
      evidenceRequired: [] as string[],
    };
  }
  const item = await currentDashboardItem(ctx, societyId, ruleId);
  if (!item || item.level === "ok" || !item.subjectKey) throw new Error("This item is no longer on the dashboard.");
  assertExpectedLevel(args.flagLevel, item.level);
  return { ...item, subjectKey: item.subjectKey };
}

/**
 * Clear an acknowledgement or a snooze from a row. A row that only held
 * attention (no review task, decision or other attention left) is removed;
 * otherwise its status says what is left.
 */
async function clearAttention(
  ctx: PortableMutationCtx,
  row: Record<string, unknown> & { _id: string },
  patch: Record<string, unknown>,
) {
  const after = { ...row, ...patch };
  const attentionOnly = row.status === ACKNOWLEDGED_STATUS || row.status === SNOOZED_STATUS;
  if (attentionOnly && !row.taskId && !after.acknowledgedAtISO && !after.snoozedUntilISO) {
    await ctx.db.delete(row._id);
    return;
  }
  const status = attentionOnly ? (after.acknowledgedAtISO ? ACKNOWLEDGED_STATUS : after.snoozedUntilISO ? SNOOZED_STATUS : row.status) : row.status;
  await ctx.db.patch(row._id, { ...patch, ...(status !== row.status ? { status } : {}) });
}

async function remediationRow(ctx: PortableMutationCtx, societyId: string, ruleId: string) {
  return await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q) => q.eq("societyId", societyId).eq("ruleId", ruleId))
    .first();
}

async function logDashboardActivity(ctx: PortableMutationCtx, societyId: string, actor: string | undefined, action: string, summary: string, createdAtISO: string) {
  await ctx.db.insert("activity", {
    societyId,
    actor: actor ?? "You",
    entityType: "society",
    subjectId: societyId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: societyId,
    action,
    summary,
    createdAtISO,
  });
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
  // An open task for this finding takes the new owner and due date; a closed
  // one is left as history and a new task is made.
  const existingTask = existingTasks.find((task: Record<string, any>) =>
    task.eventId === eventId && (OPEN_TASK_STATUSES as readonly string[]).includes(String(task.status)),
  );
  const assignee = args.assignee?.trim() || undefined;
  const dueDate = args.dueDate?.trim() || undefined;
  const reassignment: { assignee?: string; dueDate?: string } = existingTask ? {
    ...(assignee && assignee !== existingTask.assignee ? { assignee } : {}),
    ...(dueDate && dueDate !== existingTask.dueDate ? { dueDate } : {}),
  } : {};
  const reassigned = Object.keys(reassignment).length > 0;
  if (existingTask && reassigned) {
    await ctx.db.patch(existingTask._id, reassignment);
    const owner = reassignment.assignee ?? existingTask.assignee;
    const due = reassignment.dueDate ?? existingTask.dueDate;
    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "You",
      entityType: "task",
      subjectId: existingTask._id,
      // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
      entityId: existingTask._id,
      action: "follow-up-reassigned",
      summary: `Follow-up reassigned${owner ? ` to ${owner}` : ""}${due ? `, due ${due}` : ""}`,
      createdAtISO: nowISO,
    });
  }

  const taskId = existingTask?._id ?? await ctx.db.insert("tasks", {
    societyId: args.societyId,
    title: args.title,
    description: args.description,
    status: "Todo",
    priority: args.flagLevel === "err" ? "High" : "Medium",
    assignee,
    dueDate,
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
    assignedTo: existingTask ? (reassignment.assignee ?? existingTask.assignee) : assignee,
    taskId,
    notes: !existingTask ? "Review task created from dashboard remediation action." : reassigned ? "Existing open remediation task reassigned." : "Existing open remediation task reused.",
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

  return { taskId, remediationId, reused: Boolean(existingTask), reassigned };
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

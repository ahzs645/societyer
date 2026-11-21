/**
 * PORTABLE FUNCTIONS: the compliance-obligations domain
 * (listDecisions / markReviewed / dismissDecision / acknowledgeDecision /
 *  reopenDecision).
 *
 * Reads/writes the `complianceRemediations` table over `ctx.db`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `upsertDecision` is a pure (`ctx.db`-only) helper shared by the
 * mutations.
 *
 * Obligation occurrences ("<context>:<ruleId>:<due date>") follow the same
 * dismissal policy as the dashboard (shared/dashboardFindingPolicy.ts): the
 * statute-based rule packs make them requirements, so they can be
 * acknowledged but not dismissed, and stay in the page's counts.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { findingPolicy } from "../dashboardFindingPolicy";
import { ACKNOWLEDGED_STATUS, normalizeAcknowledgementNote } from "../dashboardDismissals";

export async function listDecisionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("complianceRemediations")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function markReviewedPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
    notes?: string;
    targetTable?: string;
    targetId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.targetTable && args.targetId) {
    await getOwned(ctx, args.targetTable, args.targetId, args.societyId);
  }
  const nowISO = new Date().toISOString();
  return await upsertDecision(ctx, {
    ...args,
    status: "resolved",
    resolvedAtISO: nowISO,
    notes: args.notes ?? "Marked reviewed from compliance obligations.",
  });
}

export async function dismissDecisionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
    notes?: string;
  },
) {
  if (findingPolicy(args.ruleId).protected) {
    throw new Error("This obligation is a requirement, so it can't be dismissed. Acknowledge it instead; it stays in the counts until it is filed or reviewed.");
  }
  await requireSocietyMembership(ctx, args.societyId);
  const nowISO = new Date().toISOString();
  return await upsertDecision(ctx, {
    ...args,
    status: "dismissed",
    dismissedAtISO: nowISO,
    notes: args.notes ?? "Dismissed from compliance obligations.",
  });
}

/**
 * Acknowledge an obligation occurrence: record who has seen it, when, and an
 * optional note. It stays outstanding and in the page's counts. The
 * occurrence key is its own subject, so a later occurrence is not covered.
 */
export async function acknowledgeDecisionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
    notes?: string;
  },
) {
  const user = await requireSocietyMembership(ctx, args.societyId);
  const nowISO = new Date().toISOString();
  const acknowledgedByName = typeof user.displayName === "string" && user.displayName.trim() ? user.displayName.trim() : undefined;
  const note = normalizeAcknowledgementNote(args.notes);
  const fields = {
    acknowledgedAtISO: nowISO,
    acknowledgedByUserId: user._id,
    acknowledgedByName,
    acknowledgementNote: note,
    acknowledgedSubjectKey: args.ruleId,
    updatedAtISO: nowISO,
  };
  const existing = await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q) => q.eq("societyId", args.societyId).eq("ruleId", args.ruleId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return { remediationId: existing._id, status: existing.status, updated: true };
  }
  const remediationId = await ctx.db.insert("complianceRemediations", {
    societyId: args.societyId,
    ruleId: args.ruleId,
    flagLevel: args.flagLevel,
    flagText: String(args.flagText ?? "").slice(0, 1000),
    evidenceRequired: args.evidenceRequired,
    status: ACKNOWLEDGED_STATUS,
    createdAtISO: nowISO,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  });
  return { remediationId, status: ACKNOWLEDGED_STATUS, updated: false };
}

export async function reopenDecisionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  return upsertDecision(ctx, {
    ...args,
    status: "open",
    notes: "Reopened from compliance obligations.",
    clearAcknowledgement: true,
  });
}

async function upsertDecision(
  ctx: PortableMutationCtx,
  args: {
    societyId: any;
    ruleId: string;
    flagLevel: string;
    flagText: string;
    evidenceRequired: string[];
    status: string;
    targetTable?: string;
    targetId?: string;
    resolvedAtISO?: string;
    dismissedAtISO?: string;
    notes?: string;
    /** Reopening also withdraws an acknowledgement. */
    clearAcknowledgement?: boolean;
  },
) {
  const nowISO = new Date().toISOString();
  const existing = await ctx.db
    .query("complianceRemediations")
    .withIndex("by_society_rule", (q: any) =>
      q.eq("societyId", args.societyId).eq("ruleId", args.ruleId),
    )
    .first();
  const patch = {
    flagLevel: args.flagLevel,
    flagText: args.flagText,
    evidenceRequired: args.evidenceRequired,
    status: args.status,
    targetTable: args.targetTable,
    targetId: args.targetId,
    resolvedAtISO: args.resolvedAtISO,
    dismissedAtISO: args.dismissedAtISO,
    notes: args.notes,
    updatedAtISO: nowISO,
    ...(args.clearAcknowledgement ? {
      acknowledgedAtISO: undefined,
      acknowledgedByUserId: undefined,
      acknowledgedByName: undefined,
      acknowledgementNote: undefined,
      acknowledgedSubjectKey: undefined,
    } : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return { remediationId: existing._id, status: args.status, updated: true };
  }
  const remediationId = await ctx.db.insert("complianceRemediations", {
    societyId: args.societyId,
    ruleId: args.ruleId,
    createdAtISO: nowISO,
    ...patch,
  });
  return { remediationId, status: args.status, updated: false };
}

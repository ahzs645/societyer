/**
 * PORTABLE FUNCTIONS: the compliance-obligations domain
 * (listDecisions / markReviewed / dismissDecision / reopenDecision).
 *
 * Reads/writes the `complianceRemediations` table over `ctx.db`. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `upsertDecision` is a pure (`ctx.db`-only) helper shared by the three
 * mutations.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";

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
  await requireSocietyMembership(ctx, args.societyId);
  const nowISO = new Date().toISOString();
  return await upsertDecision(ctx, {
    ...args,
    status: "dismissed",
    dismissedAtISO: nowISO,
    notes: args.notes ?? "Dismissed from compliance obligations.",
  });
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

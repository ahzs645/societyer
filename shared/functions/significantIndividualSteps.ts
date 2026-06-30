/**
 * PORTABLE FUNCTIONS: the significant-individual-steps domain
 * (list / create / reviewsDue / remove).
 *
 * Reads/writes the `significantIndividualSteps` table over `ctx.db` — the
 * diligence sub-register of reasonable steps taken to identify and confirm a
 * significant individual. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle. The due-review derivation
 * delegates to the dep-free `reviewsDue` helper in shared/significantIndividuals.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  reviewsDue as computeReviewsDue,
  type SignificanceStep,
} from "../significantIndividuals";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("significantIndividualSteps")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.sort((a, b) => (a.stepDate < b.stepDate ? 1 : a.stepDate > b.stepDate ? -1 : 0));
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    individualName: string;
    roleHolderId?: string;
    stepsNarrative: string;
    stepDate: string;
    nextReviewDate?: string;
    nowISO: string;
  },
): Promise<string> {
  const { nowISO, ...rest } = args;
  return ctx.db.insert("significantIndividualSteps", {
    ...rest,
    createdAtISO: nowISO,
  });
}

export async function reviewsDuePortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  const rows = await ctx.db
    .query("significantIndividualSteps")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const steps: SignificanceStep[] = rows.map((row: Record<string, any>) => ({
    individualName: row.individualName,
    stepsNarrative: row.stepsNarrative,
    stepDate: row.stepDate,
    nextReviewDate: row.nextReviewDate,
  }));
  return computeReviewsDue(steps, asOf);
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}

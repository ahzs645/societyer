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
import { getOwned, requireSocietyMembership } from "./access";
import {
  reviewsDue as computeReviewsDue,
  type SignificanceStep,
} from "../significantIndividuals";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  if (args.roleHolderId) await getOwned(ctx, "roleHolders", args.roleHolderId, args.societyId);
  // A diligence step needs who it concerns, what was done and when (G-29).
  const problems = [
    !String(args.individualName ?? "").trim() ? "the individual's name" : "",
    !String(args.stepsNarrative ?? "").trim() ? "the steps taken" : "",
    !/^\d{4}-\d{2}-\d{2}$/.test(String(args.stepDate ?? "")) ? "the step date" : "",
  ].filter(Boolean);
  if (problems.length) throw new Error(`Step not recorded: enter ${problems.join(", ")}.`);
  if (args.nextReviewDate && args.nextReviewDate < args.stepDate) throw new Error("The next review date cannot be before the step date.");
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
  await requireSocietyMembership(ctx, societyId);
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
  const candidate = await ctx.db.get(id, "significantIndividualSteps");
  if (!candidate || typeof candidate.societyId !== "string") {
    throw new Error("significantIndividualSteps not found.");
  }
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "significantIndividualSteps", id, candidate.societyId);
  await ctx.db.delete(id);
}

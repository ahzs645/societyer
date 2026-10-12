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
  deriveTransparencyDeadlines,
  transparencyEventsFromSteps,
  reviewsDue as computeReviewsDue,
  TRANSPARENCY_STEP_KINDS,
  type SignificanceStep,
  type TransparencyStepKind,
} from "../significantIndividuals";
import { legalGovernanceProfile } from "../legalGovernanceProfiles";

export { transparencyEventsFromSteps };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Date-order checks for the Part 4.1 clock fields of a diligence step. */
export function transparencyStepDateProblems(step: { stepKind?: string; awareOn?: string; recordedOn?: string; notifiedOn?: string }): string[] {
  const problems: string[] = [];
  if (step.stepKind !== undefined && !TRANSPARENCY_STEP_KINDS.some((kind) => kind.value === step.stepKind)) problems.push("Choose what the step records.");
  for (const [label, value] of [["awareness date", step.awareOn], ["recorded date", step.recordedOn], ["notice date", step.notifiedOn]] as const) {
    if (value !== undefined && !DAY.test(String(value))) problems.push(`The ${label} must be a valid date.`);
  }
  if (step.awareOn && step.recordedOn && step.recordedOn < step.awareOn) problems.push("The recorded date cannot be before the company became aware of the information.");
  if (step.recordedOn && step.notifiedOn && step.notifiedOn < step.recordedOn) problems.push("The notice date cannot be before the register entry.");
  if (step.notifiedOn && step.stepKind !== "became_significant" && step.stepKind !== "ceased_significant") problems.push("A notice date applies only to a became- or ceased-significant entry.");
  return problems;
}

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
    stepKind?: TransparencyStepKind;
    awareOn?: string;
    recordedOn?: string;
    notifiedOn?: string;
    nowISO: string;
  },
): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.roleHolderId) await getOwned(ctx, "roleHolders", args.roleHolderId, args.societyId);
  const dateProblems = transparencyStepDateProblems(args);
  if (dateProblems.length) throw new Error(`Step not recorded: ${dateProblems.join(" ")}`);
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

/** Record the register entry date or the notice date on an existing step. */
export async function updateDatesPortable(
  ctx: PortableMutationCtx,
  args: { id: string; recordedOn?: string; notifiedOn?: string },
): Promise<void> {
  const row = await ctx.db.get(args.id, "significantIndividualSteps");
  if (!row || typeof row.societyId !== "string") throw new Error("significantIndividualSteps not found.");
  await requireSocietyMembership(ctx, row.societyId);
  await getOwned(ctx, "significantIndividualSteps", args.id, row.societyId);
  const next = {
    stepKind: row.stepKind as string | undefined,
    awareOn: row.awareOn as string | undefined,
    recordedOn: args.recordedOn ?? (row.recordedOn as string | undefined),
    notifiedOn: args.notifiedOn ?? (row.notifiedOn as string | undefined),
  };
  const problems = transparencyStepDateProblems(next);
  if (problems.length) throw new Error(problems.join(" "));
  await ctx.db.patch(args.id, {
    ...(args.recordedOn ? { recordedOn: args.recordedOn } : {}),
    ...(args.notifiedOn ? { notifiedOn: args.notifiedOn } : {}),
  });
}

/**
 * Transparency-register deadlines for a BC company (annual review window,
 * 30-day update, 10-day notice, disposal). Other organizations get none: the
 * BC Part 4.1 register does not apply to them.
 */
export async function transparencyDeadlinesPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: { societyId: string; asOf: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId, "societies");
  if (legalGovernanceProfile(society as any)?.id !== "bc_company" || !DAY.test(String(asOf ?? "").slice(0, 10))) return [];
  const rows = await ctx.db
    .query("significantIndividualSteps")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return deriveTransparencyDeadlines({
    recognitionDate: (society as any)?.recognitionDate ?? (society as any)?.incorporationDate,
    events: transparencyEventsFromSteps(rows as any[]),
  }, String(asOf).slice(0, 10));
}

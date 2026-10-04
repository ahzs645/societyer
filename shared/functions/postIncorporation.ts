/**
 * PORTABLE FUNCTIONS: the post-incorporation domain (checklist).
 *
 * Post-incorporation guided checklist (YCN "next steps after incorporating").
 * Returns the ordered steps for the society's jurisdiction/entity type (pure
 * logic in shared/postIncorporationSteps.ts), each enriched with whether its
 * linked document packet has already been generated. Reads the society row and
 * the `legalPrecedentRuns` table over `ctx.db`; runs unchanged on hosted Convex,
 * the local Dexie runtime, and the convex-test oracle.
 */

import { getOwned, principalUserId, requireSocietyMembership } from "./access";
import { entityPreparationDecision } from "../entitySetup";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { postIncorporationStepsForOrganization } from "../postIncorporationSteps";

export async function checklistPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId);
  if (!society) return { steps: [], generatedPacketKeys: [] };

  const steps = postIncorporationStepsForOrganization(society as any);

  // A packet counts as "started" when a precedent run was staged for it.
  const runs = await ctx.db
    .query("legalPrecedentRuns")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const generatedPacketKeys = new Set<string>();
  for (const run of runs) {
    for (const id of run.sourceExternalIds ?? []) {
      const match = /^societyer:(?:corporation|society)-packet-run:(.+)$/.exec(String(id));
      if (match) generatedPacketKeys.add(match[1]);
    }
  }

  return { steps, generatedPacketKeys: Array.from(generatedPacketKeys), evidence: society.postIncorporationEvidence ?? [], preparation: entityPreparationDecision(society as any) };
}


export async function recordEvidencePortable(ctx: PortableMutationCtx, args: {
  societyId: string; stepKey: string; stage: string; documentId?: string; confirmationNumber?: string; notes?: string;
}) {
  await requireSocietyMembership(ctx, args.societyId);
  const society = await ctx.db.get(args.societyId, "societies");
  if (!society) throw new Error("Organization not found.");
  const steps = postIncorporationStepsForOrganization(society as any);
  if (!steps.some((step) => step.key === args.stepKey)) throw new Error("This checklist step is unavailable for the organization route.");
  if (!["preparing", "executed", "filed", "certified"].includes(args.stage)) throw new Error("Choose a supported evidence stage.");
  if (args.stage !== "preparing" && !args.documentId) throw new Error("Attach the executed document, filing receipt, or certified registry document for this evidence stage.");
  if (["filed", "certified"].includes(args.stage) && !args.confirmationNumber?.trim()) throw new Error("Record the official confirmation or certificate reference.");
  if (args.documentId) await getOwned(ctx, "documents", args.documentId, args.societyId);
  const evidence = (society.postIncorporationEvidence ?? []).filter((entry: any) => entry.stepKey !== args.stepKey);
  evidence.push({ stepKey: args.stepKey, stage: args.stage, documentId: args.documentId,
    confirmationNumber: args.confirmationNumber?.trim() || undefined, notes: args.notes?.trim() || undefined,
    recordedAtISO: new Date().toISOString(), recordedByUserId: await principalUserId(ctx, args.societyId) ?? undefined });
  await ctx.db.patch(args.societyId, { postIncorporationEvidence: evidence, updatedAt: Date.now() });
  return args.stepKey;
}

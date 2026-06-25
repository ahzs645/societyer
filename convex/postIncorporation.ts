import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { postIncorporationStepsForOrganization } from "../shared/postIncorporationSteps";

/**
 * Post-incorporation guided checklist (YCN "next steps after incorporating").
 * Returns the ordered steps for the society's jurisdiction/entity type (pure
 * logic in shared/postIncorporationSteps.ts), each enriched with whether its
 * linked document packet has already been generated, so the UI can show progress
 * and a one-click generate per step.
 */
export const checklist = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
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
        const match = /^societyer:corporation-packet-run:(.+)$/.exec(String(id));
        if (match) generatedPacketKeys.add(match[1]);
      }
    }

    return { steps, generatedPacketKeys: Array.from(generatedPacketKeys) };
  },
});

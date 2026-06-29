import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { checklistPortable } from "../shared/functions/postIncorporation";
import { toPortableQueryCtx } from "./lib/portable";

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
  handler: (ctx, args) => checklistPortable(toPortableQueryCtx(ctx), args),
});

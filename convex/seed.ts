import { mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { assertMaintenanceToken, serviceTokenValidator } from "./lib/serviceAuth";
import { runPortable, resetPortable } from "../shared/functions/seed";
import { toPortableMutationCtx } from "./lib/portable";

// Seed the demo society "Riverside Community Society".
// Idempotent-ish: if a society already exists, it wipes everything first.
export const run = mutation({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ societyId: v.id("societies") }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return runPortable(toPortableMutationCtx(ctx));
  },
});

export const reset = mutation({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    return resetPortable(toPortableMutationCtx(ctx));
  },
});

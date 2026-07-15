import { query } from "./_generated/server";
import { v } from "convex/values";
import { summaryPortable } from "../shared/functions/annualCycle";
import { toPortableQueryCtx } from "./lib/portable";

export const summary = query({
  args: {
    societyId: v.id("societies"),
    year: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => summaryPortable(await toPortableQueryCtx(ctx), args),
});

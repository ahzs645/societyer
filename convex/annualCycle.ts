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
  handler: (ctx, args) => summaryPortable(toPortableQueryCtx(ctx), args),
});

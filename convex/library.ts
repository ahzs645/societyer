import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { overviewPortable } from "../shared/functions/library";
import { toPortableQueryCtx } from "./lib/portable";

export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => overviewPortable(toPortableQueryCtx(ctx), args),
});

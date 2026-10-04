import { authorizedQuery } from "./lib/authorizedServer";
import { query } from "./lib/untypedServer";
import { v } from "convex/values";
import { overviewPortable } from "../shared/functions/library";
import { toPortableQueryCtx } from "./lib/portable";

export const overview = authorizedQuery("library:overview", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => overviewPortable(await toPortableQueryCtx(ctx), args),
});

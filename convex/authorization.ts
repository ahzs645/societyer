import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireFunctionAction } from "../shared/functions/actionPolicy";
import { toPortableQueryCtx } from "./lib/portable";

export const checkAction = internalQuery({
  args: { name: v.string(), kind: v.union(v.literal("query"), v.literal("mutation"), v.literal("action")), args: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireFunctionAction(await toPortableQueryCtx(ctx), args.name, args.kind, args.args);
    return null;
  },
});

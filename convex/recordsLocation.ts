import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import { recordsLocationGet, recordsLocationUpsert } from "../shared/functions/recordsLocation";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const get = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => recordsLocationGet(await toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    address: v.string(),
    noticePostedAtOffice: v.boolean(),
    postedAtISO: v.optional(v.string()),
    computerProvidedForInspection: v.boolean(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordsLocationUpsert(await toPortableMutationCtx(ctx), args),
});

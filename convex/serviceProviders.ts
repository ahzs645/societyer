import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  listPortable,
  functionsCatalogPortable,
  activeAsOfPortable,
  upsertPortable,
} from "../shared/functions/serviceProviders";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const functionsCatalog = query({
  args: {},
  returns: v.any(),
  handler: () => functionsCatalogPortable(),
});

export const activeAsOf = query({
  args: { societyId: v.id("societies"), asOf: v.string() },
  returns: v.any(),
  handler: (ctx, args) => activeAsOfPortable(toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("serviceProviders")),
    societyId: v.id("societies"),
    function: v.string(),
    firmName: v.string(),
    contactName: v.optional(v.string()),
    firmLocation: v.optional(v.string()),
    appointedOn: v.optional(v.string()),
    removedOn: v.optional(v.string()),
    notes: v.optional(v.string()),
    nowISO: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
});

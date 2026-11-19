import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import * as records from "../shared/functions/businessEvidence";

const scope = { societyId: v.id("societies"), register: v.string() };

export const list = authorizedQuery("businessEvidence:list", query)({
  args: scope, returns: v.any(),
  handler: async (ctx, args) => records.list(await toPortableQueryCtx(ctx), args),
});

export const choices = authorizedQuery("businessEvidence:choices", query)({
  args: scope, returns: v.any(),
  handler: async (ctx, args) => records.choices(await toPortableQueryCtx(ctx), args),
});

export const save = authorizedMutation("businessEvidence:save", mutation)({
  args: {
    ...scope, previousId: v.optional(v.string()), documentId: v.optional(v.id("documents")),
    sourcePage: v.optional(v.number()), values: v.record(v.string(), v.union(v.string(), v.number())),
  },
  returns: v.any(),
  handler: async (ctx, args) => records.save(await toPortableMutationCtx(ctx), args),
});

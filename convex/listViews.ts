/**
 * Named views of the in-memory lists (shared/functions/listViews.ts). The
 * action policy gives reads society:read and every change settings:write.
 */
import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import * as handlers from "../shared/functions/listViews";

export const list = authorizedQuery("listViews:list", query)({
  args: { societyId: v.id("societies"), tableId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => handlers.listPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("listViews:create", mutation)({
  args: { societyId: v.id("societies"), tableId: v.string(), name: v.string(), stateJson: v.string() },
  returns: v.id("listViews"),
  handler: async (ctx, args) => handlers.createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = authorizedMutation("listViews:update", mutation)({
  args: { societyId: v.id("societies"), id: v.id("listViews"), name: v.optional(v.string()), stateJson: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => handlers.updatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("listViews:remove", mutation)({
  args: { societyId: v.id("societies"), id: v.id("listViews") },
  returns: v.null(),
  handler: async (ctx, args) => handlers.removePortable(await toPortableMutationCtx(ctx), args),
});

/** One-time, idempotent move of the old saved invoice views into the invoice list's views. */
export const importInvoiceViews = authorizedMutation("listViews:importInvoiceViews", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.object({ imported: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => handlers.importInvoiceViewsPortable(await toPortableMutationCtx(ctx), args),
});

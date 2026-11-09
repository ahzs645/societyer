/** Personal account linking. Handlers check the signed-in identity themselves and never take a workspace id. */
import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import {
  beginPortable, cancelPortable, confirmPortable, overviewPortable, previewPortable, unlinkPortable,
} from "../shared/functions/accountLinks";

export const overview = authorizedQuery("accountLinks:overview", query)({
  args: {},
  returns: v.any(),
  handler: async (ctx) => overviewPortable(await toPortableQueryCtx(ctx)),
});

export const begin = authorizedMutation("accountLinks:begin", mutation)({
  args: {},
  returns: v.any(),
  handler: async (ctx) => beginPortable(await toPortableMutationCtx(ctx)),
});

export const preview = authorizedQuery("accountLinks:preview", query)({
  args: { code: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => previewPortable(await toPortableQueryCtx(ctx), args),
});

export const confirm = authorizedMutation("accountLinks:confirm", mutation)({
  args: { code: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => confirmPortable(await toPortableMutationCtx(ctx), args),
});

export const cancel = authorizedMutation("accountLinks:cancel", mutation)({
  args: { code: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => cancelPortable(await toPortableMutationCtx(ctx), args),
});

export const unlink = authorizedMutation("accountLinks:unlink", mutation)({
  args: { issuer: v.string(), subject: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => unlinkPortable(await toPortableMutationCtx(ctx), args),
});

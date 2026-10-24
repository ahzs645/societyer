import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { payrollTd1ReviewedFields } from "./tables/payrollTd1";
import * as handlers from "../shared/functions/payrollTd1";

export const workspace = authorizedQuery(
  "payrollTd1:workspace",
  query,
)({
  args: {
    societyId: v.id("societies"),
    employeeId: v.id("employees"),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    handlers.workspacePortable(await toPortableQueryCtx(ctx), args),
});
export const applyReviewed = authorizedMutation(
  "payrollTd1:applyReviewed",
  mutation,
)({
  args: {
    societyId: v.id("societies"),
    employeeId: v.id("employees"),
    effectiveFrom: v.string(),
    receivedOn: v.string(),
    forms: v.array(v.object(payrollTd1ReviewedFields)),
  },
  returns: v.object({
    declarationIds: v.array(v.id("payrollTd1Declarations")),
    effectiveFrom: v.string(),
    year: v.number(),
  }),
  handler: async (ctx, args) =>
    handlers.applyReviewedPortable(await toPortableMutationCtx(ctx), args),
});

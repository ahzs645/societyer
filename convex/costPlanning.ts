import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { costPeriodFieldsValidator, planningCostFieldsValidator, staffCostFieldsValidator } from "./tables/costPlanning";
import * as handlers from "../shared/functions/costPlanning";

const societyId = v.id("societies"), cursor = v.optional(v.union(v.string(), v.null()));
export const workspace = authorizedQuery("costPlanning:workspace", query)({ args: { societyId, periodId: v.optional(v.id("costPlanningPeriods")), cursor, archived: v.optional(v.boolean()) }, returns: v.any(), handler: async (ctx, args) => handlers.workspacePortable(await toPortableQueryCtx(ctx), args) });
export const sourcePage = authorizedQuery("costPlanning:sourcePage", query)({ args: { societyId, collection: v.union(v.literal("costs"), v.literal("staff"), v.literal("insurance"), v.literal("subscriptions"), v.literal("employees"), v.literal("budgets"), v.literal("actuals")), cursor, periodId: v.optional(v.id("costPlanningPeriods")), asOf: v.optional(v.string()) }, returns: v.any(), handler: async (ctx, args) => handlers.sourcePagePortable(await toPortableQueryCtx(ctx), args) });
export const savePeriod = authorizedMutation("costPlanning:savePeriod", mutation)({ args: { societyId, id: v.optional(v.id("costPlanningPeriods")), fields: costPeriodFieldsValidator }, returns: v.id("costPlanningPeriods"), handler: async (ctx, args) => handlers.savePeriodPortable(await toPortableMutationCtx(ctx), args) });
export const saveCost = authorizedMutation("costPlanning:saveCost", mutation)({ args: { societyId, id: v.optional(v.id("costPlanningItems")), fields: planningCostFieldsValidator }, returns: v.id("costPlanningItems"), handler: async (ctx, args) => handlers.saveCostPortable(await toPortableMutationCtx(ctx), args) });
export const saveStaff = authorizedMutation("costPlanning:saveStaff", mutation)({ args: { societyId, id: v.optional(v.id("staffCostPlans")), fields: staffCostFieldsValidator }, returns: v.id("staffCostPlans"), handler: async (ctx, args) => handlers.saveStaffPortable(await toPortableMutationCtx(ctx), args) });
export const setArchived = authorizedMutation("costPlanning:setArchived", mutation)({ args: { societyId, kind: v.union(v.literal("period"), v.literal("cost"), v.literal("staff")), id: v.string(), archived: v.boolean() }, returns: v.string(), handler: async (ctx, args) => handlers.setArchivedPortable(await toPortableMutationCtx(ctx), args) });
export const importSource = authorizedMutation("costPlanning:importSource", mutation)({ args: { societyId, kind: v.union(v.literal("insurance"), v.literal("subscription")), sourceId: v.string(), currency: v.optional(v.string()) }, returns: v.id("costPlanningItems"), handler: async (ctx, args) => handlers.importSourcePortable(await toPortableMutationCtx(ctx), args) });

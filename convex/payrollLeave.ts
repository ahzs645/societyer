import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { payrollVacationPeriodFields, payrollVacationRequestFields } from "./tables/payrollLeave";
import * as handlers from "../shared/functions/payrollLeave";

const societyId = v.id("societies"), employeeId = v.id("employees"), periodId = v.id("payrollVacationPeriods"), requestId = v.id("payrollVacationRequests");
export const workspace = authorizedQuery("payrollLeave:workspace", query)({ args: { societyId, employeeId, collection: v.union(v.literal("periods"), v.literal("requests")), periodId: v.optional(periodId), cursor: v.optional(v.union(v.string(), v.null())) }, returns: v.any(), handler: async (ctx, args) => handlers.workspacePortable(await toPortableQueryCtx(ctx), args) });
export const savePeriod = authorizedMutation("payrollLeave:savePeriod", mutation)({ args: { societyId, employeeId, id: v.optional(periodId), fields: v.object(payrollVacationPeriodFields) }, returns: periodId, handler: async (ctx, args) => handlers.savePeriodPortable(await toPortableMutationCtx(ctx), args) });
export const saveRequest = authorizedMutation("payrollLeave:saveRequest", mutation)({ args: { societyId, employeeId, periodId, id: v.optional(requestId), fields: v.object(payrollVacationRequestFields) }, returns: requestId, handler: async (ctx, args) => handlers.saveRequestPortable(await toPortableMutationCtx(ctx), args) });
export const transitionRequest = authorizedMutation("payrollLeave:transitionRequest", mutation)({ args: { societyId, id: requestId, status: v.union(v.literal("approved"), v.literal("taken"), v.literal("cancelled"), v.literal("rejected")), reason: v.optional(v.string()), expectedVersion: v.optional(v.number()) }, returns: requestId, handler: async (ctx, args) => handlers.transitionRequestPortable(await toPortableMutationCtx(ctx), args) });

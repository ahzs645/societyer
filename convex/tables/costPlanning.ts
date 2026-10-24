import { defineTable } from "convex/server";
import { v } from "convex/values";

const status = v.union(v.literal("committed"), v.literal("planned"), v.literal("paused"));
const cadence = v.union(v.literal("once"), v.literal("weekly"), v.literal("biweekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("semiannual"), v.literal("annual"));
const periodFields = {
  name: v.string(), startDate: v.string(), endDate: v.string(), currency: v.string(), allocationCents: v.number(), openingBalanceCents: v.number(), reserveCents: v.number(),
  basis: v.union(v.literal("cash"), v.literal("allocated")), includePlanned: v.boolean(), spendBudgetId: v.optional(v.id("spendBudgets")),
};
const costFields = {
  name: v.string(), category: v.string(), currency: v.string(), amountCents: v.number(), cadence, startDate: v.string(), anchorDate: v.string(), endDate: v.optional(v.string()), status,
  sourceKind: v.union(v.literal("manual"), v.literal("insurance"), v.literal("subscription")), sourceId: v.optional(v.string()), notes: v.optional(v.string()),
};
const staffFields = {
  name: v.string(), employeeId: v.optional(v.id("employees")), currency: v.string(), startDate: v.string(), endDate: v.optional(v.string()), status,
  compensation: v.union(v.literal("hourly"), v.literal("monthly"), v.literal("annual")), rateCents: v.number(), hoursPerWeek: v.optional(v.number()),
  payFrequency: v.union(v.literal("weekly"), v.literal("biweekly"), v.literal("semimonthly"), v.literal("monthly")), payAnchorDate: v.string(), vacationPercent: v.optional(v.number()), employerPercent: v.optional(v.number()), monthlyBenefitsCents: v.optional(v.number()), assumptionsConfirmed: v.boolean(), notes: v.optional(v.string()),
};
export const costPeriodFieldsValidator = v.object(periodFields);
export const planningCostFieldsValidator = v.object(costFields);
export const staffCostFieldsValidator = v.object(staffFields);
const attribution = { societyId: v.id("societies"), archiveState: v.union(v.literal("active"), v.literal("archived")), archivedAtISO: v.optional(v.string()), createdByUserId: v.string(), createdAtISO: v.string(), updatedByUserId: v.string(), updatedAtISO: v.string() };

export const costPlanningTables = {
  costPlanningPeriods: defineTable({ ...periodFields, ...attribution }).index("by_society", ["societyId"]).index("by_society_archive", ["societyId", "archiveState"]),
  costPlanningItems: defineTable({ ...costFields, ...attribution }).index("by_society", ["societyId"]).index("by_society_source", ["societyId", "sourceKind", "sourceId"]),
  staffCostPlans: defineTable({ ...staffFields, ...attribution }).index("by_society", ["societyId"]).index("by_society_employee", ["societyId", "employeeId"]),
};

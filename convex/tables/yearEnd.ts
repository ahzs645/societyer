import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Year-end reporting tables.
 *
 * `programStatements` stores the per-program "Program Actual Revenue and
 * Expenses and Budget" statement modelled on the BC Community Gaming Grants
 * supporting document. It is the one year-end report whose data exists nowhere
 * else in the app (itemized revenues by funding source AND expenses by
 * category, in two columns: prior-fiscal-year actuals vs current-fiscal-year
 * budget). The annual financial statement, restricted-fund statement, and
 * year-end readiness checklist are all DERIVED from existing finance/grant data
 * (see convex/yearEnd.ts) and therefore need no storage.
 *
 * Column totals and surplus/deficit are always computed, never stored, so the
 * statement can never drift from its line items.
 */
const programStatementLine = v.object({
  // Stable key from the BC category list (e.g. "communityGamingGrant",
  // "wagesBenefits") or a "custom:*" key for itemized "Other" rows.
  key: v.string(),
  label: v.string(),
  actualCents: v.number(),
  budgetCents: v.number(),
  notes: v.optional(v.string()),
});

const orgStatementLine = v.object({
  key: v.string(),
  label: v.string(),
  generalCents: v.number(),
  gamingCents: v.number(),
  notes: v.optional(v.string()),
});

export const yearEndTables = {
  programStatements: defineTable({
    societyId: v.id("societies"),
    grantId: v.optional(v.id("grants")),
    programName: v.string(),
    funderName: v.optional(v.string()),
    priorFiscalYearLabel: v.string(),
    currentFiscalYearLabel: v.string(),
    revenues: v.array(programStatementLine),
    expenses: v.array(programStatementLine),
    narrative: v.optional(v.string()),
    status: v.string(), // Draft | Final
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_grant", ["grantId"]),

  // Organisation-wide "Statement of Revenues & Expenses" (fund accounting:
  // General Fund / Gaming Fund / Total) modelled on the BC Community Gaming
  // Grants organization revenue & expense statement. Required for Program Grant
  // and Capital Project Grant applications. Total column and excess of revenues
  // over expenses are computed, never stored.
  orgRevenueStatements: defineTable({
    societyId: v.id("societies"),
    organizationName: v.string(),
    fiscalYearLabel: v.string(),
    periodLabel: v.optional(v.string()),
    revenues: v.array(orgStatementLine),
    expenses: v.array(orgStatementLine),
    narrative: v.optional(v.string()),
    status: v.string(), // Draft | Final
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.optional(v.string()),
  }).index("by_society", ["societyId"]),
};

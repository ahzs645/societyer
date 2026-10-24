import { defineTable } from "convex/server";
import { v } from "convex/values";
const choice = <T extends string>(...values: T[]) =>
  v.union(...values.map((value) => v.literal(value)));
export const roeWorkflowFacts = {
  trigger: choice(
    "seven_days",
    "reduced_earnings",
    "wage_loss",
    "request",
    "other",
  ),
  format: choice("electronic", "paper"),
  payPeriodCode: choice("W", "B", "S", "M", "O", "H", "E"),
  firstDayWorked: v.string(),
  lastDayPaid: v.string(),
  interruptionDate: v.optional(v.string()),
  awareDate: v.string(),
  periodStart: v.string(),
  periodEnd: v.string(),
  noWorkNoEarningsDays: v.number(),
  anticipatedGap: v.boolean(),
  normalWeeklyEarningsCents: v.optional(v.number()),
  reducedWeeklyEarningsCents: v.optional(v.number()),
  reductionWeekDate: v.optional(v.string()),
  reductionReason: v.optional(
    choice(
      "illness_injury_quarantine",
      "pregnancy",
      "parental",
      "family_care",
      "other",
    ),
  ),
  exception: choice(
    "ordinary",
    "casual",
    "annual_vacation",
    "self_funded",
    "nonstandard",
    "needs_review",
  ),
  requestFrom: choice("none", "employee", "service_canada"),
  inactiveCasual: v.boolean(),
  otherRequirementConfirmed: v.boolean(),
  reasonCode: v.string(),
  evidence: v.string(),
  requestedDueDate: v.optional(v.string()),
  reviewTargetDate: v.optional(v.string()),
  notes: v.optional(v.string()),
};
export const roeWorkflowChecklist = {
  insurability: v.boolean(),
  dates_reason: v.boolean(),
  history: v.boolean(),
  separation: v.boolean(),
  identifiers: v.boolean(),
  portal_access: v.boolean(),
  employee_access: v.boolean(),
};
export const roeFollowUpKey = choice(
  "acceptance",
  "employee_access",
  "missing_information",
  "retention",
);
export const roeFollowUpStatus = choice(
  "open",
  "blocked",
  "done",
  "not_applicable",
);
export const payrollRoeWorkflowTables = {
  payrollRoeWorkflowCases: defineTable({
    societyId: v.id("societies"),
    employeeId: v.id("employees"),
    employeeName: v.string(),
    registerId: v.optional(v.id("recordsOfEmployment")),
    amendmentOfCaseId: v.optional(v.id("payrollRoeWorkflowCases")),
    amendmentOriginalSerial: v.optional(v.string()),
    facts: v.object(roeWorkflowFacts),
    checklist: v.object(roeWorkflowChecklist),
    rulesVersion: v.string(),
    version: v.number(),
    history: v.array(
      v.object({
        atISO: v.string(),
        actorUserId: v.string(),
        action: v.string(),
        note: v.optional(v.string()),
        version: v.number(),
        sha256: v.optional(v.string()),
        byteLength: v.optional(v.number()),
        filename: v.optional(v.string()),
        caseFingerprint: v.optional(v.string()),
        schemaVersion: v.optional(v.string()),
      }),
    ),
    followUps: v.array(
      v.object({
        key: roeFollowUpKey,
        dueDate: v.string(),
        status: roeFollowUpStatus,
        note: v.optional(v.string()),
        updatedAtISO: v.string(),
        deadlineId: v.optional(v.id("deadlines")),
        completedAtISO: v.optional(v.string()),
      }),
    ),
    deadlineId: v.optional(v.id("deadlines")),
    generated: v.optional(
      v.object({
        atISO: v.string(),
        sha256: v.string(),
        byteLength: v.number(),
        filename: v.string(),
        caseFingerprint: v.string(),
        schemaVersion: v.string(),
      }),
    ),
    submission: v.optional(
      v.object({
        atISO: v.string(),
        channel: choice("roe_web", "provider", "paper"),
        reference: v.string(),
        note: v.string(),
      }),
    ),
    closedAtISO: v.optional(v.string()),
    closeNote: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_employee", ["societyId", "employeeId"])
    .index("by_society_register", ["societyId", "registerId"])
    .index("by_society_parent", ["societyId", "amendmentOfCaseId"]),
};

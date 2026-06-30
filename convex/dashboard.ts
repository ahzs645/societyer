import { query } from "./_generated/server";
import { v } from "convex/values";
import { navCountsPortable, summaryPortable } from "../shared/functions/dashboard";
import { toPortableQueryCtx } from "./lib/portable";

const validator = v as unknown as {
  id: (tableName: string) => unknown;
  string: () => unknown;
  number: () => unknown;
  boolean: () => unknown;
  null: () => unknown;
  literal: (value: string) => unknown;
  optional: (value: unknown) => unknown;
  array: (value: unknown) => unknown;
  object: (fields: Record<string, unknown>) => unknown;
  union: (...values: unknown[]) => unknown;
};

const complianceFlagValidator = validator.object({
  ruleId: validator.string(),
  level: validator.union(validator.literal("ok"), validator.literal("warn"), validator.literal("err")),
  text: validator.string(),
  citationId: validator.optional(validator.string()),
  citationIds: validator.optional(validator.array(validator.string())),
  evidenceRequired: validator.array(validator.string()),
  remediationActions: validator.array(validator.object({
    id: validator.string(),
    label: validator.string(),
    intent: validator.string(),
    to: validator.optional(validator.string()),
  })),
  remediationStatus: validator.optional(validator.string()),
  remediationTaskId: validator.optional(validator.id("tasks")),
  remediationUpdatedAtISO: validator.optional(validator.string()),
});

const dashboardSocietyValidator = validator.union(
  validator.null(),
  validator.object({
    _id: validator.id("societies"),
    name: validator.string(),
    incorporationNumber: validator.optional(validator.string()),
    fiscalYearEnd: validator.optional(validator.string()),
    isCharity: validator.boolean(),
    isMemberFunded: validator.boolean(),
    registeredOfficeAddress: validator.optional(validator.string()),
    boardCadence: validator.optional(validator.string()),
  }),
);

const dashboardFilingValidator = validator.object({
  _id: validator.id("filings"),
  kind: validator.string(),
  periodLabel: validator.optional(validator.string()),
  dueDate: validator.string(),
  status: validator.string(),
});

const evidenceChainValidator = validator.object({
  id: validator.string(),
  title: validator.string(),
  status: validator.union(validator.literal("verified"), validator.literal("incomplete")),
  summary: validator.string(),
  actionHref: validator.optional(validator.string()),
  nodes: validator.array(validator.object({
    label: validator.string(),
    value: validator.string(),
    status: validator.union(validator.literal("verified"), validator.literal("missing"), validator.literal("info")),
    href: validator.optional(validator.string()),
  })),
});

const dashboardMeetingValidator = validator.object({
  _id: validator.id("meetings"),
  type: validator.string(),
  title: validator.string(),
  scheduledAt: validator.string(),
  location: validator.optional(validator.string()),
  status: validator.string(),
});

const dashboardDirectorValidator = validator.object({
  _id: validator.id("directors"),
  name: validator.string(),
  position: validator.string(),
  termStart: validator.string(),
  termEnd: validator.optional(validator.string()),
  isBCResident: validator.boolean(),
});

const dashboardTaskValidator = validator.object({
  _id: validator.id("tasks"),
  title: validator.string(),
  status: validator.string(),
  priority: validator.string(),
  assignee: validator.optional(validator.string()),
  dueDate: validator.optional(validator.string()),
});

const dashboardGoalValidator = validator.object({
  _id: validator.id("goals"),
  title: validator.string(),
  status: validator.string(),
  progressPercent: validator.number(),
  targetDate: validator.string(),
});

const dashboardSummaryValidator = validator.object({
  society: dashboardSocietyValidator,
  counts: validator.object({
    members: validator.number(),
    directors: validator.number(),
    bcResidents: validator.number(),
    meetingsThisYear: validator.number(),
    overdueFilings: validator.number(),
    openDeadlines: validator.number(),
    openConflicts: validator.number(),
    committees: validator.number(),
    openGoals: validator.number(),
    openTasks: validator.number(),
  }),
  board: validator.array(dashboardDirectorValidator),
  upcomingMeetings: validator.array(dashboardMeetingValidator),
  upcomingFilings: validator.array(dashboardFilingValidator),
  overdueFilings: validator.array(dashboardFilingValidator),
  goals: validator.array(dashboardGoalValidator),
  openTasks: validator.array(dashboardTaskValidator),
  complianceFlags: validator.array(complianceFlagValidator),
  evidenceChains: validator.array(evidenceChainValidator),
});

export const navCounts = query({
  args: { societyId: v.id("societies") },
  returns: v.object({
    members: v.number(),
    directors: v.number(),
    meetingsThisYear: v.number(),
    overdueFilings: v.number(),
    openDeadlines: v.number(),
    openConflicts: v.number(),
    committees: v.number(),
    openGoals: v.number(),
    openTasks: v.number(),
  }),
  handler: (ctx, args) => navCountsPortable(toPortableQueryCtx(ctx), args),
});

export const summary = (query as any)({
  args: { societyId: validator.id("societies") },
  returns: dashboardSummaryValidator,
  handler: (ctx: any, args: any) => summaryPortable(toPortableQueryCtx(ctx), args),
});

import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  clearPeriodMarkPortable,
  createExpectationPortable,
  dashboardChecksPortable,
  deriveFromBylawRulesPortable,
  evidenceDocumentsPortable,
  gapsPortable,
  listExpectationsPortable,
  markPeriodPortable,
  removeExpectationPortable,
  seedRulePackPortable,
  updateExpectationPortable,
} from "../shared/functions/continuity";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { cadenceRuleValidator } from "./validators/gaps";

const expectationFields = {
  title: v.string(),
  kind: v.string(),
  bodyKind: v.string(),
  committeeId: v.optional(v.id("committees")),
  meetingType: v.optional(v.string()),
  rule: cadenceRuleValidator,
  effectiveFrom: v.optional(v.string()),
  effectiveTo: v.optional(v.string()),
  severity: v.optional(v.string()),
  origin: v.optional(v.string()),
  ruleKey: v.optional(v.string()),
  citation: v.optional(v.string()),
  sourceIds: v.optional(v.array(v.string())),
  authorityDocumentId: v.optional(v.id("documents")),
  authorityLocator: v.optional(v.string()),
  status: v.optional(v.string()),
  confidence: v.optional(v.number()),
  notes: v.optional(v.string()),
};

export const gaps = authorizedQuery("continuity:gaps", query)({
  args: { societyId: v.id("societies"), from: v.optional(v.string()), to: v.optional(v.string()), includeCrossReferences: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => gapsPortable(await toPortableQueryCtx(ctx), args),
});

export const dashboardChecks = authorizedQuery("continuity:dashboardChecks", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => dashboardChecksPortable(await toPortableQueryCtx(ctx), args),
});

export const listExpectations = authorizedQuery("continuity:listExpectations", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listExpectationsPortable(await toPortableQueryCtx(ctx), args),
});

export const evidenceDocuments = authorizedQuery("continuity:evidenceDocuments", query)({
  args: { societyId: v.id("societies"), search: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => evidenceDocumentsPortable(await toPortableQueryCtx(ctx), args),
});

export const createExpectation = authorizedMutation("continuity:createExpectation", mutation)({
  args: { societyId: v.id("societies"), ...expectationFields },
  returns: v.any(),
  handler: async (ctx, args) => createExpectationPortable(await toPortableMutationCtx(ctx), args),
});

export const updateExpectation = authorizedMutation("continuity:updateExpectation", mutation)({
  args: {
    id: v.id("governanceExpectations"),
    patch: v.object({
      title: v.optional(v.string()),
      kind: v.optional(v.string()),
      bodyKind: v.optional(v.string()),
      committeeId: v.optional(v.id("committees")),
      meetingType: v.optional(v.string()),
      rule: v.optional(cadenceRuleValidator),
      effectiveFrom: v.optional(v.string()),
      effectiveTo: v.optional(v.string()),
      severity: v.optional(v.string()),
      citation: v.optional(v.string()),
      authorityDocumentId: v.optional(v.id("documents")),
      authorityLocator: v.optional(v.string()),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateExpectationPortable(await toPortableMutationCtx(ctx), args),
});

export const removeExpectation = authorizedMutation("continuity:removeExpectation", mutation)({
  args: { id: v.id("governanceExpectations") },
  returns: v.any(),
  handler: async (ctx, args) => removeExpectationPortable(await toPortableMutationCtx(ctx), args),
});

export const seedRulePack = authorizedMutation("continuity:seedRulePack", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedRulePackPortable(await toPortableMutationCtx(ctx), args),
});

export const deriveFromBylawRules = authorizedMutation("continuity:deriveFromBylawRules", mutation)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => deriveFromBylawRulesPortable(await toPortableMutationCtx(ctx), args),
});

export const markPeriod = authorizedMutation("continuity:markPeriod", mutation)({
  args: {
    societyId: v.id("societies"),
    expectationKey: v.string(),
    periodKey: v.string(),
    status: v.string(),
    reason: v.optional(v.string()),
    evidenceDocumentIds: v.optional(v.array(v.id("documents"))),
    meetingId: v.optional(v.id("meetings")),
  },
  returns: v.any(),
  handler: async (ctx, args) => markPeriodPortable(await toPortableMutationCtx(ctx), args),
});

export const clearPeriodMark = authorizedMutation("continuity:clearPeriodMark", mutation)({
  args: { id: v.id("continuityPeriodMarks") },
  returns: v.any(),
  handler: async (ctx, args) => clearPeriodMarkPortable(await toPortableMutationCtx(ctx), args),
});

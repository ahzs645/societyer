import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  getActiveBylawRuleSet,
  getBylawRuleSetForDate,
  getNextBylawRuleVersion,
  getDefaultBylawRules,
} from "./lib/bylawRules";

export const getActive = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const active = await getActiveBylawRuleSet(ctx, societyId);
    return {
      ...active,
      isFallback: !active._id,
    };
  },
});

export const getForDate = query({
  args: { societyId: v.id("societies"), dateISO: v.string() },
  returns: v.any(),
  handler: async (ctx, { societyId, dateISO }) => {
    const rules = await getBylawRuleSetForDate(ctx, societyId, dateISO);
    return {
      ...rules,
      isFallback: !rules._id,
    };
  },
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("bylawRuleSets")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.sort((a, b) => {
      const byEffective = timestamp(b.effectiveFromISO ?? b.updatedAtISO) - timestamp(a.effectiveFromISO ?? a.updatedAtISO);
      if (byEffective !== 0) return byEffective;
      return b.version - a.version;
    });
  },
});

export const upsertActive = mutation({
  args: {
    id: v.optional(v.id("bylawRuleSets")),
    societyId: v.id("societies"),
    effectiveFromISO: v.optional(v.string()),
    sourceBylawDocumentId: v.optional(v.id("documents")),
    sourceAmendmentId: v.optional(v.id("bylawAmendments")),
    generalNoticeMinDays: v.number(),
    generalNoticeMaxDays: v.number(),
    allowElectronicMeetings: v.boolean(),
    allowHybridMeetings: v.boolean(),
    allowElectronicVoting: v.boolean(),
    allowProxyVoting: v.boolean(),
    proxyHolderMustBeMember: v.boolean(),
    proxyLimitPerGrantorPerMeeting: v.number(),
    quorumType: v.string(),
    quorumValue: v.number(),
    memberProposalThresholdPct: v.number(),
    memberProposalMinSignatures: v.number(),
    memberProposalLeadDays: v.number(),
    requisitionMeetingThresholdPct: v.number(),
    annualReportDueDaysAfterMeeting: v.number(),
    requireAgmFinancialStatements: v.boolean(),
    requireAgmElections: v.boolean(),
    ballotIsAnonymous: v.boolean(),
    voterMustBeMemberAtRecordDate: v.boolean(),
    inspectionMemberRegisterByMembers: v.boolean(),
    inspectionMemberRegisterByPublic: v.boolean(),
    inspectionDirectorRegisterByMembers: v.boolean(),
    inspectionCopiesAllowed: v.boolean(),
    ordinaryResolutionThresholdPct: v.number(),
    specialResolutionThresholdPct: v.number(),
    unanimousWrittenSpecialResolution: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const {
      id: _previousId,
      effectiveFromISO,
      ...ruleValues
    } = args;
    const payload = {
      ...ruleValues,
      status: "Active",
      effectiveFromISO: effectiveFromISO || now,
      updatedAtISO: now,
    };

    const rows = await ctx.db
      .query("bylawRuleSets")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    for (const row of rows) {
      if (row.status === "Active") {
        await ctx.db.patch(row._id, { status: "Archived" });
      }
    }

    return await ctx.db.insert("bylawRuleSets", {
      ...payload,
      version: await getNextBylawRuleVersion(ctx, args.societyId),
    });
  },
});

export const resetToDefault = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const now = new Date().toISOString();
    const defaults = {
      ...getDefaultBylawRules(societyId),
      effectiveFromISO: now,
      updatedAtISO: now,
      version: await getNextBylawRuleVersion(ctx, societyId),
    };
    const rows = await ctx.db
      .query("bylawRuleSets")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    for (const row of rows) {
      if (row.status === "Active") {
        await ctx.db.patch(row._id, { status: "Archived" });
      }
    }
    return await ctx.db.insert("bylawRuleSets", defaults);
  },
});

function timestamp(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  getActiveBylawRuleSet,
  getNextBylawRuleVersion,
  getDefaultBylawRules,
} from "./lib/bylawRules";

export const getActive = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const active = await getActiveBylawRuleSet(ctx, societyId);
    return {
      ...active,
      isFallback: !active._id,
    };
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
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const payload = {
      ...args,
      status: "Active",
      updatedAtISO: now,
    };

    if (args.id) {
      await ctx.db.patch(args.id, payload);
      return args.id;
    }

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
  handler: async (ctx, { societyId }) => {
    const defaults = {
      ...getDefaultBylawRules(societyId),
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

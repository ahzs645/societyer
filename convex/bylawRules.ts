import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  getActivePortable,
  getForDatePortable,
  listPortable,
  upsertActivePortable,
  resetToDefaultPortable,
} from "../shared/functions/bylawRules";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const getActive = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => getActivePortable(await toPortableQueryCtx(ctx), args),
});

export const getForDate = query({
  args: { societyId: v.id("societies"), dateISO: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => getForDatePortable(await toPortableQueryCtx(ctx), args),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
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
    quorumMinimumCount: v.optional(v.number()),
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
    // Custom resolution types only — built-ins (Ordinary/Special/Unanimous) are
    // derived from the threshold percentages above (src/lib/motionGovernance.ts).
    resolutionTypes: v.optional(
      v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          builtIn: v.optional(v.boolean()),
          base: v.string(),
          thresholdPct: v.number(),
          tieBreak: v.optional(v.string()),
          order: v.optional(v.number()),
        }),
      ),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertActivePortable(await toPortableMutationCtx(ctx), args),
});

export const resetToDefault = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => resetToDefaultPortable(await toPortableMutationCtx(ctx), args),
});

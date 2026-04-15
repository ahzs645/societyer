import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";

export type BylawRuleSetLike = Omit<
  Doc<"bylawRuleSets">,
  "_id" | "_creationTime"
>;

export const DEFAULT_BYLAW_RULES: BylawRuleSetLike = {
  societyId: "placeholder" as Id<"societies">,
  version: 1,
  status: "Active",
  effectiveFromISO: undefined,
  sourceBylawDocumentId: undefined,
  sourceAmendmentId: undefined,
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  allowHybridMeetings: true,
  allowElectronicVoting: false,
  allowProxyVoting: false,
  proxyHolderMustBeMember: false,
  proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "fixed",
  quorumValue: 10,
  memberProposalThresholdPct: 5,
  memberProposalMinSignatures: 1,
  memberProposalLeadDays: 7,
  requisitionMeetingThresholdPct: 10,
  annualReportDueDaysAfterMeeting: 30,
  requireAgmFinancialStatements: true,
  requireAgmElections: true,
  ballotIsAnonymous: true,
  voterMustBeMemberAtRecordDate: true,
  inspectionMemberRegisterByMembers: true,
  inspectionMemberRegisterByPublic: false,
  inspectionDirectorRegisterByMembers: true,
  inspectionCopiesAllowed: true,
  ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67,
  unanimousWrittenSpecialResolution: true,
  updatedAtISO: new Date(0).toISOString(),
};

export function getDefaultBylawRules(
  societyId: Id<"societies">,
): BylawRuleSetLike {
  return {
    ...DEFAULT_BYLAW_RULES,
    societyId,
    updatedAtISO: new Date().toISOString(),
  };
}

export async function getActiveBylawRuleSet(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
) {
  const active = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society_status", (q) =>
      q.eq("societyId", societyId).eq("status", "Active"),
    )
    .collect();
  return (
    active.sort((a, b) => b.version - a.version)[0] ??
    ({ ...getDefaultBylawRules(societyId), _id: undefined } as const)
  );
}

export async function getNextBylawRuleVersion(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
) {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return Math.max(0, ...rows.map((row) => row.version)) + 1;
}

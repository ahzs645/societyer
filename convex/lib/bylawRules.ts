import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";

export type BylawRuleSetLike = Omit<
  Doc<"bylawRuleSets">,
  "_id" | "_creationTime"
>;

export type ResolvedBylawRuleSet = BylawRuleSetLike &
  Partial<Pick<Doc<"bylawRuleSets">, "_id" | "_creationTime">> & {
    isFallback?: boolean;
  };

export type QuorumSnapshot = {
  bylawRuleSetId?: Id<"bylawRuleSets">;
  quorumRuleVersion?: number;
  quorumRuleEffectiveFromISO?: string;
  quorumSourceLabel: string;
  quorumRequired?: number;
  quorumComputedAtISO: string;
};

export const DEFAULT_BYLAW_RULES: BylawRuleSetLike = {
  societyId: "placeholder" as Id<"societies">,
  version: 1,
  status: "Active",
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  allowHybridMeetings: true,
  allowElectronicVoting: false,
  allowProxyVoting: false,
  proxyHolderMustBeMember: false,
  proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "percentage",
  quorumValue: 10,
  quorumMinimumCount: 3,
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
  return getBylawRuleSetForDate(ctx, societyId, new Date().toISOString());
}

export async function getBylawRuleSetForDate(
  ctx: QueryCtx | MutationCtx,
  societyId: Id<"societies">,
  dateISO: string,
): Promise<ResolvedBylawRuleSet> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const targetTs = timestampOrInfinity(dateISO);
  const eligible = rows
    .filter((row) => row.status !== "Draft")
    .filter((row) => effectiveTimestamp(row) <= targetTs);
  const selected = eligible.sort(compareRuleSetsDesc)[0];
  if (selected) return selected;
  return {
    ...getDefaultBylawRules(societyId),
    isFallback: true,
  };
}

export async function buildQuorumSnapshot(
  ctx: QueryCtx | MutationCtx,
  args: {
    societyId: Id<"societies">;
    meetingDateISO: string;
    meetingType?: string;
    quorumRequiredOverride?: number;
  },
): Promise<QuorumSnapshot> {
  const now = new Date().toISOString();
  const rules = await getBylawRuleSetForDate(
    ctx,
    args.societyId,
    args.meetingDateISO,
  );
  const ruleRequired = await computeRequiredQuorum(ctx, rules, args);
  const quorumRequired =
    args.quorumRequiredOverride ?? ruleRequired;
  const label = quorumSourceLabel(
    rules,
    quorumRequired != null &&
      ruleRequired != null &&
      quorumRequired !== ruleRequired,
  );

  return {
    bylawRuleSetId: rules._id,
    quorumRuleVersion: rules.version,
    quorumRuleEffectiveFromISO: rules.effectiveFromISO,
    quorumSourceLabel: label,
    quorumRequired,
    quorumComputedAtISO: now,
  };
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

async function computeRequiredQuorum(
  ctx: QueryCtx | MutationCtx,
  rules: ResolvedBylawRuleSet,
  args: {
    societyId: Id<"societies">;
    meetingType?: string;
  },
) {
  if (rules.quorumType === "fixed") {
    return rules.quorumValue;
  }
  if (rules.quorumType === "percentage" && isGeneralMeeting(args.meetingType)) {
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const eligible = members.filter(
      (member) => member.status === "Active" && member.votingRights,
    ).length;
    const percentageQuorum = Math.ceil(eligible * (rules.quorumValue / 100));
    return Math.max(rules.quorumMinimumCount ?? 1, percentageQuorum);
  }
  return undefined;
}

function quorumSourceLabel(
  rules: ResolvedBylawRuleSet,
  hasManualOverride: boolean,
) {
  const prefix = hasManualOverride ? "Manual quorum override; " : "";
  if (rules.isFallback || !rules._id) {
    return `${prefix}BC Model Bylaw baseline assumptions`;
  }
  const effective = rules.effectiveFromISO
    ? `, effective ${rules.effectiveFromISO.slice(0, 10)}`
    : "";
  return `${prefix}Bylaw rules v${rules.version}${effective}`;
}

function compareRuleSetsDesc(
  a: Doc<"bylawRuleSets">,
  b: Doc<"bylawRuleSets">,
) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
}

function effectiveTimestamp(row: Doc<"bylawRuleSets">) {
  return timestampOrNegativeInfinity(row.effectiveFromISO);
}

function timestampOrInfinity(value: string) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function timestampOrNegativeInfinity(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

function isGeneralMeeting(type?: string) {
  return type === "AGM" || type === "SGM";
}

/**
 * PORTABLE FUNCTIONS: the bylaw-rules domain
 * (getActive / getForDate / list / upsertActive / resetToDefault).
 *
 * Reads/writes the `bylawRuleSets` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 *
 * The rule-resolution helpers (`getActiveBylawRuleSet`, `getBylawRuleSetForDate`,
 * `getNextBylawRuleVersion`, `getDefaultBylawRules`) are portable copies of
 * `convex/lib/bylawRules.ts`: that module imports `_generated`, so its pure
 * `ctx.db`-only logic is inlined here on the portable contract rather than
 * reaching into the Convex-typed lib module.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export const DEFAULT_BYLAW_RULES = {
  societyId: "placeholder",
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

function getDefaultBylawRules(societyId: string) {
  return {
    ...DEFAULT_BYLAW_RULES,
    societyId,
    updatedAtISO: new Date().toISOString(),
  };
}

async function getBylawRuleSetForDate(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
  dateISO: string,
): Promise<Record<string, any>> {
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

export async function getActiveBylawRuleSet(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
) {
  return getBylawRuleSetForDate(ctx, societyId, new Date().toISOString());
}

async function getNextBylawRuleVersion(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
) {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return Math.max(0, ...rows.map((row) => row.version)) + 1;
}

function compareRuleSetsDesc(a: any, b: any) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
}

function effectiveTimestamp(row: any) {
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

export async function getActivePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const active = await getActiveBylawRuleSet(ctx, societyId);
  return {
    ...active,
    isFallback: !active._id,
  };
}

export async function getForDatePortable(ctx: PortableQueryCtx, { societyId, dateISO }: { societyId: string; dateISO: string }) {
  const rules = await getBylawRuleSetForDate(ctx, societyId, dateISO);
  return {
    ...rules,
    isFallback: !rules._id,
  };
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.sort((a, b) => {
    const byEffective = timestamp(b.effectiveFromISO ?? b.updatedAtISO) - timestamp(a.effectiveFromISO ?? a.updatedAtISO);
    if (byEffective !== 0) return byEffective;
    return b.version - a.version;
  });
}

export async function upsertActivePortable(ctx: PortableMutationCtx, args: Record<string, any>) {
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
}

export async function resetToDefaultPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
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
}

function timestamp(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

/**
 * PORTABLE FUNCTIONS: the member-proposals domain (list / create / update / remove).
 *
 * Reads/writes the `memberProposals` table over `ctx.db`. `create`/`update`
 * evaluate the signature threshold against the active bylaw rule set. The
 * rule-resolution helper is a portable copy of `convex/lib/bylawRules.ts`'s
 * `getActiveBylawRuleSet`: it only reads `bylawRuleSets` via the `by_society`
 * index, so it lives here on the portable contract rather than reaching into the
 * Convex-typed lib module. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

interface ResolvedBylawRules {
  status?: string;
  version: number;
  effectiveFromISO?: string;
  memberProposalThresholdPct: number;
  memberProposalMinSignatures: number;
  memberProposalLeadDays: number;
  isFallback?: boolean;
  _id?: string;
}

const DEFAULT_BYLAW_RULES = {
  version: 1,
  status: "Active",
  memberProposalThresholdPct: 5,
  memberProposalMinSignatures: 1,
  memberProposalLeadDays: 7,
};

function timestampOrInfinity(value: string) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function timestampOrNegativeInfinity(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

function effectiveTimestamp(row: any) {
  return timestampOrNegativeInfinity(row.effectiveFromISO);
}

function compareRuleSetsDesc(a: any, b: any) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
}

async function getActiveBylawRuleSet(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
): Promise<ResolvedBylawRules> {
  const dateISO = new Date().toISOString();
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const targetTs = timestampOrInfinity(dateISO);
  const eligible = rows
    .filter((row) => row.status !== "Draft")
    .filter((row) => effectiveTimestamp(row) <= targetTs);
  const selected = eligible.sort(compareRuleSetsDesc)[0];
  if (selected) return selected as ResolvedBylawRules;
  return {
    ...DEFAULT_BYLAW_RULES,
    societyId,
    updatedAtISO: new Date().toISOString(),
    isFallback: true,
  } as ResolvedBylawRules;
}

export interface MemberProposalCreateArgs {
  societyId: string;
  meetingId?: string;
  title: string;
  text: string;
  submittedByName: string;
  submittedAtISO: string;
  signatureCount: number;
  thresholdPercent?: number;
  eligibleVotersAtSubmission?: number;
  notes?: string;
}

export interface MemberProposalPatch {
  title?: string;
  text?: string;
  signatureCount?: number;
  eligibleVotersAtSubmission?: number;
  meetingId?: string;
  includedInAgenda?: boolean;
  status?: string;
  receivedAtISO?: string;
  notes?: string;
}

export async function memberProposalsList(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("memberProposals")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function memberProposalCreate(ctx: PortableMutationCtx, args: MemberProposalCreateArgs): Promise<string> {
  const rules = await getActiveBylawRuleSet(ctx, args.societyId);
  const thresholdPercent =
    args.thresholdPercent ?? rules.memberProposalThresholdPct;
  const signatureThresholdCount =
    args.eligibleVotersAtSubmission && args.eligibleVotersAtSubmission > 0
      ? Math.ceil(args.eligibleVotersAtSubmission * (thresholdPercent / 100))
      : 0;
  const requiredSignatureCount = Math.max(
    rules.memberProposalMinSignatures,
    signatureThresholdCount,
  );
  // Evaluate threshold on insert
  const meets = args.signatureCount >= requiredSignatureCount;

  let status = meets ? "MeetsThreshold" : "Submitted";
  if (args.meetingId) {
    const meeting = await ctx.db.get(args.meetingId);
    if (meeting?.noticeSentAt) {
      const leadMs = rules.memberProposalLeadDays * 86_400_000;
      const receivedTs = new Date(args.submittedAtISO).getTime();
      const noticeTs = new Date(meeting.noticeSentAt).getTime();
      if (receivedTs > noticeTs - leadMs) {
        status = "Rejected";
      }
    }
  }
  return ctx.db.insert("memberProposals", {
    ...args,
    thresholdPercent,
    includedInAgenda: false,
    status,
  });
}

export async function memberProposalUpdate(
  ctx: PortableMutationCtx,
  { id, patch }: { id: string; patch: MemberProposalPatch },
): Promise<void> {
  const before = await ctx.db.get(id);
  await ctx.db.patch(id, patch);

  // Re-evaluate the signature threshold when the count or electorate changes,
  // but only while the proposal is in an auto-managed state — never override a
  // manual status set in this patch, nor a terminal status like Rejected.
  const autoManaged = before?.status === "Submitted" || before?.status === "MeetsThreshold";
  if (before && patch.status === undefined && autoManaged) {
    const merged: Record<string, any> = { ...before, ...patch };
    const rules = await getActiveBylawRuleSet(ctx, String(before.societyId));
    const thresholdPercent = merged.thresholdPercent ?? rules.memberProposalThresholdPct;
    const eligibleVoters = merged.eligibleVotersAtSubmission ?? 0;
    const signatureThresholdCount =
      eligibleVoters > 0 ? Math.ceil(eligibleVoters * (thresholdPercent / 100)) : 0;
    const required = Math.max(rules.memberProposalMinSignatures, signatureThresholdCount);
    const recomputed = (merged.signatureCount ?? 0) >= required ? "MeetsThreshold" : "Submitted";
    if (recomputed !== before.status) {
      await ctx.db.patch(id, { status: recomputed });
    }
  }
}

export async function memberProposalRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  await ctx.db.delete(id);
}

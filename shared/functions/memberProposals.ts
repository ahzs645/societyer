/**
 * PORTABLE FUNCTIONS: the member-proposals domain (list / create / update / remove).
 *
 * Reads/writes the `memberProposals` table over `ctx.db`. `create`/`update`
 * evaluate the signature threshold against the bylaw rule set in force today,
 * selected by `shared/bylawRuleSelection.ts`. Each handler runs unchanged on hosted Convex, the
 * local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { bylawRuleSelectionDay, selectBylawRuleSetForDay } from "../bylawRuleSelection";
import { organizationTimeZone } from "../organizationDomain";

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

/** The rule set in force on `at`'s local day (default today); see `shared/bylawRuleSelection.ts`. */
async function getActiveBylawRuleSet(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
  at: string = new Date().toISOString(),
): Promise<ResolvedBylawRules> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const timeZone = organizationTimeZone(await ctx.db.get(societyId));
  const selected = selectBylawRuleSetForDay(rows, bylawRuleSelectionDay(at, timeZone), timeZone);
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
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("memberProposals")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function memberProposalCreate(ctx: PortableMutationCtx, args: MemberProposalCreateArgs): Promise<string> {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.meetingId) await getOwned(ctx, "meetings", args.meetingId, args.societyId);
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
    const meeting = await getOwned(ctx, "meetings", args.meetingId, args.societyId);
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
  const before = await requireOwnedRow(ctx, "memberProposals", id);
  const societyId = String(before.societyId);
  if (patch.meetingId) await getOwned(ctx, "meetings", patch.meetingId, societyId);
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
  await requireOwnedRow(ctx, "memberProposals", id);
  await ctx.db.delete(id);
}

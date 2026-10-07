import type { PortableMutationCtx, PortableQueryCtx } from "./portable/ctx";
import { computeQuorumFromRule, countForBasis, defaultCountBasis, resolveMeetingQuorumRule, type QuorumCounts } from "./bodyQuorum";

/**
 * ctx.db adapter for the per-body quorum kernel (shared/bodyQuorum.ts), used by
 * the meetings and minutes quorum snapshots. Loads only the population the
 * governing rule counts.
 */
export async function requiredQuorumForMeeting(
  ctx: PortableQueryCtx | PortableMutationCtx,
  rules: Record<string, any>,
  args: { societyId: string; meetingType?: string; committeeId?: string },
): Promise<{ required?: number; label?: string }> {
  const committee = args.committeeId ? await ctx.db.get(args.committeeId).catch(() => null) : null;
  const usableCommittee = committee && String(committee.societyId) === String(args.societyId) ? committee : null;
  const resolved = resolveMeetingQuorumRule(rules, { type: args.meetingType, committeeId: args.committeeId }, usableCommittee);
  if (!resolved) return {};
  // The legacy society rule keeps its statutory-baseline guard; an explicit
  // body or committee rule is the organization's own instrument.
  if (resolved.source === "society" && (rules.quorumRequiresLegalRegister || rules.governanceAutomationBlocked)) return {};
  const basis = resolved.rule.countBasis || defaultCountBasis(resolved.body);
  const counts: QuorumCounts = {};
  if (resolved.rule.quorumType !== "fixed") {
    if (basis === "voting_members") {
      const members = await ctx.db.query("members").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
      counts.votingMembers = members.filter((member: any) => member.status === "Active" && member.votingRights).length;
    } else if (basis === "directors_in_office") {
      const directors = await ctx.db.query("directors").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
      counts.directorsInOffice = directors.filter((director: any) => director.status === "Active").length;
    } else if (basis === "committee_members" && args.committeeId) {
      const members = await ctx.db.query("committeeMembers").withIndex("by_committee", (q) => q.eq("committeeId", args.committeeId)).collect();
      counts.committeeMembers = members.filter((member: any) => !member.leftAt).length;
    }
    // For an explicit body/committee rule an empty register is an unknown
    // population, not a quorum of one. The legacy society rule keeps its
    // historical minimum-count behaviour.
    const population = countForBasis(basis, counts);
    if (!population && resolved.source !== "society") return { label: resolved.label };
  }
  return { required: computeQuorumFromRule(resolved.rule, resolved.body, counts), label: resolved.label };
}

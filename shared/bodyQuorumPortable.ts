import type { PortableMutationCtx, PortableQueryCtx } from "./portable/ctx";
import { computeQuorumFromRule, countForBasis, defaultCountBasis, meetingBodyKind, resolveMeetingQuorumRule, type QuorumCounts } from "./bodyQuorum";
import { buildShareholderElectorate } from "./shareholderElectorate";
import { describeArticlesShareholderQuorum } from "./operativeArticles";
import { todayDateOnly } from "./dateOnly";

/**
 * ctx.db adapter for the per-body quorum kernel (shared/bodyQuorum.ts), used by
 * the meetings and minutes quorum snapshots. Loads only the population the
 * governing rule counts.
 */
export async function requiredQuorumForMeeting(
  ctx: PortableQueryCtx | PortableMutationCtx,
  rules: Record<string, any>,
  args: { societyId: string; meetingType?: string; committeeId?: string },
): Promise<{ required?: number; label?: string; articlesLabel?: string }> {
  // A BC company's recorded articles set the shareholder quorum (Table 1 Art.
  // 8.2: persons AND a voting-share fraction). The persons minimum comes from
  // the securities register, but a headcount cannot establish the share
  // fraction, so no `required` count is returned and minutes never confirm it
  // from attendee names alone.
  if (rules.articlesShareholderQuorum && meetingBodyKind(args.meetingType, args.committeeId) === "general") {
    return { articlesLabel: await articlesShareholderQuorumLabel(ctx, args.societyId) };
  }
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

/** Describe the articles' shareholder quorum against the current securities register. */
export async function articlesShareholderQuorumLabel(ctx: PortableQueryCtx | PortableMutationCtx, societyId: string): Promise<string | undefined> {
  const organization = await ctx.db.get(societyId);
  const [classes, holdings, roleHolders] = await Promise.all(["rightsClasses", "rightsHoldings", "roleHolders"].map((table) =>
    ctx.db.query(table).withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect()));
  const today = todayDateOnly();
  const electorate = buildShareholderElectorate({ classes, holdings, roleHolders, recordDateISO: today, holdingsAsOfISO: today });
  const votingShares = electorate.votingHolders.reduce((sum, holder) => sum + holder.classVotes.filter((row) => row.votesPerShare > 0).reduce((total, row) => total + row.quantity, 0), 0);
  const counts = electorate.complete && electorate.votingHolders.length
    ? { eligibleShareholders: electorate.votingHolders.length, eligibleVotingShares: votingShares }
    : undefined;
  return describeArticlesShareholderQuorum(organization, counts);
}

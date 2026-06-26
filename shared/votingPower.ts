/**
 * VOTING-POWER ROLL-UP + ELIGIBILITY (pure logic).
 *
 * Ports the YCN Transaction-sheet voting math: for each shareholder, total
 * votes = Σ(shares held in a class × that class's votes-per-share), summed
 * per holder, then partitioned into voting vs non-voting shareholders. Adds the
 * YCN People-sheet eligibility gate — a holder counts as an eligible voting
 * *signatory* only if they are a natural person at the age of majority
 * (minors and corporate holders are excluded from that set even though they
 * still hold and vote). Framework-free.
 */

import { looksLikeOrganization } from "./nlg";

export interface VotingClassInput {
  rightsClassId: string;
  /** Numeric votes per share. When absent, inferred from votingRights text. */
  votesPerShare?: number | null;
  votingRights?: string | null;
  classType?: string | null;
}

export interface VotingHoldingInput {
  holderKey: string;
  holderName?: string;
  rightsClassId: string;
  quantity: number;
}

export interface VotingHolderMeta {
  isIndividual?: boolean;
  atAgeOfMajority?: boolean;
}

export interface VotingHolderResult {
  holderKey: string;
  holderName: string;
  totalShares: number;
  totalVotes: number;
  /** Holder's share of total outstanding shares, 0–100 (0 when none issued). */
  percentOfShares: number;
  /** Holder's share of total votes, 0–100 (0 when no class carries votes). */
  percentOfVotes: number;
  isVoting: boolean;
  /** Eligible to be enumerated / sign as a voting shareholder. */
  isEligibleSignatory: boolean;
}

export interface VotingPowerResult {
  holders: VotingHolderResult[];
  voting: VotingHolderResult[];
  nonVoting: VotingHolderResult[];
  eligibleSigners: VotingHolderResult[];
  totalVotes: number;
}

/**
 * Resolve a class's votes-per-share: the explicit numeric multiplier when set,
 * otherwise inferred from the free-text votingRights / classType ("non-voting"
 * → 0, anything mentioning voting → 1, else 0).
 */
export function votesPerShareOf(cls: VotingClassInput): number {
  if (typeof cls.votesPerShare === "number" && Number.isFinite(cls.votesPerShare) && cls.votesPerShare >= 0) {
    return cls.votesPerShare;
  }
  const text = `${cls.votingRights ?? ""} ${cls.classType ?? ""}`.toLowerCase();
  if (!text.trim()) return 0;
  if (/non[\s_-]?voting|no\s+vote/.test(text)) return 0;
  if (/voting|vote/.test(text)) return 1;
  return 0;
}

export function computeVotingPower(
  holdings: readonly VotingHoldingInput[],
  classes: readonly VotingClassInput[],
  meta?: Record<string, VotingHolderMeta>,
): VotingPowerResult {
  const votesByClass = new Map<string, number>();
  for (const cls of classes) votesByClass.set(cls.rightsClassId, votesPerShareOf(cls));

  // Aggregate shares and votes per holder.
  const byHolder = new Map<string, { name: string; shares: number; votes: number }>();
  for (const h of holdings) {
    const quantity = Number(h.quantity) || 0;
    if (quantity === 0) continue;
    const perShare = votesByClass.get(h.rightsClassId) ?? 0;
    const entry = byHolder.get(h.holderKey) ?? { name: h.holderName ?? h.holderKey, shares: 0, votes: 0 };
    if (h.holderName && (entry.name === h.holderKey || !entry.name)) entry.name = h.holderName;
    entry.shares += quantity;
    entry.votes += quantity * perShare;
    byHolder.set(h.holderKey, entry);
  }

  // Denominators for ownership %: total shares issued and total votes across
  // every holder. Computed up front so each holder row can carry its own share.
  let totalSharesAll = 0;
  let totalVotesAll = 0;
  for (const entry of byHolder.values()) {
    totalSharesAll += entry.shares;
    totalVotesAll += entry.votes;
  }

  const holders: VotingHolderResult[] = [];
  for (const [holderKey, entry] of byHolder) {
    const m = meta?.[holderKey] ?? {};
    const individual = m.isIndividual ?? !looksLikeOrganization(entry.name);
    const major = m.atAgeOfMajority ?? true;
    const isVoting = entry.votes > 0;
    holders.push({
      holderKey,
      holderName: entry.name,
      totalShares: entry.shares,
      totalVotes: entry.votes,
      percentOfShares: totalSharesAll > 0 ? (entry.shares / totalSharesAll) * 100 : 0,
      percentOfVotes: totalVotesAll > 0 ? (entry.votes / totalVotesAll) * 100 : 0,
      isVoting,
      isEligibleSignatory: isVoting && individual && major,
    });
  }

  // Stable order: most votes first, then name.
  holders.sort((a, b) => b.totalVotes - a.totalVotes || a.holderName.localeCompare(b.holderName));

  return {
    holders,
    voting: holders.filter((h) => h.isVoting),
    nonVoting: holders.filter((h) => !h.isVoting),
    eligibleSigners: holders.filter((h) => h.isEligibleSignatory),
    totalVotes: holders.reduce((sum, h) => sum + h.totalVotes, 0),
  };
}

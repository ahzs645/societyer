import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { organizationRuleScope } from "../../shared/entityRuleScope";

export type EligibleVoters = {
  /** Undefined while loading. */
  count: number | undefined;
  /** Which register the count comes from. */
  source: "member_register" | "share_register";
  /** Short description of what was counted, for hints and subtitles. */
  label: string;
};

/**
 * Who can vote at a general meeting, counted from the register that applies.
 *
 * - Societies (and generic organizations) count Active members with voting
 *   rights on the member register.
 * - Corporations count shareholders holding voting shares on the share
 *   register (`legalOperations:votingPower`, the same roll-up the Share register
 *   page shows). The member table only holds contact records for a corporation,
 *   so it is never used as the shareholder count.
 */
export function useEligibleVoters(society: any): EligibleVoters {
  const corporation = organizationRuleScope(society).isCorporation;
  const members = useQuery(api.members.list, society && !corporation ? { societyId: society._id } : "skip") as any[] | undefined;
  const voting = useQuery(api.legalOperations.votingPower, society && corporation ? { societyId: society._id } : "skip") as
    | { voting: any[] }
    | undefined;
  if (corporation) {
    const count = voting ? voting.voting.length : undefined;
    return {
      count,
      source: "share_register",
      label: count === 0
        ? "No shareholders hold voting shares on the share register yet"
        : `Shareholders holding voting shares on the share register: ${count ?? "…"}`,
    };
  }
  const count = members ? members.filter((member) => member.status === "Active" && member.votingRights).length : undefined;
  return {
    count,
    source: "member_register",
    label: `Eligible voting members: ${count ?? "…"}`,
  };
}

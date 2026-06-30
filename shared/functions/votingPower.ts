/**
 * PORTABLE FUNCTION: legalOperations:votingPower.
 *
 * The first handler ported to the portable `ctx.db` contract (the audit's
 * Phase-0 slice). It existed in TWO hand-written copies — the Convex handler
 * (convex/legalOperations.ts) and the static mirror (src/lib/staticConvex.ts) —
 * both marshalling the same inputs into the shared `computeVotingPower` kernel.
 *
 * This file is now the single source of truth for that logic:
 *   - `summarizeVotingPower` is the pure marshaller (no ctx) — the part that was
 *     literally copy-pasted between the two runtimes.
 *   - `votingPowerPortable` is the portable handler: loads rows via the contract
 *     and calls the marshaller. Convex runs it on the real `ctx.db`; the local
 *     runtimes run the exact same function on the Dexie-backed adapter.
 *
 * Dependency-free (only `shared/*` pure modules + the portable ctx types), so it
 * runs in Node, the browser, and Convex alike.
 */

import { computeVotingPower, type VotingPowerResult } from "../votingPower";
import { materializeRightsHoldings } from "../equityLedger";
import type { PortableQueryCtx } from "../portable/ctx";

export interface VotingPowerArgs {
  societyId: string;
  asOf?: string;
}

/** Keep transfers on/before an as-of date (date-only compare, inclusive). */
export function transfersAsOf<T extends Record<string, any>>(transfers: T[], asOf?: string): T[] {
  if (!asOf) return transfers;
  return transfers.filter((t) => String(t.transferDate ?? t.createdAtISO ?? "").slice(0, 10) <= asOf);
}

export interface VotingPowerSummaryInput {
  classes: Record<string, any>[];
  holdings: Record<string, any>[];
  roleHolders: Record<string, any>[];
  directory: Record<string, any>[];
}

/**
 * Pure marshaller: turn the four cap-table row sets into the voting-power
 * roll-up. This is the formerly-duplicated body — keep it free of any ctx so
 * both the Convex handler and the static mirror can call it identically.
 */
export function summarizeVotingPower(input: VotingPowerSummaryInput): VotingPowerResult {
  const { classes, holdings, roleHolders, directory } = input;
  const roleById = new Map<string, any>(roleHolders.map((r) => [String(r._id), r]));
  const dirById = new Map<string, any>(directory.map((d) => [String(d._id), d]));
  const meta: Record<string, { isIndividual?: boolean; atAgeOfMajority?: boolean }> = {};

  const holdingInputs = holdings
    .filter((h) => String(h.status) === "current" && Number(h.quantity) > 0)
    .map((h) => {
      const role = h.holderRoleHolderId ? roleById.get(String(h.holderRoleHolderId)) : undefined;
      const dir = role?.directoryPersonId ? dirById.get(String(role.directoryPersonId)) : undefined;
      if (dir && (dir.isIndividual !== undefined || dir.atAgeOfMajority !== undefined)) {
        meta[String(h.holderKey)] = { isIndividual: dir.isIndividual, atAgeOfMajority: dir.atAgeOfMajority };
      }
      return {
        holderKey: String(h.holderKey),
        holderName: String(role?.fullName ?? h.holderKey),
        rightsClassId: String(h.rightsClassId),
        quantity: Number(h.quantity) || 0,
      };
    });

  const classInputs = classes.map((c) => ({
    rightsClassId: String(c._id),
    votesPerShare: c.votesPerShare,
    votingRights: c.votingRights,
    classType: c.classType,
  }));

  return computeVotingPower(holdingInputs, classInputs, meta);
}

/**
 * The portable handler. Runs unchanged on hosted Convex and on the local
 * (Dexie) runtime — the only difference is which `ctx.db` is injected.
 */
export async function votingPowerPortable(
  ctx: PortableQueryCtx,
  { societyId, asOf }: VotingPowerArgs,
): Promise<VotingPowerResult> {
  const [classes, storedHoldings, roleHolders, directory, transfers] = await Promise.all([
    ctx.db.query("rightsClasses").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("rightsHoldings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("roleHolders").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("peopleDirectory").collect(),
    asOf
      ? ctx.db.query("rightsholdingTransfers").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect()
      : Promise.resolve([] as Record<string, any>[]),
  ]);

  const holdings = asOf
    ? materializeRightsHoldings(transfersAsOf(transfers, asOf) as any)
    : storedHoldings;

  return summarizeVotingPower({ classes, holdings, roleHolders, directory });
}

/**
 * An immutable, share-weighted electorate input for meetings and written
 * resolutions. This module has no access-control side effects: callers must
 * authorize their workspace, reconstruct the ledger at the reviewed record
 * date, and separately verify the human representative who may act for a
 * holder. Ownership never follows from an email address, login or name match.
 *
 * Legal basis: BC BCA ss. 171, 173; CBCA ss. 134, 138, 140;
 * Ontario OBCA ss. 95, 100, 102. See docs/legal-research/meetings-records.md.
 */

type Row = Record<string, any>;

export type ShareholderClassVotes = {
  rightsClassId: string;
  quantity: number;
  votesPerShare: number;
  votes: number;
};

export type ShareholderElector = {
  holderKey: string;
  roleHolderId: string;
  fullName: string;
  email?: string;
  totalShares: number;
  totalVotes: number;
  classVotes: ShareholderClassVotes[];
};

export type ShareholderElectorate = {
  recordDateISO: string;
  holders: ShareholderElector[];
  votingHolders: ShareholderElector[];
  totalVotes: number;
  issues: string[];
  complete: boolean;
};

function nonempty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Reject impossible dates, including dates that Date.parse silently rolls. */
export function validElectorateDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}

/**
 * Numeric rights are authoritative. Only unambiguous legacy text can supply a
 * missing multiplier; ambiguous class labels must not silently become 0 or 1.
 */
export function explicitVotesPerShare(row: Row): number | undefined {
  if (row.votesPerShare !== undefined && row.votesPerShare !== null) {
    return typeof row.votesPerShare === "number" && Number.isFinite(row.votesPerShare) && row.votesPerShare >= 0
      ? row.votesPerShare : undefined;
  }
  const rights = String(row.votingRights ?? "").trim().toLowerCase();
  const type = String(row.classType ?? "").trim().toLowerCase();
  if (/^(non[ _-]?voting|no votes?|none|0(?: votes?(?: per share)?)?)\.?$/.test(rights)) return 0;
  if (/^(voting|one vote(?: per share)?|1 vote(?: per share)?)\.?$/.test(rights)) return 1;
  const numeric = rights.match(/^(\d+(?:\.\d+)?)\s+votes?\s+per\s+share\.?$/);
  if (numeric) return Number(numeric[1]);
  if (!rights && /^non[ _-]?voting$/.test(type)) return 0;
  if (!rights && type === "voting") return 1;
  return undefined;
}

export function buildShareholderElectorate(input: {
  classes: Row[];
  holdings: Row[];
  roleHolders: Row[];
  recordDateISO: string;
  /** Date/time at which the caller reconstructed or verified these positions. */
  holdingsAsOfISO: string;
  /** A reviewed class vote uses only these classes; omit for an ordinary poll. */
  classIds?: string[];
}): ShareholderElectorate {
  const issues = new Set<string>();
  if (!validElectorateDate(input.recordDateISO)) issues.add("A valid reviewed record date is required.");
  if (!validElectorateDate(input.holdingsAsOfISO) || input.holdingsAsOfISO !== input.recordDateISO) {
    issues.add("The share positions must be reconstructed or verified at the reviewed record date.");
  }
  const byClass = new Map(input.classes.map((row) => [String(row._id), row]));
  const byRole = new Map(input.roleHolders.map((row) => [String(row._id), row]));
  const allowed = input.classIds ? new Set(input.classIds) : null;
  if (allowed && allowed.size === 0) issues.add("Select at least one class for a class vote.");
  for (const id of allowed ?? []) if (!byClass.has(id)) issues.add(`Share class ${id} is missing from the register.`);
  const holders = new Map<string, ShareholderElector>();
  for (const holding of input.holdings) {
    if (String(holding.status ?? "current") !== "current") continue;
    const classId = String(holding.rightsClassId ?? "");
    if (allowed && !allowed.has(classId)) continue;
    const quantity = Number(holding.quantity);
    if (quantity === 0) continue;
    if (!Number.isFinite(quantity) || quantity < 0) {
      issues.add(`Share class ${classId || "(missing)"} contains an invalid holding quantity.`);
      continue;
    }
    const cls = byClass.get(classId);
    if (!cls) { issues.add(`Share class ${classId || "(missing)"} is missing from the register.`); continue; }
    if (["proposed", "needs_review"].includes(String(cls.status))) issues.add(`Confirm the issued rights of share class ${cls.className ?? classId}.`);
    const votesPerShare = explicitVotesPerShare(cls);
    if (votesPerShare === undefined) {
      issues.add(`Record the votes per share for ${cls.className ?? classId}; its voting rights are not unambiguous.`);
      continue;
    }
    const providedKey = String(holding.holderKey ?? "");
    const roleHolderId = nonempty(holding.holderRoleHolderId)
      ?? (providedKey.startsWith("roleHolder:") ? providedKey.slice("roleHolder:".length) : undefined);
    const role = roleHolderId ? byRole.get(roleHolderId) : undefined;
    if (!roleHolderId || !role || !nonempty(role.fullName)) {
      issues.add(`Link shareholder ${providedKey || "(unnamed holder)"} to an identified role-holder record.`);
      continue;
    }
    if (providedKey.startsWith("roleHolder:") && providedKey !== `roleHolder:${roleHolderId}`) {
      issues.add(`Shareholder identity ${providedKey} conflicts with its linked role-holder record.`);
      continue;
    }
    // A single registered holder may own several classes. Deduplicate by the
    // explicit role-holder identity, never by their display name or email.
    const holderKey = `roleHolder:${roleHolderId}`;
    const elector = holders.get(holderKey) ?? {
      holderKey, roleHolderId, fullName: String(role.fullName).trim(),
      ...(nonempty(role.email) ? { email: nonempty(role.email) } : {}),
      totalShares: 0, totalVotes: 0, classVotes: [],
    };
    const votes = quantity * votesPerShare;
    if (!Number.isFinite(votes)) { issues.add(`Voting weight for ${elector.fullName} is outside the supported numeric range.`); continue; }
    elector.totalShares += quantity;
    elector.totalVotes += votes;
    const existingClass = elector.classVotes.find((row) => row.rightsClassId === classId);
    if (existingClass) { existingClass.quantity += quantity; existingClass.votes += votes; }
    else elector.classVotes.push({ rightsClassId: classId, quantity, votesPerShare, votes });
    holders.set(holderKey, elector);
  }
  const allHolders = [...holders.values()].sort((a, b) => a.fullName.localeCompare(b.fullName) || a.holderKey.localeCompare(b.holderKey));
  for (const holder of allHolders) holder.classVotes.sort((a, b) => a.rightsClassId.localeCompare(b.rightsClassId));
  const votingHolders = allHolders.filter((row) => row.totalVotes > 0);
  if (!allHolders.length) issues.add("The reviewed share register contains no identified shareholders.");
  const totalVotes = votingHolders.reduce((sum, row) => sum + row.totalVotes, 0);
  if (!Number.isFinite(totalVotes)) issues.add("The total voting weight is outside the supported numeric range.");
  return { recordDateISO: input.recordDateISO, holders: allHolders, votingHolders, totalVotes, issues: [...issues], complete: issues.size === 0 };
}

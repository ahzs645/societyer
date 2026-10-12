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

import type { RecordDateLimit } from "./legalGovernanceTypes";
import { legalGovernanceProfile, type GovernanceOrganization } from "./legalGovernanceProfiles";
import { earliestPermittedNoticeDate, shiftCalendarMonths } from "./legalMeetingNotice";

type Row = Record<string, any>;

export type ShareholderClassVotes = {
  rightsClassId: string;
  quantity: number;
  /** Votes per share counted in this vote (1 in a separate class vote). */
  votesPerShare: number;
  votes: number;
  /** Set when the class votes separately: one vote per share, whatever the class's general voting rights. */
  basis?: ShareholderVoteBasis;
};

/**
 * `general`: each class's votes per share from the articles (an ordinary poll).
 * `class_separate_resolution`: a separate vote of the selected classes, where
 * every share of those classes carries one vote, including shares that do not
 * otherwise vote (for a BC company, BCA s. 61 and s. 173(9)).
 */
export type ShareholderVoteBasis = "general" | "class_separate_resolution";

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
  /** How votes per share were counted. */
  voteBasis: ShareholderVoteBasis;
  issues: string[];
  complete: boolean;
};

/** Votes per share counted in a separate class vote: every share of a selected class carries one vote. */
export const CLASS_SEPARATE_RESOLUTION_VOTES_PER_SHARE = 1;

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
  /**
   * A reviewed separate class vote uses only these classes, and every share of
   * them carries one vote (basis `class_separate_resolution`), even where the
   * class does not otherwise vote. Omit for an ordinary poll.
   */
  classIds?: string[];
}): ShareholderElectorate {
  const voteBasis: ShareholderVoteBasis = input.classIds ? "class_separate_resolution" : "general";
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
    // In a separate class vote the class's general voting rights do not
    // matter: non-voting shares vote on their own class's rights.
    const votesPerShare = voteBasis === "class_separate_resolution" ? CLASS_SEPARATE_RESOLUTION_VOTES_PER_SHARE : explicitVotesPerShare(cls);
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
    else elector.classVotes.push({ rightsClassId: classId, quantity, votesPerShare, votes, ...(voteBasis === "class_separate_resolution" ? { basis: voteBasis } : {}) });
    holders.set(holderKey, elector);
  }
  const allHolders = [...holders.values()].sort((a, b) => a.fullName.localeCompare(b.fullName) || a.holderKey.localeCompare(b.holderKey));
  for (const holder of allHolders) holder.classVotes.sort((a, b) => a.rightsClassId.localeCompare(b.rightsClassId));
  const votingHolders = allHolders.filter((row) => row.totalVotes > 0);
  if (!allHolders.length) issues.add("The reviewed share register contains no identified shareholders.");
  const totalVotes = votingHolders.reduce((sum, row) => sum + row.totalVotes, 0);
  if (!Number.isFinite(totalVotes)) issues.add("The total voting weight is outside the supported numeric range.");
  return { recordDateISO: input.recordDateISO, holders: allHolders, votingHolders, totalVotes, voteBasis, issues: [...issues], complete: issues.size === 0 };
}

/**
 * Explanation shown with a separate class vote. BC citations only for a BC
 * company; other corporations get the rule without a BC citation and a
 * prompt to confirm it under their own Act.
 */
export function classSeparateResolutionNote(options: { isBcCompany: boolean; classCount: number }): string {
  const rule = options.isBcCompany
    ? "Separate class vote: every share of the selected classes counts as one vote, including shares that do not otherwise vote. A change that prejudices or interferes with a class's rights needs that class's consent by special separate resolution (Business Corporations Act s. 61), and shares given a vote by the Act carry at least one vote per share (s. 173(9)). Every share of a class carries the same rights (s. 59(4)), so within one class one vote per share gives the same result as the class's own per-share votes. A special separate resolution needs notice to every holder of the class and the majority the articles set (between 2/3 and 3/4 of the votes cast), otherwise 2/3 (3/4 for a pre-existing company under the Pre-existing Company Provisions), or the written consent of every holder of the class (s. 1, \"special separate resolution\")."
    : "Separate class vote: every share of the selected classes counts as one vote, including shares that do not otherwise vote. Confirm the class-vote rule, majority and any articles provision on votes per share under the governing Act before relying on the result.";
  const multiple = options.classCount > 1
    ? " Each class consents separately: tally each class's votes on its own, using the per-class totals, rather than relying on the combined total."
    : "";
  return rule + multiple;
}

export type RecordDatePurpose = "meeting" | "writtenResolution";

/** Applied when no verified profile states a limit. The record date then also needs review. */
export const CONSERVATIVE_RECORD_DATE_LIMIT: RecordDateLimit = {
  maxAgeDays: 60, basis: "conservative", researchAnchor: "meetings-records.md#mtg-5", sourceIds: [],
  note: "No verified record-date limit applies to this organization. A 60-day bound applies pending legal review.",
};

export function recordDateLimitFor(organization: GovernanceOrganization | null | undefined, purpose: RecordDatePurpose): RecordDateLimit {
  return legalGovernanceProfile(organization)?.recordDates?.[purpose] ?? CONSERVATIVE_RECORD_DATE_LIMIT;
}

/**
 * How the reviewed record date was set. `fixed`: fixed in advance by the
 * directors, so any statutory minimum interval applies. `statutory_default`:
 * the Act's default record date when none was fixed (OBCA s. 95(3)).
 */
export type RecordDateSource = "fixed" | "statutory_default";

/** The latest permitted fixed record date, or null when the limit has no minimum. */
export function latestFixedRecordDate(referenceDateISO: string, limit: RecordDateLimit): string | null {
  if (limit.minAgeDays === undefined) return null;
  return earliestPermittedNoticeDate(referenceDateISO, limit.minAgeDays);
}

/** The earliest permitted record date, counted back from the event's calendar date. */
export function earliestRecordDate(referenceDateISO: string, limit: RecordDateLimit): string | null {
  if (limit.maxAgeMonths !== undefined) return shiftCalendarMonths(referenceDateISO, -limit.maxAgeMonths);
  return earliestPermittedNoticeDate(referenceDateISO, limit.maxAgeDays ?? 60);
}

function describeLimit(limit: RecordDateLimit) {
  return limit.maxAgeMonths !== undefined ? `${limit.maxAgeMonths} calendar months` : `${limit.maxAgeDays ?? 60} days`;
}

/**
 * Bounds for a reviewed record date. An older date would make former holders
 * or members the electorate; where the research states a minimum interval
 * (OBCA s. 95(2)), a fixed record date closer to the event is also refused.
 * `issue` blocks; `reviewNote` flags a conservative bound that the research
 * does not establish for this entity, or a statutory default to verify.
 */
export function recordDateWindow(recordDateISO: string, referenceDateISO: string, limit: RecordDateLimit, eventLabel: string, source: RecordDateSource = "fixed") {
  const earliestISO = earliestRecordDate(referenceDateISO, limit);
  const latestISO = latestFixedRecordDate(referenceDateISO, limit);
  const section = limit.section ? ` (${limit.section})` : "";
  const issue = !earliestISO
    ? `The ${eventLabel} date is not a valid calendar date, so the record-date window cannot be checked.`
    : recordDateISO < earliestISO
      ? `The record date ${recordDateISO} is more than ${describeLimit(limit)} before the ${eventLabel} on ${referenceDateISO}${section}. Choose a record date on or after ${earliestISO}; an older register can include former holders.`
      : latestISO && source === "fixed" && recordDateISO > latestISO
        ? `A record date fixed by the directors must be at least ${limit.minAgeDays} days before the ${eventLabel} on ${referenceDateISO}${section}; ${recordDateISO} is later than ${latestISO}. Choose a record date on or before ${latestISO}, or record that the statutory default record date applies.`
        : undefined;
  const notes = [
    limit.basis === "conservative" ? `Record-date window: ${describeLimit(limit)} before the ${eventLabel} is a conservative bound, not a verified statutory limit. ${limit.note}` : undefined,
    limit.minAgeDays !== undefined && source === "statutory_default" ? `Statutory default record date${section}: verify it is the close of business on the day before notice was given, or the ${eventLabel} day where no notice is given. The ${limit.minAgeDays}-day minimum applies only to a record date fixed by the directors.` : undefined,
  ].filter(Boolean);
  const reviewNote = notes.length ? notes.join(" ") : undefined;
  return { earliestISO: earliestISO ?? undefined, latestISO: latestISO ?? undefined, issue, reviewNote, limit };
}

/**
 * PORTABLE FUNCTIONS: the committees domain
 * (list / get / detail / create / update / remove / addMember / removeMember).
 *
 * Reads/writes the `committees` table (plus `committeeMembers`, `meetings`,
 * `tasks`, `goals`, `activity`) over `ctx.db`. Each handler runs unchanged on
 * hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";
import { describeCadenceRule, normalizeCadenceRule } from "../continuityRules";

export async function committeesListPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [committees, members] = await Promise.all([
    ctx.db
      .query("committees")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("committeeMembers")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);
  const memberCounts = new Map<string, number>();
  for (const member of members) {
    const committeeId = String(member.committeeId);
    memberCounts.set(committeeId, (memberCounts.get(committeeId) ?? 0) + 1);
  }
  return committees.map((committee) => ({
    ...committee,
    memberCount: memberCounts.get(String(committee._id)) ?? 0,
  }));
}

export async function committeeGetPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return requireOwnedRow(ctx, "committees", id);
}

export async function committeeDetailPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const committee = await requireOwnedRow(ctx, "committees", id);
  const [members, meetings, tasks, goals] = await Promise.all([
    ctx.db
      .query("committeeMembers")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
    ctx.db
      .query("meetings")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
    ctx.db
      .query("tasks")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
    ctx.db
      .query("goals")
      .withIndex("by_committee", (q) => q.eq("committeeId", id))
      .collect(),
  ]);
  return { committee, members, meetings, tasks, goals };
}

/** A3: a committee's own quorum rule. See shared/bodyQuorum.ts. */
export type CommitteeQuorumRule = {
  quorumType: string;
  quorumValue?: number;
  quorumMinimumCount?: number;
  countBasis?: string;
  notes?: string;
};

function assertQuorumRule(rule?: CommitteeQuorumRule) {
  if (!rule) return;
  if (!["fixed", "percentage", "all_members", "majority"].includes(rule.quorumType)) throw new Error("Committee quorum type must be fixed, percentage, all_members or majority.");
  if ((rule.quorumType === "fixed" || rule.quorumType === "percentage") && !(typeof rule.quorumValue === "number" && rule.quorumValue > 0)) throw new Error("Committee quorum needs a positive value.");
  if (rule.quorumType === "percentage" && (rule.quorumValue ?? 0) > 100) throw new Error("A percentage quorum cannot exceed 100.");
  if (rule.quorumMinimumCount != null && rule.quorumMinimumCount < 0) throw new Error("Quorum minimum cannot be negative.");
}

export async function committeeCreatePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    name: string;
    description?: string;
    mission?: string;
    cadence: string;
    cadenceNotes?: string;
    chairDirectorId?: string;
    quorumRule?: CommitteeQuorumRule;
    bodyKey?: string;
    color: string;
    kind?: string;
    parentBody?: string;
  },
) {
  assertQuorumRule(args.quorumRule);
  await requireSocietyMembership(ctx, args.societyId);
  if (args.chairDirectorId) await getOwned(ctx, "directors", args.chairDirectorId, args.societyId);
  if (args.kind && !(COMMITTEE_KINDS as readonly string[]).includes(args.kind)) throw new Error(`Unsupported committee kind: ${args.kind}.`);
  if (args.parentBody && !(COMMITTEE_PARENT_BODIES as readonly string[]).includes(args.parentBody)) throw new Error(`Unsupported parent body: ${args.parentBody}.`);
  const id = await ctx.db.insert("committees", {
    ...args,
    status: "Active",
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: "You",
    entityType: "committee",
    subjectId: id,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: id,
    action: "created",
    summary: `Created committee "${args.name}"`,
    createdAtISO: new Date().toISOString(),
  });
  return id;
}

export async function committeeUpdatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      name?: string;
      description?: string;
      mission?: string;
      cadence?: string;
      cadenceNotes?: string;
      nextMeetingAt?: string;
      chairDirectorId?: string;
      color?: string;
      status?: string;
      quorumRule?: CommitteeQuorumRule;
      clearQuorumRule?: boolean;
      bodyKey?: string;
    };
  },
) {
  const authorizedRow = await requireOwnedRow(ctx, "committees", id);
  const societyId = String(authorizedRow.societyId);
  if (patch.chairDirectorId) await getOwned(ctx, "directors", patch.chairDirectorId, societyId);
  assertQuorumRule(patch.quorumRule);
  const { clearQuorumRule, ...rest } = patch;
  await ctx.db.patch(id, clearQuorumRule ? { ...rest, quorumRule: undefined } : rest);
}

export async function committeeRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "committees", id);
  const members = await ctx.db
    .query("committeeMembers")
    .withIndex("by_committee", (q) => q.eq("committeeId", id))
    .collect();
  for (const m of members) await ctx.db.delete(m._id);
  await ctx.db.delete(id);
}

export async function committeeAddMemberPortable(
  ctx: PortableMutationCtx,
  args: {
    committeeId: string;
    societyId: string;
    name: string;
    email?: string;
    role: string;
    directorId?: string;
    memberId?: string;
    /** A1: people-directory link for members who are not directors/members. */
    personId?: string;
    representedOrganization?: string;
    joinedAt?: string;
    leftAt?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "committees", args.committeeId, args.societyId);
  if (args.directorId) await getOwned(ctx, "directors", args.directorId, args.societyId);
  if (args.memberId) await getOwned(ctx, "members", args.memberId, args.societyId);
  if (args.personId) await getOwned(ctx, "peopleDirectory", args.personId, args.societyId);
  if (args.joinedAt && args.leftAt && args.leftAt < args.joinedAt) throw new Error("A committee member cannot leave before joining.");
  return ctx.db.insert("committeeMembers", {
    ...args,
    joinedAt: args.joinedAt || new Date().toISOString().slice(0, 10),
  });
}

export async function committeeRemoveMemberPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "committeeMembers", id);
  await ctx.db.delete(id);
}

/* --------------- A4: committee kind, parent body, cadence, mandate --------------- */

export const COMMITTEE_KINDS = ["standing", "ad_hoc", "working_group", "executive", "advisory"] as const;
export const COMMITTEE_PARENT_BODIES = ["board", "members", "committee"] as const;

type CommitteeCadenceRule = { frequency: string; count?: number; months?: number[]; anchor?: string; offsetDays?: number; minimumCount?: number; seriesKey?: string; notes?: string };
type CommitteeMandateVersion = {
  id: string;
  effectiveFrom: string;
  effectiveTo?: string;
  title?: string;
  mandate?: string;
  documentId?: string;
  cadenceRule?: CommitteeCadenceRule;
  quorumText?: string;
  notes?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Update a committee's structured model (kind, parent body, cadence rule and
 * effective-dated mandate versions). The free-text `cadence` label is kept for
 * compatibility; when a cadence rule is set and no label is given, the label
 * follows the rule.
 */
export async function committeeUpdateStructurePortable(
  ctx: PortableMutationCtx,
  args: {
    id: string;
    kind?: string | null;
    parentBody?: string | null;
    parentCommitteeId?: string | null;
    cadenceRule?: CommitteeCadenceRule | null;
    mandateVersions?: CommitteeMandateVersion[];
    cadenceLabel?: string;
  },
) {
  const committee = await requireOwnedRow(ctx, "committees", args.id);
  const societyId = String(committee.societyId);
  const patch: Record<string, unknown> = {};
  if (args.kind !== undefined) {
    if (args.kind !== null && !(COMMITTEE_KINDS as readonly string[]).includes(args.kind)) throw new Error(`Unsupported committee kind: ${args.kind}.`);
    patch.kind = args.kind ?? undefined;
  }
  if (args.parentBody !== undefined) {
    if (args.parentBody !== null && !(COMMITTEE_PARENT_BODIES as readonly string[]).includes(args.parentBody)) throw new Error(`Unsupported parent body: ${args.parentBody}.`);
    patch.parentBody = args.parentBody ?? undefined;
  }
  if (args.parentCommitteeId !== undefined) {
    if (args.parentCommitteeId) {
      if (args.parentCommitteeId === args.id) throw new Error("A committee cannot be its own parent.");
      await getOwned(ctx, "committees", args.parentCommitteeId, societyId);
    }
    patch.parentCommitteeId = args.parentCommitteeId || undefined;
  }
  if (args.cadenceRule !== undefined) {
    patch.cadenceRule = args.cadenceRule ? normalizeCadenceRule(args.cadenceRule) : undefined;
    if (args.cadenceRule && !args.cadenceLabel) patch.cadence = describeCadenceRule(patch.cadenceRule as any);
  }
  if (args.cadenceLabel !== undefined) patch.cadence = args.cadenceLabel.trim().slice(0, 80) || "Ad hoc";
  if (args.mandateVersions !== undefined) {
    const versions: CommitteeMandateVersion[] = [];
    const ids = new Set<string>();
    for (const raw of args.mandateVersions.slice(0, 50)) {
      if (!raw.effectiveFrom || !ISO_DATE.test(raw.effectiveFrom)) throw new Error("Each mandate version needs an effective-from date (YYYY-MM-DD).");
      if (raw.effectiveTo && (!ISO_DATE.test(raw.effectiveTo) || raw.effectiveTo < raw.effectiveFrom)) throw new Error("A mandate version's end date must be on or after its start.");
      const id = String(raw.id || `mandate-${raw.effectiveFrom}`).slice(0, 80);
      if (ids.has(id)) throw new Error("Mandate versions need distinct ids.");
      ids.add(id);
      if (raw.documentId) await getOwned(ctx, "documents", raw.documentId, societyId);
      const version: CommitteeMandateVersion = { id, effectiveFrom: raw.effectiveFrom };
      if (raw.effectiveTo) version.effectiveTo = raw.effectiveTo;
      if (raw.title?.trim()) version.title = raw.title.trim().slice(0, 200);
      if (raw.mandate?.trim()) version.mandate = raw.mandate.trim().slice(0, 8000);
      if (raw.documentId) version.documentId = raw.documentId;
      if (raw.cadenceRule) version.cadenceRule = normalizeCadenceRule(raw.cadenceRule);
      if (raw.quorumText?.trim()) version.quorumText = raw.quorumText.trim().slice(0, 300);
      if (raw.notes?.trim()) version.notes = raw.notes.trim().slice(0, 2000);
      versions.push(version);
    }
    versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i = 1; i < versions.length; i += 1) {
      const previous = versions[i - 1];
      if (previous.effectiveTo && previous.effectiveTo >= versions[i].effectiveFrom) throw new Error("Mandate versions overlap; end the earlier version before the next one starts.");
    }
    patch.mandateVersions = versions;
  }
  if (!Object.keys(patch).length) return { ok: true };
  await ctx.db.patch(args.id, patch);
  return { ok: true };
}

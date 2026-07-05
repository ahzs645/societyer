/**
 * PORTABLE FUNCTIONS: the minutes domain
 * (list / getByMeeting / create / update / upsertFromDraft /
 *  backfillMotionPersonLinks).
 *
 * Reads/writes the `minutes` table (plus `meetings`, `members`, `directors`,
 * `bylawRuleSets`, `motions`) over `ctx.db`. The quorum-snapshot helpers are
 * portable copies of `convex/lib/bylawRules.ts`, and `syncMotionsForMinutes` is
 * a portable copy of `convex/motions.ts`'s dual-write helper (both only touch
 * `ctx.db`). Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * Server-only handlers stay on Convex (convex/minutes.ts):
 *   - generateDraft (action; ctx.runQuery/ctx.runMutation + summarizeMinutes)
 *   - backfillQuorumSnapshot (NOOP)
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  applyProceduralTags,
  classifyProceduralMotion,
  defaultDecidedByFor,
} from "../proceduralMotions";
import { motionRowToEmbedded } from "../minutesMotions";

// ----- portable quorum-snapshot helpers (copied from convex/lib/bylawRules) --

type BylawRuleSetLike = Record<string, any>;
type ResolvedBylawRuleSet = BylawRuleSetLike & { isFallback?: boolean };

export type QuorumSnapshot = {
  bylawRuleSetId?: string;
  quorumRuleVersion?: number;
  quorumRuleEffectiveFromISO?: string;
  quorumSourceLabel: string;
  quorumRequired?: number;
  quorumComputedAtISO: string;
};

const DEFAULT_BYLAW_RULES: BylawRuleSetLike = {
  societyId: "placeholder",
  version: 1,
  status: "Active",
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  allowHybridMeetings: true,
  allowElectronicVoting: false,
  allowProxyVoting: false,
  proxyHolderMustBeMember: false,
  proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "percentage",
  quorumValue: 10,
  quorumMinimumCount: 3,
  memberProposalThresholdPct: 5,
  memberProposalMinSignatures: 1,
  memberProposalLeadDays: 7,
  requisitionMeetingThresholdPct: 10,
  annualReportDueDaysAfterMeeting: 30,
  requireAgmFinancialStatements: true,
  requireAgmElections: true,
  ballotIsAnonymous: true,
  voterMustBeMemberAtRecordDate: true,
  inspectionMemberRegisterByMembers: true,
  inspectionMemberRegisterByPublic: false,
  inspectionDirectorRegisterByMembers: true,
  inspectionCopiesAllowed: true,
  ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67,
  unanimousWrittenSpecialResolution: true,
  updatedAtISO: new Date(0).toISOString(),
};

function getDefaultBylawRules(societyId: string): BylawRuleSetLike {
  return {
    ...DEFAULT_BYLAW_RULES,
    societyId,
    updatedAtISO: new Date().toISOString(),
  };
}

async function getBylawRuleSetForDate(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
  dateISO: string,
): Promise<ResolvedBylawRuleSet> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const targetTs = timestampOrInfinity(dateISO);
  const eligible = rows
    .filter((row) => row.status !== "Draft")
    .filter((row) => effectiveTimestamp(row) <= targetTs);
  const selected = eligible.sort(compareRuleSetsDesc)[0];
  if (selected) return selected;
  return {
    ...getDefaultBylawRules(societyId),
    isFallback: true,
  };
}

async function buildQuorumSnapshot(
  ctx: PortableQueryCtx | PortableMutationCtx,
  args: {
    societyId: string;
    meetingDateISO: string;
    meetingType?: string;
    quorumRequiredOverride?: number;
  },
): Promise<QuorumSnapshot> {
  const now = new Date().toISOString();
  const rules = await getBylawRuleSetForDate(
    ctx,
    args.societyId,
    args.meetingDateISO,
  );
  const ruleRequired = await computeRequiredQuorum(ctx, rules, args);
  const quorumRequired =
    args.quorumRequiredOverride ?? ruleRequired;
  const label = quorumSourceLabel(
    rules,
    quorumRequired != null &&
      ruleRequired != null &&
      quorumRequired !== ruleRequired,
  );

  return {
    bylawRuleSetId: rules._id,
    quorumRuleVersion: rules.version,
    quorumRuleEffectiveFromISO: rules.effectiveFromISO,
    quorumSourceLabel: label,
    quorumRequired,
    quorumComputedAtISO: now,
  };
}

async function computeRequiredQuorum(
  ctx: PortableQueryCtx | PortableMutationCtx,
  rules: ResolvedBylawRuleSet,
  args: {
    societyId: string;
    meetingType?: string;
  },
) {
  if (rules.quorumType === "fixed") {
    return rules.quorumValue;
  }
  if (rules.quorumType === "percentage" && isGeneralMeeting(args.meetingType)) {
    const members = await ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    const eligible = members.filter(
      (member) => member.status === "Active" && member.votingRights,
    ).length;
    const percentageQuorum = Math.ceil(eligible * (rules.quorumValue / 100));
    return Math.max(rules.quorumMinimumCount ?? 1, percentageQuorum);
  }
  return undefined;
}

function quorumSourceLabel(
  rules: ResolvedBylawRuleSet,
  hasManualOverride: boolean,
) {
  const prefix = hasManualOverride ? "Manual quorum override; " : "";
  if (rules.isFallback || !rules._id) {
    return `${prefix}BC Model Bylaw baseline assumptions`;
  }
  const effective = rules.effectiveFromISO
    ? `, effective ${rules.effectiveFromISO.slice(0, 10)}`
    : "";
  return `${prefix}Bylaw rules v${rules.version}${effective}`;
}

function compareRuleSetsDesc(
  a: Record<string, any>,
  b: Record<string, any>,
) {
  const byEffective = effectiveTimestamp(b) - effectiveTimestamp(a);
  if (byEffective !== 0) return byEffective;
  return b.version - a.version;
}

function effectiveTimestamp(row: Record<string, any>) {
  return timestampOrNegativeInfinity(row.effectiveFromISO);
}

function timestampOrInfinity(value: string) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

function timestampOrNegativeInfinity(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
}

function isGeneralMeeting(type?: string) {
  return type === "AGM" || type === "SGM";
}

// ----- portable motions dual-write helper (copied from convex/motions.ts) ----

function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined) out[k] = val;
  return out;
}

const KNOWN_EMBEDDED_OUTCOMES = new Set([
  "",
  "pending",
  "carried",
  "defeated",
  "tabled",
  "deferred",
  "withdrawn",
]);

/** Map a legacy embedded `outcome` string to the explicit (status, outcome)
 *  split. See the backfill map in docs/motions-first-class-object-design.md. */
function statusFromEmbeddedOutcome(raw?: string): { status: string; outcome?: string } {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "pending") return { status: "Moved" };
  if (value === "carried") return { status: "Voted", outcome: "Carried" };
  if (value === "defeated") return { status: "Voted", outcome: "Defeated" };
  if (value === "tabled") return { status: "Tabled" };
  if (value === "deferred") return { status: "Deferred" };
  if (value === "withdrawn") return { status: "Withdrawn" };
  return { status: "Moved" }; // unknown → caller preserves the raw value in `note`
}

/** Mirror one minutes doc's embedded `motions[]` into the motions table.
 *  Delete-and-reinsert keeps the mirror consistent during the dual-write phase:
 *  reads still come from the embedded array, so motion ids are not yet relied
 *  upon. Reconcile-by-identity replaces this when reads are flipped. */
export async function syncMotionsForMinutes(
  ctx: PortableMutationCtx,
  args: { societyId: any; minutesId: any; meetingId?: any; motions?: any[] },
) {
  // Best-effort: a mirror failure must never roll back the minutes save that
  // triggered it. A stale mirror is corrected by the step-2 backfill or the
  // next edit; a broken minutes save is a user-facing regression.
  try {
    const existing = await ctx.db
      .query("motions")
      .withIndex("by_minutes", (q) => q.eq("minutesId", args.minutesId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const now = new Date().toISOString();
    const motionIds: any[] = [];
    for (const m of args.motions ?? []) {
      const { status, outcome } = statusFromEmbeddedOutcome(m.outcome);
      const note = KNOWN_EMBEDDED_OUTCOMES.has(String(m.outcome ?? "").trim().toLowerCase())
        ? undefined
        : `legacy outcome: ${m.outcome}`;
      // Classify recurring procedural motions (adjournment, approve-minutes,
      // approve-agenda, recess, receive-reports) from their wording and stamp
      // the first-class record with an explicit kind + label, so the master
      // list filters by a stored tag instead of regex-matching every render.
      // Default the "decided by" axis from the catalogue (most procedural
      // motions pass by general consent, carrying without a recorded tally).
      const kind = classifyProceduralMotion({
        text: m.text,
        sectionTitle: m.sectionTitle,
        resolutionType: m.resolutionType,
      });
      const tags = applyProceduralTags(m.tags, {
        text: m.text,
        sectionTitle: m.sectionTitle,
      });
      const decidedBy =
        m.decidedBy ??
        defaultDecidedByFor({ text: m.text, sectionTitle: m.sectionTitle });
      const insertedId = await ctx.db.insert(
        "motions",
        stripUndefined({
          societyId: args.societyId,
          minutesId: args.minutesId,
          primaryMeetingId: args.meetingId,
          title: m.name,
          text: m.text ?? "",
          movedBy: m.movedBy,
          movedByMemberId: m.movedByMemberId,
          movedByDirectorId: m.movedByDirectorId,
          secondedBy: m.secondedBy,
          secondedByMemberId: m.secondedByMemberId,
          secondedByDirectorId: m.secondedByDirectorId,
          resolutionTypeLabel: m.resolutionType,
          status,
          outcome,
          decidedBy,
          proceduralKind: kind?.key,
          tags: tags.length ? tags : undefined,
          votesFor: m.votesFor,
          votesAgainst: m.votesAgainst,
          abstentions: m.abstentions,
          sectionIndex: m.sectionIndex,
          sectionTitle: m.sectionTitle,
          motionTemplateId: m.motionTemplateId,
          adoptsMinutesId: m.adoptsMinutesId,
          source: "minutes",
          history: [
            stripUndefined({
              at: now,
              minutesId: args.minutesId,
              meetingId: args.meetingId,
              status,
              outcome,
              votesFor: m.votesFor,
              votesAgainst: m.votesAgainst,
              abstentions: m.abstentions,
              note,
            }),
          ],
          createdAtISO: now,
          updatedAtISO: now,
        }),
      );
      motionIds.push(insertedId);
    }
    // Maintain the ordered id references on the minutes alongside the embedded
    // array (same best-effort block as the mirror rows: on a throw, motionIds
    // stays as-is and is corrected on the next save). Reads flip onto it in
    // Phase 2 of docs/motions-migration-finish-scope.md.
    await ctx.db.patch(args.minutesId, { motionIds });
  } catch (err) {
    console.warn(
      `[motions] dual-write sync failed for minutes ${String(args.minutesId)}: ${String(err)}`,
    );
  }
}

// ----- queries --------------------------------------------------------------

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("minutes")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  // Attach the resolved display motions at the query boundary so every frontend
  // display read (all routed through minutesMotionsForDisplay in Phase 0) becomes
  // table-sourced transparently. The live embedded `motions[]` stays untouched on
  // the row for the editor's write path. See docs/motions-migration-finish-scope.md.
  return Promise.all(
    rows.map(async (m) => ({ ...m, displayMotions: await resolveMinutesMotions(ctx, m) })),
  );
}

export async function getByMeetingPortable(
  ctx: PortableQueryCtx,
  { meetingId }: { meetingId: string },
) {
  const rows = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  const m = rows[0];
  if (!m) return null;
  return { ...m, displayMotions: await resolveMinutesMotions(ctx, m) };
}

/**
 * Resolve a minutes' motions for DISPLAY from the single source of truth — the
 * async, table-backed counterpart to the pure `minutesMotionsForDisplay`.
 *
 * Approved minutes render from the frozen `motionSnapshots[]` (immutable legal
 * record). A draft resolves its ordered `motionIds` → first-class `motions`
 * rows → embedded display shape (`motionRowToEmbedded`). Falls back to the
 * embedded `motions[]` when `motionIds` is absent (data from before Phase 1, or
 * mid-transition) so a read never regresses.
 *
 * Phase 2 routes read sites that carry a `ctx` onto this; the write/edit path
 * stays on the live embedded array. See docs/motions-migration-finish-scope.md.
 */
export async function resolveMinutesMotions(ctx: PortableQueryCtx, minutes: any): Promise<any[]> {
  if (!minutes) return [];
  if (Array.isArray(minutes.motionSnapshots) && minutes.motionSnapshots.length > 0) {
    return minutes.motionSnapshots;
  }
  const ids: any[] = Array.isArray(minutes.motionIds) ? minutes.motionIds : [];
  if (ids.length === 0) {
    return Array.isArray(minutes.motions) ? minutes.motions : [];
  }
  const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return rows.filter(Boolean).map(motionRowToEmbedded);
}

// ----- mutations ------------------------------------------------------------

export async function createPortable(ctx: PortableMutationCtx, args: any) {
  await assertMotionPersonLinksBelongToSociety(ctx, args.societyId, args.motions);
  const meeting = await ctx.db.get(args.meetingId);
  const snapshot = meeting
    ? await quorumSnapshotForMeeting(ctx, meeting, args.quorumRequired)
    : null;
  const id = await ctx.db.insert("minutes", {
    ...args,
    ...minutesSnapshotFields(args, snapshot),
  });
  await ctx.db.patch(args.meetingId, { minutesId: id });
  // Dual-write: mirror into the standalone motions table (reads still use the
  // embedded array; see docs/motions-first-class-object-design.md).
  await syncMotionsForMinutes(ctx, {
    societyId: args.societyId,
    minutesId: id,
    meetingId: args.meetingId,
    motions: args.motions,
  });
  return id;
}

function isCarriedOutcome(outcome: unknown) {
  return String(outcome ?? "").trim().toLowerCase() === "carried";
}

/** When an adoption motion (adoptsMinutesId) newly carries, stamp the
 *  referenced minutes approved: approvedAt = the adopting meeting's date,
 *  approvedInMeetingId = the adopting meeting. Idempotent and conservative —
 *  already-approved targets, cross-society references, and motions that were
 *  already carried before this save are all left untouched. Never *clears*
 *  an approval: flipping the motion back off Carried is ambiguous (was the
 *  approval also recorded manually?), so undoing is left to the explicit
 *  "Clear approval" action. */
async function applyAdoptionApprovals(
  ctx: PortableMutationCtx,
  minutes: any,
  nextMotions: any[],
) {
  const before: any[] = Array.isArray(minutes.motions) ? minutes.motions : [];
  const previouslyCarried = new Set(
    before
      .filter((motion) => motion?.adoptsMinutesId && isCarriedOutcome(motion.outcome))
      .map((motion) => String(motion.adoptsMinutesId)),
  );
  const stamped = new Set<string>();
  for (const motion of nextMotions) {
    const targetId = motion?.adoptsMinutesId;
    if (!targetId || !isCarriedOutcome(motion.outcome)) continue;
    const key = String(targetId);
    if (previouslyCarried.has(key) || stamped.has(key)) continue;
    if (key === String(minutes._id)) continue;
    const target = await ctx.db.get(targetId);
    if (!target || target.approvedAt) continue;
    if (String(target.societyId) !== String(minutes.societyId)) continue;
    const now = new Date().toISOString();
    const targetPatch: Record<string, unknown> = {
      approvedAt: minutes.heldAt || now,
      approvedInMeetingId: minutes.meetingId,
    };
    // Mirror the snapshot-on-approval freeze from updatePortable — this patch
    // bypasses that path, and the approved record must be frozen either way.
    if (!target.motionSnapshots) {
      targetPatch.motionSnapshots = target.motions ?? [];
      targetPatch.motionSnapshotAtISO = now;
    }
    await ctx.db.patch(target._id, targetPatch);
    stamped.add(key);
    const targetMeeting = target.meetingId ? await ctx.db.get(target.meetingId) : null;
    await ctx.db.insert("activity", {
      societyId: minutes.societyId,
      actor: "You",
      entityType: "minutes",
      entityId: String(target._id),
      action: "approved",
      summary: `Marked minutes${targetMeeting ? ` of ${targetMeeting.title}` : ""} approved — adoption motion carried`,
      createdAtISO: now,
    });
  }
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch: rawPatch }: { id: string; patch: any },
) {
  const minutes = await ctx.db.get(id);
  if (!minutes) throw new Error("Minutes not found");
  // `undefined` fields are stripped from the wire, so unsetting approval
  // arrives as explicit clear flags (mirrors meetings.clearNoticeSent).
  const { clearApproval, clearApprovedInMeeting, ...patch } = rawPatch;
  if (clearApproval) {
    patch.approvedAt = undefined;
    patch.approvedInMeetingId = undefined;
  } else if (clearApprovedInMeeting) {
    patch.approvedInMeetingId = undefined;
  }
  if (patch.motions) {
    await assertMotionPersonLinksBelongToSociety(ctx, String(minutes.societyId), patch.motions);
  }
  await ctx.db.patch(id, patch);

  // Snapshot-on-approval: the first time minutes become approved, freeze the
  // motion set so later edits to live motions never rewrite the approved legal
  // record. Skipped if a snapshot already exists (idempotent).
  const newlyApproved = !!patch.approvedAt && !minutes.approvedAt;
  if (newlyApproved && !minutes.motionSnapshots) {
    const frozen = patch.motions ?? minutes.motions ?? [];
    await ctx.db.patch(id, {
      motionSnapshots: frozen,
      motionSnapshotAtISO: new Date().toISOString(),
    });
  }

  // Adoption carry-through: when an "adopt previous minutes" motion
  // (adoptsMinutesId) newly records as Carried, stamp the referenced minutes
  // approved — the step people forget after the vote in the room.
  if (Array.isArray(patch.motions)) {
    await applyAdoptionApprovals(ctx, minutes, patch.motions);
  }

  // Dual-write: re-mirror only when the motions array was part of this patch.
  if (patch.motions) {
    await syncMotionsForMinutes(ctx, {
      societyId: minutes.societyId,
      minutesId: id,
      meetingId: minutes.meetingId,
      motions: patch.motions,
    });
  }
}

// Upsert a minutes row from an AI-generated draft (transcripts.runPipeline).
export async function upsertFromDraftPortable(ctx: PortableMutationCtx, args: any) {
  await assertMotionPersonLinksBelongToSociety(ctx, args.societyId, args.motions);
  const meeting = await ctx.db.get(args.meetingId);
  const snapshot = meeting
    ? await quorumSnapshotForMeeting(ctx, meeting, args.quorumRequired)
    : null;
  const quorumRequired = args.quorumRequired ?? snapshot?.quorumRequired;
  const payload = {
    ...args,
    ...minutesSnapshotFields(args, snapshot),
    quorumMet:
      quorumRequired == null
        ? args.quorumMet
        : args.attendees.length >= quorumRequired,
  };
  const existing = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  if (existing[0]) {
    await ctx.db.patch(existing[0]._id, payload);
    await syncMotionsForMinutes(ctx, {
      societyId: args.societyId,
      minutesId: existing[0]._id,
      meetingId: args.meetingId,
      motions: args.motions,
    });
    return existing[0]._id;
  }
  const id = await ctx.db.insert("minutes", payload);
  await ctx.db.patch(args.meetingId, { minutesId: id });
  await syncMotionsForMinutes(ctx, {
    societyId: args.societyId,
    minutesId: id,
    meetingId: args.meetingId,
    motions: args.motions,
  });
  return id;
}

export async function backfillMotionPersonLinksPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
) {
  const [rows, members, directors] = await Promise.all([
    ctx.db
      .query("minutes")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("members")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("directors")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
  ]);

  let minutesUpdated = 0;
  let motionRowsUpdated = 0;
  const linkedNames: Record<string, string> = {};
  const unresolvedNames: Record<string, number> = {};

  for (const row of rows) {
    let changed = false;
    const motions = row.motions.map((motion: any) => {
      const movedBy = resolveMotionPersonLink(motion.movedBy, members, directors);
      const secondedBy = resolveMotionPersonLink(motion.secondedBy, members, directors);
      const next = { ...motion };

      if (movedBy.label || !motion.movedBy) {
        next.movedByMemberId = movedBy.memberId;
        next.movedByDirectorId = movedBy.directorId;
      }
      if (secondedBy.label || !motion.secondedBy) {
        next.secondedByMemberId = secondedBy.memberId;
        next.secondedByDirectorId = secondedBy.directorId;
      }

      if (motion.movedBy) {
        if (movedBy.label) linkedNames[motion.movedBy] = movedBy.label;
        else unresolvedNames[motion.movedBy] = (unresolvedNames[motion.movedBy] ?? 0) + 1;
      }
      if (motion.secondedBy) {
        if (secondedBy.label) linkedNames[motion.secondedBy] = secondedBy.label;
        else unresolvedNames[motion.secondedBy] = (unresolvedNames[motion.secondedBy] ?? 0) + 1;
      }

      if (
        next.movedByMemberId !== motion.movedByMemberId ||
        next.movedByDirectorId !== motion.movedByDirectorId ||
        next.secondedByMemberId !== motion.secondedByMemberId ||
        next.secondedByDirectorId !== motion.secondedByDirectorId
      ) {
        changed = true;
        motionRowsUpdated += 1;
      }
      return next;
    });

    if (changed) {
      await ctx.db.patch(row._id, { motions });
      minutesUpdated += 1;
    }
  }

  return { minutesScanned: rows.length, minutesUpdated, motionRowsUpdated, linkedNames, unresolvedNames };
}

export async function backfillQuorumSnapshotPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const minutes = await ctx.db.get(id);
  if (!minutes) return null;
  const meeting = await ctx.db.get(minutes.meetingId);
  if (!meeting) return null;
  const snapshot = await quorumSnapshotForMeeting(
    ctx,
    meeting,
    minutes.quorumRequired ?? meeting.quorumRequired,
  );
  const patch: any = {};
  if (minutes.quorumRequired == null && snapshot.quorumRequired != null) {
    patch.quorumRequired = snapshot.quorumRequired;
  }
  if (!minutes.bylawRuleSetId && snapshot.bylawRuleSetId) {
    patch.bylawRuleSetId = snapshot.bylawRuleSetId;
  }
  if (minutes.quorumRuleVersion == null && snapshot.quorumRuleVersion != null) {
    patch.quorumRuleVersion = snapshot.quorumRuleVersion;
  }
  if (!minutes.quorumRuleEffectiveFromISO && snapshot.quorumRuleEffectiveFromISO) {
    patch.quorumRuleEffectiveFromISO = snapshot.quorumRuleEffectiveFromISO;
  }
  if (!minutes.quorumSourceLabel) {
    patch.quorumSourceLabel = snapshot.quorumSourceLabel;
  }
  if (!minutes.quorumComputedAtISO) {
    patch.quorumComputedAtISO = snapshot.quorumComputedAtISO;
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(id, patch);
  }
  return { patched: Object.keys(patch) };
}

// ----- helpers --------------------------------------------------------------

async function quorumSnapshotForMeeting(
  ctx: PortableMutationCtx,
  meeting: Record<string, any>,
  quorumRequiredOverride?: number,
) {
  return await buildQuorumSnapshot(ctx, {
    societyId: meeting.societyId,
    meetingDateISO: meeting.scheduledAt,
    meetingType: meeting.type,
    quorumRequiredOverride,
  });
}

function minutesSnapshotFields(
  args: {
    quorumRequired?: number;
    bylawRuleSetId?: any;
    quorumRuleVersion?: number;
    quorumRuleEffectiveFromISO?: string;
    quorumSourceLabel?: string;
    quorumComputedAtISO?: string;
  },
  snapshot: QuorumSnapshot | null,
) {
  return {
    quorumRequired: args.quorumRequired ?? snapshot?.quorumRequired,
    bylawRuleSetId: args.bylawRuleSetId ?? snapshot?.bylawRuleSetId,
    quorumRuleVersion: args.quorumRuleVersion ?? snapshot?.quorumRuleVersion,
    quorumRuleEffectiveFromISO:
      args.quorumRuleEffectiveFromISO ??
      snapshot?.quorumRuleEffectiveFromISO,
    quorumSourceLabel: args.quorumSourceLabel ?? snapshot?.quorumSourceLabel,
    quorumComputedAtISO: args.quorumComputedAtISO ?? snapshot?.quorumComputedAtISO,
  };
}

async function assertMotionPersonLinksBelongToSociety(ctx: PortableMutationCtx, societyId: string, motions: any[]) {
  for (const motion of motions) {
    await assertPersonLinkBelongsToSociety(ctx, societyId, "members", motion.movedByMemberId, "movedByMemberId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "directors", motion.movedByDirectorId, "movedByDirectorId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "members", motion.secondedByMemberId, "secondedByMemberId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "directors", motion.secondedByDirectorId, "secondedByDirectorId");
  }
}

async function assertPersonLinkBelongsToSociety(
  ctx: PortableMutationCtx,
  societyId: string,
  table: "members" | "directors",
  id: string | undefined,
  fieldName: string,
) {
  if (!id) return;
  const row = await ctx.db.get(id);
  if (!row || row.societyId !== societyId) {
    throw new Error(`Motion ${fieldName} must reference a ${table.slice(0, -1)} in the same society.`);
  }
}

function resolveMotionPersonLink(
  value: unknown,
  members: any[],
  directors: any[],
): { memberId?: string; directorId?: string; label?: string } {
  const key = normalizePersonLookupName(value);
  if (!key) return {};
  const memberMatches = members.filter((member) => personLookupKeys(member).includes(key));
  const directorMatches = directors.filter((director) => personLookupKeys(director).includes(key));
  const matches = [
    ...memberMatches.map((member) => ({
      memberId: member._id,
      label: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim(),
    })),
    ...directorMatches.map((director) => ({
      directorId: director._id,
      label: `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim(),
    })),
  ];
  return matches.length === 1 ? matches[0] : {};
}

function personLookupKeys(row: any) {
  return unique([
    `${row?.firstName ?? ""} ${row?.lastName ?? ""}`,
    `${row?.lastName ?? ""}, ${row?.firstName ?? ""}`,
    row?.name,
    ...(Array.isArray(row?.aliases) ? row.aliases : []),
  ]).map(normalizePersonLookupName).filter(Boolean);
}

function normalizePersonLookupName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const withoutFormer = text.replace(/\([^)]*\)/g, " ");
  const commaMatch = withoutFormer.match(/^\s*([^,]+),\s*(.+?)\s*$/);
  const name = commaMatch ? `${commaMatch[2]} ${commaMatch[1]}` : withoutFormer;
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * PORTABLE FUNCTIONS: the first-class motions domain
 * (list / listForMinutes / listForMeeting / backlog /
 *  create / update / setStatus / setTags / recordVote / remove).
 *
 * Standalone first-class motion store. See
 * docs/motions-first-class-object-design.md. These handlers read/write the
 * `motions` table over `ctx.db`. `insertMotion` / `patchMotion` /
 * `classifyMotionInput` / `stripUndefined` are the portable write helpers (this
 * is their home; shared/functions/motionBacklog.ts inlines verbatim copies).
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  applyProceduralTags,
  classifyProceduralMotion,
} from "../proceduralMotions";

function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined) out[k] = val;
  return out;
}

// ----- shared write helpers (reused by the dual-write hooks) ----------------

/** Stamp a motion's procedural classification onto an input record without
 *  overwriting values the caller set explicitly: the `proceduralKind` slug, the
 *  auto-applied kind tag, and the default `decidedBy`. Applied to every direct
 *  insert so backlog / import / AI-transcript creation paths label recurring
 *  procedural motions (adjournment, approve-minutes, …) the same way the
 *  minutes→motions mirror does. Substantive motions are left untouched. */
function classifyMotionInput(input: Record<string, any>) {
  const subject = {
    text: input.text,
    sectionTitle: input.sectionTitle,
    resolutionType: input.resolutionType ?? input.resolutionTypeLabel,
  };
  const kind = classifyProceduralMotion(subject);
  if (!kind) return input;
  return {
    ...input,
    proceduralKind: input.proceduralKind ?? kind.key,
    tags: applyProceduralTags(input.tags, subject),
    decidedBy: input.decidedBy ?? kind.defaultDecidedBy,
  };
}

/** Insert a motion row, defaulting status to Draft and stamping timestamps.
 *  Returns the new id. */
async function insertMotion(ctx: PortableMutationCtx, input: Record<string, any>) {
  const now = new Date().toISOString();
  const classified = classifyMotionInput(input);
  return await ctx.db.insert("motions", {
    ...stripUndefined(classified),
    status: classified.status ?? "Draft",
    createdAtISO: now,
    updatedAtISO: now,
  });
}

/** Patch a motion row, dropping undefined keys and stamping updatedAtISO. */
async function patchMotion(ctx: PortableMutationCtx, motionId: any, patch: Record<string, any>) {
  await ctx.db.patch(motionId, {
    ...stripUndefined(patch),
    updatedAtISO: new Date().toISOString(),
  });
  return motionId;
}

// ----- queries --------------------------------------------------------------

/**
 * Read-only motions synthesized from meeting minutes that were never converted
 * into a first-class `motions` row (conversion is a manual, on-demand action —
 * see createFromMinutesMotionPortable in motionBacklog.ts). Without this, a
 * meeting's recorded motions (e.g. an AGM's carried motions) are invisible on
 * the master Motions page even though they're the actual record of what the
 * society decided. Synthetic ids encode their source so the UI can recognize
 * (and avoid trying to mutate) a row that has no real `motions` document yet.
 */
async function minutesSourcedMotions(
  ctx: PortableQueryCtx,
  societyId: string,
  alreadyConverted: Set<string>,
) {
  const allMinutes = await ctx.db
    .query("minutes")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const synthesized: any[] = [];
  for (const minutes of allMinutes) {
    const motions = Array.isArray((minutes as any).motions) ? (minutes as any).motions : [];
    motions.forEach((motion: any, index: number) => {
      if (alreadyConverted.has(`${minutes._id}:${index}`)) return;
      if (!motion?.text) return;
      synthesized.push({
        _id: `from-minutes:${minutes._id}:${index}`,
        societyId,
        text: motion.text,
        title: motion.name,
        movedBy: motion.movedBy,
        secondedBy: motion.secondedBy,
        status: motion.outcome === "Carried" || motion.outcome === "Defeated" ? "Voted" : (motion.outcome ?? "Voted"),
        outcome: motion.outcome,
        votesFor: motion.votesFor,
        votesAgainst: motion.votesAgainst,
        abstentions: motion.abstentions,
        decidedBy: motion.decidedBy,
        resolutionTypeLabel: motion.resolutionType,
        primaryMeetingId: (minutes as any).meetingId,
        tags: [],
        createdAtISO: (minutes as any).heldAt,
        sourceMinutesId: minutes._id,
        sourceMotionIndex: index,
        readOnly: true,
      });
    });
  }
  return synthesized;
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const alreadyConverted = new Set(
    rows
      .filter((row: any) => row.sourceMinutesId != null && row.sourceMotionIndex != null)
      .map((row: any) => `${row.sourceMinutesId}:${row.sourceMotionIndex}`),
  );
  const fromMinutes = await minutesSourcedMotions(ctx, societyId, alreadyConverted);
  return [...rows, ...fromMinutes];
}

export async function listForMinutesPortable(ctx: PortableQueryCtx, { minutesId }: { minutesId: string }) {
  return ctx.db
    .query("motions")
    .withIndex("by_minutes", (q) => q.eq("minutesId", minutesId))
    .collect();
}

export async function listForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  return ctx.db
    .query("motions")
    .withIndex("by_meeting", (q) => q.eq("primaryMeetingId", meetingId))
    .collect();
}

// Backlog list = motions parked before/around a meeting. Folds in the old
// motionBacklog query surface; the "backlog" is just a status filter now.
const BACKLOG_STATUSES = new Set(["Backlog", "Tabled", "Deferred"]);
export async function backlogPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.filter((r: any) => BACKLOG_STATUSES.has(r.status));
}

// ----- mutations ------------------------------------------------------------

export async function createPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  return insertMotion(ctx, args);
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { motionId, patch }: { motionId: string; patch: Record<string, any> },
) {
  return patchMotion(ctx, motionId, patch);
}

/** Set an explicit, overridable status (and optional outcome), appending a
 *  history entry so the cross-meeting trail is preserved (see "Votes Model A +
 *  History" in the design doc). */
export async function setStatusPortable(
  ctx: PortableMutationCtx,
  { motionId, status, outcome, manual, meetingId, note }: {
    motionId: string;
    status: string;
    outcome?: string;
    manual?: boolean;
    meetingId?: string;
    note?: string;
  },
) {
  const row = await ctx.db.get(motionId);
  if (!row) return null;
  const now = new Date().toISOString();
  const entry = stripUndefined({
    at: now,
    status,
    outcome,
    meetingId,
    minutesId: row.minutesId,
    votesFor: row.votesFor,
    votesAgainst: row.votesAgainst,
    abstentions: row.abstentions,
    note,
  });
  await ctx.db.patch(
    motionId,
    stripUndefined({
      status,
      outcome,
      statusIsManual: manual === true ? true : row.statusIsManual,
      history: [...(row.history ?? []), entry],
      updatedAtISO: now,
    }),
  );
  return motionId;
}

/** Replace a motion's tag/label set (normalized: trimmed, lowercased, deduped).
 *  Drives the master-list filtering, including the default-hidden routine
 *  labels (adjournment, previous-minutes). */
export async function setTagsPortable(
  ctx: PortableMutationCtx,
  { motionId, tags }: { motionId: string; tags: string[] },
) {
  const normalized = Array.from(
    new Set(
      (tags ?? [])
        .map((t: string) => String(t ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  return patchMotion(ctx, motionId, { tags: normalized });
}

export async function recordVotePortable(
  ctx: PortableMutationCtx,
  { motionId, votesFor, votesAgainst, abstentions }: {
    motionId: string;
    votesFor?: number;
    votesAgainst?: number;
    abstentions?: number;
  },
) {
  return patchMotion(ctx, motionId, { votesFor, votesAgainst, abstentions });
}

export async function removePortable(ctx: PortableMutationCtx, { motionId }: { motionId: string }) {
  await ctx.db.delete(motionId);
  return null;
}

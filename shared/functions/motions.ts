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
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";

async function validateMotionForeignKeys(
  ctx: PortableMutationCtx,
  input: Record<string, unknown>,
  societyId: string,
) {
  const foreignKeys = [
    ["movedByMemberId", "members"],
    ["movedByDirectorId", "directors"],
    ["secondedByMemberId", "members"],
    ["secondedByDirectorId", "directors"],
    ["primaryMeetingId", "meetings"],
    ["targetMeetingId", "meetings"],
    ["minutesId", "minutes"],
    ["agendaId", "agendas"],
    ["agendaItemId", "agendaItems"],
    ["motionTemplateId", "motionTemplates"],
    ["sourceMotionEvidenceId", "motionEvidence"],
    ["sourceMinutesId", "minutes"],
  ] as const;
  for (const [field, table] of foreignKeys) {
    const value = input[field];
    if (typeof value === "string") await getOwned(ctx, table, value, societyId);
  }
  if (Array.isArray(input.sourceDocumentIds)) {
    for (const documentId of input.sourceDocumentIds) {
      if (typeof documentId === "string") {
        await getOwned(ctx, "documents", documentId, societyId);
      }
    }
  }
}

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

// The master motions list is now purely the first-class `motions` table. Every
// minutes motion has a mirror row (the dual-write on save + `backfillFromLegacy`),
// so the old `minutesSourcedMotions` synthesizer is redundant. After the read-flip
// it was worse than redundant: it double-counted a mirrored motion — once as its
// real row and again as a synthetic `from-minutes:<minutesId>:<index>` entry,
// because mirror rows carry `minutesId` but not `sourceMinutesId`, so they never
// landed in the `alreadyConverted` dedupe set. See Phase 4A in
// docs/motions-migration-finish-scope.md.
export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function listForMinutesPortable(ctx: PortableQueryCtx, { minutesId }: { minutesId: string }) {
  await requireOwnedRow(ctx, "minutes", minutesId);
  return ctx.db
    .query("motions")
    .withIndex("by_minutes", (q) => q.eq("minutesId", minutesId))
    .collect();
}

export async function listForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  await requireOwnedRow(ctx, "meetings", meetingId);
  return ctx.db
    .query("motions")
    .withIndex("by_meeting", (q) => q.eq("primaryMeetingId", meetingId))
    .collect();
}

// Backlog list = motions parked before/around a meeting. Folds in the old
// motionBacklog query surface; the "backlog" is just a status filter now.
const BACKLOG_STATUSES = new Set(["Backlog", "Tabled", "Deferred"]);
export async function backlogPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.filter((r: any) => BACKLOG_STATUSES.has(r.status));
}

// ----- mutations ------------------------------------------------------------

export async function createPortable(ctx: PortableMutationCtx, args: Record<string, any>) {
  const societyId = typeof args.societyId === "string" ? args.societyId : "";
  await requireSocietyMembership(ctx, societyId);
  await validateMotionForeignKeys(ctx, args, societyId);
  return insertMotion(ctx, args);
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { motionId, patch }: { motionId: string; patch: Record<string, any> },
) {
  const authorizedRow = await requireOwnedRow(ctx, "motions", motionId);
  const societyId = String(authorizedRow.societyId);
  await validateMotionForeignKeys(ctx, patch, societyId);
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
  const row = await requireOwnedRow(ctx, "motions", motionId);
  const societyId = String(row.societyId);
  if (meetingId) await getOwned(ctx, "meetings", meetingId, societyId);
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
  await requireOwnedRow(ctx, "motions", motionId);
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
  await requireOwnedRow(ctx, "motions", motionId);
  return patchMotion(ctx, motionId, { votesFor, votesAgainst, abstentions });
}

export async function removePortable(ctx: PortableMutationCtx, { motionId }: { motionId: string }) {
  await requireOwnedRow(ctx, "motions", motionId);
  await ctx.db.delete(motionId);
  return null;
}

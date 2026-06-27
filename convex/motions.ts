import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";

// Standalone first-class motion store. See
// docs/motions-first-class-object-design.md. During the dual-write phase the
// existing UI still reads minutes.motions[]; these functions + helpers are how
// the new table gets populated in parallel. Reads are flipped in a later step.

// Writable, optional motion fields shared by create() and update(). Kept in one
// place so the dual-write hooks (convex/minutes.ts, agendas.ts, …) and the
// public mutations stay in lockstep with the table definition.
const motionContent = {
  title: v.optional(v.string()),
  category: v.optional(v.string()),
  movedBy: v.optional(v.string()),
  movedByMemberId: v.optional(v.id("members")),
  movedByDirectorId: v.optional(v.id("directors")),
  secondedBy: v.optional(v.string()),
  secondedByMemberId: v.optional(v.id("members")),
  secondedByDirectorId: v.optional(v.id("directors")),
  resolutionTypeId: v.optional(v.string()),
  resolutionTypeLabel: v.optional(v.string()),
  outcome: v.optional(v.string()),
  votesFor: v.optional(v.number()),
  votesAgainst: v.optional(v.number()),
  abstentions: v.optional(v.number()),
  recordedApprovers: v.optional(v.array(v.string())),
  backlogPriority: v.optional(v.string()),
  source: v.optional(v.string()),
  seededKey: v.optional(v.string()),
  primaryMeetingId: v.optional(v.id("meetings")),
  targetMeetingId: v.optional(v.id("meetings")),
  minutesId: v.optional(v.id("minutes")),
  sectionIndex: v.optional(v.number()),
  sectionTitle: v.optional(v.string()),
  agendaId: v.optional(v.id("agendas")),
  agendaItemId: v.optional(v.id("agendaItems")),
  motionTemplateId: v.optional(v.id("motionTemplates")),
  sourceMotionEvidenceId: v.optional(v.id("motionEvidence")),
  sourceMinutesId: v.optional(v.id("minutes")),
  sourceMotionIndex: v.optional(v.number()),
  sourceSectionIndex: v.optional(v.number()),
  sourceDocumentIds: v.optional(v.array(v.id("documents"))),
  sourceExternalIds: v.optional(v.array(v.string())),
};

function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined) out[k] = val;
  return out;
}

// ----- shared write helpers (reused by the dual-write hooks) ----------------

/** Insert a motion row, defaulting status to Draft and stamping timestamps.
 *  Returns the new id. */
export async function insertMotion(ctx: any, input: Record<string, any>) {
  const now = new Date().toISOString();
  return await ctx.db.insert("motions", {
    ...stripUndefined(input),
    status: input.status ?? "Draft",
    createdAtISO: now,
    updatedAtISO: now,
  });
}

/** Patch a motion row, dropping undefined keys and stamping updatedAtISO. */
export async function patchMotion(ctx: any, motionId: any, patch: Record<string, any>) {
  await ctx.db.patch(motionId, {
    ...stripUndefined(patch),
    updatedAtISO: new Date().toISOString(),
  });
  return motionId;
}

// ----- dual-write: mirror embedded minutes.motions[] into the table ---------

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
export function statusFromEmbeddedOutcome(raw?: string): { status: string; outcome?: string } {
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
  ctx: any,
  args: { societyId: any; minutesId: any; meetingId?: any; motions?: any[] },
) {
  // Best-effort: a mirror failure must never roll back the minutes save that
  // triggered it. A stale mirror is corrected by the step-2 backfill or the
  // next edit; a broken minutes save is a user-facing regression.
  try {
    const existing = await ctx.db
      .query("motions")
      .withIndex("by_minutes", (q: any) => q.eq("minutesId", args.minutesId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const now = new Date().toISOString();
    for (const m of args.motions ?? []) {
      const { status, outcome } = statusFromEmbeddedOutcome(m.outcome);
      const note = KNOWN_EMBEDDED_OUTCOMES.has(String(m.outcome ?? "").trim().toLowerCase())
        ? undefined
        : `legacy outcome: ${m.outcome}`;
      await ctx.db.insert(
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
          votesFor: m.votesFor,
          votesAgainst: m.votesAgainst,
          abstentions: m.abstentions,
          sectionIndex: m.sectionIndex,
          sectionTitle: m.sectionTitle,
          motionTemplateId: m.motionTemplateId,
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
    }
  } catch (err) {
    console.warn(
      `[motions] dual-write sync failed for minutes ${String(args.minutesId)}: ${String(err)}`,
    );
  }
}

// ----- queries --------------------------------------------------------------

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx: any, { societyId }: any) =>
    ctx.db
      .query("motions")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect(),
});

export const listForMinutes = query({
  args: { minutesId: v.id("minutes") },
  returns: v.any(),
  handler: async (ctx: any, { minutesId }: any) =>
    ctx.db
      .query("motions")
      .withIndex("by_minutes", (q: any) => q.eq("minutesId", minutesId))
      .collect(),
});

export const listForMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx: any, { meetingId }: any) =>
    ctx.db
      .query("motions")
      .withIndex("by_meeting", (q: any) => q.eq("primaryMeetingId", meetingId))
      .collect(),
});

// Backlog list = motions parked before/around a meeting. Folds in the old
// motionBacklog query surface; the "backlog" is just a status filter now.
const BACKLOG_STATUSES = new Set(["Backlog", "Tabled", "Deferred"]);
export const backlog = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx: any, { societyId }: any) => {
    const rows = await ctx.db
      .query("motions")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    return rows.filter((r: any) => BACKLOG_STATUSES.has(r.status));
  },
});

// ----- mutations ------------------------------------------------------------

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    text: v.string(),
    status: v.optional(v.string()),
    ...motionContent,
  },
  returns: v.any(),
  handler: async (ctx: any, args: any) => insertMotion(ctx, args),
});

export const update = mutation({
  args: {
    motionId: v.id("motions"),
    patch: v.object({
      text: v.optional(v.string()),
      status: v.optional(v.string()),
      ...motionContent,
    }),
  },
  returns: v.any(),
  handler: async (ctx: any, { motionId, patch }: any) => patchMotion(ctx, motionId, patch),
});

/** Set an explicit, overridable status (and optional outcome), appending a
 *  history entry so the cross-meeting trail is preserved (see "Votes Model A +
 *  History" in the design doc). */
export const setStatus = mutation({
  args: {
    motionId: v.id("motions"),
    status: v.string(),
    outcome: v.optional(v.string()),
    manual: v.optional(v.boolean()),
    meetingId: v.optional(v.id("meetings")),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx: any, { motionId, status, outcome, manual, meetingId, note }: any) => {
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
  },
});

export const recordVote = mutation({
  args: {
    motionId: v.id("motions"),
    votesFor: v.optional(v.number()),
    votesAgainst: v.optional(v.number()),
    abstentions: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx: any, { motionId, votesFor, votesAgainst, abstentions }: any) =>
    patchMotion(ctx, motionId, { votesFor, votesAgainst, abstentions }),
});

export const remove = mutation({
  args: { motionId: v.id("motions") },
  returns: v.any(),
  handler: async (ctx: any, { motionId }: any) => {
    await ctx.db.delete(motionId);
    return null;
  },
});

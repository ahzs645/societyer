/**
 * PORTABLE FUNCTIONS: the motion-backlog domain
 * (list / suggestForMeeting / create / update / remove /
 *  createFromMinutesMotion / createFromMinutesSection / seedPipaSetup /
 *  addToAgenda / carryForwardToMeeting / seedToMinutes).
 *
 * The `motionBacklog` table has been retired (see
 * docs/motions-first-class-object-design.md). A "backlog item" is now just a row
 * in the first-class `motions` table with an early lifecycle status. These
 * handlers read/write the `motions` (and `agendas` / `agendaItems` / `minutes`)
 * tables over `ctx.db`. `insertMotion` / `patchMotion` are portable copies of
 * `convex/motions.ts`'s write helpers (they only touch `ctx.db`, so they live
 * here rather than reaching into the Convex-typed module). Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  applyProceduralTags,
  classifyProceduralMotion,
} from "../proceduralMotions";
import { resolveMinutesMotions, syncMotionsForMinutes } from "./minutes";

// Lifecycle statuses that make a motion show up in the backlog UI.
const BACKLOG_STATUSES = new Set(["Backlog", "Tabled", "Deferred", "Agenda"]);

const PIPA_SETUP_MOTIONS = [
  {
    seededKey: "pipa-designate-privacy-officer",
    title: "Designate privacy officer",
    motionText:
      "BE IT RESOLVED THAT the Society designate [role or name] as privacy officer for purposes of privacy questions, access requests, correction requests, complaints, and privacy-program upkeep, and that the privacy officer maintain a monitored privacy contact address.",    priority: "high",
    notes: "Use once the role/name and monitored email address are known.",
  },
  {
    seededKey: "pipa-adopt-privacy-policy",
    title: "Adopt PIPA privacy policy and complaint process",
    motionText:
      "BE IT RESOLVED THAT the Society adopt the PIPA privacy policy, privacy practices, access and correction process, complaint process, safeguards, and retention approach presented to the meeting, effective [date], and authorize the privacy officer to maintain the working copy and evidence record.",    priority: "high",
    notes: "Use after the draft policy has been reviewed and is ready for approval.",
  },
  {
    seededKey: "pipa-member-data-gap-memo",
    title: "Approve member-data access gap memo",
    motionText:
      "BE IT RESOLVED THAT the Society approve the member-data access gap memo presented to the meeting, recording which member or eligibility records are controlled by the Society, which records are held by the university or other institution, and how privacy and records requests will be handled.",    priority: "normal",
    notes: "Useful where the university or parent body does not share the full member list.",
  },
  {
    seededKey: "pipa-training-review-cycle",
    title: "Set annual privacy and CASL training review",
    motionText:
      "BE IT RESOLVED THAT the Society establish an annual privacy and CASL training review for directors, officers, staff, and volunteers with access to personal information or electronic communications systems, and that completion evidence be kept with the Society's privacy records.",    priority: "normal",
    notes: "Use if the society wants the training cadence approved as part of setup.",
  },
];

// ----- portable motions write helpers (copied from convex/motions.ts) -------

function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined) out[k] = val;
  return out;
}

/** Stamp a motion's procedural classification onto an input record without
 *  overwriting values the caller set explicitly. */
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

// Shape a motions row into the backlog-item shape the frontend still reads
// (status / priority / motionText / notes), so the api.motionBacklog.list
// contract is preserved after the table merge.
function toBacklogItem(motion: any) {
  return {
    ...motion,
    motionText: motion.text ?? "",
    priority: motion.backlogPriority,
  };
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows
    .filter((row) => BACKLOG_STATUSES.has(String(row.status ?? "Backlog")))
    .map(toBacklogItem)
    .sort(compareBacklogItems);
}

// Tabled / deferred / unscheduled motions worth pulling onto a meeting's
// agenda as "unfinished business". Motions already planned for THIS meeting
// (targetMeetingId) rank first; motions already linked to one of this meeting's
// agendas are excluded so a suggestion never duplicates what's on the agenda.
const SUGGESTIBLE_STATUSES = new Set(["Backlog", "Tabled", "Deferred"]);
export async function suggestForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) return [];

  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  const linkedMotionIds = new Set<string>();
  for (const agenda of agendas) {
    const items = await ctx.db
      .query("agendaItems")
      .withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id))
      .collect();
    items.forEach((item) => {
      if (item.motionId) linkedMotionIds.add(String(item.motionId));
    });
  }

  const rows = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", meeting.societyId))
    .collect();
  return rows
    .filter((row) => SUGGESTIBLE_STATUSES.has(String(row.status ?? "Backlog")))
    .filter((row) => !linkedMotionIds.has(String(row._id)))
    .map((row) => ({
      ...toBacklogItem(row),
      isPlanned: String(row.targetMeetingId ?? "") === String(meetingId),
    }))
    .sort(
      (a: any, b: any) =>
        (a.isPlanned === b.isPlanned ? 0 : a.isPlanned ? -1 : 1) ||
        compareBacklogItems(a, b),
    );
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    motionText: string;
    tags?: string[];
    priority?: string;
    source?: string;
    notes?: string;
  },
) {
  return insertMotion(ctx, {
    societyId: args.societyId,
    title: args.title,
    text: args.motionText,
    // Free-form tags replaced the old fixed "category" enum; category is no
    // longer written to motion rows (Phase 4E). Procedural tags are merged by
    // insertMotion.
    tags: args.tags,
    status: "Backlog",
    backlogPriority: args.priority ?? "normal",
    source: args.source ?? "manual",
    notes: args.notes,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { backlogId, motionText, priority, ...rest }: {
    backlogId: string;
    title?: string;
    motionText?: string;    status?: string;
    priority?: string;
    notes?: string;
  },
) {
  const patch: Record<string, unknown> = { ...rest };
  if (motionText !== undefined) patch.text = motionText;
  if (priority !== undefined) patch.backlogPriority = priority;
  await patchMotion(ctx, backlogId, patch);
  return backlogId;
}

export async function removePortable(ctx: PortableMutationCtx, { backlogId }: { backlogId: string }) {
  await ctx.db.delete(backlogId);
}

export async function createFromMinutesMotionPortable(
  ctx: PortableMutationCtx,
  args: {
    minutesId: string;
    motionIndex: number;
    title?: string;    priority?: string;
    notes?: string;
  },
) {
  const minutes = await ctx.db.get(args.minutesId);
  if (!minutes) throw new Error("Minutes not found.");
  // Index into the RESOLVED motions (snapshots for approved, table rows for
  // drafts) — the same list the frontend indexed to produce `motionIndex`, so
  // the positional basis matches and this survives the embedded array being
  // dropped in Phase 4. See docs/motions-migration-finish-scope.md.
  const resolvedMotions = await resolveMinutesMotions(ctx, minutes);
  const motion = resolvedMotions[args.motionIndex];
  if (!motion?.text) throw new Error("Motion not found.");

  const existing = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", minutes.societyId))
    .collect();
  const duplicate = existing.find((item) =>
    String(item.sourceMinutesId ?? "") === String(args.minutesId) &&
    item.sourceMotionIndex === args.motionIndex
  );
  if (duplicate) return { backlogId: duplicate._id, reused: true };

  const meeting = await ctx.db.get(minutes.meetingId);
  const backlogId = await insertMotion(ctx, {
    societyId: minutes.societyId,
    title: args.title?.trim() || summarizeMotionTitle(motion.text),
    text: motion.text,    status: "Deferred",
    backlogPriority: args.priority ?? "normal",
    source: "minutes-motion",
    notes: [
      meeting ? `Carried forward from ${meeting.title}.` : "Carried forward from meeting minutes.",
      motion.outcome ? `Recorded outcome: ${motion.outcome}.` : "",
      args.notes,
    ].filter(Boolean).join(" "),
    sourceMinutesId: args.minutesId,
    sourceMotionIndex: args.motionIndex,
  });
  return { backlogId, reused: false };
}

export async function createFromMinutesSectionPortable(
  ctx: PortableMutationCtx,
  args: {
    minutesId: string;
    sectionIndex: number;
    title?: string;
    motionText?: string;    priority?: string;
    notes?: string;
  },
) {
  const minutes = await ctx.db.get(args.minutesId);
  if (!minutes) throw new Error("Minutes not found.");
  const section = Array.isArray(minutes.sections) ? minutes.sections[args.sectionIndex] : undefined;
  if (!section?.title) throw new Error("Minutes section not found.");

  const existing = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", minutes.societyId))
    .collect();
  const duplicate = existing.find((item) =>
    String(item.sourceMinutesId ?? "") === String(args.minutesId) &&
    item.sourceSectionIndex === args.sectionIndex
  );
  if (duplicate) return { backlogId: duplicate._id, reused: true };

  const meeting = await ctx.db.get(minutes.meetingId);
  const sectionNotes = [
    section.discussion,
    ...(section.decisions ?? []).map((decision: string) => `Decision: ${decision}`),
    ...(section.actionItems ?? []).map((item: any) => `Action: ${item.assignee ? `${item.assignee}: ` : ""}${item.text}`),
  ].filter(Boolean).join(" ");
  const title = args.title?.trim() || section.title;
  const backlogId = await insertMotion(ctx, {
    societyId: minutes.societyId,
    title,
    text: args.motionText?.trim() || `Discuss and decide next steps for ${title}.`,    status: "Deferred",
    backlogPriority: args.priority ?? "normal",
    source: "minutes-section",
    notes: [
      meeting ? `Carried forward from ${meeting.title}.` : "Carried forward from meeting minutes.",
      sectionNotes,
      args.notes,
    ].filter(Boolean).join(" "),
    sourceMinutesId: args.minutesId,
    sourceSectionIndex: args.sectionIndex,
  });
  return { backlogId, reused: false };
}

export async function seedPipaSetupPortable(ctx: PortableMutationCtx, { societyId }: { societyId: string }) {
  const existing = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const existingKeys = new Set(existing.map((row) => row.seededKey).filter(Boolean));
  let inserted = 0;
  for (const motion of PIPA_SETUP_MOTIONS) {
    if (existingKeys.has(motion.seededKey)) continue;
    await insertMotion(ctx, {
      societyId,
      title: motion.title,
      text: motion.motionText,
      status: "Backlog",
      backlogPriority: motion.priority,
      source: "pipa-setup",
      seededKey: motion.seededKey,
      notes: motion.notes,
    });
    inserted++;
  }
  return { inserted, existing: PIPA_SETUP_MOTIONS.length - inserted };
}

export async function addToAgendaPortable(
  ctx: PortableMutationCtx,
  { backlogId, agendaId }: { backlogId: string; agendaId: string },
) {
  const [backlogItem, agenda] = await Promise.all([
    ctx.db.get(backlogId),
    ctx.db.get(agendaId),
  ]);
  if (!backlogItem) throw new Error("Backlog motion not found.");
  if (!agenda) throw new Error("Agenda not found.");
  if (backlogItem.societyId !== agenda.societyId) {
    throw new Error("Backlog motion and agenda must belong to the same society.");
  }

  const existingItems = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  const duplicate = existingItems.find((item) => String(item.motionId ?? "") === String(backlogId));
  if (duplicate) {
    await patchMotion(ctx, backlogId, {
      status: "Agenda",
      targetMeetingId: agenda.meetingId,
      agendaId,
      agendaItemId: duplicate._id,
    });
    return { agendaItemId: duplicate._id, reused: true };
  }

  const now = new Date().toISOString();
  const agendaItemId = await ctx.db.insert("agendaItems", {
    societyId: agenda.societyId,
    agendaId,
    order: existingItems.length,
    type: "motion",
    title: backlogItem.title,
    details: backlogItem.notes,
    motionId: backlogId,
    motionText: backlogItem.text,
    createdAtISO: now,
  });
  await patchMotion(ctx, backlogId, {
    status: "Agenda",
    targetMeetingId: agenda.meetingId,
    agendaId,
    agendaItemId,
  });
  return { agendaItemId, reused: false };
}

// Create backlog motions for a set of (deferred/tabled) motions in a source
// meeting's minutes and link them onto a target meeting's agenda in one shot.
// Used by "Schedule next meeting" so unfinished business becomes tracked motion
// rows AND agenda items on the new meeting. Idempotent: deduped by source
// minutes+motion index (motion row) and by motionId (agenda item).
export async function carryForwardToMeetingPortable(
  ctx: PortableMutationCtx,
  { meetingId, sourceMinutesId, motionIndexes }: {
    meetingId: string;
    sourceMinutesId: string;
    motionIndexes: number[];
  },
) {
  const minutes = await ctx.db.get(sourceMinutesId);
  if (!minutes) throw new Error("Source minutes not found.");
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) throw new Error("Target meeting not found.");
  if (meeting.societyId !== minutes.societyId) {
    throw new Error("Meeting and minutes must belong to the same society.");
  }
  const sourceMeeting = await ctx.db.get(minutes.meetingId);
  const now = new Date().toISOString();

  // Resolve (or create) the target meeting's agenda.
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a, b) => String(a.createdAtISO).localeCompare(String(b.createdAtISO)));
  let agendaId = agendas[0]?._id;
  if (!agendaId) {
    agendaId = await ctx.db.insert("agendas", {
      societyId: meeting.societyId,
      meetingId,
      title: `${meeting.title} agenda`,
      status: "Draft",
      createdAtISO: now,
      updatedAtISO: now,
    });
  }

  const existingBacklog = await ctx.db
    .query("motions")
    .withIndex("by_society", (q) => q.eq("societyId", minutes.societyId))
    .collect();
  // Track agenda items for this agenda so order/dedupe stay correct as we add.
  const agendaItems = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  const linkedMotionIds = new Set(
    agendaItems.map((item) => String(item.motionId ?? "")).filter(Boolean),
  );
  let order = agendaItems.length;

  // Resolve from the single source of truth (snapshots for approved, table rows
  // for drafts) so `motionIndexes` line up with the list the frontend indexed
  // and the read survives Phase 4. See docs/motions-migration-finish-scope.md.
  const motions = await resolveMinutesMotions(ctx, minutes);
  let created = 0;
  let reused = 0;
  for (const motionIndex of motionIndexes) {
    const motion = motions[motionIndex];
    if (!motion?.text) continue;

    // 1. Motion row — dedupe by source minutes + motion index.
    const existing = existingBacklog.find((item) =>
      String(item.sourceMinutesId ?? "") === String(sourceMinutesId) &&
      item.sourceMotionIndex === motionIndex
    );
    const title = existing?.title || summarizeMotionTitle(motion.text);
    let backlogId = existing?._id;
    if (!backlogId) {
      backlogId = await insertMotion(ctx, {
        societyId: minutes.societyId,
        title,
        text: motion.text,
        status: "Deferred",
        backlogPriority: "normal",
        source: "minutes-motion",
        notes: [
          sourceMeeting ? `Carried forward from ${sourceMeeting.title}.` : "Carried forward from meeting minutes.",
          motion.outcome ? `Recorded outcome: ${motion.outcome}.` : "",
        ].filter(Boolean).join(" "),
        sourceMinutesId,
        sourceMotionIndex: motionIndex,
      });
    }

    // 2. Link it onto the target agenda — dedupe by motionId.
    let agendaItemId: any;
    if (linkedMotionIds.has(String(backlogId))) {
      const dup = agendaItems.find((item) => String(item.motionId ?? "") === String(backlogId));
      agendaItemId = dup?._id;
      reused += 1;
    } else {
      agendaItemId = await ctx.db.insert("agendaItems", {
        societyId: meeting.societyId,
        agendaId,
        order,
        type: "motion",
        title,
        motionId: backlogId,
        motionText: motion.text,
        createdAtISO: now,
      });
      order += 1;
      linkedMotionIds.add(String(backlogId));
      created += 1;
    }

    await patchMotion(ctx, backlogId, {
      status: "Agenda",
      targetMeetingId: meetingId,
      agendaId,
      agendaItemId,
    });
  }

  return { created, reused, agendaId };
}

export async function seedToMinutesPortable(ctx: PortableMutationCtx, { meetingId }: { meetingId: string }) {
  const minutesRows = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  const minutes = minutesRows[0];
  if (!minutes) {
    throw new Error("Create or generate minutes for this meeting before seeding backlog motions into minutes.");
  }

  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  const agendaItemsByAgenda = await Promise.all(
    agendas.map((agenda) =>
      ctx.db.query("agendaItems").withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id)).collect(),
    ),
  );
  const agendaItems = agendaItemsByAgenda
    .flat()
    .filter((item) => item.type === "motion" && item.motionId && item.motionText);

  // The agenda items reference existing backlog motion ROWS (item.motionId). Seed
  // them into the minutes by LINKING those rows — stamp minutesId + append to
  // minutes.motionIds — instead of copying text into the retired minutes.motions[]
  // (Phase 4C: the table is the single source of truth). Dedup by resolved text
  // and by already-linked id, so the linked row IS the minutes motion (no copy,
  // no duplicate in the master list).
  const existingMotions = await resolveMinutesMotions(ctx, minutes);
  const existingTexts = new Set(existingMotions.map((motion: any) => comparableMotionText(motion.text)));
  const existingIds = new Set((minutes.motionIds ?? []).map((id: any) => String(id)));
  const itemsToLink = agendaItems.filter(
    (item) =>
      !existingIds.has(String(item.motionId)) &&
      !existingTexts.has(comparableMotionText(item.motionText)),
  );

  // Materialize the minutes' current motions first when they haven't been (a
  // template/import minutes carries embedded motions but no motionIds), so
  // appending links never drops the existing ones.
  let motionIds: any[] = Array.isArray(minutes.motionIds) ? [...minutes.motionIds] : [];
  if (motionIds.length === 0 && existingMotions.length > 0) {
    await syncMotionsForMinutes(ctx, {
      societyId: minutes.societyId,
      minutesId: minutes._id,
      meetingId: minutes.meetingId,
      motions: existingMotions,
    });
    const refreshed: any = await ctx.db.get(minutes._id);
    motionIds = Array.isArray(refreshed?.motionIds) ? [...refreshed.motionIds] : [];
  }

  for (const item of itemsToLink) {
    // Seeded into a minutes draft but not yet voted — the closest unified
    // lifecycle stage is Draft.
    await patchMotion(ctx, item.motionId!, {
      status: "Draft",
      minutesId: minutes._id,
      primaryMeetingId: minutes.meetingId,
    });
    motionIds.push(item.motionId);
  }
  if (itemsToLink.length > 0) {
    await ctx.db.patch(minutes._id, { motionIds });
  }

  return { inserted: itemsToLink.length, considered: agendaItems.length, minutesId: minutes._id };
}

function compareBacklogItems(a: any, b: any) {
  return (
    statusRank(a.status) - statusRank(b.status) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    String(a.updatedAtISO ?? "").localeCompare(String(b.updatedAtISO ?? "")) * -1 ||
    String(a.title ?? "").localeCompare(String(b.title ?? ""))
  );
}

function statusRank(status: string | undefined) {
  const index = ["Backlog", "Agenda", "Draft", "Tabled", "Deferred", "Voted", "Archived"].indexOf(status ?? "Backlog");
  return index === -1 ? 99 : index;
}

function priorityRank(priority: string | undefined) {
  return priority === "high" ? 0 : priority === "normal" || !priority ? 1 : 2;
}

function comparableMotionText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(be it resolved that|resolved that|motion to|motion)\b[:\s-]*/gi, "")
    .trim();
}

function summarizeMotionTitle(value: unknown) {
  const text = comparableMotionText(value)
    .replace(/^(approve|adopt|authorize|accept|confirm)\s+/i, "")
    .trim();
  if (!text) return "Deferred motion";
  return text.length > 72 ? `${text.slice(0, 69).trim()}...` : text.charAt(0).toUpperCase() + text.slice(1);
}

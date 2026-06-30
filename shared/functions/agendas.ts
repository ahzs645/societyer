/**
 * PORTABLE FUNCTIONS: the agendas domain
 * (listForMeeting / getForMeeting / get / listForSociety / create /
 *  updateAgenda / remove / addItem / updateItem / syncForMeeting /
 *  startMinutesFromAgenda / removeItem / reorderItems).
 *
 * Reads/writes the `agendas` and `agendaItems` tables (plus `meetings`,
 * `minutes`, `motions`, `motionTemplates`) over `ctx.db`. `syncMotionsForMinutes`
 * is a portable copy of `convex/motions.ts`'s dual-write helper (it only touches
 * `ctx.db`, so it lives here rather than reaching into the Convex-typed module).
 * Each handler runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import {
  applyProceduralTags,
  classifyProceduralMotion,
  defaultDecidedByFor,
} from "../proceduralMotions";

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
async function syncMotionsForMinutes(
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
          decidedBy,
          proceduralKind: kind?.key,
          tags: tags.length ? tags : undefined,
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

export async function listForMeetingPortable(
  ctx: PortableQueryCtx,
  { meetingId }: { meetingId: string },
) {
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  return agendas;
}

export async function getForMeetingPortable(
  ctx: PortableQueryCtx,
  { meetingId }: { meetingId: string },
) {
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a, b) => a.createdAtISO.localeCompare(b.createdAtISO));
  const agenda = agendas[0] ?? null;
  if (!agenda) return null;
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id))
    .collect();
  items.sort((a, b) => a.order - b.order);
  return { agenda, items };
}

export async function getPortable(ctx: PortableQueryCtx, { agendaId }: { agendaId: string }) {
  const agenda = await ctx.db.get(agendaId);
  if (!agenda) return null;
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  items.sort((a, b) => a.order - b.order);
  return { agenda, items };
}

export async function listForSocietyPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  return await ctx.db
    .query("agendas")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

// ----- mutations ------------------------------------------------------------

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId: string;
    title: string;
    notes?: string;
  },
) {
  const now = new Date().toISOString();
  return await ctx.db.insert("agendas", {
    ...args,
    status: "Draft",
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updateAgendaPortable(
  ctx: PortableMutationCtx,
  { agendaId, ...patch }: {
    agendaId: string;
    title?: string;
    status?: string;
    notes?: string;
  },
) {
  const updatedAtISO = new Date().toISOString();
  const clean: Record<string, unknown> = { updatedAtISO };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  await ctx.db.patch(agendaId, clean);
  return agendaId;
}

export async function removePortable(ctx: PortableMutationCtx, { agendaId }: { agendaId: string }) {
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  for (const item of items) await ctx.db.delete(item._id);
  await ctx.db.delete(agendaId);
  return agendaId;
}

export async function addItemPortable(
  ctx: PortableMutationCtx,
  args: {
    agendaId: string;
    type: string;
    title: string;
    details?: string;
    presenter?: string;
    depth?: 0 | 1;
    timeAllottedMinutes?: number;
    motionTemplateId?: string;
    motionId?: string;
    motionText?: string;
  },
) {
  const agenda = await ctx.db.get(args.agendaId);
  if (!agenda) throw new Error("Agenda not found");
  const existing = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", args.agendaId))
    .collect();
  const order = existing.length;
  const now = new Date().toISOString();

  let motionText = args.motionText;
  if (args.motionTemplateId && !motionText) {
    const template = await ctx.db.get(args.motionTemplateId);
    if (template) {
      motionText = template.body;
      await ctx.db.patch(template._id, {
        usageCount: (template.usageCount ?? 0) + 1,
        updatedAtISO: now,
      });
    }
  }

  return await ctx.db.insert("agendaItems", {
    societyId: agenda.societyId,
    agendaId: args.agendaId,
    order,
    type: args.type,
    title: args.title,
    details: args.details,
    presenter: args.presenter,
    depth: args.depth,
    timeAllottedMinutes: args.timeAllottedMinutes,
    motionTemplateId: args.motionTemplateId,
    motionId: args.motionId,
    motionText,
    createdAtISO: now,
  });
}

export async function updateItemPortable(
  ctx: PortableMutationCtx,
  { itemId, ...patch }: {
    itemId: string;
    title?: string;
    details?: string;
    presenter?: string;
    depth?: 0 | 1;
    timeAllottedMinutes?: number;
    motionText?: string;
    outcome?: string;
  },
) {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  await ctx.db.patch(itemId, clean);
  return itemId;
}

export async function syncForMeetingPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    meetingId: string;
    title?: string;
    status?: string;
    items: Array<{
      title: string;
      depth?: 0 | 1;
      type?: string;
      details?: string;
      presenter?: string;
      timeAllottedMinutes?: number;
      motionTemplateId?: string;
      motionId?: string;
      motionText?: string;
    }>;
  },
) {
  const meeting = await ctx.db.get(args.meetingId);
  if (!meeting) throw new Error("Meeting not found");
  if (meeting.societyId !== args.societyId) throw new Error("Meeting belongs to a different society");

  const now = new Date().toISOString();
  const existingAgendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  existingAgendas.sort((a, b) => a.createdAtISO.localeCompare(b.createdAtISO));

  const agendaId = existingAgendas[0]?._id ?? await ctx.db.insert("agendas", {
    societyId: args.societyId,
    meetingId: args.meetingId,
    title: args.title || `${meeting.title} agenda`,
    status: "Draft",
    createdAtISO: now,
    updatedAtISO: now,
  });

  await ctx.db.patch(agendaId, {
    title: args.title || existingAgendas[0]?.title || `${meeting.title} agenda`,
    status: args.status || existingAgendas[0]?.status || "Draft",
    updatedAtISO: now,
  });

  const existingItems = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  existingItems.sort((a, b) => a.order - b.order);

  const unusedExisting = new Set(existingItems.map((item) => String(item._id)));
  const byTitle = new Map<string, any[]>();
  for (const item of existingItems) {
    const key = normalizeTitle(item.title);
    if (!key) continue;
    const rows = byTitle.get(key) ?? [];
    rows.push(item);
    byTitle.set(key, rows);
  }

  const usedIds = new Set<string>();
  for (let order = 0; order < args.items.length; order++) {
    const item = args.items[order];
    const title = item.title.trim();
    if (!title) continue;
    const key = normalizeTitle(title);
    const match = (byTitle.get(key) ?? []).find((candidate) => !usedIds.has(String(candidate._id)));
    let motionText = item.motionText;
    if (item.motionTemplateId && !motionText) {
      const template = await ctx.db.get(item.motionTemplateId);
      motionText = template?.body;
    }

    const payload: Record<string, unknown> = {
      societyId: args.societyId,
      agendaId,
      order,
      type: item.type || inferAgendaItemType(title),
      title,
      depth: item.depth === 1 ? 1 : 0,
      createdAtISO: now,
    };
    if (item.details !== undefined) payload.details = item.details;
    if (item.presenter !== undefined) payload.presenter = item.presenter;
    if (item.timeAllottedMinutes !== undefined) payload.timeAllottedMinutes = item.timeAllottedMinutes;
    if (item.motionTemplateId !== undefined) payload.motionTemplateId = item.motionTemplateId;
    if (item.motionId !== undefined) payload.motionId = item.motionId;
    if (motionText !== undefined) payload.motionText = motionText;

    if (match) {
      usedIds.add(String(match._id));
      unusedExisting.delete(String(match._id));
      const { createdAtISO: _createdAtISO, ...patch } = payload;
      await ctx.db.patch(match._id, patch);
    } else {
      const id = await ctx.db.insert("agendaItems", payload as any);
      usedIds.add(String(id));
    }
  }

  for (const itemId of unusedExisting) {
    await ctx.db.delete(itemId as any);
  }

  const savedItems = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  savedItems.sort((a, b) => a.order - b.order);
  await syncMeetingAndMinutesFromAgenda(ctx, meeting, savedItems, now);

  return agendaId;
}

export async function startMinutesFromAgendaPortable(
  ctx: PortableMutationCtx,
  { agendaId }: { agendaId: string },
) {
  const agenda = await ctx.db.get(agendaId);
  if (!agenda) throw new Error("Agenda not found");
  const meeting = await ctx.db.get(agenda.meetingId);
  if (!meeting) throw new Error("Meeting not found");
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agendaId))
    .collect();
  items.sort((a, b) => a.order - b.order);
  if (items.length === 0) throw new Error("Add agenda items before starting minutes.");

  const existing = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  if (existing[0]) {
    await syncMeetingAndMinutesFromAgenda(ctx, meeting, items, new Date().toISOString());
    return { minutesId: existing[0]._id, reused: true };
  }

  const attendees = Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds.map(String) : [];
  const minutesPayload: Record<string, unknown> = {
    societyId: meeting.societyId,
    meetingId: meeting._id,
    heldAt: meeting.scheduledAt,
    attendees,
    absent: [],
    quorumMet: meeting.quorumRequired == null ? false : attendees.length >= meeting.quorumRequired,
    discussion: "",
    sections: items.map(sectionFromAgendaItem),
    motions: motionsFromAgendaItems(items),
    decisions: [],
    actionItems: [],
  };
  if (meeting.quorumRequired !== undefined) minutesPayload.quorumRequired = meeting.quorumRequired;
  if (meeting.bylawRuleSetId !== undefined) minutesPayload.bylawRuleSetId = meeting.bylawRuleSetId;
  if (meeting.quorumRuleVersion !== undefined) minutesPayload.quorumRuleVersion = meeting.quorumRuleVersion;
  if (meeting.quorumRuleEffectiveFromISO !== undefined) minutesPayload.quorumRuleEffectiveFromISO = meeting.quorumRuleEffectiveFromISO;
  if (meeting.quorumSourceLabel !== undefined) minutesPayload.quorumSourceLabel = meeting.quorumSourceLabel;
  if (meeting.quorumComputedAtISO !== undefined) minutesPayload.quorumComputedAtISO = meeting.quorumComputedAtISO;

  const id = await ctx.db.insert("minutes", minutesPayload as any);
  await ctx.db.patch(meeting._id, {
    minutesId: id,
  });
  await syncMotionsForMinutes(ctx, {
    societyId: meeting.societyId,
    minutesId: id,
    meetingId: meeting._id,
    motions: minutesPayload.motions as any[],
  });
  return { minutesId: id, reused: false };
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase();
}

function inferAgendaItemType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve")) return "motion";
  if (lower.includes("report") || lower.includes("financial")) return "report";
  if (lower.includes("break")) return "break";
  if (lower.includes("camera") || lower.includes("closed") || lower.includes("executive")) return "executive_session";
  return "discussion";
}

function sectionFromAgendaItem(item: Record<string, any>) {
  const depth: 0 | 1 = item.depth === 1 ? 1 : 0;
  const section: Record<string, unknown> = {
    title: item.title,
    type: item.type || inferAgendaItemType(item.title),
    discussion: item.details ?? "",
    decisions: [],
    actionItems: [],
    depth,
  };
  if (item.presenter !== undefined) section.presenter = item.presenter;
  if (item.motionText !== undefined) section.motionText = item.motionText;
  if (item.motionTemplateId !== undefined) section.motionTemplateId = item.motionTemplateId;
  if (item.motionId !== undefined) section.motionId = item.motionId;
  return section;
}

function motionsFromAgendaItems(items: any[]) {
  return items
    .map((item, index) => {
      const motion: Record<string, unknown> = {
        text: String(item.motionText ?? "").trim(),
        outcome: "Pending",
        resolutionType: "Ordinary",
        sectionIndex: index,
        sectionTitle: item.title,
      };
      if (item.motionTemplateId !== undefined) motion.motionTemplateId = item.motionTemplateId;
      if (item.motionId !== undefined) motion.motionId = item.motionId;
      return motion;
    })
    .filter((motion) => motion.text);
}

async function syncMeetingAndMinutesFromAgenda(ctx: PortableMutationCtx, meeting: any, items: any[], now: string) {
  const rows = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  const minutes = rows[0];
  if (!minutes) return;

  const existingSections = Array.isArray(minutes.sections) ? minutes.sections : [];
  // Queue per-title so duplicate-titled sections each consume one matching
  // entry. Without this, multiple "New section" entries would all resolve to
  // the first section and the others would be silently overwritten with its
  // content (discussion, decisions, etc.), wiping out edits the user just
  // saved to sections 2+.
  const byTitle = new Map<string, any[]>();
  for (const section of existingSections) {
    const key = normalizeTitle(section?.title ?? "");
    if (!key) continue;
    const queue = byTitle.get(key) ?? [];
    queue.push(section);
    byTitle.set(key, queue);
  }
  const nextSections = items.map((item) => {
    const existing = byTitle.get(normalizeTitle(item.title))?.shift();
    const base = sectionFromAgendaItem(item);
    if (!existing) return base;
    const merged: Record<string, unknown> = {
      title: item.title,
      type: item.type || existing.type || base.type,
      discussion: existing.discussion || item.details || "",
      depth: item.depth === 1 ? 1 : 0,
    };
    if (existing.reportSubmitted !== undefined) merged.reportSubmitted = existing.reportSubmitted;
    if (Array.isArray(existing.decisions)) merged.decisions = existing.decisions;
    else merged.decisions = [];
    if (Array.isArray(existing.actionItems)) merged.actionItems = existing.actionItems.map(cleanActionItem);
    else merged.actionItems = [];
    if (Array.isArray(existing.linkedTaskIds)) merged.linkedTaskIds = existing.linkedTaskIds;
    if (item.presenter !== undefined) merged.presenter = item.presenter;
    else if (existing.presenter !== undefined) merged.presenter = existing.presenter;
    if (item.motionText !== undefined) merged.motionText = item.motionText;
    else if (existing.motionText !== undefined) merged.motionText = existing.motionText;
    if (item.motionTemplateId !== undefined) merged.motionTemplateId = item.motionTemplateId;
    else if (existing.motionTemplateId !== undefined) merged.motionTemplateId = existing.motionTemplateId;
    if (item.motionId !== undefined) merged.motionId = item.motionId;
    else if (existing.motionId !== undefined) merged.motionId = existing.motionId;
    // Editor-managed flag, never derived from agenda metadata. Preserve it so
    // saving a section with publicVisible:false isn't immediately reverted by
    // the agenda re-sync that runs from saveMinuteSections.
    if (existing.publicVisible !== undefined) merged.publicVisible = existing.publicVisible;
    return merged;
  });
  const nextTitles = new Set(items.map((item) => normalizeTitle(item.title)));
  for (const section of existingSections) {
    const key = normalizeTitle(section?.title ?? "");
    if (key && nextTitles.has(key)) continue;
    if (sectionHasDetails(section)) nextSections.push(cleanMinutesSection(section));
  }

  const existingMotions: any[] = Array.isArray(minutes.motions) ? minutes.motions.map(cleanMotion) : [];
  const agendaMotions = motionsFromAgendaItems(items);
  const agendaMotionKeys = new Set(agendaMotions.map((motion) => normalizeTitle(String(motion.text ?? ""))));
  const existingMotionByText = new Map<string, any>();
  for (const motion of existingMotions) {
    const key = normalizeTitle(motion?.text ?? "");
    if (key && !existingMotionByText.has(key)) existingMotionByText.set(key, motion);
  }
  const mergedAgendaMotions = agendaMotions.map((motion) => {
    const existing = existingMotionByText.get(normalizeTitle(String(motion.text ?? "")));
    return existing ? cleanMotion({ ...existing, sectionIndex: motion.sectionIndex, sectionTitle: motion.sectionTitle }) : cleanMotion(motion);
  });
  const preservedMotions = existingMotions.filter((motion: any) => {
    const key = normalizeTitle(motion?.text ?? "");
    return !agendaMotionKeys.has(key);
  });
  const nextMotions = [...mergedAgendaMotions, ...preservedMotions.map(cleanMotion)];
  await ctx.db.patch(minutes._id, {
    sections: nextSections,
    motions: nextMotions,
  });
  await syncMotionsForMinutes(ctx, {
    societyId: minutes.societyId,
    minutesId: minutes._id,
    meetingId: meeting._id,
    motions: nextMotions,
  });
}

function cleanMinutesSection(section: any) {
  const clean: Record<string, unknown> = {
    title: String(section?.title ?? ""),
    depth: section?.depth === 1 ? 1 : 0,
  };
  if (section?.type !== undefined) clean.type = section.type;
  if (section?.presenter !== undefined) clean.presenter = section.presenter;
  if (section?.discussion !== undefined) clean.discussion = section.discussion;
  if (section?.motionText !== undefined) clean.motionText = section.motionText;
  if (section?.motionTemplateId !== undefined) clean.motionTemplateId = section.motionTemplateId;
  if (section?.motionId !== undefined) clean.motionId = section.motionId;
  if (section?.reportSubmitted !== undefined) clean.reportSubmitted = section.reportSubmitted;
  if (Array.isArray(section?.decisions)) clean.decisions = section.decisions.map(String);
  if (Array.isArray(section?.actionItems)) clean.actionItems = section.actionItems.map(cleanActionItem);
  if (Array.isArray(section?.linkedTaskIds)) clean.linkedTaskIds = section.linkedTaskIds;
  if (section?.publicVisible !== undefined) clean.publicVisible = section.publicVisible;
  return clean;
}

function cleanActionItem(actionItem: any) {
  const clean: Record<string, unknown> = {
    text: String(actionItem?.text ?? ""),
    done: !!actionItem?.done,
  };
  if (actionItem?.assignee !== undefined) clean.assignee = actionItem.assignee;
  if (actionItem?.dueDate !== undefined) clean.dueDate = actionItem.dueDate;
  return clean;
}

function cleanMotion(motion: any) {
  const clean: Record<string, unknown> = {
    text: String(motion?.text ?? ""),
    outcome: String(motion?.outcome ?? "Pending"),
  };
  if (motion?.movedBy !== undefined) clean.movedBy = motion.movedBy;
  if (motion?.movedByMemberId !== undefined) clean.movedByMemberId = motion.movedByMemberId;
  if (motion?.movedByDirectorId !== undefined) clean.movedByDirectorId = motion.movedByDirectorId;
  if (motion?.secondedBy !== undefined) clean.secondedBy = motion.secondedBy;
  if (motion?.secondedByMemberId !== undefined) clean.secondedByMemberId = motion.secondedByMemberId;
  if (motion?.secondedByDirectorId !== undefined) clean.secondedByDirectorId = motion.secondedByDirectorId;
  if (motion?.votesFor !== undefined) clean.votesFor = motion.votesFor;
  if (motion?.votesAgainst !== undefined) clean.votesAgainst = motion.votesAgainst;
  if (motion?.abstentions !== undefined) clean.abstentions = motion.abstentions;
  if (motion?.resolutionType !== undefined) clean.resolutionType = motion.resolutionType;
  if (motion?.sectionIndex !== undefined) clean.sectionIndex = motion.sectionIndex;
  if (motion?.sectionTitle !== undefined) clean.sectionTitle = motion.sectionTitle;
  if (motion?.motionTemplateId !== undefined) clean.motionTemplateId = motion.motionTemplateId;
  if (motion?.motionId !== undefined) clean.motionId = motion.motionId;
  return clean;
}

function sectionHasDetails(section: any) {
  return !!(
    section?.discussion ||
    section?.presenter ||
    (section?.decisions ?? []).length ||
    (section?.actionItems ?? []).length ||
    (section?.linkedTaskIds ?? []).length
  );
}

export async function removeItemPortable(ctx: PortableMutationCtx, { itemId }: { itemId: string }) {
  const item = await ctx.db.get(itemId);
  if (!item) return;
  if (item.motionId) {
    await ctx.db.patch(item.motionId, {
      status: "Backlog",
      updatedAtISO: new Date().toISOString(),
    });
  }
  await ctx.db.delete(itemId);
  const siblings = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", item.agendaId))
    .collect();
  siblings.sort((a, b) => a.order - b.order);
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i].order !== i) {
      await ctx.db.patch(siblings[i]._id, { order: i });
    }
  }
}

export async function reorderItemsPortable(
  ctx: PortableMutationCtx,
  { agendaId, orderedItemIds }: {
    agendaId: string;
    orderedItemIds: string[];
  },
) {
  for (let i = 0; i < orderedItemIds.length; i++) {
    const item = await ctx.db.get(orderedItemIds[i]);
    if (!item || item.agendaId !== agendaId) continue;
    await ctx.db.patch(orderedItemIds[i], { order: i });
  }
  await ctx.db.patch(agendaId, { updatedAtISO: new Date().toISOString() });
}

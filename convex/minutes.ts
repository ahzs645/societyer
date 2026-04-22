import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { summarizeMinutes } from "./providers/llm";
import { buildQuorumSnapshot, QuorumSnapshot } from "./lib/bylawRules";
import { Doc } from "./_generated/dataModel";

const motion = v.object({
  text: v.string(),
  movedBy: v.optional(v.string()),
  movedByMemberId: v.optional(v.id("members")),
  movedByDirectorId: v.optional(v.id("directors")),
  secondedBy: v.optional(v.string()),
  secondedByMemberId: v.optional(v.id("members")),
  secondedByDirectorId: v.optional(v.id("directors")),
  outcome: v.string(),
  votesFor: v.optional(v.number()),
  votesAgainst: v.optional(v.number()),
  abstentions: v.optional(v.number()),
  resolutionType: v.optional(v.string()),
});

const actionItem = v.object({
  text: v.string(),
  assignee: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  done: v.boolean(),
});

const remoteParticipation = v.object({
  url: v.optional(v.string()),
  meetingId: v.optional(v.string()),
  passcode: v.optional(v.string()),
  instructions: v.optional(v.string()),
});

const detailedAttendance = v.object({
  name: v.string(),
  status: v.string(),
  roleTitle: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  memberIdentifier: v.optional(v.string()),
  proxyFor: v.optional(v.string()),
  quorumCounted: v.optional(v.boolean()),
  notes: v.optional(v.string()),
});

const minuteSection = v.object({
  title: v.string(),
  type: v.optional(v.string()),
  presenter: v.optional(v.string()),
  discussion: v.optional(v.string()),
  reportSubmitted: v.optional(v.boolean()),
  decisions: v.optional(v.array(v.string())),
  actionItems: v.optional(v.array(actionItem)),
});

const sessionSegment = v.object({
  type: v.string(),
  title: v.optional(v.string()),
  startedAt: v.optional(v.string()),
  endedAt: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const appendix = v.object({
  title: v.string(),
  type: v.optional(v.string()),
  reference: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const directorAppointment = v.object({
  name: v.string(),
  roleTitle: v.optional(v.string()),
  affiliation: v.optional(v.string()),
  term: v.optional(v.string()),
  consentRecorded: v.optional(v.boolean()),
  votesReceived: v.optional(v.number()),
  elected: v.optional(v.boolean()),
  status: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const specialResolutionExhibit = v.object({
  title: v.string(),
  reference: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const agmDetails = v.object({
  financialStatementsPresented: v.optional(v.boolean()),
  financialStatementsNotes: v.optional(v.string()),
  directorElectionNotes: v.optional(v.string()),
  directorAppointments: v.optional(v.array(directorAppointment)),
  specialResolutionExhibits: v.optional(v.array(specialResolutionExhibit)),
});

const structuredMinutesFields = {
  chairName: v.optional(v.string()),
  secretaryName: v.optional(v.string()),
  recorderName: v.optional(v.string()),
  calledToOrderAt: v.optional(v.string()),
  adjournedAt: v.optional(v.string()),
  remoteParticipation: v.optional(remoteParticipation),
  detailedAttendance: v.optional(v.array(detailedAttendance)),
  sections: v.optional(v.array(minuteSection)),
  nextMeetingAt: v.optional(v.string()),
  nextMeetingLocation: v.optional(v.string()),
  nextMeetingNotes: v.optional(v.string()),
  sessionSegments: v.optional(v.array(sessionSegment)),
  appendices: v.optional(v.array(appendix)),
  agmDetails: v.optional(agmDetails),
};

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("minutes")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const getByMeeting = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const rows = await ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();
    return rows[0] ?? null;
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    ...structuredMinutesFields,
    attendees: v.array(v.string()),
    absent: v.array(v.string()),
    quorumMet: v.boolean(),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    discussion: v.string(),
    motions: v.array(motion),
    decisions: v.array(v.string()),
    actionItems: v.array(actionItem),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    draftTranscript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("minutes"),
    patch: v.object({
      heldAt: v.optional(v.string()),
      ...structuredMinutesFields,
      attendees: v.optional(v.array(v.string())),
      absent: v.optional(v.array(v.string())),
      quorumMet: v.optional(v.boolean()),
      quorumRequired: v.optional(v.number()),
      bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
      quorumRuleVersion: v.optional(v.number()),
      quorumRuleEffectiveFromISO: v.optional(v.string()),
      quorumSourceLabel: v.optional(v.string()),
      quorumComputedAtISO: v.optional(v.string()),
      discussion: v.optional(v.string()),
      motions: v.optional(v.array(motion)),
      decisions: v.optional(v.array(v.string())),
      actionItems: v.optional(v.array(actionItem)),
      approvedAt: v.optional(v.string()),
      approvedInMeetingId: v.optional(v.id("meetings")),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      sourceExternalIds: v.optional(v.array(v.string())),
      draftTranscript: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const minutes = await ctx.db.get(id);
    if (!minutes) throw new Error("Minutes not found");
    if (patch.motions) {
      await assertMotionPersonLinksBelongToSociety(ctx, minutes.societyId, patch.motions);
    }
    await ctx.db.patch(id, patch);
  },
});

// Upsert a minutes row from an AI-generated draft (transcripts.runPipeline).
export const upsertFromDraft = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    heldAt: v.string(),
    ...structuredMinutesFields,
    attendees: v.array(v.string()),
    absent: v.array(v.string()),
    quorumMet: v.boolean(),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    discussion: v.string(),
    motions: v.array(motion),
    decisions: v.array(v.string()),
    actionItems: v.array(actionItem),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    sourceExternalIds: v.optional(v.array(v.string())),
    draftTranscript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
      return existing[0]._id;
    }
    const id = await ctx.db.insert("minutes", payload);
    await ctx.db.patch(args.meetingId, { minutesId: id });
    return id;
  },
});

export const backfillMotionPersonLinks = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
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
  },
});

export const backfillQuorumSnapshot = mutation({
  args: { id: v.id("minutes") },
  handler: async (ctx, { id }) => {
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
  },
});

export const generateDraft = action({
  args: {
    meetingId: v.id("meetings"),
    transcript: v.string(),
  },
  handler: async (ctx, { meetingId, transcript }) => {
    const meeting = await ctx.runQuery(api.meetings.get, { id: meetingId });
    if (!meeting) throw new Error("Meeting not found");

    const draft = await summarizeMinutes({
      transcript,
      meetingTitle: meeting.title,
      meetingType: meeting.type,
    });

    return await ctx.runMutation(api.minutes.upsertFromDraft, {
      societyId: meeting.societyId,
      meetingId,
      heldAt: meeting.scheduledAt,
      chairName: draft.chairName,
      secretaryName: draft.secretaryName,
      recorderName: draft.recorderName,
      calledToOrderAt: draft.calledToOrderAt,
      adjournedAt: draft.adjournedAt,
      remoteParticipation: draft.remoteParticipation,
      detailedAttendance: draft.detailedAttendance,
      attendees: draft.attendees.length ? draft.attendees : meeting.attendeeIds,
      absent: draft.absent,
      quorumMet: draft.attendees.length >= (meeting.quorumRequired ?? 0),
      discussion: draft.discussion,
      sections: draft.sections,
      motions: draft.motions,
      decisions: draft.decisions,
      actionItems: draft.actionItems,
      nextMeetingAt: draft.nextMeetingAt,
      nextMeetingLocation: draft.nextMeetingLocation,
      nextMeetingNotes: draft.nextMeetingNotes,
      sessionSegments: draft.sessionSegments,
      appendices: draft.appendices,
      agmDetails: draft.agmDetails,
      draftTranscript: transcript,
    });
  },
});

async function quorumSnapshotForMeeting(
  ctx: any,
  meeting: Doc<"meetings">,
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

async function assertMotionPersonLinksBelongToSociety(ctx: any, societyId: string, motions: any[]) {
  for (const motion of motions) {
    await assertPersonLinkBelongsToSociety(ctx, societyId, "members", motion.movedByMemberId, "movedByMemberId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "directors", motion.movedByDirectorId, "movedByDirectorId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "members", motion.secondedByMemberId, "secondedByMemberId");
    await assertPersonLinkBelongsToSociety(ctx, societyId, "directors", motion.secondedByDirectorId, "secondedByDirectorId");
  }
}

async function assertPersonLinkBelongsToSociety(
  ctx: any,
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

function resolveMotionPersonLink(value: unknown, members: any[], directors: any[]) {
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

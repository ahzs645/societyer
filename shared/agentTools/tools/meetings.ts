/** Meeting tools: list, read one with its minutes and motions, page its transcript. */
import { z } from "zod";
import {
  IN_CAMERA_TITLE,
  IN_CAMERA_TRANSCRIPT_LINE,
  TRANSCRIPT_READ_PERMISSION,
  TRANSCRIPT_WITHHELD_IN_CAMERA,
  inCameraFacts,
  isInCameraMotion,
  type InCameraFacts,
} from "../../minutesPrivacy";
import { speakerResolver, type TranscriptSpeaker } from "../../transcriptModel";
import { AgentToolError, READ_ANNOTATIONS, defineAgentTool, type AgentToolAdapter } from "../types";
import {
  UNTRUSTED_NOTICE,
  asRows,
  dateOnly,
  dateString,
  idOf,
  isRow,
  label,
  limitInput,
  matchesQuery,
  numberOrUndefined,
  page,
  untrusted,
  untrustedList,
  untrustedTextSchema,
  type Row,
} from "../output";

const can = (adapter: AgentToolAdapter, permission: string) => adapter.context.principal.permissions.includes(permission);

const meetingSummary = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string().optional(),
  status: z.string().optional(),
  scheduledAt: z.string().optional(),
  location: z.string().optional(),
  recordKind: z.string().optional(),
});

function summarizeMeeting(row: Row): z.infer<typeof meetingSummary> {
  return {
    id: idOf(row),
    title: label(row.title) ?? "Untitled meeting",
    type: label(row.type),
    status: label(row.status),
    scheduledAt: label(row.scheduledAt),
    location: label(row.location),
    recordKind: label(row.recordKind) ?? "minutes",
  };
}

export const listMeetings = defineAgentTool({
  name: "list_meetings",
  title: "List meetings",
  description: "List the workspace's meetings, newest first. Filter by date range, status or words in the title.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [{ name: "meetings:list", kind: "query" }],
  requires: ["meetings:read"],
  input: z.strictObject({
    from: dateString.optional().describe("Meetings on or after this date."),
    to: dateString.optional().describe("Meetings on or before this date."),
    status: z.string().max(40).optional().describe("Scheduled, Held, Cancelled…"),
    query: z.string().max(200).optional(),
    limit: limitInput(20, 50),
  }),
  async handler({ from, to, status, query, limit }, adapter) {
    const rows = asRows(await adapter.query("meetings:list", { societyId: adapter.context.workspace.id }))
      .filter((row) => !from || dateOnly(row.scheduledAt) >= from)
      .filter((row) => !to || dateOnly(row.scheduledAt) <= to)
      .filter((row) => !status || String(row.status).toLowerCase() === status.toLowerCase())
      .filter((row) => matchesQuery(query, [row.title, row.type, row.location]))
      .sort((a, b) => dateOnly(b.scheduledAt).localeCompare(dateOnly(a.scheduledAt)));
    const { items, total, truncated } = page(rows, limit);
    return { total, truncated, meetings: items.map(summarizeMeeting) };
  },
  output: z.object({ total: z.number(), truncated: z.boolean(), meetings: z.array(meetingSummary) }),
});

const MAX_SECTIONS = 40;
const MAX_MOTIONS = 40;
const MAX_ITEMS = 30;

const motionOutput = z.object({
  number: z.number(),
  title: z.string().optional(),
  text: untrustedTextSchema.optional(),
  outcome: z.string().optional(),
  movedBy: z.string().optional(),
  secondedBy: z.string().optional(),
  votes: z.object({ for: z.number().optional(), against: z.number().optional(), abstained: z.number().optional() }).optional(),
  sectionIndex: z.number().optional(),
  inCamera: z.boolean(),
});

function motionView(motion: Row, index: number, facts: InCameraFacts): z.infer<typeof motionOutput> {
  const votes = { for: numberOrUndefined(motion.votesFor), against: numberOrUndefined(motion.votesAgainst), abstained: numberOrUndefined(motion.abstentions) };
  return {
    number: index + 1,
    title: label(motion.name ?? motion.title),
    text: untrusted(motion.text, 1000),
    outcome: label(motion.outcome),
    movedBy: label(motion.movedBy),
    secondedBy: label(motion.secondedBy),
    ...(Object.values(votes).some((value) => value !== undefined) ? { votes } : {}),
    sectionIndex: numberOrUndefined(motion.sectionIndex),
    inCamera: motion.inCameraRedacted === true || isInCameraMotion(motion, facts),
  };
}

const minutesOutput = z.object({
  id: z.string(),
  status: z.enum(["approved", "draft"]),
  heldAt: z.string().optional(),
  approvedAt: z.string().optional(),
  attendees: z.array(z.string()),
  attendeeCount: z.number(),
  absentCount: z.number(),
  quorum: z.string().optional(),
  chair: z.string().optional(),
  secretary: z.string().optional(),
  discussion: untrustedTextSchema.optional(),
  sessions: z.array(z.object({ type: z.string(), title: z.string().optional(), startedAt: z.string().optional(), endedAt: z.string().optional() })),
  sections: z.array(z.object({
    index: z.number(),
    title: z.string(),
    type: z.string().optional(),
    inCamera: z.boolean(),
    discussion: untrustedTextSchema.optional(),
    decisions: z.array(untrustedTextSchema),
  })),
  decisions: z.array(untrustedTextSchema),
  actionItems: z.array(z.object({ text: untrustedTextSchema.optional(), assignee: z.string().optional(), dueDate: z.string().optional(), done: z.boolean() })),
  motions: z.array(motionOutput),
  inCameraRedacted: z.boolean(),
  truncated: z.boolean(),
});

function minutesView(minutes: Row): z.infer<typeof minutesOutput> {
  const sections = asRows(minutes.sections);
  const motions = asRows(minutes.displayMotions ?? minutes.motionSnapshots);
  const decisions = Array.isArray(minutes.decisions) ? minutes.decisions : [];
  const actionItems = asRows(minutes.actionItems);
  const attendees = Array.isArray(minutes.attendees) ? minutes.attendees : [];
  const facts = inCameraFacts(minutes);
  return {
    id: idOf(minutes),
    status: minutes.approvedAt ? "approved" : "draft",
    heldAt: label(minutes.heldAt),
    approvedAt: label(minutes.approvedAt),
    attendees: attendees.slice(0, 50).map((name) => label(name, 120)).filter((name): name is string => Boolean(name)),
    attendeeCount: attendees.length,
    absentCount: Array.isArray(minutes.absent) ? minutes.absent.length : 0,
    quorum: label(minutes.quorumStatus) ?? (typeof minutes.quorumMet === "boolean" ? (minutes.quorumMet ? "confirmed" : "not_met") : undefined),
    chair: label(minutes.chairName),
    secretary: label(minutes.secretaryName),
    discussion: untrusted(minutes.discussion, 4000),
    sessions: asRows(minutes.sessionSegments).slice(0, 10).map((segment) => ({
      type: label(segment.type) ?? "other",
      title: label(segment.title),
      startedAt: label(segment.startedAt),
      endedAt: label(segment.endedAt),
    })),
    sections: sections.slice(0, MAX_SECTIONS).map((section, index) => ({
      index,
      title: label(section.title) ?? `Item ${index + 1}`,
      type: label(section.type),
      inCamera: section.inCameraRedacted === true || facts.sectionIndexes.includes(index),
      discussion: untrusted(section.discussion, 1500),
      decisions: untrustedList(section.decisions, 10, 300),
    })),
    decisions: untrustedList(decisions, MAX_ITEMS, 300),
    actionItems: actionItems.slice(0, MAX_ITEMS).map((action) => ({
      text: untrusted(action.text, 300),
      assignee: label(action.assignee),
      dueDate: label(action.dueDate),
      done: action.done === true,
    })),
    motions: motions.slice(0, MAX_MOTIONS).map((motion, index) => motionView(motion, index, facts)),
    inCameraRedacted: minutes.inCameraRedacted === true,
    truncated: sections.length > MAX_SECTIONS || motions.length > MAX_MOTIONS || decisions.length > MAX_ITEMS || actionItems.length > MAX_ITEMS,
  };
}

export const getMeeting = defineAgentTool({
  name: "get_meeting",
  title: "Get meeting",
  description:
    "Read one meeting with its minutes (draft or approved), agenda sections, decisions, action items and motions. In-camera content is replaced by a placeholder unless your role may read it.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [
    { name: "meetings:get", kind: "query" },
    { name: "minutes:getByMeeting", kind: "query" },
  ],
  requires: ["meetings:read"],
  enrichesWith: ["minutes:read"],
  input: z.strictObject({ meetingId: z.string().min(1).max(100) }),
  async handler({ meetingId }, adapter) {
    const meeting = await adapter.query<unknown>("meetings:get", { id: meetingId });
    if (!isRow(meeting)) throw new AgentToolError("not_found", "Meeting not found.");
    const minutes = can(adapter, "minutes:read") ? await adapter.query<unknown>("minutes:getByMeeting", { meetingId }) : null;
    const view = isRow(minutes) ? minutesView(minutes) : null;
    return {
      notice: UNTRUSTED_NOTICE,
      meeting: summarizeMeeting(meeting),
      minutes: view,
      restricted: can(adapter, "minutes:read") ? [] : ["minutes"],
      ...(view?.inCameraRedacted ? { inCameraNotice: "This meeting had an in-camera session. Your role can't read it, so it shows as \"In-camera session — not shown\"." } : {}),
    };
  },
  output: z.object({
    notice: z.string(),
    meeting: meetingSummary,
    minutes: minutesOutput.nullable(),
    restricted: z.array(z.string()),
    inCameraNotice: z.string().optional(),
  }),
});

const MAX_SEGMENTS = 200;

const transcriptOutput = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    notice: z.string(),
    meetingId: z.string(),
    meetingTitle: z.string(),
    provider: z.string().optional(),
    durationSeconds: z.number().optional(),
    totalSegments: z.number(),
    matchingSegments: z.number(),
    page: z.object({ startIndex: z.number(), count: z.number(), nextStartIndex: z.number().nullable() }),
    speakers: z.array(z.object({ label: z.string(), name: z.string() })),
    segments: z.array(z.object({ index: z.number(), startSec: z.number(), endSec: z.number(), speaker: z.string(), text: untrustedTextSchema.optional(), inCamera: z.literal(true).optional() })),
    inCameraNotice: z.string().optional(),
  }),
  z.object({
    available: z.literal(false),
    meetingId: z.string(),
    meetingTitle: z.string(),
    reason: z.enum(["none", "in_camera"]),
    message: z.string(),
  }),
]);

export const getTranscript = defineAgentTool({
  name: "get_transcript",
  title: "Get meeting transcript",
  description:
    "Read a page of a meeting's working transcript with speaker names. Page with startIndex and limit, or narrow to a time range with fromSec and toSec. A transcript is draft evidence, not the official record.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [
    { name: "meetings:get", kind: "query" },
    { name: "transcripts:getByMeeting", kind: "query" },
  ],
  requires: ["meetings:read", "minutes:read"],
  // Decision A1: only people who keep the minutes read transcripts. A token's
  // scopes can't grant it; the creator's role must hold it.
  requiresRole: [TRANSCRIPT_READ_PERMISSION],
  input: z.strictObject({
    meetingId: z.string().min(1).max(100),
    startIndex: z.number().int().min(0).max(100_000).default(0).describe("First segment to return, counted within the matching segments."),
    limit: limitInput(50, MAX_SEGMENTS),
    fromSec: z.number().min(0).optional().describe("Only segments that end after this time."),
    toSec: z.number().min(0).optional().describe("Only segments that start before this time."),
    speaker: z.string().max(120).optional().describe("Only this speaker (name or raw label)."),
  }).refine((input) => input.fromSec === undefined || input.toSec === undefined || input.fromSec < input.toSec, "fromSec must be before toSec."),
  async handler({ meetingId, startIndex, limit, fromSec, toSec, speaker }, adapter) {
    const meeting = await adapter.query<unknown>("meetings:get", { id: meetingId });
    if (!isRow(meeting)) throw new AgentToolError("not_found", "Meeting not found.");
    const meetingTitle = label(meeting.title) ?? "Untitled meeting";
    const transcript = await adapter.query<unknown>("transcripts:getByMeeting", { meetingId });
    if (!isRow(transcript)) {
      return { available: false as const, meetingId, meetingTitle, reason: "none" as const, message: "This meeting has no working transcript." };
    }
    if (transcript.withheld === TRANSCRIPT_WITHHELD_IN_CAMERA) {
      return {
        available: false as const,
        meetingId,
        meetingTitle,
        reason: "in_camera" as const,
        message: "This meeting had an in-camera session that isn't marked in the recording, so its working transcript can't be shared here.",
      };
    }
    const speakers = asRows(transcript.speakers)
      .filter((row) => typeof row.label === "string")
      .map((row): TranscriptSpeaker => ({ label: String(row.label), name: label(row.name), mergedInto: label(row.mergedInto) }));
    const names = speakerResolver(speakers);
    const wanted = speaker?.trim().toLowerCase();
    const all = asRows(transcript.segments).map((segment, index) => ({
      index,
      startSec: numberOrUndefined(segment.startSec) ?? 0,
      endSec: numberOrUndefined(segment.endSec) ?? 0,
      label: String(segment.speaker ?? ""),
      text: segment.text,
      inCamera: segment.inCameraRedacted === true,
    }));
    const matching = all
      .filter((segment) => fromSec === undefined || segment.endSec > fromSec)
      .filter((segment) => toSec === undefined || segment.startSec < toSec)
      .filter((segment) => !wanted || names.name(segment.label).toLowerCase() === wanted || segment.label.toLowerCase() === wanted);
    const slice = matching.slice(startIndex, startIndex + limit);
    const next = startIndex + slice.length;
    const labels = [...new Set(all.filter((segment) => !segment.inCamera).map((segment) => names.resolve(segment.label)))];
    return {
      available: true as const,
      notice: UNTRUSTED_NOTICE,
      meetingId,
      meetingTitle,
      provider: label(transcript.provider),
      durationSeconds: numberOrUndefined(transcript.durationSeconds),
      totalSegments: all.length,
      matchingSegments: matching.length,
      page: { startIndex, count: slice.length, nextStartIndex: next < matching.length ? next : null },
      speakers: labels.slice(0, 50).map((raw) => ({ label: raw, name: names.name(raw) })),
      segments: slice.map((segment) => ({
        index: segment.index,
        startSec: segment.startSec,
        endSec: segment.endSec,
        ...(segment.inCamera
          ? { speaker: IN_CAMERA_TITLE, text: untrusted(IN_CAMERA_TRANSCRIPT_LINE, 100), inCamera: true as const }
          : { speaker: names.name(segment.label), text: untrusted(segment.text, 1000) }),
      })),
      ...(transcript.inCameraRedacted === true ? { inCameraNotice: `Parts recorded in camera are replaced by "${IN_CAMERA_TRANSCRIPT_LINE}".` } : {}),
    };
  },
  output: transcriptOutput,
});

/**
 * Meeting notes tools: the primitives of the meeting notes skill
 * (shared/ai/meetingNotesSkill.ts) for agents outside "Draft notes": read
 * who and what the meeting can be linked to, add action items assigned to
 * people, and name transcript speakers.
 *
 * Names and text are untrusted on the way out; ids go back in as given and
 * the portable handlers check every one belongs to this workspace.
 */
import { z } from "zod";
import { newNoteActionId, type NoteActionItem } from "../../meetingNoteActions";
import { TRANSCRIPT_READ_PERMISSION } from "../../minutesPrivacy";
import { AgentToolError, READ_ANNOTATIONS, defineAgentTool } from "../types";
import { UNTRUSTED_NOTICE, dateString, isRow, untrustedLabel, untrustedList, untrustedTextSchema, untrustedTitle } from "../output";

const id = z.string().trim().min(1).max(100);

export const getMeetingNotesContext = defineAgentTool({
  name: "get_meeting_notes_context",
  title: "Get meeting notes context",
  description:
    "Read what a meeting's notes can be linked to: the organization's people with their person ids and roles (attendees first), open goals, committees, and the transcript's speaker labels with sample lines. Use the ids with add_meeting_action_items and name_transcript_speakers.",
  kind: "read",
  annotations: READ_ANNOTATIONS,
  calls: [{ name: "meetings:notesSkillContext", kind: "query" }],
  // Each part of the context is gated on its own read permission in the handler.
  requires: ["meetings:read"],
  input: z.strictObject({ meetingId: id }),
  async handler({ meetingId }, adapter) {
    const context = await adapter.query<unknown>("meetings:notesSkillContext", { id: meetingId });
    if (!isRow(context)) throw new AgentToolError("not_found", "Meeting not found.");
    const rows = (value: unknown) => (Array.isArray(value) ? value.filter(isRow) : []);
    const meeting = isRow(context.meeting) ? context.meeting : {};
    return {
      notice: UNTRUSTED_NOTICE,
      meeting: { title: untrustedTitle(meeting.title, "Meeting"), date: typeof meeting.date === "string" ? meeting.date : undefined },
      people: rows(context.people).map((person) => ({
        personId: typeof person.id === "string" ? person.id : undefined,
        name: untrustedTitle(person.name, "Unnamed"),
        roles: untrustedList(person.roles, 4, 120),
        attendee: person.attendee === true || undefined,
      })),
      peopleOmitted: typeof context.peopleOmitted === "number" ? context.peopleOmitted : 0,
      goals: rows(context.goals).map((goal) => ({ goalId: String(goal.id), title: untrustedTitle(goal.title, "Untitled goal") })),
      committees: rows(context.committees).map((committee) => ({ committeeId: String(committee.id), name: untrustedTitle(committee.name, "Committee") })),
      speakers: rows(context.speakers).map((speaker) => ({
        label: String(speaker.label),
        name: untrustedLabel(speaker.name, 120),
        segments: Number(speaker.segments ?? 0),
        sample: untrustedList(speaker.sample, 3, 200),
      })),
    };
  },
  output: z.object({
    notice: z.string(),
    meeting: z.object({ title: untrustedTextSchema, date: z.string().optional() }),
    people: z.array(z.object({ personId: z.string().optional(), name: untrustedTextSchema, roles: z.array(untrustedTextSchema), attendee: z.literal(true).optional() })),
    peopleOmitted: z.number(),
    goals: z.array(z.object({ goalId: z.string(), title: untrustedTextSchema })),
    committees: z.array(z.object({ committeeId: z.string(), name: untrustedTextSchema })),
    speakers: z.array(z.object({ label: z.string(), name: untrustedTextSchema.optional(), segments: z.number(), sample: z.array(untrustedTextSchema) })),
  }),
});

export const addMeetingActionItems = defineAgentTool({
  name: "add_meeting_action_items",
  title: "Add meeting action items",
  description:
    "Add up to ten action items to a meeting that keeps notes, each optionally assigned to a person (personId from get_meeting_notes_context, or ownerName), with a due date, a goal and a committee. They appear on the meeting's Notes tab, where people turn them into tasks.",
  kind: "write",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
  calls: [
    { name: "meetings:get", kind: "query" },
    { name: "meetings:setNoteActionItems", kind: "mutation" },
  ],
  requires: ["meetings:read", "meetings:write"],
  writeMode: { remote: "draft", device: "approve", browser: "direct" },
  draftTitle: ({ items }) => (items.length === 1 ? `Add action item "${items[0].text.slice(0, 80)}"` : `Add ${items.length} meeting action items`),
  input: z.strictObject({
    meetingId: id,
    items: z
      .array(z.strictObject({
        text: z.string().trim().min(1).max(500),
        personId: id.optional(),
        ownerName: z.string().trim().max(120).optional(),
        dueDate: dateString.optional(),
        goalId: id.optional(),
        committeeId: id.optional(),
      }))
      .min(1, "items must contain between 1 and 10 entries.")
      .max(10, "items must contain between 1 and 10 entries."),
  }),
  async handler({ meetingId, items }, adapter) {
    const meeting = await adapter.query<unknown>("meetings:get", { id: meetingId });
    if (!isRow(meeting)) throw new AgentToolError("not_found", "Meeting not found.");
    const added: NoteActionItem[] = items.map((item) => ({
      id: newNoteActionId(),
      text: item.text,
      ...(item.ownerName ? { assignee: item.ownerName } : {}),
      ...(item.personId ? { assigneePersonId: item.personId } : {}),
      ...(item.dueDate ? { dueDate: item.dueDate } : {}),
      ...(item.goalId ? { goalId: item.goalId } : {}),
      ...(item.committeeId ? { committeeId: item.committeeId } : {}),
      done: false,
      status: "open",
      origin: "manual",
    }));
    // The handler refuses an id that isn't a record of this workspace.
    // Added to the list as it is on the server, so edits made meanwhile stay.
    await adapter.mutation("meetings:setNoteActionItems", { id: meetingId, ops: added.map((item) => ({ op: "add", item })) });
    adapter.context.browser?.navigate(`/app/meetings/${meetingId}?tab=notes`);
    return { added: added.map((item) => ({ id: item.id, text: item.text })), count: added.length };
  },
  output: z.object({ added: z.array(z.object({ id: z.string(), text: z.string() })), count: z.number() }),
});

export const nameTranscriptSpeakers = defineAgentTool({
  name: "name_transcript_speakers",
  title: "Name transcript speakers",
  description:
    "Name up to twenty speaker labels in a meeting's transcript (e.g. SPEAKER_01 is Marcus Oyelaran), linking each to a person when you have their personId. Only name a label with evidence in the transcript: a self-introduction, being addressed by name and answering, or a role only that person holds.",
  kind: "write",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: true },
  calls: [{ name: "transcripts:assignSpeaker", kind: "mutation" }],
  requires: ["meetings:write"],
  // Naming speakers means reading the transcript (decision A1).
  requiresRole: [TRANSCRIPT_READ_PERMISSION],
  writeMode: { remote: "draft", device: "approve", browser: "direct" },
  draftTitle: ({ speakers }) => (speakers.length === 1 ? `Name ${speakers[0].label} "${speakers[0].name.slice(0, 60)}"` : `Name ${speakers.length} transcript speakers`),
  input: z.strictObject({
    meetingId: id,
    speakers: z
      .array(z.strictObject({ label: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(120), personId: id.optional() }))
      .min(1, "speakers must contain between 1 and 20 entries.")
      .max(20, "speakers must contain between 1 and 20 entries."),
  }),
  async handler({ meetingId, speakers }, adapter) {
    for (const speaker of speakers) {
      await adapter.mutation("transcripts:assignSpeaker", {
        societyId: adapter.context.workspace.id,
        meetingId,
        label: speaker.label,
        name: speaker.name,
        ...(speaker.personId ? { personId: speaker.personId } : {}),
      });
    }
    adapter.context.browser?.navigate(`/app/meetings/${meetingId}?tab=transcript`);
    return { named: speakers.map((speaker) => ({ label: speaker.label, name: speaker.name })), count: speakers.length };
  },
  output: z.object({ named: z.array(z.object({ label: z.string(), name: z.string() })), count: z.number() }),
});

/**
 * PORTABLE FUNCTIONS: the AI notes draft and the action items of a meeting
 * that keeps notes. Hosted Convex (convex/meetings.ts) and the local runtimes
 * run these unchanged.
 *
 * The person's own notes (`meetings.workingNotes`) are never written here:
 * the draft is stored beside them in `meetings.notesDraft`.
 */
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow } from "./access";
import { requirePermissionPortable, type Permission } from "./permissions";
import { directoryPersonForSociety, listPortable as peopleListPortable } from "./peopleDirectory";
import { getByMeetingPortable as getTranscriptByMeetingPortable } from "./transcripts";
import { minutesForMeeting } from "./minutesPrivacy";
import { transcriptWithoutInCamera } from "../minutesPrivacy";
import { findTranscriptQuote, SKILL_CONTEXT_LIMITS, transcriptLines, type MeetingNotesSkillContext, type SkillPerson, type SkillSpeaker } from "../ai/meetingNotesSkill";
import { isNotesDraftTemplateId, normalizeNotesActionItems, normalizeNotesDraft, notesDraftTranscriptFromRow, type NotesDraftQuote } from "../ai/notesDraft";
import {
  isReplaceableSuggestion,
  mergeSuggestedActions,
  normalizeNoteActionItems,
  taskDraftFromNoteAction,
  type NoteActionItem,
} from "../meetingNoteActions";
import { taskCreate } from "./tasks";

const GENERATED_BY_MAX = 120;

/**
 * Saves a notes draft (from the hosted action or the on-device model) and
 * merges its suggested action items. The draft is untrusted model output, so
 * it is normalised again here, whatever the caller did.
 */
export async function saveNotesDraftPortable(
  ctx: PortableMutationCtx,
  args: {
    id: string;
    template: string;
    draft: unknown;
    generatedBy: string;
    usedNotes: boolean;
    usedTranscript: boolean;
    /** From the tool-calling skill: who each speaker label is, with the words that show it. */
    speakers?: unknown;
    /** From the tool-calling skill: people who took part. */
    attendees?: unknown;
  },
) {
  const meeting = await requireOwnedRow(ctx, "meetings", args.id);
  const societyId = String(meeting.societyId);
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  if (!isNotesDraftTemplateId(args.template)) throw new Error("Unknown notes template.");
  const empty = { template: args.template, summary: "", sections: [], decisions: [], openQuestions: [], actionItems: [] };
  const draft = normalizeNotesDraft(args.draft, empty);
  // Model output: a suggested link survives only if it names a record of this workspace.
  const owned = ownedChecker(ctx, societyId);
  const suggestions = await Promise.all(
    (normalizeNotesActionItems((args.draft as { actionItems?: unknown } | null)?.actionItems) ?? []).map(async (item) => ({
      ...item,
      assigneePersonId: await owned("peopleDirectory", item.assigneePersonId),
      goalId: await owned("goals", item.goalId),
      committeeId: await owned("committees", item.committeeId),
    })),
  );
  // Quotes are kept only if their words are in the transcript this person may
  // read (in-camera parts aside), with the speaker and time of that line.
  const quotes = draft.quotes?.length ? await verifiedQuotes(ctx, args.id, meeting.societyId, draft.quotes) : [];
  const speakerSuggestions = await normalizeSpeakerSuggestions(args.speakers, owned);
  const attendeeSuggestions = await normalizeAttendeeSuggestions(args.attendees, owned);
  if (!draft.summary && !draft.sections.length && !draft.decisions.length && !suggestions.length) {
    throw new Error("The draft came back empty. Add some notes or a transcript, then try again.");
  }
  const existing = (Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[];
  const { items, added } = mergeSuggestedActions(existing, suggestions);
  await ctx.db.patch(args.id, {
    notesDraft: {
      template: draft.template,
      summary: draft.summary,
      sections: draft.sections,
      decisions: draft.decisions,
      openQuestions: draft.openQuestions,
      ...(quotes.length ? { quotes } : {}),
      generatedAtISO: new Date().toISOString(),
      generatedBy: String(args.generatedBy ?? "").trim().slice(0, GENERATED_BY_MAX) || "AI",
      usedNotes: Boolean(args.usedNotes),
      usedTranscript: Boolean(args.usedTranscript),
      ...(speakerSuggestions.length ? { speakerSuggestions } : {}),
      ...(attendeeSuggestions.length ? { attendeeSuggestions } : {}),
    },
    noteActionItems: items.map(withoutUndefined),
  });
  return { actionItemsAdded: added, actionItems: items.length };
}

async function verifiedQuotes(ctx: PortableMutationCtx, meetingId: string, societyId: unknown, quotes: readonly NotesDraftQuote[]): Promise<NotesDraftQuote[]> {
  let text = "";
  try {
    const readable = await getTranscriptByMeetingPortable(ctx as unknown as PortableQueryCtx, { meetingId });
    text = readable ? notesDraftTranscriptFromRow(transcriptWithoutInCamera(readable, await minutesForMeeting(ctx as unknown as PortableQueryCtx, meetingId, societyId))) : "";
  } catch {
    text = "";
  }
  const lines = transcriptLines(text);
  if (!lines.length) return [];
  return quotes.flatMap((quote) => {
    const found = findTranscriptQuote(lines, quote.text, quote.atSec);
    if ("error" in found) return [];
    const { line } = found;
    return [{ text: quote.text, ...(line.speaker ? { speaker: line.speaker } : {}), ...(line.atSec !== undefined ? { atSec: line.atSec } : {}) }];
  });
}

type OwnedCheck = (table: "peopleDirectory" | "goals" | "committees", id: string | undefined) => Promise<string | undefined>;

function ownedChecker(ctx: PortableMutationCtx, societyId: string): OwnedCheck {
  return async (table, id) => {
    if (!id) return undefined;
    try {
      // Directory people can be shared records with no workspace id (local and desktop).
      if (table === "peopleDirectory") await directoryPersonForSociety(ctx, id, societyId);
      else await getOwned(ctx, table, id, societyId);
      return id;
    } catch {
      return undefined;
    }
  };
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

async function normalizeSpeakerSuggestions(value: unknown, owned: OwnedCheck) {
  if (!Array.isArray(value)) return [];
  const out: Array<{ label: string; name: string; personId?: string; evidence: string }> = [];
  for (const entry of value.slice(0, 60)) {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const label = text(row.label, 120);
    const name = text(row.name, 120);
    const evidence = text(row.evidence, 240);
    if (!label || !name || !evidence || out.some((item) => item.label === label)) continue;
    const personId = await owned("peopleDirectory", typeof row.personId === "string" ? row.personId : undefined);
    out.push({ label, name, ...(personId ? { personId } : {}), evidence });
  }
  return out;
}

async function normalizeAttendeeSuggestions(value: unknown, owned: OwnedCheck) {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name: string; personId?: string }> = [];
  for (const entry of value.slice(0, 200)) {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const name = text(row.name, 120);
    if (!name || out.some((item) => item.name.toLowerCase() === name.toLowerCase())) continue;
    const personId = await owned("peopleDirectory", typeof row.personId === "string" ? row.personId : undefined);
    out.push({ name, ...(personId ? { personId } : {}) });
  }
  return out;
}

/** Convex keeps a field sent as undefined out of the row; drop them so validators see absent fields. */
function withoutUndefined<T extends Record<string, unknown>>(item: T): T {
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as T;
}

/** Removes the draft and the suggestions nobody acted on. */
export async function discardNotesDraftPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const meeting = await requireOwnedRow(ctx, "meetings", id);
  await requirePermissionPortable(ctx, String(meeting.societyId), "meetings:write");
  const existing = (Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[];
  await ctx.db.patch(id, { notesDraft: undefined, noteActionItems: existing.filter((item) => !isReplaceableSuggestion(item)) });
  return null;
}

/** Replaces the action items list (add, edit, reorder, remove). */
/**
 * One change to the action items, applied to the list as it is now on the
 * server: two people (or two quick clicks) editing different items never
 * undo each other, and a task link set meanwhile is kept.
 */
export type NoteActionOp =
  | { op: "add"; item: NoteActionItem }
  | { op: "patch"; itemId: string; set?: Partial<NoteActionItem>; unset?: string[] }
  | { op: "remove"; itemId: string };

const PATCHABLE = new Set(["text", "assignee", "assigneePersonId", "dueDate", "done", "status", "goalId", "committeeId", "origin"]);

export function applyNoteActionOps(current: readonly NoteActionItem[], ops: readonly NoteActionOp[]): NoteActionItem[] {
  let items = [...current];
  for (const op of ops) {
    if (op.op === "add") {
      if (!items.some((item) => item.id === op.item.id)) items.push(op.item);
    } else if (op.op === "remove") {
      items = items.filter((item) => item.id !== op.itemId);
    } else if (op.op === "patch") {
      items = items.map((item) => {
        if (item.id !== op.itemId) return item;
        const next: Record<string, unknown> = { ...item };
        for (const [key, value] of Object.entries(op.set ?? {})) if (PATCHABLE.has(key) && value !== undefined) next[key] = value;
        for (const key of op.unset ?? []) if (PATCHABLE.has(key)) delete next[key];
        return next as NoteActionItem;
      });
    }
  }
  return items;
}

export async function setNoteActionItemsPortable(ctx: PortableMutationCtx, args: { id: string; items?: NoteActionItem[]; ops?: NoteActionOp[] }) {
  const { id } = args;
  const meeting = await requireOwnedRow(ctx, "meetings", id);
  const societyId = String(meeting.societyId);
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  const current = (Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[];
  if (!args.items && !args.ops) throw new Error("Send items or ops.");
  const items = args.ops ? applyNoteActionOps(current, args.ops) : args.items!;
  const normalized = normalizeNoteActionItems(items);
  const previous = new Map(current.map((item) => [item.id, item]));
  for (const item of normalized) {
    if (item.assigneePersonId) await directoryPersonForSociety(ctx, item.assigneePersonId, societyId);
    if (item.goalId) await getOwned(ctx, "goals", item.goalId, societyId);
    if (item.committeeId) await getOwned(ctx, "committees", item.committeeId, societyId);
    if (item.taskId && item.taskId !== previous.get(item.id)?.taskId) await getOwned(ctx, "tasks", item.taskId, societyId);
  }
  await ctx.db.patch(id, { noteActionItems: normalized });
  return null;
}

/**
 * "Create task" on a notes action item: one task linked to the meeting, the
 * item's transcript time, its goal, committee and assignee, and the item
 * linked back to the task, atomically. Idempotent: an item that already has
 * a task returns it.
 */
export async function createTaskFromNoteActionPortable(
  ctx: PortableMutationCtx,
  { id, itemId, priority }: { id: string; itemId: string; priority?: string },
) {
  const meeting = await requireOwnedRow(ctx, "meetings", id);
  const societyId = String(meeting.societyId);
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  await requirePermissionPortable(ctx, societyId, "tasks:write");
  const items = (Array.isArray(meeting.noteActionItems) ? meeting.noteActionItems : []) as NoteActionItem[];
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("That action item is no longer on this meeting.");
  if (item.taskId && (await ctx.db.get(item.taskId))) return { taskId: item.taskId, created: false };
  const draft = taskDraftFromNoteAction(item, { meetingTitle: String(meeting.title ?? "") });
  const taskId = await taskCreate(ctx, {
    societyId,
    title: draft.title,
    description: draft.description,
    status: draft.status,
    priority: priority && ["Low", "Medium", "High", "Urgent"].includes(priority) ? priority : draft.priority,
    assignee: draft.assignee,
    assigneePersonId: draft.assigneePersonId,
    sourceAssignee: draft.sourceAssignee,
    dueDate: draft.dueDate,
    meetingId: id,
    ...(draft.transcriptRef ? { transcriptRef: draft.transcriptRef } : {}),
    ...(draft.goalId ? { goalId: draft.goalId } : {}),
    ...(draft.committeeId ? { committeeId: draft.committeeId } : {}),
    tags: ["meeting-notes"],
  });
  await ctx.db.patch(id, {
    noteActionItems: items.map((entry) => (entry.id === itemId ? { ...entry, taskId, origin: "manual" as const } : entry)),
  });
  return { taskId, created: true };
}

// ---------------------------------------------------------------------------
// Context for the meeting notes skill (shared/ai/meetingNotesSkill.ts)
// ---------------------------------------------------------------------------

const ACTIVE_STATUS = /^(active|current|in office|elected|appointed)$/i;
const CLOSED_GOAL = /^(done|completed|complete|cancelled|canceled|archived|abandoned)$/i;
const INACTIVE_BODY = /inactive|dissolved|archived/i;

/**
 * What the model may know when it writes up this meeting: the people of the
 * organization (directory ids, names, aliases, roles), open goals, committees
 * and the transcript's speaker labels. Each register is included only when
 * the caller may read it (so it reveals nothing they couldn't read register by
 * register); the transcript only for people who keep the minutes,
 * with in-camera sessions withheld. Bounded by SKILL_CONTEXT_LIMITS.
 */
export async function notesSkillContextPortable(ctx: PortableQueryCtx, { id }: { id: string }): Promise<MeetingNotesSkillContext> {
  const meeting = await requireOwnedRow(ctx, "meetings", id);
  const societyId = String(meeting.societyId);
  // Each part below is gated on its own read permission, so the context never
  // reveals more than the caller could read register by register.
  await requirePermissionPortable(ctx, societyId, "meetings:read");
  // The caller's role AND, for a connector token, its scopes: a token scoped
  // to meetings:read gets no roster even when its creator's role could read one.
  const allowed = new Map<Permission, boolean>();
  for (const permission of ["members:read", "directors:read", "employees:read", "volunteers:read", "committees:read", "commitments:read"] as const) {
    allowed.set(permission, await requirePermissionPortable(ctx, societyId, permission).then(() => true, () => false));
  }
  const can = (permission: Permission) => allowed.get(permission) === true;
  const bySociety = (table: string) => ctx.db.query(table).withIndex("by_society", (q) => q.eq("societyId", societyId)).collect().catch(() => [] as PortableDoc[]);

  type Entry = SkillPerson & { rank: number };
  const entries = new Map<string, Entry>();
  const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const attendeeKeys = new Set((Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds : []).map((name: unknown) => nameKey(String(name))));
  // One entry per person: by directory id when known, else by name; a name
  // seen again (a staff record, an attendee) joins the entry already there.
  const byName = new Map<string, Entry>();
  const add = (person: { id?: string; name: string; aliases?: string[] }, role: string | undefined, rank: number) => {
    const name = String(person.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) return;
    const named = byName.get(nameKey(name));
    const existing = (person.id ? entries.get(`id:${person.id}`) : undefined) ?? (named && (!person.id || !named.id || named.id === person.id) ? named : undefined);
    const entry: Entry = existing ?? { name, roles: [], rank };
    if (person.id && !entry.id) {
      entry.id = person.id;
      entry.name = name;
    }
    if (person.aliases?.length) entry.aliases = [...new Set([...(entry.aliases ?? []), ...person.aliases])].slice(0, SKILL_CONTEXT_LIMITS.aliases);
    if (role && !entry.roles.includes(role) && entry.roles.length < SKILL_CONTEXT_LIMITS.roles) entry.roles.push(role);
    entry.rank = Math.min(entry.rank, rank);
    if (attendeeKeys.has(nameKey(name))) { entry.attendee = true; entry.rank = 0; }
    for (const [key, value] of entries) if (value === entry) entries.delete(key);
    entries.set(entry.id ? `id:${entry.id}` : `name:${nameKey(entry.name)}`, entry);
    byName.set(nameKey(name), entry);
    byName.set(nameKey(entry.name), entry);
  };

  // People directory: ids and aliases. Registers below add roles.
  const directoryById = new Map<string, PortableDoc>();
  if (can("members:read")) {
    for (const row of await peopleListPortable(ctx, { societyId })) {
      if (row.mergedIntoId) continue;
      directoryById.set(String(row._id), row);
    }
  }
  const directoryName = (personId: unknown) => (personId ? directoryById.get(String(personId)) : undefined);
  const linked = (personId: unknown, fallback: string) => {
    const row = directoryName(personId);
    return row ? { id: String(row._id), name: String(row.fullName), aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : undefined } : { name: fallback };
  };

  const committees = can("committees:read") ? (await bySociety("committees")).filter((row) => !INACTIVE_BODY.test(String(row.status ?? ""))) : [];
  const committeeName = new Map(committees.map((row) => [String(row._id), String(row.name)]));
  const meetingCommitteeId = meeting.committeeId ? String(meeting.committeeId) : undefined;
  if (can("committees:read")) {
    for (const committee of committees) {
      const rows = await ctx.db.query("committeeMembers").withIndex("by_committee", (q) => q.eq("committeeId", committee._id)).collect().catch(() => [] as PortableDoc[]);
      for (const row of rows) {
        if (row.status && !ACTIVE_STATUS.test(String(row.status))) continue;
        add(linked(row.personId, String(row.name)), `${committee.name}: ${row.role ?? "Member"}`, String(committee._id) === meetingCommitteeId ? 1 : 3);
      }
    }
  }
  if (can("directors:read")) {
    for (const row of await bySociety("directors")) {
      if (row.status && !ACTIVE_STATUS.test(String(row.status))) continue;
      add(linked(row.directoryPersonId, `${row.firstName} ${row.lastName}`), `Director: ${row.position ?? "Director"}`, 2);
    }
  }
  if (can("employees:read")) {
    const today = new Date().toISOString().slice(0, 10);
    for (const row of await bySociety("employees")) {
      if (row.endDate && String(row.endDate) < today) continue;
      add({ name: `${row.firstName} ${row.lastName}` }, `Staff: ${row.role ?? "Employee"}`, 2);
    }
  }
  if (can("volunteers:read")) {
    for (const row of await bySociety("volunteers")) {
      if (String(row.status ?? "") !== "Active") continue;
      add({ name: `${row.firstName} ${row.lastName}` }, `Volunteer${row.committeeId && committeeName.get(String(row.committeeId)) ? `: ${committeeName.get(String(row.committeeId))}` : ""}`, 4);
    }
  }
  if (can("members:read")) {
    for (const row of await bySociety("members")) {
      if (row.status && !ACTIVE_STATUS.test(String(row.status))) continue;
      add(linked(row.directoryPersonId, `${row.firstName} ${row.lastName}`), "Member", 5);
    }
    // Directory people with no register role (contacts, partners) come last.
    for (const row of directoryById.values()) add(linked(row._id, String(row.fullName)), undefined, 6);
  }
  // Attendees named on the meeting but nowhere else.
  for (const name of Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds : []) add({ name: String(name) }, undefined, 0);
  // Names given to transcript speakers that link to the directory.
  const sorted = [...entries.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const people = sorted.slice(0, SKILL_CONTEXT_LIMITS.people).map(({ rank: _rank, ...person }) => person);

  const goals = can("commitments:read")
    ? (await bySociety("goals")).filter((row) => !CLOSED_GOAL.test(String(row.status ?? ""))).slice(0, SKILL_CONTEXT_LIMITS.goals).map((row) => ({ id: String(row._id), title: String(row.title) }))
    : [];

  let speakers: SkillSpeaker[] = [];
  try {
    // In-camera parts never go to the model, whoever asks.
    const readable = await getTranscriptByMeetingPortable(ctx, { meetingId: id });
    const transcript = readable ? transcriptWithoutInCamera(readable, await minutesForMeeting(ctx, id, meeting.societyId)) as typeof readable : readable;
    const segments = Array.isArray(transcript?.segments) ? (transcript!.segments as Array<{ speaker: string; text: string }>) : [];
    const map = new Map<string, { name?: string; personId?: string }>(
      (Array.isArray(transcript?.speakers) ? transcript!.speakers : []).map((speaker: any) => [String(speaker.label), { name: speaker.name, personId: speaker.personId }]),
    );
    const byLabel = new Map<string, SkillSpeaker>();
    for (const segment of segments) {
      const label = String(segment.speaker);
      const speaker = byLabel.get(label) ?? { label, ...(map.get(label)?.name ? { name: map.get(label)!.name } : {}), ...(map.get(label)?.personId ? { personId: String(map.get(label)!.personId) } : {}), segments: 0, sample: [] };
      speaker.segments += 1;
      // The longest few lines say most about who is talking.
      const line = String(segment.text ?? "").replace(/\s+/g, " ").trim().slice(0, SKILL_CONTEXT_LIMITS.sampleChars);
      if (line.split(" ").length >= 4) {
        speaker.sample.push(line);
        speaker.sample.sort((a, b) => b.length - a.length);
        speaker.sample.length = Math.min(speaker.sample.length, SKILL_CONTEXT_LIMITS.sampleLines);
      }
      byLabel.set(label, speaker);
    }
    speakers = [...byLabel.values()].sort((a, b) => b.segments - a.segments).slice(0, SKILL_CONTEXT_LIMITS.speakers);
  } catch {
    speakers = [];
  }

  return {
    meeting: {
      title: String(meeting.title ?? "Meeting"),
      date: String(meeting.scheduledAt ?? "").slice(0, 10) || undefined,
      body: String(meeting.type ?? "") || undefined,
      ...(meetingCommitteeId && committeeName.get(meetingCommitteeId) ? { committeeName: committeeName.get(meetingCommitteeId) } : {}),
    },
    people,
    ...(sorted.length > people.length ? { peopleOmitted: sorted.length - people.length } : {}),
    goals,
    committees: committees.slice(0, SKILL_CONTEXT_LIMITS.committees).map((row) => ({ id: String(row._id), name: String(row.name) })),
    speakers,
  };
}

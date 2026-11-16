/**
 * THE MEETING NOTES SKILL: how an AI model writes up a meeting by calling
 * tools, provider-neutral.
 *
 * Instead of returning one JSON blob, the model is given primitives with
 * schemas (write the summary, add a decision, add an action item for a
 * person, identify a speaker, mark an attendee, finish) and the context it
 * needs to use them well: who is in the organization, with their ids and
 * roles, the open goals and committees, and the transcript's speaker labels.
 * It calls the tools; `createMeetingNotesSkillSession` checks every call
 * against that context, answers the model (so it can correct a bad id), and
 * collects the result.
 *
 * The same session runs three ways:
 *  - a tool loop over OpenAI-compatible or Anthropic chat (hosted, convex/providers/llm.ts);
 *  - the on-device client, including CLIs that run their own tool loop
 *    (src/features/meetings/localNotesDraft.ts);
 *  - JSON mode for models that can't call tools: `{ "calls": [{ "tool", "arguments" }] }`.
 *
 * Nothing here writes to the database. Model output is untrusted: ids that
 * aren't in the context are refused, text is bounded, dates are checked.
 */
import type { ChatToolCall, ChatToolDefinition, ChatWireMessage, RawToolCall } from "./openAiCompatible";
import { parseJsonObject } from "./minutesDraft";
import {
  isIsoDate,
  NOTES_DRAFT_LIMITS,
  notesDraftTemplate,
  normalizeNotesDraft,
  type NotesDraft,
  type NotesDraftTemplateId,
} from "./notesDraft";
import { splitTranscript } from "./minutesDraftChunks";

// ---------------------------------------------------------------------------
// Context: what the model knows about the organization
// ---------------------------------------------------------------------------

export type SkillPerson = {
  /** People directory id. Absent for someone the registers name but the directory doesn't. */
  id?: string;
  name: string;
  aliases?: string[];
  /** "Director: Treasurer", "Finance Committee: Chair", "Staff: Executive Director", "Member". */
  roles: string[];
  /** Listed as attending this meeting. */
  attendee?: boolean;
};

export type SkillSpeaker = {
  label: string;
  /** Name already given to this label, if any. */
  name?: string;
  personId?: string;
  segments: number;
  /** A few of the speaker's lines, so the model can tell who they are. */
  sample: string[];
};

export type MeetingNotesSkillContext = {
  meeting: { title: string; date?: string; body?: string; committeeName?: string };
  people: SkillPerson[];
  goals: Array<{ id: string; title: string }>;
  committees: Array<{ id: string; name: string }>;
  speakers: SkillSpeaker[];
  /** People left out to keep the prompt bounded. */
  peopleOmitted?: number;
};

export const SKILL_CONTEXT_LIMITS = { people: 150, aliases: 3, roles: 4, goals: 40, committees: 40, speakers: 30, sampleLines: 3, sampleChars: 160 } as const;

const clip = (value: unknown, max: number) => {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Thursday " for a YYYY-MM-DD date, so the model never has to work out the weekday. */
function weekdayOf(date: string): string {
  if (!isIsoDate(date)) return "";
  return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} `;
}

/** The context as a compact block for the prompt. Ids are shown exactly as the tools take them. */
export function meetingNotesSkillContextBlock(context: MeetingNotesSkillContext): string {
  const lines: string[] = [];
  const { meeting } = context;
  lines.push(`Meeting: ${clip(meeting.title, 200)}${meeting.date ? ` (${weekdayOf(meeting.date)}${meeting.date})` : ""}${meeting.body ? `, ${meeting.body}` : ""}${meeting.committeeName ? `, ${meeting.committeeName}` : ""}`);
  lines.push("", "People in the organization (person_id | name | roles):");
  if (!context.people.length) lines.push("(none available: use owner_name / name only)");
  for (const person of context.people) {
    const aliases = person.aliases?.length ? ` (also: ${person.aliases.join(", ")})` : "";
    const roles = person.roles.length ? person.roles.join("; ") : "no recorded role";
    lines.push(`${person.id ?? "-"} | ${person.name}${aliases} | ${roles}${person.attendee ? " | attending" : ""}`);
  }
  if (context.peopleOmitted) lines.push(`(${context.peopleOmitted} more people not listed; use owner_name for anyone else)`);
  lines.push("", "Open goals (goal_id | title):");
  lines.push(...(context.goals.length ? context.goals.map((goal) => `${goal.id} | ${goal.title}`) : ["(none)"]));
  lines.push("", "Committees (committee_id | name):");
  lines.push(...(context.committees.length ? context.committees.map((committee) => `${committee.id} | ${committee.name}`) : ["(none)"]));
  lines.push("", "Transcript speakers (speaker_label | current name | lines | sample):");
  if (!context.speakers.length) lines.push("(no timed transcript)");
  for (const speaker of context.speakers) {
    lines.push(`${speaker.label} | ${speaker.name ?? "unnamed"} | ${speaker.segments} | ${speaker.sample.map((line) => `"${line}"`).join(" ")}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const PERSON_ID = { type: "string", description: "A person_id from the People list. Omit when the person isn't listed." };

export const MEETING_NOTES_TOOLS: readonly ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "write_summary",
      description: "Write the meeting summary and its sections. Call once; a later call replaces it.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "2–4 sentences: what the meeting was for and what came of it." },
          sections: {
            type: "array",
            description: "Sections following the template's headings; each point one short sentence.",
            items: {
              type: "object",
              properties: { heading: { type: "string" }, points: { type: "array", items: { type: "string" } } },
              required: ["heading", "points"],
            },
          },
        },
        required: ["summary", "sections"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_decision",
      description: "Record one thing the meeting decided or agreed. One call per decision.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_open_question",
      description: "Record one question left unanswered or a follow-up the meeting couldn't settle.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_action_item",
      description: "Record one concrete next step someone agreed to. Assign it to the person who took it on. One call per action.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Imperative, e.g. \"Send the budget to the funder\". Don't repeat the owner's name." },
          owner_person_id: PERSON_ID,
          owner_name: { type: "string", description: "The owner's name as said, when they have no person_id." },
          owner_speaker_label: { type: "string", description: "When the owner is a transcript speaker you couldn't identify, their speaker_label. It resolves to the person if that label is identified." },
          due_date: { type: "string", description: "YYYY-MM-DD, only when a date or deadline was stated. Resolve \"Friday\" against the meeting date." },
          at_seconds: { type: "number", description: "Transcript time in seconds where it was agreed, from the [m:ss] prefix." },
          goal_id: { type: "string", description: "A goal_id the action clearly advances." },
          committee_id: { type: "string", description: "A committee_id the action belongs to." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_speaker",
      description: "Say who a transcript speaker label is, only with evidence in the transcript (they introduce themselves, are addressed by name, or state a role only one person holds).",
      parameters: {
        type: "object",
        properties: {
          speaker_label: { type: "string", description: "A speaker_label from the Transcript speakers list." },
          person_id: PERSON_ID,
          name: { type: "string", description: "Their name, when they have no person_id." },
          evidence: { type: "string", description: "The words that show it, quoted briefly." },
        },
        required: ["speaker_label", "evidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_attendee",
      description: "Record someone who took part in the meeting (spoke, was addressed as present, or is in the notes as attending).",
      parameters: {
        type: "object",
        properties: { person_id: PERSON_ID, name: { type: "string" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Call last, once everything is recorded.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export const MEETING_NOTES_TOOL_NAMES: ReadonlySet<string> = new Set(MEETING_NOTES_TOOLS.map((tool) => tool.function.name));

export function meetingNotesSkillSystemPrompt(template: NotesDraftTemplateId): string {
  const shape = notesDraftTemplate(template);
  return [
    "You write meeting notes for a nonprofit organization by calling tools. You do not reply in prose.",
    "",
    "You get the note-taker's own notes, the transcript (lines start with [m:ss] and the speaker), and a context block listing the organization's people with their person_id and roles, its open goals, its committees, and the transcript's speaker labels.",
    "",
    "How to work:",
    "1. Read everything first. The note-taker's notes show what mattered to them: build on them and never contradict them. A note the transcript never discusses becomes a section point as written, not a decision or an action.",
    `2. Call write_summary once. Template "${shape.label}": use these section headings where they fit: ${shape.sections.join("; ")}. ${shape.guidance} Sections are flat: one section per topic, each with a short heading.`,
    "3. Call add_decision for each decision or agreement made in this meeting. Something reported as already decided earlier is a section point, not a decision. Call add_open_question for each question the meeting left open.",
    "4. Call add_action_item for each concrete next step someone took on. Owner: owner_person_id when they are in the People list (match first names, nicknames and roles such as \"the treasurer\" to the person who holds them); otherwise owner_name; or owner_speaker_label when the person who took it on is a speaker you couldn't identify. When the meeting asks someone who isn't present to do something, leave the owner out and name them in the text. Leave the owner out when nobody took it on. A next step nobody took on is an action item only, not also an open question.",
    "   Due dates: only when a date or deadline was stated. Resolve relative dates from the meeting's date and weekday: \"this Friday\" is the next Friday after the meeting, \"next Friday\" is the Friday of the following week, \"end of the month\" is that month's last day. A vague span (\"this week\", \"over the next two weeks\", \"soon\") is not a due date: leave due_date out and keep the wording in the text. Add at_seconds from the line where it was agreed, and goal_id or committee_id only when the link is clear.",
    "5. Call identify_speaker for a speaker label only with evidence: a self-introduction; being greeted or asked a question by name and answering it; or speaking plainly from a role that exactly one listed person holds (\"as treasurer…\", \"from the volunteer side…\" when only one person coordinates volunteers). A role two listed people share is not evidence. Skip labels you can't support, and never guess from speaking order.",
    "6. Call mark_attendee for each person who clearly took part. Someone mentioned as absent did not.",
    "7. Call finish.",
    "",
    "Rules: use only ids that appear in the context, exactly as written. Never invent people, dates or commitments. If a tool answers with an error, fix that call and try again. You may call several tools in one turn.",
  ].join("\n");
}

export type MeetingNotesSkillInput = {
  template: NotesDraftTemplateId;
  notes: string;
  /** Timed lines "[m:ss] Speaker: text", or plain text. */
  transcript: string;
  context: MeetingNotesSkillContext;
};

export function meetingNotesSkillUserPrompt(input: MeetingNotesSkillInput, part?: { index: number; total: number }): string {
  return [
    meetingNotesSkillContextBlock(input.context),
    "",
    "Note-taker's notes:",
    input.notes.trim() || "(none)",
    "",
    part && part.total > 1 ? `Transcript (part ${part.index + 1} of ${part.total}; record only what this part supports):` : "Transcript:",
    input.transcript.trim() || "(none)",
  ].join("\n");
}

/** Requests for a long transcript: one tool conversation per part, all into one session. */
export function planMeetingNotesSkill(input: MeetingNotesSkillInput, budgetChars: number): ChatWireMessage[][] {
  const fixed = meetingNotesSkillUserPrompt({ ...input, transcript: "" }).length + 3_000;
  const budget = Math.max(4_000, budgetChars - fixed);
  const parts = input.transcript.length > budget ? splitTranscript(input.transcript, budget) : [input.transcript];
  return parts.map((transcript, index) => [
    { role: "system", content: meetingNotesSkillSystemPrompt(input.template) },
    { role: "user", content: meetingNotesSkillUserPrompt({ ...input, transcript }, { index, total: parts.length }) },
  ]);
}

// ---------------------------------------------------------------------------
// The session: checks each call against the context and collects the result
// ---------------------------------------------------------------------------

export type SkillActionItem = {
  text: string;
  assignee?: string;
  assigneePersonId?: string;
  dueDate?: string;
  atSec?: number;
  goalId?: string;
  committeeId?: string;
};

type PendingAction = SkillActionItem & { speakerLabel?: string };

export type SkillSpeakerSuggestion = { label: string; name: string; personId?: string; evidence: string };
export type SkillAttendee = { name: string; personId?: string };

export type MeetingNotesSkillResult = {
  draft: NotesDraft & { actionItems: SkillActionItem[] };
  speakers: SkillSpeakerSuggestion[];
  attendees: SkillAttendee[];
  /** Calls refused, for diagnostics and tests. */
  refused: Array<{ tool: string; reason: string }>;
  calls: number;
  finished: boolean;
};

export type SkillToolAnswer = { content: string; isError?: boolean };

const normalizeName = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Finds a listed person by name or alias, then by a first name only one person has. */
export function matchSkillPerson(people: readonly SkillPerson[], name: string): SkillPerson | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  const exact = people.filter((person) => [person.name, ...(person.aliases ?? [])].some((candidate) => normalizeName(candidate) === key));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  if (key.includes(" ")) return undefined;
  const byFirst = people.filter((person) => normalizeName(person.name).split(" ")[0] === key);
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

/** Tool arguments arrive as a JSON string, an object, or a string encoded twice. */
export function decodeSkillArguments(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw ?? {};
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value || "{}");
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const MAX_REF_SEC = 24 * 60 * 60;
const str = (value: unknown, max: number) => clip(value, max) || undefined;

export function createMeetingNotesSkillSession(context: MeetingNotesSkillContext, template: NotesDraftTemplateId) {
  const peopleById = new Map(context.people.filter((person) => person.id).map((person) => [person.id!, person]));
  const goalIds = new Set(context.goals.map((goal) => goal.id));
  const committeeIds = new Set(context.committees.map((committee) => committee.id));
  const speakerLabels = new Set(context.speakers.map((speaker) => speaker.label));
  let summary = "";
  let sections: Array<{ heading: string; points: string[] }> = [];
  const decisions: string[] = [];
  const questions: string[] = [];
  const actions: PendingAction[] = [];
  const speakers = new Map<string, SkillSpeakerSuggestion>();
  const attendees = new Map<string, SkillAttendee>();
  const refused: Array<{ tool: string; reason: string }> = [];
  let calls = 0;
  let finished = false;

  const refuse = (tool: string, reason: string): SkillToolAnswer => {
    refused.push({ tool, reason });
    return { content: `Not recorded: ${reason}`, isError: true };
  };

  /** A person from an id (must be listed) or a name (matched when it can be). */
  const person = (id: unknown, name: unknown): { ok: true; personId?: string; name?: string } | { ok: false; reason: string } => {
    const rawId = typeof id === "string" ? id.trim() : "";
    const rawName = str(name, 120);
    if (rawId) {
      const listed = peopleById.get(rawId);
      if (listed) return { ok: true, personId: listed.id, name: listed.name };
      const byName = rawName ? matchSkillPerson(context.people, rawName) : undefined;
      if (byName?.id) return { ok: true, personId: byName.id, name: byName.name };
      return { ok: false, reason: `person_id "${clip(rawId, 40)}" is not in the People list. Use a listed person_id, or give the name instead.` };
    }
    if (!rawName) return { ok: true };
    const matched = matchSkillPerson(context.people, rawName);
    return matched?.id ? { ok: true, personId: matched.id, name: matched.name } : { ok: true, name: rawName };
  };

  function handle(call: { name: string; arguments: unknown }): SkillToolAnswer {
    calls += 1;
    const tool = String(call.name ?? "");
    if (!MEETING_NOTES_TOOL_NAMES.has(tool)) return refuse(tool, `there is no tool "${clip(tool, 40)}".`);
    const args = decodeSkillArguments(call.arguments);
    if (!args) return refuse(tool, "the arguments were not a JSON object.");
    switch (tool) {
      case "write_summary": {
        const draft = normalizeNotesDraft({ summary: args.summary, sections: args.sections, decisions: [], openQuestions: [], actionItems: [] }, { template, summary: "", sections: [], decisions: [], openQuestions: [], actionItems: [] });
        if (!draft.summary) return refuse(tool, "summary is empty.");
        summary = draft.summary;
        sections = draft.sections;
        return { content: `Summary recorded with ${sections.length} section(s).` };
      }
      case "add_decision":
      case "add_open_question": {
        const text = str(args.text, NOTES_DRAFT_LIMITS.point);
        if (!text) return refuse(tool, "text is empty.");
        const list = tool === "add_decision" ? decisions : questions;
        if (list.length >= NOTES_DRAFT_LIMITS.listItems) return refuse(tool, "too many items.");
        if (!list.some((item) => normalizeName(item) === normalizeName(text))) list.push(text);
        return { content: "Recorded." };
      }
      case "add_action_item": {
        const text = str(args.text, NOTES_DRAFT_LIMITS.actionText);
        if (!text) return refuse(tool, "text is empty.");
        if (actions.length >= NOTES_DRAFT_LIMITS.actionItems) return refuse(tool, "too many action items.");
        const owner = person(args.owner_person_id, args.owner_name);
        if (!owner.ok) return refuse(tool, owner.reason);
        if (args.due_date !== undefined && args.due_date !== null && args.due_date !== "" && !isIsoDate(args.due_date)) return refuse(tool, "due_date must be YYYY-MM-DD.");
        const goalId = typeof args.goal_id === "string" && args.goal_id.trim() ? args.goal_id.trim() : undefined;
        if (goalId && !goalIds.has(goalId)) return refuse(tool, `goal_id "${clip(goalId, 40)}" is not in the Open goals list. Omit it or use a listed id.`);
        const committeeId = typeof args.committee_id === "string" && args.committee_id.trim() ? args.committee_id.trim() : undefined;
        if (committeeId && !committeeIds.has(committeeId)) return refuse(tool, `committee_id "${clip(committeeId, 40)}" is not in the Committees list. Omit it or use a listed id.`);
        const ownerLabel = typeof args.owner_speaker_label === "string" && args.owner_speaker_label.trim() ? args.owner_speaker_label.trim() : undefined;
        if (ownerLabel && !speakerLabels.has(ownerLabel)) return refuse(tool, `owner_speaker_label "${clip(ownerLabel, 40)}" is not in the Transcript speakers list.`);
        const at = typeof args.at_seconds === "number" && Number.isFinite(args.at_seconds) && args.at_seconds >= 0 && args.at_seconds <= MAX_REF_SEC ? Math.round(args.at_seconds) : undefined;
        if (actions.some((item) => normalizeName(item.text) === normalizeName(text))) return { content: "Already recorded." };
        actions.push({
          text,
          ...(owner.name ? { assignee: owner.name } : {}),
          ...(owner.personId ? { assigneePersonId: owner.personId } : {}),
          ...(isIsoDate(args.due_date) ? { dueDate: args.due_date as string } : {}),
          ...(at !== undefined ? { atSec: at } : {}),
          ...(goalId ? { goalId } : {}),
          ...(committeeId ? { committeeId } : {}),
          ...(!owner.name && ownerLabel ? { speakerLabel: ownerLabel } : {}),
        });
        if (!owner.name && ownerLabel) return { content: `Recorded; the owner is ${ownerLabel} until that speaker is identified.` };
        return { content: owner.personId ? `Recorded for ${owner.name}.` : owner.name ? `Recorded for ${owner.name} (not in the People list).` : "Recorded with no owner." };
      }
      case "identify_speaker": {
        const label = typeof args.speaker_label === "string" ? args.speaker_label.trim() : "";
        if (!speakerLabels.has(label)) return refuse(tool, `speaker_label "${clip(label, 40)}" is not in the Transcript speakers list.`);
        const evidence = str(args.evidence, 240);
        if (!evidence) return refuse(tool, "evidence is required: quote the words that show who this is.");
        const who = person(args.person_id, args.name);
        if (!who.ok) return refuse(tool, who.reason);
        if (!who.name) return refuse(tool, "give person_id or name.");
        speakers.set(label, { label, name: who.name, ...(who.personId ? { personId: who.personId } : {}), evidence });
        return { content: `${label} recorded as ${who.name}.` };
      }
      case "mark_attendee": {
        const who = person(args.person_id, args.name);
        if (!who.ok) return refuse(tool, who.reason);
        if (!who.name) return refuse(tool, "give person_id or name.");
        attendees.set(who.personId ?? normalizeName(who.name), { name: who.name, ...(who.personId ? { personId: who.personId } : {}) });
        return { content: "Recorded." };
      }
      case "finish":
        finished = true;
        return { content: "Done." };
    }
    return refuse(tool, "unknown tool.");
  }

  function result(): MeetingNotesSkillResult {
    // An action owned by a speaker label takes the person that label was identified as.
    const actionItems = actions.map(({ speakerLabel, ...item }) => {
      const speaker = speakerLabel ? speakers.get(speakerLabel) : undefined;
      return speaker ? { ...item, assignee: speaker.name, ...(speaker.personId ? { assigneePersonId: speaker.personId } : {}) } : item;
    });
    return {
      draft: { template, summary, sections, decisions: [...decisions], openQuestions: [...questions], actionItems },
      speakers: [...speakers.values()],
      attendees: [...attendees.values()],
      refused: [...refused],
      calls,
      finished,
    };
  }

  return { handle, result, get finished() { return finished; } };
}

export type MeetingNotesSkillSession = ReturnType<typeof createMeetingNotesSkillSession>;

/** Merges sessions run over transcript parts into one result. */
export function mergeSkillResults(results: readonly MeetingNotesSkillResult[]): MeetingNotesSkillResult {
  if (results.length === 1) return results[0];
  const first = results[0];
  const byKey = <T,>(items: T[], key: (item: T) => string) => [...new Map(items.map((item) => [key(item), item])).values()];
  const sections = new Map<string, { heading: string; points: string[] }>();
  for (const section of results.flatMap((result) => result.draft.sections)) {
    const existing = sections.get(section.heading.toLowerCase());
    if (existing) existing.points = [...new Set([...existing.points, ...section.points])].slice(0, NOTES_DRAFT_LIMITS.pointsPerSection);
    else sections.set(section.heading.toLowerCase(), { heading: section.heading, points: [...section.points] });
  }
  return {
    draft: {
      template: first.draft.template,
      summary: clip(results.map((result) => result.draft.summary).filter(Boolean).join(" "), NOTES_DRAFT_LIMITS.summary),
      sections: [...sections.values()].slice(0, NOTES_DRAFT_LIMITS.sections),
      decisions: byKey(results.flatMap((result) => result.draft.decisions), normalizeName),
      openQuestions: byKey(results.flatMap((result) => result.draft.openQuestions), normalizeName),
      actionItems: byKey(results.flatMap((result) => result.draft.actionItems), (item) => normalizeName(item.text)),
    },
    speakers: byKey(results.flatMap((result) => result.speakers), (item) => item.label),
    attendees: byKey(results.flatMap((result) => result.attendees), (item) => item.personId ?? normalizeName(item.name)),
    refused: results.flatMap((result) => result.refused),
    calls: results.reduce((sum, result) => sum + result.calls, 0),
    finished: results.every((result) => result.finished),
  };
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

/** One model turn: the reply text and any tool calls it made. */
export type SkillStep = (messages: ChatWireMessage[], tools: readonly ChatToolDefinition[]) => Promise<{ text: string; toolCalls: RawToolCall[] }>;

export const SKILL_MAX_ROUNDS = 8;

/**
 * The tool loop: send, run every call through the session, answer each one,
 * repeat until the model stops calling tools or calls finish. A reply with no
 * tool calls is also read as JSON-mode calls (`{ "calls": [...] }`), so a model
 * that writes its calls as text still counts.
 */
export async function runMeetingNotesSkillLoop(step: SkillStep, messages: ChatWireMessage[], session: MeetingNotesSkillSession, maxRounds = SKILL_MAX_ROUNDS) {
  const conversation = [...messages];
  for (let round = 0; round < maxRounds; round++) {
    const reply = await step(conversation, MEETING_NOTES_TOOLS);
    const calls = reply.toolCalls.length ? reply.toolCalls : skillCallsFromText(reply.text);
    if (!calls.length) break;
    const wire: ChatToolCall[] = calls.map((call, index) => ({
      id: call.id || `call_${round}_${index}`,
      type: "function",
      function: { name: call.name, arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}) },
    }));
    conversation.push({ role: "assistant", content: reply.text || null, tool_calls: wire });
    for (const [index, call] of calls.entries()) {
      const answer = session.handle(call);
      conversation.push({ role: "tool", tool_call_id: wire[index].id, content: answer.content });
    }
    if (session.finished) break;
  }
  return session.result();
}

/** JSON mode: the whole set of calls in one reply. */
export const MEETING_NOTES_CALLS_JSON_SCHEMA = {
  name: "meeting_notes_tool_calls",
  strict: false,
  schema: {
    type: "object",
    properties: {
      calls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", enum: [...MEETING_NOTES_TOOL_NAMES] },
            arguments: { type: "object" },
          },
          required: ["tool", "arguments"],
        },
      },
    },
    required: ["calls"],
  },
} as const;

/** The JSON-mode instruction appended for models that can't call tools. */
export function meetingNotesJsonModeInstruction(): string {
  const tools = MEETING_NOTES_TOOLS.map((tool) => `- ${tool.function.name}: ${tool.function.description} Arguments: ${JSON.stringify(tool.function.parameters)}`).join("\n");
  return `You can't call tools directly here. Instead reply with one JSON object {"calls": [{"tool": "<name>", "arguments": {...}}, ...]} listing every call you would make, in order, ending with finish. Tools:\n${tools}`;
}

/** Calls written as text: `{ "calls": [...] }`, `{ "tool_calls": [...] }`, or a bare array. */
export function skillCallsFromText(text: string): RawToolCall[] {
  if (!text || !/[{[]/.test(text)) return [];
  let parsed: unknown = parseJsonObject(text);
  if (parsed === undefined) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch {
        parsed = undefined;
      }
    }
  }
  const row = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  const list = Array.isArray(parsed) ? parsed : Array.isArray(row?.calls) ? row!.calls : Array.isArray(row?.tool_calls) ? row!.tool_calls : [];
  return (list as unknown[]).flatMap((entry, index) => {
    const call = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined;
    const fn = call?.function && typeof call.function === "object" ? (call.function as Record<string, unknown>) : undefined;
    const name = String(call?.tool ?? call?.name ?? fn?.name ?? "");
    if (!MEETING_NOTES_TOOL_NAMES.has(name)) return [];
    return [{ id: `text_${index}`, name, arguments: call?.arguments ?? call?.args ?? call?.input ?? fn?.arguments ?? {} }];
  });
}

/** Runs JSON-mode calls through a session (no back-and-forth). */
export function applySkillCalls(session: MeetingNotesSkillSession, calls: readonly RawToolCall[]) {
  for (const call of calls) session.handle(call);
  return session.result();
}

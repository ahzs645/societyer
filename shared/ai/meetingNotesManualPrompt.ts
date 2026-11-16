/**
 * "Draft with your own AI": a prompt to copy into any AI chat (ChatGPT,
 * Claude, Copilot…) that carries the meeting notes skill's rules, its tools
 * and the JSON to return, the organization's people, goals and committees,
 * the note-taker's notes and the transcript. The reply is pasted back and run
 * through the same session the built-in AI uses (createMeetingNotesSkillSession),
 * so pasted JSON gets the same checks: owners from the People list, quotes
 * word for word from the transcript, speakers named only with evidence.
 *
 * Like the webforms Builder JSON prompt: core rules always, optional blocks
 * the person can switch off, and their own requirements appended.
 */
import {
  applySkillCalls,
  createMeetingNotesSkillSession,
  MEETING_NOTES_TOOLS,
  meetingNotesSkillContextBlock,
  meetingNotesSkillSystemPrompt,
  skillCallsFromText,
  type MeetingNotesSkillContext,
  type MeetingNotesSkillResult,
} from "./meetingNotesSkill";
import { notesDraftTemplate, type NotesDraftTemplateId } from "./notesDraft";

export type ManualPromptSectionId = "notes" | "transcript" | "people" | "goals" | "speakers" | "quotes";

export type ManualPromptSection = { id: ManualPromptSectionId; label: string; description: string };

export const MANUAL_PROMPT_SECTIONS: readonly ManualPromptSection[] = [
  { id: "transcript", label: "Transcript", description: "The meeting transcript, with times and speakers. Off if you attach the file to your AI yourself." },
  { id: "notes", label: "Notes", description: "The team notes and any notes people shared. The AI builds on them and never contradicts them." },
  { id: "people", label: "People and roles", description: "Directors, staff, volunteers, members and attendees with their ids, so action items get real owners." },
  { id: "goals", label: "Goals and committees", description: "Open goals and committees, so action items can be linked to them." },
  { id: "speakers", label: "Name the speakers", description: "Lets the AI say who each unnamed transcript speaker is, with the words that show it." },
  { id: "quotes", label: "Key quotes", description: "Up to three quotes kept word for word; each is checked against the transcript." },
];

export type ManualPromptSectionState = Record<ManualPromptSectionId, boolean>;

export function manualPromptSectionState(enabled: readonly ManualPromptSectionId[] = MANUAL_PROMPT_SECTIONS.map((section) => section.id)): ManualPromptSectionState {
  return Object.fromEntries(MANUAL_PROMPT_SECTIONS.map((section) => [section.id, enabled.includes(section.id)])) as ManualPromptSectionState;
}

/** The tools on offer: speaker naming and quotes only when their block is on. */
function promptTools(sections: ManualPromptSectionState) {
  return MEETING_NOTES_TOOLS.filter((tool) => {
    const name = tool.function.name;
    if (name === "identify_speaker") return sections.speakers;
    if (name === "add_quote") return sections.quotes && sections.transcript;
    return true;
  });
}

const EXAMPLE = {
  calls: [
    { tool: "write_summary", arguments: { summary: "Two to four sentences on what the meeting was about and what came of it.", sections: [{ heading: "Topic", points: ["One point per line"] }] } },
    { tool: "add_decision", arguments: { text: "Go ahead with the spring pilot" } },
    { tool: "add_action_item", arguments: { text: "Send the revised budget to the funder", owner_person_id: "<a person_id from the People list>", due_date: "2026-11-20", at_seconds: 125 } },
    { tool: "add_open_question", arguments: { text: "Who signs the lease?" } },
    { tool: "finish", arguments: {} },
  ],
};

export type ManualPromptInput = {
  template: NotesDraftTemplateId;
  notes: string;
  /** Timed lines "[m:ss] Speaker: text", or plain text. */
  transcript: string;
  context: MeetingNotesSkillContext;
  sections: ManualPromptSectionState;
  /** The person's own extra instructions, appended at the end. */
  requirements?: string;
};

export function buildManualNotesPrompt(input: ManualPromptInput): string {
  const { sections } = input;
  const tools = promptTools(sections);
  const context: MeetingNotesSkillContext = {
    ...input.context,
    people: sections.people ? input.context.people : [],
    peopleOmitted: sections.people ? input.context.peopleOmitted : undefined,
    goals: sections.goals ? input.context.goals : [],
    committees: sections.goals ? input.context.committees : [],
    speakers: sections.speakers ? input.context.speakers : [],
  };
  const skipped = [
    !sections.speakers && "Don't call identify_speaker.",
    !(sections.quotes && sections.transcript) && "Don't call add_quote.",
    !sections.people && "No People list is given: use owner_name with the name as said, never owner_person_id.",
    !sections.goals && "No goals or committees are given: leave goal_id and committee_id out.",
  ].filter(Boolean);
  const transcriptPart = !sections.transcript
    ? "Transcript: attached separately by the person who sent this prompt. Read it from the attachment; its lines are \"[m:ss] Speaker: text\" or WebVTT cues."
    : `Transcript:\n${input.transcript.trim() || "(none)"}`;
  const notesPart = sections.notes ? `Note-taker's notes:\n${input.notes.trim() || "(none)"}` : "";
  return [
    `You are drafting meeting notes for an organization, using the "${notesDraftTemplate(input.template).label}" template. You can't call tools in this chat, so write the calls as JSON instead.`,
    "",
    "Return ONLY one JSON object, with no markdown fences, commentary or text around it:",
    '{"calls": [{"tool": "<tool name>", "arguments": {…}}, …]}',
    "List every call you would make, in order, and end with finish. The calls are checked when they are imported: a person_id, goal_id or committee_id that isn't listed below, a malformed date, or a quote that isn't word for word in the transcript is refused with a reason.",
    "",
    meetingNotesSkillSystemPrompt(input.template).replace("You do not reply in prose.", "You do not reply in prose: only the JSON object."),
    ...(skipped.length ? ["", ...skipped] : []),
    "",
    "Tools (name: what it records; arguments as JSON Schema):",
    ...tools.map((tool) => `- ${tool.function.name}: ${tool.function.description}\n  ${JSON.stringify(tool.function.parameters)}`),
    "",
    "Example of the shape (replace everything with what this meeting supports):",
    JSON.stringify(EXAMPLE),
    "",
    "Context:",
    meetingNotesSkillContextBlock(context),
    ...(notesPart ? ["", notesPart] : []),
    "",
    transcriptPart,
    ...(input.requirements?.trim() ? ["", "Additional requirements from the person:", input.requirements.trim()] : []),
  ].join("\n");
}

export type ManualReplyImport =
  | { ok: true; result: MeetingNotesSkillResult; calls: number }
  | { ok: false; error: string };

/**
 * A reply pasted back from another AI: its calls run through the same session
 * as the built-in AI's, against this meeting's context and transcript.
 */
export function importManualNotesReply(text: string, input: { template: NotesDraftTemplateId; context: MeetingNotesSkillContext; transcript: string }): ManualReplyImport {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Paste the JSON your AI returned." };
  const calls = skillCallsFromText(trimmed);
  if (!calls.length) {
    return {
      ok: false,
      error: /[{[]/.test(trimmed)
        ? "No tool calls were found. The JSON should look like {\"calls\": [{\"tool\": \"write_summary\", \"arguments\": {…}}, …]}."
        : "That isn't JSON. Paste the JSON object your AI returned.",
    };
  }
  const session = createMeetingNotesSkillSession(input.context, input.template, { transcript: input.transcript, lenient: true });
  const result = applySkillCalls(session, calls);
  if (!result.draft.summary && !result.draft.sections.length && !result.draft.decisions.length && !result.draft.actionItems.length) {
    return { ok: false, error: result.refused.length ? `Nothing could be imported: ${result.refused[0].tool}: ${result.refused[0].reason}` : "The reply had no summary, decisions or action items." };
  }
  return { ok: true, result, calls: calls.length };
}

/** Rough size check: very long prompts may exceed what a chat accepts in one message. */
export const MANUAL_PROMPT_LONG_CHARS = 120_000;

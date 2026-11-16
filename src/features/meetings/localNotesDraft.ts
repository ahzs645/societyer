/**
 * The AI notes draft with the on-device model (browser-local workspace and the
 * desktop app), the pure part: no React, no runtime imports, so it runs under
 * Node in scripts/check-meeting-notes-draft.ts.
 *
 *   notes + transcript -> device model (shared prompt; long transcripts in parts)
 *   -> parseNotesDraft -> mergeNotesDrafts
 *
 * The caller writes the result through the portable `meetings:saveNotesDraft`,
 * which normalises it again and stays authoritative.
 */
import {
  heuristicNotesDraft,
  mergeNotesDrafts,
  NOTES_DRAFT_JSON_SCHEMA,
  parseNotesDraft,
  planNotesDraftRequests,
  type NotesDraft,
  type NotesDraftInput,
} from "../../../shared/ai/notesDraft";
import type { DeviceAiClient } from "../../lib/localAi/client";
import { DeviceAiError } from "../../lib/localAi/transport";
import {
  applySkillCalls,
  createMeetingNotesSkillSession,
  MEETING_NOTES_CALLS_JSON_SCHEMA,
  meetingNotesJsonModeInstruction,
  mergeSkillResults,
  planMeetingNotesSkill,
  runMeetingNotesSkillLoop,
  skillCallsFromText,
  type MeetingNotesSkillInput,
  type MeetingNotesSkillResult,
  type SkillStep,
} from "../../../shared/ai/meetingNotesSkill";

export async function draftNotesOnDevice(input: {
  client: Pick<DeviceAiClient, "completeJson">;
  draft: NotesDraftInput;
  chunkChars: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ draft: NotesDraft; requests: number; chunked: boolean }> {
  if (!input.draft.notes.trim() && !input.draft.transcript.trim()) throw new Error("Write some notes or add a transcript first.");
  const plan = planNotesDraftRequests(input.draft, input.chunkChars);
  const parts: NotesDraft[] = [];
  for (const [index, request] of plan.requests.entries()) {
    input.onProgress?.(index, plan.requests.length);
    const reply = await input.client.completeJson({
      messages: request.messages,
      jsonSchema: NOTES_DRAFT_JSON_SCHEMA as never,
      signal: input.signal,
    });
    // A reply that is not JSON falls back to the rule-based draft for that part.
    parts.push(parseNotesDraft(reply.text, heuristicNotesDraft(request.input)));
  }
  input.onProgress?.(plan.requests.length, plan.requests.length);
  return { draft: mergeNotesDrafts(parts), requests: plan.requests.length, chunked: plan.chunked };
}

/**
 * The meeting notes skill with the on-device model: a tool loop per
 * transcript part. Models served by a desktop CLI (Claude Code, Codex) run
 * the loop themselves and call the tools through `onToolCall`; other servers
 * return tool calls each turn; a server that refuses tools gets JSON-mode calls.
 */
export async function draftNotesWithSkillOnDevice(input: {
  client: Pick<DeviceAiClient, "chatStep" | "completeJson">;
  skill: MeetingNotesSkillInput;
  chunkChars: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<MeetingNotesSkillResult> {
  if (!input.skill.notes.trim() && !input.skill.transcript.trim()) throw new Error("Write some notes or add a transcript first.");
  const plan = planMeetingNotesSkill(input.skill, input.chunkChars);
  const results: MeetingNotesSkillResult[] = [];
  for (const [index, messages] of plan.entries()) {
    input.onProgress?.(index, plan.length);
    const session = createMeetingNotesSkillSession(input.skill.context, input.skill.template, { transcript: input.skill.transcript });
    const step: SkillStep = async (conversation, tools) => {
      const reply = await input.client.chatStep({
        messages: conversation,
        tools,
        signal: input.signal,
        maxTokens: 2500,
        temperature: 0.2,
        onToolCall: async (call) => session.handle({ name: call.name, arguments: call.arguments }),
      });
      return { text: reply.text, toolCalls: reply.toolCalls };
    };
    try {
      results.push(await runMeetingNotesSkillLoop(step, messages, session));
    } catch (error) {
      if (!(error instanceof DeviceAiError && error.code === "tools_unsupported")) throw error;
      const reply = await input.client.completeJson({
        messages: [...messages, { role: "system", content: meetingNotesJsonModeInstruction() }] as never,
        jsonSchema: MEETING_NOTES_CALLS_JSON_SCHEMA as never,
        signal: input.signal,
      });
      results.push(applySkillCalls(session, skillCallsFromText(reply.text)));
    }
  }
  input.onProgress?.(plan.length, plan.length);
  return mergeSkillResults(results);
}

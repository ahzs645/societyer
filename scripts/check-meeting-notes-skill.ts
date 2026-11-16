// The meeting notes skill (shared/ai/meetingNotesSkill.ts): tools, context,
// the session that checks every call, the tool loop, JSON mode, the roster
// query (meetings:notesSkillContext) and saving speaker suggestions.
//
//   node --import tsx scripts/check-meeting-notes-skill.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StaticConvexClient } from "../src/lib/staticConvex";
import {
  applySkillCalls,
  createMeetingNotesSkillSession,
  decodeSkillArguments,
  matchSkillPerson,
  MEETING_NOTES_TOOLS,
  meetingNotesJsonModeInstruction,
  meetingNotesSkillContextBlock,
  meetingNotesSkillSystemPrompt,
  mergeSkillResults,
  planMeetingNotesSkill,
  runMeetingNotesSkillLoop,
  skillCallsFromText,
  type SkillStep,
} from "../shared/ai/meetingNotesSkill";
import { SKILL_FIXTURE_B, SKILL_FIXTURE_CONTEXT as CONTEXT, SKILL_FIXTURE_EXPECTED, SKILL_FIXTURE_NOTES, SKILL_FIXTURE_TRANSCRIPT } from "./fixtures/meetingNotesSkillFixture";
import { toolStep, ToolsUnsupportedError } from "../convex/providers/llm";
import { buildManualNotesPrompt, importManualNotesReply, manualPromptSectionState } from "../shared/ai/meetingNotesManualPrompt";
import { draftNotesWithSkillOnDevice } from "../src/features/meetings/localNotesDraft";
import { DeviceAiError } from "../src/lib/localAi/transport";

// ---------- tools and prompt -------------------------------------------------------
assert.deepEqual(
  MEETING_NOTES_TOOLS.map((tool) => tool.function.name),
  ["write_summary", "add_decision", "add_open_question", "add_action_item", "add_quote", "identify_speaker", "finish"],
);
for (const tool of MEETING_NOTES_TOOLS) assert.equal((tool.function.parameters as { type: string }).type, "object", `${tool.function.name} takes an object`);
const block = meetingNotesSkillContextBlock(CONTEXT);
assert.match(block, /^Meeting: Operations check-in \(Thursday 2026-11-12\)/, "the weekday is given, not left to the model");
assert.match(block, /pd_marcus \| Marcus Oyelaran \| Director: Treasurer; Finance Committee: Chair/);
assert.match(block, /pd_samuel \| Samuel Cho \(also: Sam Cho\)/);
assert.match(block, /pd_priya \| Priya Raman \| Staff: Executive Director \| attending/);
assert.match(block, /goal_grants \| Raise \$150k/);
assert.match(block, /SPEAKER_04 \| unnamed \| 1 \| "Yeah, sounds good\."/);
const system = meetingNotesSkillSystemPrompt("one_on_one");
assert.match(system, /Template "1:1"/);
assert.match(system, /never guess from speaking order/);
assert.match(system, /A role two listed people share is not evidence/);
assert.match(meetingNotesJsonModeInstruction(), /"calls"/);
const parts = planMeetingNotesSkill({ template: "general", notes: SKILL_FIXTURE_NOTES, transcript: SKILL_FIXTURE_TRANSCRIPT.repeat(60), context: CONTEXT }, 20_000);
assert.ok(parts.length > 1, "long transcripts are drafted in parts");
assert.match(String(parts[1][1].content), /Transcript \(part 2 of \d+/);
for (const part of parts) assert.match(String(part[1].content), /pd_marcus/, "every part carries the context");
console.log("✓ tools, context block with weekday, prompt rules, long transcripts in parts");

// ---------- name matching and argument decoding ----------------------------------
assert.equal(matchSkillPerson(CONTEXT.people, "Marcus")?.id, "pd_marcus", "a unique first name");
assert.equal(matchSkillPerson(CONTEXT.people, "sam cho")?.id, "pd_samuel", "an alias");
assert.equal(matchSkillPerson(CONTEXT.people, "Jo")?.id, "pd_jo", "a short alias");
assert.equal(matchSkillPerson(CONTEXT.people, "Sam"), undefined, "an ambiguous nickname matches nobody");
assert.equal(matchSkillPerson(CONTEXT.people, "Tomas Reyes")?.id, "pd_tomas", "accents ignored");
assert.equal(matchSkillPerson(CONTEXT.people, "Gabe"), undefined);
assert.deepEqual(decodeSkillArguments('{"a":1}'), { a: 1 });
assert.deepEqual(decodeSkillArguments(JSON.stringify('{"a":1}')), { a: 1 }, "double-encoded");
assert.deepEqual(decodeSkillArguments({ a: 1 }), { a: 1 });
assert.equal(decodeSkillArguments("{nope"), null);

// ---------- the session checks every call ----------------------------------------
const session = createMeetingNotesSkillSession(CONTEXT, "general");
const ok = (name: string, args: unknown) => {
  const answer = session.handle({ name, arguments: args });
  assert.ok(!answer.isError, `${name}: ${answer.content}`);
  return answer.content;
};
const refused = (name: string, args: unknown, why: RegExp) => {
  const answer = session.handle({ name, arguments: args });
  assert.equal(answer.isError, true, `${name} should be refused`);
  assert.match(answer.content, why);
};
ok("write_summary", { summary: "We picked Elm Street.", sections: [{ heading: "Site", points: ["Elm Street has a dock"] }] });
assert.match(ok("add_action_item", { text: "Send the revised budget", owner_person_id: "pd_marcus", due_date: "2026-11-20", goal_id: "goal_grants", at_seconds: 70.4 }), /Recorded for Marcus Oyelaran/);
refused("add_action_item", { text: "x", owner_person_id: "pd_ghost" }, /not in the People list/);
assert.match(ok("add_action_item", { text: "Draft the lease letter", owner_person_id: "pd_wrong", owner_name: "Priya" }), /Priya Raman/, "a bad id with a matching name is corrected");
assert.match(ok("add_action_item", { text: "Email the zoning letter", owner_name: "Gabe" }), /not in the People list/);
assert.match(ok("add_action_item", { text: "Recruit ten volunteers", owner_speaker_label: "SPEAKER_02" }), /until that speaker is identified/);
refused("add_action_item", { text: "y", owner_speaker_label: "SPEAKER_99" }, /not in the Transcript speakers/);
refused("add_action_item", { text: "z", due_date: "next Friday" }, /YYYY-MM-DD/);
refused("add_action_item", { text: "z", goal_id: "goal_moon" }, /not in the Open goals/);
refused("add_action_item", { text: "z", committee_id: "com_nope" }, /not in the Committees/);
assert.equal(ok("add_action_item", { text: "send the revised budget." }), "Already recorded.");
ok("add_decision", { text: "Go with Elm Street" });
ok("add_decision", { text: "go with elm street!" });
ok("add_open_question", { text: "Who signs the lease?" });
refused("identify_speaker", { speaker_label: "SPEAKER_00", person_id: "pd_priya" }, /evidence is required/);
ok("identify_speaker", { speaker_label: "SPEAKER_00", person_id: "pd_priya", evidence: "Priya here" });
ok("identify_speaker", { speaker_label: "SPEAKER_02", name: "Li", evidence: "From the volunteer side" });
ok("identify_speaker", { speaker_label: "SPEAKER_03", name: "Gabe", evidence: "Gabe from the City" });
refused("identify_speaker", { speaker_label: "SPEAKER_09", name: "x", evidence: "y" }, /not in the Transcript speakers/);
refused("delete_everything", {}, /no tool/);
refused("add_decision", "{not json", /not a JSON object/);
ok("finish", {});
const result = session.result();
assert.equal(result.finished, true);
assert.equal(result.draft.summary, "We picked Elm Street.");
assert.deepEqual(result.draft.decisions, ["Go with Elm Street"], "near-duplicate decisions merged");
assert.deepEqual(
  result.draft.actionItems.map((item) => [item.text, item.assigneePersonId ?? item.assignee ?? null, item.dueDate ?? null, item.atSec ?? null, item.goalId ?? null]),
  [
    ["Send the revised budget", "pd_marcus", "2026-11-20", 70, "goal_grants"],
    ["Draft the lease letter", "pd_priya", null, null, null],
    ["Email the zoning letter", "Gabe", null, null, null],
    ["Recruit ten volunteers", "pd_li", null, null, null],
  ],
  "the speaker-label owner resolves once SPEAKER_02 is identified as Li",
);
assert.deepEqual(result.speakers.map((speaker) => [speaker.label, speaker.personId ?? speaker.name]), [["SPEAKER_00", "pd_priya"], ["SPEAKER_02", "pd_li"], ["SPEAKER_03", "Gabe"]]);
assert.equal(result.refused.length, 9);
console.log("✓ session: ids checked, names matched, bad calls refused with a reason, speaker-label owners resolved");

// ---------- quotes are checked against the transcript ---------------------------------
{
  const quoting = createMeetingNotesSkillSession(CONTEXT, "general", { transcript: SKILL_FIXTURE_TRANSCRIPT });
  const say = (args: Record<string, unknown>) => quoting.handle({ name: "add_quote", arguments: args });
  assert.equal(say({ text: "Elm Street is zoned for warehouse use, so you're fine." }).isError, undefined);
  assert.equal(say({ text: "“I'll send the revised budget to them before then”" }).isError, undefined, "curly quotes and a missing full stop don't matter");
  assert.match(say({ text: "Elm Street is zoned for warehouse use so you are fine" }).content, /not in the transcript exactly/, "a paraphrase is refused");
  assert.match(say({ text: "I'll draft the lease letter. The rent works." }).content, /not in the transcript exactly/, "words joined from two lines are refused");
  assert.match(say({ text: "sounds good" }).content, /at least three words/);
  assert.match(say({ text: "is zoned for warehouse use" }).content, /whole sentences/, "a clipped sentence is refused");
  assert.match(say({ text: "Street is the only one with a loading dock" }).content, /whole sentences/, "a sentence cut at the start too");
  assert.equal(say({ text: "Elm Street is zoned for warehouse use, so you're fine" }).content, "Already recorded.");
  quoting.handle({ name: "identify_speaker", arguments: { speaker_label: "SPEAKER_01", person_id: "pd_marcus", evidence: "As treasurer" } });
  const { quotes } = quoting.result().draft;
  assert.deepEqual(quotes?.slice(0, 2), [
    { text: "Elm Street is zoned for warehouse use, so you're fine.", speaker: "SPEAKER_03", atSec: 146 },
    { text: "I'll send the revised budget to them before then", speaker: "Marcus Oyelaran", atSec: 70 },
  ], "speaker and time come from the line; an identified label takes the person's name");
  const none = createMeetingNotesSkillSession(CONTEXT, "general");
  assert.match(none.handle({ name: "add_quote", arguments: { text: "Elm Street is zoned for warehouse use" } }).content, /no transcript/);
  assert.equal(none.result().draft.quotes, undefined, "no quotes key without quotes");
  const merged = mergeSkillResults([quoting.result(), quoting.result()]);
  assert.equal(merged.draft.quotes?.length, quotes?.length, "merged parts keep each quote once");
}
console.log("✓ quotes: word for word from one line, speaker and time taken from it, paraphrases refused");

// ---------- the tool loop ----------------------------------------------------------
// A model that makes a mistake, reads the refusal, fixes it, then finishes.
const turns: Array<{ text: string; toolCalls: Array<{ id?: string; name: string; arguments: unknown }> }> = [
  { text: "", toolCalls: [
    { id: "a", name: "write_summary", arguments: JSON.stringify({ summary: "Ops check-in.", sections: [] }) },
    { id: "b", name: "add_action_item", arguments: { text: "Send the budget", owner_person_id: "marcus" } },
  ] },
  { text: "", toolCalls: [{ id: "c", name: "add_action_item", arguments: { text: "Send the budget", owner_person_id: "pd_marcus" } }] },
  { text: "", toolCalls: [{ id: "d", name: "finish", arguments: "{}" }] },
  { text: "never reached", toolCalls: [] },
];
const seen: unknown[][] = [];
const step: SkillStep = async (messages, tools) => {
  assert.equal(tools.length, MEETING_NOTES_TOOLS.length);
  seen.push(messages.map((message) => message.role));
  return turns[seen.length - 1];
};
const looped = await runMeetingNotesSkillLoop(step, parts[0], createMeetingNotesSkillSession(CONTEXT, "general"));
assert.equal(seen.length, 3, "stops at finish");
assert.deepEqual(seen[1], ["system", "user", "assistant", "tool", "tool"], "each call is answered");
assert.deepEqual(looped.draft.actionItems.map((item) => item.assigneePersonId), ["pd_marcus"], "the corrected call is recorded");
assert.equal(looped.refused.length, 1);
// A model that writes its calls as text instead of calling tools.
const textModel = await runMeetingNotesSkillLoop(
  async () => ({ text: '```json\n{"calls":[{"tool":"add_decision","arguments":{"text":"Renew the lease"}},{"tool":"finish","arguments":{}}]}\n```', toolCalls: [] }),
  parts[0],
  createMeetingNotesSkillSession(CONTEXT, "general"),
);
assert.deepEqual(textModel.draft.decisions, ["Renew the lease"]);
assert.equal(textModel.finished, true);
// JSON mode, and the other shapes models use.
assert.equal(skillCallsFromText('[{"name":"add_decision","arguments":{"text":"A"}}]').length, 1);
assert.equal(skillCallsFromText('{"tool_calls":[{"function":{"name":"add_decision","arguments":"{\\"text\\":\\"B\\"}"}}]}').length, 1);
assert.equal(skillCallsFromText('{"calls":[{"tool":"rm_rf","arguments":{}}]}').length, 0, "unknown tools are dropped");
assert.equal(skillCallsFromText("no calls here").length, 0);
const merged = mergeSkillResults([
  applySkillCalls(createMeetingNotesSkillSession(CONTEXT, "general"), skillCallsFromText('{"calls":[{"tool":"write_summary","arguments":{"summary":"Part one.","sections":[{"heading":"Site","points":["A"]}]}},{"tool":"add_action_item","arguments":{"text":"Call Gabe"}}]}')),
  applySkillCalls(createMeetingNotesSkillSession(CONTEXT, "general"), skillCallsFromText('{"calls":[{"tool":"write_summary","arguments":{"summary":"Part two.","sections":[{"heading":"site","points":["B"]}]}},{"tool":"add_action_item","arguments":{"text":"call gabe"}}]}')),
]);
assert.equal(merged.draft.summary, "Part one. Part two.");
assert.deepEqual(merged.draft.sections, [{ heading: "Site", points: ["A", "B"] }]);
assert.equal(merged.draft.actionItems.length, 1);
console.log("✓ loop: refusals answered and corrected, stops at finish, calls written as text, parts merged");

// ---------- on-device: tool loop, CLI-hosted loop, and servers without tools ------
const replies = [
  { text: "", toolCalls: [{ id: "x", name: "add_decision", arguments: '{"text":"Go with Elm Street"}' }, { id: "y", name: "finish", arguments: "{}" }] },
];
const device = await draftNotesWithSkillOnDevice({
  client: { chatStep: async () => replies.shift()!, completeJson: async () => { throw new Error("unused"); } } as never,
  skill: { template: "general", notes: SKILL_FIXTURE_NOTES, transcript: SKILL_FIXTURE_TRANSCRIPT, context: CONTEXT },
  chunkChars: 120_000,
});
assert.deepEqual(device.draft.decisions, ["Go with Elm Street"]);
// Claude Code / Codex run the loop themselves and call tools through onToolCall.
const hostedLoop = await draftNotesWithSkillOnDevice({
  client: {
    chatStep: async (input: any) => {
      assert.match((await input.onToolCall({ callId: "1", name: "add_action_item", arguments: '{"text":"Send budget","owner_person_id":"pd_marcus"}' })).content, /Marcus/);
      const refusal = await input.onToolCall({ callId: "2", name: "add_action_item", arguments: '{"text":"x","goal_id":"nope"}' });
      assert.equal(refusal.isError, true, "the CLI's loop sees the refusal too");
      await input.onToolCall({ callId: "3", name: "finish", arguments: "{}" });
      return { text: "Done.", toolCalls: [] };
    },
    completeJson: async () => { throw new Error("unused"); },
  } as never,
  skill: { template: "general", notes: SKILL_FIXTURE_NOTES, transcript: "", context: CONTEXT },
  chunkChars: 120_000,
});
assert.deepEqual(hostedLoop.draft.actionItems.map((item) => item.assigneePersonId), ["pd_marcus"]);
const jsonFallback = await draftNotesWithSkillOnDevice({
  client: {
    chatStep: async () => { throw new DeviceAiError("tools_unsupported", "no tools"); },
    completeJson: async (input: any) => {
      assert.match(input.messages.at(-1).content, /"calls"/, "JSON mode gets the calls instruction");
      return { text: '{"calls":[{"tool":"add_open_question","arguments":{"text":"Who signs?"}}]}', jsonMode: "json_schema" };
    },
  } as never,
  skill: { template: "general", notes: SKILL_FIXTURE_NOTES, transcript: "", context: CONTEXT },
  chunkChars: 120_000,
});
assert.deepEqual(jsonFallback.draft.openQuestions, ["Who signs?"]);
console.log("✓ on-device: tool loop, CLI-hosted loop through onToolCall, JSON mode when tools are refused");

// ---------- local runtime: the roster query and saving suggestions -----------------
const societyId = "skill_society";
const at = "2026-01-01T00:00:00.000Z";
const client = new StaticConvexClient({ seed: {
  societies: [{ _id: societyId, name: "Skill test", jurisdictionCode: "CA-BC", entityType: "society" }],
  peopleDirectory: [
    { _id: "pd_marcus", societyId, fullName: "Marcus Oyelaran", searchName: "marcus oyelaran", createdAtISO: at },
    { _id: "pd_priya", societyId, fullName: "Priya Raman", searchName: "priya raman", aliases: ["P. Raman"], createdAtISO: at },
    { _id: "pd_old", societyId, fullName: "Old Duplicate", searchName: "old duplicate", mergedIntoId: "pd_priya", createdAtISO: at },
  ],
  directors: [
    { _id: "dir_1", societyId, directoryPersonId: "pd_marcus", firstName: "Marcus", lastName: "Oyelaran", position: "Treasurer", status: "Active", isBCResident: true, consentOnFile: true, createdAtISO: at },
    { _id: "dir_2", societyId, firstName: "Former", lastName: "Director", position: "Chair", status: "Resigned", isBCResident: true, consentOnFile: true, createdAtISO: at },
  ],
  committees: [
    { _id: "com_fin", societyId, name: "Finance Committee", cadence: "Monthly", status: "Active", createdAtISO: at },
    { _id: "com_old", societyId, name: "Old Committee", cadence: "Monthly", status: "Dissolved", createdAtISO: at },
  ],
  committeeMembers: [{ _id: "cm_1", societyId, committeeId: "com_fin", personId: "pd_marcus", name: "Marcus Oyelaran", role: "Chair", createdAtISO: at }],
  employees: [
    { _id: "emp_1", societyId, firstName: "Priya", lastName: "Raman", role: "Executive Director", startDate: "2024-01-01", employmentType: "FullTime", cppExempt: false, eiExempt: false },
    { _id: "emp_2", societyId, firstName: "Gone", lastName: "Staffer", role: "Clerk", startDate: "2020-01-01", endDate: "2021-01-01", employmentType: "FullTime", cppExempt: false, eiExempt: false },
  ],
  volunteers: [{ _id: "vol_1", societyId, firstName: "Sam", lastName: "Cho", status: "Active", committeeId: "com_fin", createdAtISO: at }],
  goals: [
    { _id: "goal_1", societyId, title: "Raise $150k", category: "Funding", status: "Active", startDate: "2026-01-01", targetDate: "2026-12-31", progressPercent: 10, milestones: [], createdAtISO: at },
    { _id: "goal_done", societyId, title: "Old goal", category: "Funding", status: "Completed", startDate: "2025-01-01", targetDate: "2025-12-31", progressPercent: 100, milestones: [], createdAtISO: at },
  ],
  meetings: [{ _id: "m_skill", societyId, type: "Working", title: "Ops check-in", scheduledAt: "2026-11-12T17:00:00.000Z", electronic: true, status: "Held", attendeeIds: ["Priya Raman", "Guest Person"], recordKind: "notes", committeeId: "com_fin" }],
  transcripts: [{
    _id: "tr_1", societyId, meetingId: "m_skill", provider: "vtt", text: "", demo: false, createdAtISO: at,
    segments: [
      { speaker: "SPEAKER_00", text: "Hi everyone, Priya here, thanks for making time today.", startSec: 0, endSec: 4 },
      { speaker: "SPEAKER_01", text: "As treasurer I have the revised numbers for the Foundation.", startSec: 5, endSec: 9 },
      { speaker: "SPEAKER_01", text: "Okay.", startSec: 10, endSec: 11 },
    ],
    speakers: [{ label: "SPEAKER_00", name: "Priya Raman", personId: "pd_priya" }],
  }],
} });
await client.whenLocalWorkspaceReady();
const context = await client.query("meetings:notesSkillContext", { id: "m_skill" }) as any;
assert.equal(context.meeting.committeeName, "Finance Committee");
const byName = new Map(context.people.map((person: any) => [person.name, person]));
assert.deepEqual(byName.get("Marcus Oyelaran"), { id: "pd_marcus", name: "Marcus Oyelaran", roles: ["Finance Committee: Chair", "Director: Treasurer"] });
assert.equal((byName.get("Priya Raman") as any).id, "pd_priya");
assert.deepEqual((byName.get("Priya Raman") as any).aliases, ["P. Raman"]);
assert.equal((byName.get("Priya Raman") as any).attendee, true);
assert.ok((byName.get("Priya Raman") as any).roles.includes("Staff: Executive Director"), "staff roles join the directory person by name");
assert.deepEqual((byName.get("Sam Cho") as any).roles, ["Volunteer: Finance Committee"]);
assert.equal((byName.get("Guest Person") as any).attendee, true, "attendees named only on the meeting are included");
for (const gone of ["Former Director", "Gone Staffer", "Old Duplicate"]) assert.ok(!byName.has(gone), `${gone} is left out`);
assert.equal(context.people[0].attendee, true, "attendees come first");
assert.deepEqual(context.goals, [{ id: "goal_1", title: "Raise $150k" }], "closed goals left out");
assert.deepEqual(context.committees, [{ id: "com_fin", name: "Finance Committee" }], "dissolved committees left out");
assert.deepEqual(context.speakers.map((speaker: any) => [speaker.label, speaker.name ?? null, speaker.segments, speaker.sample.length]), [["SPEAKER_01", null, 2, 1], ["SPEAKER_00", "Priya Raman", 1, 1]], "short lines aren't samples");

await client.mutation("meetings:saveNotesDraft", {
  id: "m_skill",
  template: "general",
  draft: { summary: "Ops.", actionItems: [
    { text: "Send budget", assignee: "Marcus Oyelaran", assigneePersonId: "pd_marcus", goalId: "goal_1", committeeId: "com_fin" },
    { text: "Forged links", assigneePersonId: "pd_nobody", goalId: "goal_other_ws", committeeId: "bad id with spaces" },
  ], quotes: [
    { text: "“As treasurer I have the revised numbers for the Foundation.”", speaker: "Made up", atSec: 999 },
    { text: "I'll send the revised budget." },
    { text: "have the revised numbers" },
    { text: "  " },
  ] },
  speakers: [
    { label: "SPEAKER_01", name: "Marcus Oyelaran", personId: "pd_marcus", evidence: "As treasurer" },
    { label: "SPEAKER_02", name: "Nobody", personId: "pd_nobody", evidence: "x" },
    { label: "", name: "No label", evidence: "x" },
  ],
  generatedBy: "test",
  usedNotes: true,
  usedTranscript: true,
});
const tables = () => client.exportLocalWorkspaceSnapshot().tables as Record<string, any[]>;
const saved = tables().meetings.find((row) => row._id === "m_skill");
assert.deepEqual(
  saved.noteActionItems.map((item: any) => [item.text, item.assigneePersonId ?? null, item.goalId ?? null, item.committeeId ?? null]),
  [["Send budget", "pd_marcus", "goal_1", "com_fin"], ["Forged links", null, null, null]],
  "suggested links survive only when they name this workspace's records",
);
assert.deepEqual(saved.notesDraft.speakerSuggestions, [
  { label: "SPEAKER_01", name: "Marcus Oyelaran", personId: "pd_marcus", evidence: "As treasurer" },
  { label: "SPEAKER_02", name: "Nobody", evidence: "x" },
]);
assert.deepEqual(
  saved.notesDraft.quotes,
  [{ text: "As treasurer I have the revised numbers for the Foundation.", speaker: "SPEAKER_01", atSec: 5 }],
  "saving re-checks quotes against the transcript: speaker and time from the line; quotes not in it, or clipped, are dropped",
);
assert.equal(saved.notesDraft.attendeeSuggestions, undefined, "no attendee suggestions any more");
// Applying a suggestion goes through the existing speaker assignment.
await client.mutation("transcripts:assignSpeaker", { societyId, meetingId: "m_skill", label: "SPEAKER_01", name: "Marcus Oyelaran", personId: "pd_marcus" });
const named = tables().transcripts.find((row) => row._id === "tr_1").speakers;
assert.ok(named.some((speaker: any) => speaker.label === "SPEAKER_01" && speaker.personId === "pd_marcus"));
console.log("✓ local runtime: roster with roles and aliases, attendees first, closed records left out; suggestions saved with checked ids");

// ---------- replays: what models actually called -----------------------------------
// Recorded from model runs given exactly meetingNotesSkillSystemPrompt, the tools
// and meetingNotesSkillUserPrompt for each fixture (a larger and a smaller model).
// They pin the interpreter to real model output and the fixtures' expectations.
for (const [fixture, model] of [["a", "default"], ["a", "small"], ["b", "default"], ["b", "small"]] as const) {
  const replay = readFileSync(new URL(`./fixtures/meeting-notes-skill-replays/${fixture}-${model}.json`, import.meta.url), "utf8");
  const spec: any = fixture === "a"
    ? { context: CONTEXT, template: "general", expected: SKILL_FIXTURE_EXPECTED }
    : { context: SKILL_FIXTURE_B.context, template: SKILL_FIXTURE_B.template, expected: SKILL_FIXTURE_B.expected };
  const transcript = fixture === "a" ? SKILL_FIXTURE_TRANSCRIPT : SKILL_FIXTURE_B.transcript;
  const run = applySkillCalls(createMeetingNotesSkillSession(spec.context, spec.template, { transcript }), skillCallsFromText(replay));
  const where = `${fixture}-${model}`;
  assert.equal(run.refused.length, 0, `${where}: no refused calls`);
  assert.ok(run.finished && run.draft.summary, `${where}: summary and finish`);
  for (const want of spec.expected.actions) {
    const hit = run.draft.actionItems.find((item) => want.match.test(item.text));
    assert.ok(hit, `${where}: action ${want.match}`);
    if (want.owner) assert.equal(hit!.assigneePersonId, want.owner, `${where}: owner of ${want.match}`);
    if (want.ownerName) assert.match(hit!.assignee ?? "", want.ownerName, `${where}: owner name of ${want.match}`);
    if (want.dueDate) assert.equal(hit!.dueDate, want.dueDate, `${where}: due date of ${want.match}`);
    if (want.goal) assert.equal(hit!.goalId, want.goal, `${where}: goal of ${want.match}`);
    if (want.noPersonOwner) assert.equal(hit!.assigneePersonId, undefined, `${where}: ${want.match} has no person owner`);
  }
  for (const id of spec.expected.neverOwners) assert.ok(!run.draft.actionItems.some((item) => item.assigneePersonId === id), `${where}: never assigned to ${id}`);
  for (const [label, want] of Object.entries(spec.expected.speakers) as Array<[string, string | RegExp]>) {
    const speaker = run.speakers.find((item) => item.label === label);
    assert.ok(speaker && (typeof want === "string" ? speaker.personId === want : want.test(speaker.name)), `${where}: ${label}`);
  }
  for (const label of spec.expected.unidentifiable) assert.ok(!run.speakers.some((item) => item.label === label), `${where}: ${label} stays unnamed`);
  for (const pattern of spec.expected.decisions) assert.ok(run.draft.decisions.some((item: string) => pattern.test(item)), `${where}: decision ${pattern}`);
  for (const pattern of spec.expected.notDecisions ?? []) assert.ok(!run.draft.decisions.some((item: string) => pattern.test(item)), `${where}: not a decision ${pattern}`);
  // Quotes: a few, every one word for word from the transcript (none refused).
  const quotes = run.draft.quotes ?? [];
  assert.ok(quotes.length >= 1 && quotes.length <= 3, `${where}: one to three quotes`);
  assert.ok(!run.refused.some((item) => item.tool === "add_quote"), `${where}: every quote is in the transcript`);
  for (const quote of quotes) assert.ok(quote.atSec !== undefined && quote.speaker, `${where}: quote has speaker and time`);
}
console.log("✓ replays: four recorded model runs meet every expectation (owners, dates, goals, speakers, verbatim quotes, no over-assignment)");

// ---------- "Use your own AI": copy a prompt, paste the JSON back -------------------------
{
  const input = { template: "general" as const, notes: SKILL_FIXTURE_NOTES, transcript: SKILL_FIXTURE_TRANSCRIPT, context: CONTEXT };
  const full = buildManualNotesPrompt({ ...input, sections: manualPromptSectionState(), requirements: "Keep the summary short." });
  assert.match(full, /Return ONLY one JSON object/);
  assert.match(full, /"calls": \[\{"tool": "<tool name>"/);
  for (const tool of ["write_summary", "add_decision", "add_open_question", "add_action_item", "add_quote", "identify_speaker", "finish"]) assert.match(full, new RegExp(`- ${tool}: `), `${tool} is described`);
  assert.match(full, /pd_marcus \| Marcus Oyelaran \| Director: Treasurer/, "the people, with their ids and roles");
  assert.match(full, /goal_grants \| Raise \$150k/);
  assert.match(full, /Note-taker's notes:\n/);
  assert.match(full, /Transcript:\n\[0:00\] SPEAKER_00: Hi everyone, Priya here/);
  assert.ok(full.trimEnd().endsWith("Additional requirements from the person:\nKeep the summary short."), "their requirements come last");
  const core = buildManualNotesPrompt({ ...input, sections: manualPromptSectionState(["transcript", "notes"]) });
  assert.ok(!/- identify_speaker: /.test(core) && !/- add_quote: /.test(core), "switched-off tools aren't offered");
  assert.match(core, /Don't call identify_speaker\./);
  assert.match(core, /No People list is given: use owner_name/);
  assert.ok(!core.includes("pd_marcus"), "no people when People is off");
  const attached = buildManualNotesPrompt({ ...input, sections: manualPromptSectionState(["notes", "people"]) });
  assert.match(attached, /Transcript: attached separately/);
  assert.ok(!attached.includes("Elm Street is the only one"), "the transcript stays out when it's attached instead");

  // A reply pasted back runs through the same checks as the built-in AI's.
  const replay = readFileSync(new URL("./fixtures/meeting-notes-skill-replays/a-default.json", import.meta.url), "utf8");
  const pasted = importManualNotesReply(`Here you go:\n\`\`\`json\n${replay}\n\`\`\``, { template: "general", context: CONTEXT, transcript: SKILL_FIXTURE_TRANSCRIPT });
  assert.ok(pasted.ok, "a reply wrapped in prose and a code fence still imports");
  if (pasted.ok) {
    assert.ok(pasted.result.draft.actionItems.some((item) => item.assigneePersonId === "pd_marcus"));
    assert.ok((pasted.result.draft.quotes ?? []).length > 0);
  }
  const forged = importManualNotesReply(JSON.stringify({ calls: [
    { tool: "write_summary", arguments: { summary: "Ops.", sections: [] } },
    { tool: "add_action_item", arguments: { text: "Do it", owner_person_id: "pd_nobody" } },
    { tool: "add_quote", arguments: { text: "We will triple the budget next year." } },
  ] }), { template: "general", context: CONTEXT, transcript: SKILL_FIXTURE_TRANSCRIPT });
  assert.ok(forged.ok);
  if (forged.ok) {
    assert.deepEqual(forged.result.refused.map((item) => item.tool), ["add_quote"], "a made-up quote is left out, with the reason");
    // A pasted reply can't be resent: an unknown owner drops the owner, not the action.
    assert.deepEqual(forged.result.draft.actionItems, [{ text: "Do it" }]);
    assert.match(forged.result.adjusted?.[0]?.reason ?? "", /"Do it": its owner isn't in the People list/);
  }
  assert.deepEqual(importManualNotesReply("", { template: "general", context: CONTEXT, transcript: "" }), { ok: false, error: "Paste the JSON your AI returned." });
  assert.match((importManualNotesReply("Sorry, I can't help with that.", { template: "general", context: CONTEXT, transcript: "" }) as { error: string }).error, /isn't JSON/);
  assert.match((importManualNotesReply('{"summary": "x"}', { template: "general", context: CONTEXT, transcript: "" }) as { error: string }).error, /No tool calls were found/);
}
console.log("✓ your own AI: prompt with rules, tools, people and transcript, blocks switch off; pasted replies checked like the built-in AI's");

// ---------- hosted provider adapter -----------------------------------------------
const realFetch = globalThis.fetch;
const sent: any[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  sent.push(JSON.parse(String(init.body)));
  return new Response(JSON.stringify(reply.body), { status: reply.status });
}) as typeof fetch;
try {
  const history = [
    { role: "system" as const, content: "SYS" },
    { role: "user" as const, content: "USER" },
    { role: "assistant" as const, content: null, tool_calls: [{ id: "t1", type: "function" as const, function: { name: "add_decision", arguments: '{"text":"A"}' } }, { id: "t2", type: "function" as const, function: { name: "finish", arguments: "{}" } }] },
    { role: "tool" as const, tool_call_id: "t1", content: "Recorded." },
    { role: "tool" as const, tool_call_id: "t2", content: "Done." },
  ];
  // Anthropic: system apart, tools as input_schema, calls as tool_use, results grouped as tool_result.
  reply = { status: 200, body: { content: [{ type: "text", text: "Thinking" }, { type: "tool_use", id: "u1", name: "add_decision", input: { text: "B" } }] } };
  const anthropic = await toolStep({ kind: "anthropic", url: "https://api.anthropic.test/v1/messages", apiKey: "k", model: "m", source: "environment" })(history, MEETING_NOTES_TOOLS);
  assert.deepEqual(anthropic, { text: "Thinking", toolCalls: [{ id: "u1", name: "add_decision", arguments: { text: "B" } }] });
  const anthropicBody = sent.at(-1);
  assert.equal(anthropicBody.system, "SYS");
  assert.equal(anthropicBody.tools[0].name, "write_summary");
  assert.ok(anthropicBody.tools[0].input_schema.properties.summary);
  assert.deepEqual(anthropicBody.messages.map((message: any) => message.role), ["user", "assistant", "user"]);
  assert.deepEqual(anthropicBody.messages[1].content.map((block: any) => block.type), ["tool_use", "tool_use"]);
  assert.deepEqual(anthropicBody.messages[1].content[0].input, { text: "A" });
  assert.deepEqual(anthropicBody.messages[2].content.map((block: any) => [block.type, block.tool_use_id]), [["tool_result", "t1"], ["tool_result", "t2"]], "both results in one user turn");
  // OpenAI-compatible: the wire messages and tools go as they are.
  reply = { status: 200, body: { choices: [{ message: { content: null, tool_calls: [{ id: "o1", type: "function", function: { name: "finish", arguments: "{}" } }] } }] } };
  const openai = await toolStep({ kind: "openai-compatible", url: "https://api.openai.test/v1/chat/completions", apiKey: "k", model: "m", source: "environment", jsonModes: ["json_object"] })(history, MEETING_NOTES_TOOLS);
  assert.deepEqual(openai.toolCalls, [{ id: "o1", name: "finish", arguments: "{}" }]);
  assert.equal(sent.at(-1).tools.length, MEETING_NOTES_TOOLS.length);
  assert.equal(sent.at(-1).messages[2].tool_calls[0].id, "t1");
  // A server that refuses tools is reported so the caller can use JSON mode.
  reply = { status: 400, body: { error: { message: "This model does not support tools" } } };
  await assert.rejects(
    () => toolStep({ kind: "openai-compatible", url: "https://api.openai.test/v1/chat/completions", apiKey: "k", model: "m", source: "environment", jsonModes: ["json_object"] })(history, MEETING_NOTES_TOOLS),
    (error: unknown) => error instanceof ToolsUnsupportedError,
  );
} finally {
  globalThis.fetch = realFetch;
}
console.log("✓ hosted adapter: Anthropic tool_use / tool_result conversion, OpenAI tools, refusal of tools detected");

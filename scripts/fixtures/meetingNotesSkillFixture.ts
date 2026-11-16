/**
 * A synthetic meeting for the meeting notes skill (shared/ai/meetingNotesSkill.ts):
 * an organization's people, goals and committees, rough notes and a diarized
 * transcript with deliberate traps, plus what a good write-up must contain.
 *
 * Traps: a director who is mentioned but absent (Dana), an outside guest who
 * isn't in the People list (Gabe), two people who could be "Sam" (the
 * volunteer on the Events Committee runs the raffle), relative due dates
 * ("next Friday" from Thursday 12 November 2026), an action nobody took on,
 * a speaker only identifiable by role, and a speaker label with no evidence.
 */
import type { MeetingNotesSkillContext } from "../../shared/ai/meetingNotesSkill";

export const SKILL_FIXTURE_CONTEXT: MeetingNotesSkillContext = {
  meeting: { title: "Operations check-in", date: "2026-11-12", body: "Working" },
  people: [
    { id: "pd_priya", name: "Priya Raman", roles: ["Staff: Executive Director"], attendee: true },
    { id: "pd_marcus", name: "Marcus Oyelaran", roles: ["Director: Treasurer", "Finance Committee: Chair"] },
    { id: "pd_li", name: "Li Wei", roles: ["Staff: Volunteer Coordinator"] },
    { id: "pd_dana", name: "Dana Whitfield", roles: ["Director: Chair", "Finance Committee: Member"] },
    { id: "pd_jo", name: "Jo-Anne Mackenzie", aliases: ["Jo"], roles: ["Director: Secretary"] },
    { id: "pd_samuel", name: "Samuel Cho", aliases: ["Sam Cho"], roles: ["Volunteer: Events Committee"] },
    { id: "pd_samantha", name: "Samantha Ortiz", roles: ["Member"] },
    { id: "pd_tomas", name: "Tomás Reyes", roles: ["Staff: Warehouse Lead"] },
  ],
  goals: [
    { id: "goal_site", title: "Open a second distribution site by fall 2026" },
    { id: "goal_grants", title: "Raise $150k in grants for 2026" },
  ],
  committees: [
    { id: "com_finance", name: "Finance Committee" },
    { id: "com_events", name: "Events Committee" },
  ],
  speakers: [
    { label: "SPEAKER_00", segments: 7, sample: ["Hi everyone, Priya here, thanks for making time.", "Marcus, can you walk us through where the Foundation budget is?"] },
    { label: "SPEAKER_01", segments: 4, sample: ["Sure. As treasurer I've got the revised numbers, the Foundation wants them by next Friday."] },
    { label: "SPEAKER_02", segments: 3, sample: ["From the volunteer side we're short about ten people for the hamper drive."] },
    { label: "SPEAKER_03", segments: 3, sample: ["Gabe from the City's parks department, I can speak to the zoning question."] },
    { label: "SPEAKER_04", segments: 1, sample: ["Yeah, sounds good."] },
  ],
};

export const SKILL_FIXTURE_NOTES = [
  "- Elm St site: go?",
  "- budget to Foundation (Marcus)",
  "- hampers: need vols",
  "- ask Gabe re zoning",
  "- freezer warranty??",
].join("\n");

export const SKILL_FIXTURE_TRANSCRIPT = [
  "[0:00] SPEAKER_00: Hi everyone, Priya here, thanks for making time. Dana couldn't make it today, she sends her regrets.",
  "[0:09] SPEAKER_00: First up, the Elm Street site. We've looked at three options and Elm Street is the only one with a loading dock.",
  "[0:31] SPEAKER_01: The rent works if the Foundation grant comes through. I'm comfortable with it.",
  "[0:40] SPEAKER_00: Okay, so we agree we go with Elm Street. I'll draft the lease letter by December 1st.",
  "[0:52] SPEAKER_04: Yeah, sounds good.",
  "[1:05] SPEAKER_00: Marcus, can you walk us through where the Foundation budget is?",
  "[1:10] SPEAKER_01: Sure. As treasurer I've got the revised numbers, the Foundation wants them by next Friday. I'll send the revised budget to them before then.",
  "[1:38] SPEAKER_00: Great. Next, the hamper drive.",
  "[1:44] SPEAKER_02: From the volunteer side we're short about ten people for the hamper drive. I can put out a call and recruit them over the next two weeks.",
  "[2:10] SPEAKER_02: And Sam from the events committee said he'll run the raffle again this year.",
  "[2:22] SPEAKER_00: Perfect. Gabe, thanks for joining from the City.",
  "[2:26] SPEAKER_03: Gabe from the City's parks department, I can speak to the zoning question. Elm Street is zoned for warehouse use, so you're fine. I'll email you the zoning letter this week.",
  "[2:58] SPEAKER_00: That's a relief. One thing we haven't settled: does the board sign the lease, or can I as executive director?",
  "[3:08] SPEAKER_01: I think that's a board call. Let's ask Jo-Anne to check the bylaws.",
  "[3:20] SPEAKER_00: Also the walk-in freezer warranty expires soon. Someone should check what it covers.",
  "[3:31] SPEAKER_02: Last thing, we approved switching to the new freezer supplier last month, so that's done.",
  "[3:40] SPEAKER_03: Sorry, which supplier was that?",
  "[3:44] SPEAKER_00: Northern Cold. Okay, thanks everyone.",
].join("\n");

/** What a correct write-up must include; checked by scripts/check-meeting-notes-skill.ts. */
export const SKILL_FIXTURE_EXPECTED = {
  actions: [
    { match: /budget/i, owner: "pd_marcus", dueDate: "2026-11-20", goal: "goal_grants" },
    { match: /lease letter/i, owner: "pd_priya", dueDate: "2026-12-01", goal: "goal_site" },
    { match: /(recruit|volunteer)/i, owner: "pd_li" },
    { match: /raffle/i, owner: "pd_samuel" },
    { match: /zoning/i, ownerName: /gabe/i },
  ],
  /** Owners that must never appear. */
  neverOwners: ["pd_dana", "pd_samantha"],
  speakers: { SPEAKER_00: "pd_priya", SPEAKER_01: "pd_marcus", SPEAKER_03: /gabe/i } as Record<string, string | RegExp>,
  /** Labels that have no evidence and must stay unnamed. */
  unidentifiable: ["SPEAKER_04"],
  decisions: [/elm/i],
};

/**
 * A 1:1 built to catch over-eager assignment: two staff share a role, so
 * "from the program side" identifies nobody; an action that unidentified
 * speaker takes on must stay unowned (or carry its speaker label); a
 * decision reported from last week is not this meeting's decision; a
 * request to someone outside the meeting has no owner.
 */
export const SKILL_FIXTURE_B = {
  template: "one_on_one" as const,
  context: {
    meeting: { title: "Program check-in", date: "2026-11-12", body: "Working" },
    people: [
      { id: "pd_ed", name: "Edwin Park", roles: ["Staff: Executive Director"] },
      { id: "pd_ana", name: "Ana Kowalski", roles: ["Staff: Program Coordinator"] },
      { id: "pd_ben", name: "Ben Osei", roles: ["Staff: Program Coordinator"] },
    ],
    goals: [{ id: "goal_youth", title: "Run 12 youth workshops in 2026" }],
    committees: [],
    speakers: [
      { label: "SPEAKER_00", segments: 4, sample: ["From the program side, we're behind on the youth workshop."] },
      { label: "SPEAKER_01", segments: 4, sample: ["As ED I'd rather we move it than rush it."] },
    ],
  } satisfies MeetingNotesSkillContext,
  notes: "- workshop slipping\n- drop-in?\n- gym booking",
  transcript: [
    "[0:00] SPEAKER_01: Thanks for making time. How are things?",
    "[0:04] SPEAKER_00: From the program side, we're behind on the youth workshop. The facilitator cancelled.",
    "[0:20] SPEAKER_01: As ED I'd rather we move it than rush it. Okay, decided: we move the youth workshop to January.",
    "[0:35] SPEAKER_00: Makes sense. I'll finish the new workshop outline by this Friday.",
    "[0:48] SPEAKER_01: Good. And the Tuesday drop-in, we already decided last week to cancel that, right?",
    "[0:55] SPEAKER_00: Yes, that's done.",
    "[1:02] SPEAKER_01: Let's ask Carla in finance to cut the cheque for the January facilitator.",
    "[1:15] SPEAKER_00: Sounds good. How do you think I'm doing with the new role?",
    "[1:20] SPEAKER_01: Honestly, really well. Keep it up.",
  ].join("\n"),
  expected: {
    actions: [
      { match: /outline/i, noPersonOwner: true, dueDate: "2026-11-13" },
      { match: /(cheque|check|facilitator)/i, noPersonOwner: true },
    ],
    neverOwners: ["pd_ana", "pd_ben"],
    speakers: { SPEAKER_01: "pd_ed" } as Record<string, string | RegExp>,
    unidentifiable: ["SPEAKER_00"],
    decisions: [/january/i],
    notDecisions: [/drop-in/i],
  },
};

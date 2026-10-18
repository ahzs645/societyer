/**
 * What a meeting keeps (`meetings.recordKind`): just the meeting, informal
 * notes, or formal minutes. A meeting without the field keeps formal minutes,
 * so every meeting created before the field existed behaves exactly as before.
 *
 * Pure module: shared by the hosted mutations, the local runtime and the UI.
 */

export const MEETING_RECORD_KINDS = ["meeting", "notes", "minutes"] as const;
export type MeetingRecordKind = (typeof MEETING_RECORD_KINDS)[number];

/** Working notes are a document, not a transcript dump. Keeps rows well under the 1 MB document limit. */
export const MEETING_WORKING_NOTES_MAX_LENGTH = 100_000;

export const MEETING_RECORD_KIND_OPTIONS: ReadonlyArray<{ value: MeetingRecordKind; label: string; hint: string }> = [
  { value: "meeting", label: "Just the meeting", hint: "Date, attendees, materials. No write-up." },
  { value: "notes", label: "Meeting notes", hint: "Informal notes, optionally with a transcript." },
  { value: "minutes", label: "Formal minutes", hint: "Agenda, motions, quorum and approval." },
];

export function isMeetingRecordKind(value: unknown): value is MeetingRecordKind {
  return typeof value === "string" && (MEETING_RECORD_KINDS as readonly string[]).includes(value);
}

/** The kind a meeting keeps. Absent (or unrecognised) means formal minutes. */
export function meetingRecordKind(meeting: { recordKind?: string | null } | null | undefined): MeetingRecordKind {
  const kind = meeting?.recordKind;
  return isMeetingRecordKind(kind) ? kind : "minutes";
}

/**
 * The default for a new meeting of `type`: formal minutes for the board and
 * general meetings (AGM, SGM), informal notes for committees and anything else.
 */
export function defaultRecordKindForType(type: string | null | undefined): MeetingRecordKind {
  const value = String(type ?? "").trim().toLowerCase();
  return value === "board" || value === "agm" || value === "sgm" ? "minutes" : "notes";
}

export const MEETING_DETAIL_TABS = ["overview", "minutes", "notes", "transcript", "motions", "package", "export", "sources"] as const;
export type MeetingDetailTabId = (typeof MEETING_DETAIL_TABS)[number];

const TABS_BY_KIND: Record<MeetingRecordKind, readonly MeetingDetailTabId[]> = {
  minutes: ["overview", "minutes", "transcript", "motions", "package", "export", "sources"],
  notes: ["overview", "notes", "transcript", "package", "sources"],
  meeting: ["overview", "transcript", "package", "sources"],
};

/** The meeting page tabs shown for a record kind, in display order. */
export function visibleMeetingTabs(kind: MeetingRecordKind): readonly MeetingDetailTabId[] {
  return TABS_BY_KIND[kind];
}

/**
 * The tab to show for a requested `?tab=` value. Deep links keep working
 * across kinds: `minutes` on a notes meeting opens Notes and `notes` on a
 * minutes meeting opens Agenda & minutes. Anything else hidden falls back to
 * Overview.
 */
export function resolveMeetingTab(requested: string | null | undefined, kind: MeetingRecordKind): MeetingDetailTabId {
  const visible = visibleMeetingTabs(kind);
  if (requested === "minutes" && kind === "notes") return "notes";
  if (requested === "notes" && kind === "minutes") return "minutes";
  const match = visible.find((tab) => tab === requested);
  return match ?? "overview";
}

export type MeetingRecordStepId = "transcript" | "notes" | "minutesDraft" | "approved";
export type MeetingRecordStepState = "done" | "current" | "upcoming";
export type MeetingRecordStep = { id: MeetingRecordStepId; label: string; state: MeetingRecordStepState };

/**
 * Progress steps for the Notes and Agenda & minutes tabs, from real state.
 * The transcript is optional, so it never becomes the current step. Minutes
 * meetings only show the Notes step when there are notes. The current step is
 * the first unfinished required step; with everything done there is none.
 */
export function meetingRecordSteps(input: {
  kind: MeetingRecordKind;
  hasTranscript: boolean;
  hasNotes: boolean;
  minutesStarted: boolean;
  minutesApproved: boolean;
}): MeetingRecordStep[] {
  if (input.kind === "meeting") return [];
  const steps: Array<{ id: MeetingRecordStepId; label: string; done: boolean; optional: boolean }> = [
    { id: "transcript", label: "Transcript", done: input.hasTranscript, optional: true },
  ];
  if (input.kind === "notes" || input.hasNotes) {
    steps.push({ id: "notes", label: "Notes", done: input.hasNotes, optional: input.kind === "minutes" });
  }
  steps.push(
    { id: "minutesDraft", label: "Minutes draft", done: input.minutesStarted || input.minutesApproved, optional: false },
    { id: "approved", label: "Approved", done: input.minutesApproved, optional: false },
  );
  const currentIndex = steps.findIndex((step) => !step.done && !step.optional);
  return steps.map((step, index) => ({
    id: step.id,
    label: step.label,
    state: step.done ? "done" : index === currentIndex ? "current" : "upcoming",
  }));
}

/**
 * The minutes discussion after seeding it with the meeting's notes. An empty
 * discussion takes the notes; existing text keeps its place and the notes
 * follow it, unless they are already there. Returns null when nothing changes.
 */
export function discussionSeededWithNotes(discussion: string | null | undefined, notes: string | null | undefined): string | null {
  const seed = String(notes ?? "").trim();
  if (!seed) return null;
  const current = String(discussion ?? "").trim();
  if (!current) return seed;
  if (current.includes(seed)) return null;
  return `${current}\n\n${seed}`;
}

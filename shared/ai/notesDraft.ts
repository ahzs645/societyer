/**
 * AI MEETING NOTES DRAFT, provider-neutral.
 *
 * For a meeting that keeps notes (`recordKind: "notes"`): the person's own
 * rough notes plus the transcript become a structured write-up — a summary,
 * sections shaped by a template, decisions, open questions and suggested
 * action items. The person's notes are read, never rewritten: the draft is
 * stored beside them (`meetings.notesDraft`).
 *
 * Hosted Convex (convex/meetings.ts `generateNotesDraft`) and the on-device
 * client (src/features/meetings/localNotesDraft.ts) both use this module, so
 * the same notes and transcript produce the same prompt and the same
 * normalised draft wherever the model runs.
 *
 * No network I/O and no Convex imports. Model output is untrusted: it is read
 * as `unknown` and every field is checked and bounded.
 */
import type { ChatMessage } from "./minutesDraft";
import { speakerResolver, type TranscriptSpeaker } from "../transcriptModel";
import { parseJsonObject } from "./minutesDraft";
import { splitTranscript } from "./minutesDraftChunks";

export const NOTES_DRAFT_TEMPLATE_IDS = ["general", "one_on_one", "check_in", "external_call"] as const;
export type NotesDraftTemplateId = (typeof NOTES_DRAFT_TEMPLATE_IDS)[number];

export type NotesDraftTemplate = {
  id: NotesDraftTemplateId;
  label: string;
  hint: string;
  /** Section headings the model fills, in order. */
  sections: readonly string[];
  /** What to listen for, in the prompt. */
  guidance: string;
};

export const NOTES_DRAFT_TEMPLATES: readonly NotesDraftTemplate[] = [
  {
    id: "general",
    label: "General meeting",
    hint: "Summary, discussion points, decisions and next steps.",
    sections: ["Discussion"],
    guidance: "Group the discussion by topic. Use one short heading per topic when there are several.",
  },
  {
    id: "one_on_one",
    label: "1:1",
    hint: "Updates, blockers, feedback and growth.",
    sections: ["Updates", "Challenges and blockers", "Feedback", "Goals and development"],
    guidance: "This is a one-to-one between a manager or mentor and a staff member or volunteer. Keep personal or sensitive remarks out unless the notes include them.",
  },
  {
    id: "check_in",
    label: "Check-in / stand-up",
    hint: "Progress, plans and blockers, per person.",
    sections: ["Progress since last time", "Plans until next time", "Blockers"],
    guidance: "Attribute progress and plans to the person who gave them, as \"Name: point\".",
  },
  {
    id: "external_call",
    label: "External call",
    hint: "A funder, partner, vendor or community call.",
    sections: ["Context", "What they asked or need", "What we shared or offered", "Commitments made"],
    guidance: "Record who the other organisation is and any commitments either side made, with dates when stated.",
  },
];

export function notesDraftTemplate(id: unknown): NotesDraftTemplate {
  return NOTES_DRAFT_TEMPLATES.find((template) => template.id === id) ?? NOTES_DRAFT_TEMPLATES[0];
}

export function isNotesDraftTemplateId(value: unknown): value is NotesDraftTemplateId {
  return (NOTES_DRAFT_TEMPLATE_IDS as readonly unknown[]).includes(value);
}

export type NotesDraftSection = { heading: string; points: string[] };

export type NotesDraftActionItem = {
  text: string;
  assignee?: string;
  /** YYYY-MM-DD only; anything else is dropped. */
  dueDate?: string;
  /** Seconds into the recording where the action was agreed. */
  atSec?: number;
  /** From the tool-calling skill (shared/ai/meetingNotesSkill.ts): ids it checked against the context. */
  assigneePersonId?: string;
  goalId?: string;
  committeeId?: string;
};

const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const recordId = (value: unknown) => (typeof value === "string" && RECORD_ID.test(value) ? value : undefined);

export type NotesDraft = {
  template: NotesDraftTemplateId;
  summary: string;
  sections: NotesDraftSection[];
  decisions: string[];
  openQuestions: string[];
  actionItems: NotesDraftActionItem[];
};

export type NotesDraftInput = {
  meetingTitle: string;
  meetingDate?: string;
  template: NotesDraftTemplateId;
  /** The person's own notes (Markdown). */
  notes: string;
  /** Transcript text; timed lines read "[mm:ss] Speaker: text". */
  transcript: string;
  attendees?: string[];
};

// Bounds on a stored draft: well under the 1 MB document limit.
export const NOTES_DRAFT_LIMITS = {
  summary: 4_000,
  heading: 120,
  point: 1_000,
  pointsPerSection: 40,
  sections: 16,
  listItems: 60,
  actionItems: 60,
  actionText: 500,
  assignee: 120,
} as const;
const MAX_REF_SEC = 24 * 60 * 60;

export const NOTES_DRAFT_SYSTEM_PROMPT = [
  "You write clear, factual meeting notes for a nonprofit team as strict JSON.",
  "You receive the note-taker's own rough notes and, when available, a transcript.",
  "The note-taker's notes show what they thought mattered: build on them, expand them with detail from the transcript, and never contradict them.",
  "Return only JSON with keys summary (2-4 sentences), sections (array of {heading, points[]}), decisions (string[]), openQuestions (string[]) and actionItems (array of {text, assignee?, dueDate?, atSec?}).",
  "An action item is a concrete next step someone agreed to; phrase it as \"Name to do something\" when an owner is clear.",
  "dueDate must be YYYY-MM-DD and only when a date was stated. atSec is the transcript time in seconds of the line where the action was agreed, read from its [mm:ss] or [h:mm:ss] prefix.",
  "Do not invent facts, names, dates or commitments. Leave a list empty rather than guess.",
].join(" ");

/** `4:05`, `1:02:03`: whole seconds, as the Transcript tab shows them. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** Seconds as a transcript prefix: `[4:05]`, `[1:02:03]`. */
export function transcriptLinePrefix(seconds: number): string {
  return `[${formatClock(seconds)}]`;
}

/** Transcript text for the prompt: each segment as "[mm:ss] Speaker: text". */
export function notesDraftTranscript(
  segments: ReadonlyArray<{ speaker: string; text: string; startSec: number }>,
  speakerName: (label: string) => string = (label) => label,
): string {
  return segments.map((segment) => `${transcriptLinePrefix(segment.startSec)} ${speakerName(segment.speaker)}: ${segment.text}`).join("\n");
}

/**
 * A working transcript row (as `transcripts:getByMeeting` returns it to this
 * reader, in-camera sessions already withheld) as prompt text: timed lines
 * with speaker names when it has segments, otherwise its text.
 */
export function notesDraftTranscriptFromRow(row: unknown): string {
  const transcript = asRow(row);
  if (!transcript) return "";
  const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
  if (segments.length) {
    const speakers = Array.isArray(transcript.speakers) ? (transcript.speakers as TranscriptSpeaker[]) : [];
    const resolver = speakerResolver(speakers);
    return notesDraftTranscript(segments as Array<{ speaker: string; text: string; startSec: number }>, resolver.name);
  }
  return typeof transcript.text === "string" ? transcript.text : "";
}

export function notesDraftUserPrompt(input: NotesDraftInput): string {
  const template = notesDraftTemplate(input.template);
  return [
    `Meeting: ${input.meetingTitle}`,
    input.meetingDate ? `Date: ${input.meetingDate}` : "",
    input.attendees?.length ? `Attendees: ${input.attendees.join(", ")}` : "",
    `Template: ${template.label}. Suggested section headings: ${template.sections.join("; ")}. ${template.guidance}`,
    "",
    "Note-taker's notes:",
    input.notes.trim() || "(none)",
    "",
    "Transcript:",
    input.transcript.trim() || "(none)",
  ].filter((line, index) => line !== "" || index > 3).join("\n");
}

export function buildNotesDraftMessages(input: NotesDraftInput): ChatMessage[] {
  return [
    { role: "system", content: NOTES_DRAFT_SYSTEM_PROMPT },
    { role: "user", content: notesDraftUserPrompt(input) },
  ];
}

export const NOTES_DRAFT_JSON_SCHEMA = {
  name: "meeting_notes_draft",
  strict: false,
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: { heading: { type: "string" }, points: { type: "array", items: { type: "string" } } },
          required: ["heading", "points"],
        },
      },
      decisions: { type: "array", items: { type: "string" } },
      openQuestions: { type: "array", items: { type: "string" } },
      actionItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            assignee: { type: "string" },
            dueDate: { type: "string" },
            atSec: { type: "number" },
          },
          required: ["text"],
        },
      },
    },
    required: ["summary", "sections", "decisions", "openQuestions", "actionItems"],
  },
} as const;

// ---------------------------------------------------------------------------
// Normalising untrusted replies
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : undefined;

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim().replace(/^[-*•]\s+/, "");
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function dedupe(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function stringList(value: unknown, max: number, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return dedupe(value.map((entry) => clean(entry, max)).filter((entry): entry is string => Boolean(entry)), limit);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeActionItem(value: unknown): NotesDraftActionItem | undefined {
  const row = asRow(value);
  const text = clean(row ? row.text : value, NOTES_DRAFT_LIMITS.actionText);
  if (!text) return undefined;
  const assignee = clean(row?.assignee, NOTES_DRAFT_LIMITS.assignee);
  const atSec = typeof row?.atSec === "number" && Number.isFinite(row.atSec) && row.atSec >= 0 && row.atSec <= MAX_REF_SEC
    ? Math.round(row.atSec * 10) / 10
    : undefined;
  const assigneePersonId = recordId(row?.assigneePersonId);
  const goalId = recordId(row?.goalId);
  const committeeId = recordId(row?.committeeId);
  return {
    text,
    ...(assignee ? { assignee } : {}),
    ...(isIsoDate(row?.dueDate) ? { dueDate: row!.dueDate as string } : {}),
    ...(atSec !== undefined ? { atSec } : {}),
    ...(assigneePersonId ? { assigneePersonId } : {}),
    ...(goalId ? { goalId } : {}),
    ...(committeeId ? { committeeId } : {}),
  };
}

export function normalizeNotesActionItems(value: unknown): NotesDraftActionItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: NotesDraftActionItem[] = [];
  for (const entry of value) {
    const item = normalizeActionItem(entry);
    if (!item) continue;
    const key = actionKey(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= NOTES_DRAFT_LIMITS.actionItems) break;
  }
  return out;
}

function normalizeSections(value: unknown): NotesDraftSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sections: NotesDraftSection[] = [];
  for (const entry of value) {
    const row = asRow(entry);
    const heading = clean(row?.heading, NOTES_DRAFT_LIMITS.heading);
    const points = stringList(row?.points, NOTES_DRAFT_LIMITS.point, NOTES_DRAFT_LIMITS.pointsPerSection) ?? [];
    if (!heading || !points.length) continue;
    sections.push({ heading, points });
    if (sections.length >= NOTES_DRAFT_LIMITS.sections) break;
  }
  return sections;
}

/** A normalised draft from an untrusted value, over a fallback for missing fields. */
export function normalizeNotesDraft(raw: unknown, fallback: NotesDraft): NotesDraft {
  const row = asRow(raw);
  if (!row) return fallback;
  return {
    template: fallback.template,
    summary: clean(row.summary, NOTES_DRAFT_LIMITS.summary) ?? fallback.summary,
    sections: normalizeSections(row.sections) ?? fallback.sections,
    decisions: stringList(row.decisions, NOTES_DRAFT_LIMITS.point, NOTES_DRAFT_LIMITS.listItems) ?? fallback.decisions,
    openQuestions: stringList(row.openQuestions, NOTES_DRAFT_LIMITS.point, NOTES_DRAFT_LIMITS.listItems) ?? fallback.openQuestions,
    actionItems: normalizeNotesActionItems(row.actionItems) ?? fallback.actionItems,
  };
}

export function parseNotesDraft(text: string, fallback: NotesDraft): NotesDraft {
  return normalizeNotesDraft(parseJsonObject(text), fallback);
}

// ---------------------------------------------------------------------------
// Rule-based draft: no model configured, or a reply that is not JSON
// ---------------------------------------------------------------------------

const BULLET = /^\s*(?:[-*•+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const ACTION_LINE = /^\s*(?:[-*•+]\s+)?(?:\[ \]\s+|(?:todo|action(?: item)?|ai|next step|follow[- ]up)\s*[:\-–]\s*)(.+)$/i;
const OWNER_ACTION = /^([A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+)?)\s+(?:to|will)\s+(.{3,})$/;
const DECISION = /\b(?:decided|decision|agreed|approved|resolved)\b/i;

/** Transcript lines keep their "[mm:ss] Speaker:" prefix; strip it for reading. */
const TIMED_PREFIX = /^\[((?:\d+:)?\d+:\d{2})\]\s*/;

function prefixSeconds(line: string): number | undefined {
  const match = TIMED_PREFIX.exec(line);
  if (!match) return undefined;
  const parts = match[1].split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function actionKey(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A draft built from patterns in the notes and transcript alone. */
export function heuristicNotesDraft(input: NotesDraftInput): NotesDraft {
  const template = notesDraftTemplate(input.template).id;
  const sections: NotesDraftSection[] = [];
  const decisions: string[] = [];
  const openQuestions: string[] = [];
  const actionItems: NotesDraftActionItem[] = [];
  let current: NotesDraftSection | null = null;
  const prose: string[] = [];

  for (const raw of input.notes.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/)?.[1];
    if (heading) {
      current = { heading: heading.trim(), points: [] };
      sections.push(current);
      continue;
    }
    const action = line.match(ACTION_LINE)?.[1];
    const text = line.replace(BULLET, "").trim();
    if (action) {
      actionItems.push(ownerAction(action.trim()));
      continue;
    }
    if (OWNER_ACTION.test(text)) actionItems.push(ownerAction(text));
    if (DECISION.test(text)) decisions.push(text);
    if (/\?$/.test(text)) openQuestions.push(text);
    if (!BULLET.test(line) && !current) prose.push(text);
    if (!current) {
      current = { heading: "Notes", points: [] };
      sections.push(current);
    }
    current.points.push(text);
  }

  for (const raw of input.transcript.split("\n")) {
    const atSec = prefixSeconds(raw);
    const line = raw.replace(TIMED_PREFIX, "").trim();
    const action = line.match(/action item:\s*(.+)$/i)?.[1];
    if (action) actionItems.push({ ...ownerAction(action.trim()), ...(atSec !== undefined ? { atSec } : {}) });
    const decision = line.match(/decision recorded:\s*(.+)$/i)?.[1];
    if (decision) decisions.push(decision.trim());
  }

  const firstLines = (prose.length ? prose : sections.flatMap((section) => section.points)).slice(0, 2).join(" ");
  const summary = firstLines
    ? firstLines
    : input.transcript.trim()
      ? `Transcript of ${input.meetingTitle}. Connect an AI model to summarise it.`
      : `Notes from ${input.meetingTitle}.`;
  return normalizeNotesDraft(
    { summary, sections: sections.filter((section) => section.points.length), decisions, openQuestions, actionItems },
    { template, summary: `Notes from ${input.meetingTitle}.`, sections: [], decisions: [], openQuestions: [], actionItems: [] },
  );
}

function ownerAction(text: string): NotesDraftActionItem {
  const assignee = text.match(OWNER_ACTION)?.[1];
  const dueDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  return { text: text.replace(/[.;]+$/, ""), ...(assignee ? { assignee } : {}), ...(isIsoDate(dueDate) ? { dueDate } : {}) };
}

// ---------------------------------------------------------------------------
// Long transcripts: drafted in parts, then merged
// ---------------------------------------------------------------------------

export type NotesDraftRequest = { messages: ChatMessage[]; input: NotesDraftInput };

/**
 * One request when everything fits `budgetChars`, otherwise one per part of
 * the transcript. The person's notes go with every part: they say what
 * matters. Every part asks for the same JSON, merged by `mergeNotesDrafts`.
 */
export function planNotesDraftRequests(input: NotesDraftInput, budgetChars: number): { requests: NotesDraftRequest[]; chunked: boolean } {
  const fixed = notesDraftUserPrompt({ ...input, transcript: "" }).length + NOTES_DRAFT_SYSTEM_PROMPT.length;
  const transcriptBudget = Math.max(4_000, budgetChars - fixed);
  const parts = input.transcript.length > transcriptBudget ? splitTranscript(input.transcript, transcriptBudget) : [input.transcript];
  const requests = parts.map((transcript, index) => {
    const partInput = {
      ...input,
      transcript: parts.length > 1 ? `(Part ${index + 1} of ${parts.length} of the transcript.)\n${transcript}` : transcript,
    };
    return { messages: buildNotesDraftMessages(partInput), input: { ...input, transcript } };
  });
  return { requests, chunked: parts.length > 1 };
}

export function mergeNotesDrafts(parts: readonly NotesDraft[]): NotesDraft {
  if (parts.length === 1) return parts[0];
  const sections = new Map<string, NotesDraftSection>();
  for (const part of parts) {
    for (const section of part.sections) {
      const key = section.heading.toLowerCase();
      const existing = sections.get(key);
      if (existing) existing.points = dedupe([...existing.points, ...section.points], NOTES_DRAFT_LIMITS.pointsPerSection);
      else sections.set(key, { heading: section.heading, points: [...section.points] });
    }
  }
  return normalizeNotesDraft(
    {
      summary: parts.map((part) => part.summary).join(" "),
      sections: [...sections.values()],
      decisions: parts.flatMap((part) => part.decisions),
      openQuestions: parts.flatMap((part) => part.openQuestions),
      actionItems: parts.flatMap((part) => part.actionItems),
    },
    { ...parts[0], actionItems: [] },
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The draft as Markdown, for "Add to my notes" and copying. */
export function notesDraftMarkdown(draft: Pick<NotesDraft, "summary" | "sections" | "decisions" | "openQuestions"> & { actionItems?: ReadonlyArray<{ text: string; assignee?: string; dueDate?: string }> }): string {
  const blocks: string[] = [];
  if (draft.summary) blocks.push(`## Summary\n\n${draft.summary}`);
  for (const section of draft.sections) blocks.push(`## ${section.heading}\n\n${section.points.map((point) => `- ${point}`).join("\n")}`);
  if (draft.decisions.length) blocks.push(`## Decisions\n\n${draft.decisions.map((item) => `- ${item}`).join("\n")}`);
  if (draft.actionItems?.length) {
    blocks.push(`## Action items\n\n${draft.actionItems.map((item) => `- [ ] ${item.text}${item.dueDate ? ` (due ${item.dueDate})` : ""}`).join("\n")}`);
  }
  if (draft.openQuestions.length) blocks.push(`## Open questions\n\n${draft.openQuestions.map((item) => `- ${item}`).join("\n")}`);
  return blocks.join("\n\n");
}

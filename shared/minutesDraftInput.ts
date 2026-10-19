/**
 * What an AI minutes draft is built from, and when a draft may not be written.
 *
 * Shared by the meeting page (to pick the transcript text and refuse early),
 * `minutes:generateDraft` (to refuse before calling the language model) and
 * `upsertFromDraftPortable` (the authoritative check).
 */
import { sectionHasRecordedContent } from "./sourceMinutesTransposition";

export const ADOPTED_MINUTES_DRAFT_BLOCKED =
  "Adopted minutes are frozen. Start an amendment before importing a draft.";

/** The refusal when sections hold content a person recorded, naming them. */
export function recordedSectionsDraftBlocked(titles: readonly string[]): string {
  const named = titles.map((title) => `“${title.trim() || "Untitled section"}”`);
  const shown = named.length > 3 ? [...named.slice(0, 3), `${named.length - 3} more`] : named;
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
  const one = titles.length === 1;
  return `${list} ${one ? "has" : "have"} recorded content, which a draft never overwrites. ` +
    `Edit or clear ${one ? "that section" : "those sections"}, then draft again.`;
}

type DraftTarget = {
  approvedAt?: unknown;
  adoptedSnapshot?: unknown;
  motionSnapshots?: unknown;
  sections?: unknown;
};

/**
 * The meeting row, for the template its minutes were seeded from
 * (`templateSnapshotJson`). Any row shape is accepted; other fields are ignored.
 */
export type DraftTemplateSource = unknown;

/** One template item's default wording, unresolved (`{{placeholders}}` kept). */
type TemplateDefault = { title: string; details: string; motionText: string };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const stringField = (row: Record<string, unknown>, key: string) => (typeof row[key] === "string" ? String(row[key]) : "");

/** The template items stored on the meeting when it was made (or a template applied). */
function templateDefaults(meeting: DraftTemplateSource): TemplateDefault[] {
  const json = isRecord(meeting) ? meeting.templateSnapshotJson : undefined;
  if (typeof json !== "string" || !json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const items = isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
  return items
    .filter(isRecord)
    .map((item) => ({ title: stringField(item, "title"), details: stringField(item, "details"), motionText: stringField(item, "motionText") }))
    .filter((item) => item.title.trim());
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Whether `value` is still the template's wording. Placeholders were filled in
 * when the meeting was made (the previous meeting's title and date, which can
 * change later), so each one matches any text; whitespace is normalised.
 */
export function matchesTemplateText(value: unknown, template: string): boolean {
  const actual = squash(typeof value === "string" ? value : "");
  // Creation joins "{{previousMeetingTitle}} of {{previousMeetingDate}}" into one
  // reference that may read just "the previous meeting".
  const pattern = squash(template).replace(
    /\{\{\s*previousMeetingTitle\s*\}\}\s+(?:of|on|held(?:\s+on)?)\s+\{\{\s*previousMeetingDate\s*\}\}/g,
    "{{previousMeetingReference}}",
  );
  const literals = pattern.split(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/);
  if (literals.length === 1) return actual === pattern;
  const escaped = literals.map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join("[\\s\\S]*?")}$`).test(actual);
}

/**
 * A section that still holds only what the meeting's template seeded: its
 * title, default discussion (e.g. a land acknowledgement) and default motion
 * wording. A decision, action, linked task or motion, a submitted report, or
 * any changed wording means a person recorded something.
 */
function isTemplateSeededSection(section: Record<string, unknown>, defaults: readonly TemplateDefault[]): boolean {
  const recordedBeyondWording = { ...section, discussion: "", motionText: "" };
  if (sectionHasRecordedContent(recordedBeyondWording)) return false;
  return defaults.some((item) =>
    matchesTemplateText(section.title, item.title) &&
    matchesTemplateText(section.discussion, item.details) &&
    matchesTemplateText(section.motionText, item.motionText),
  );
}

/** Titles of the sections a draft would overwrite that hold recorded content. */
export function recordedMinuteSectionTitles(sections: unknown, meeting?: DraftTemplateSource): string[] {
  if (!Array.isArray(sections)) return [];
  const defaults = templateDefaults(meeting);
  return sections
    .filter(isRecord)
    .filter((section) => sectionHasRecordedContent(section) && !isTemplateSeededSection(section, defaults))
    .map((section) => (typeof section.title === "string" ? section.title : ""));
}

/**
 * Why a fresh draft cannot replace these minutes, or null when it can. Pass the
 * meeting so sections still holding only its template's defaults don't count
 * as recorded; without it every non-empty section does.
 */
export function minutesDraftBlocker(row: unknown, meeting?: DraftTemplateSource): string | null {
  if (!row || typeof row !== "object") return null;
  const existing: DraftTarget = row;
  if (existing.approvedAt || existing.adoptedSnapshot || Array.isArray(existing.motionSnapshots)) {
    return ADOPTED_MINUTES_DRAFT_BLOCKED;
  }
  const recorded = recordedMinuteSectionTitles(existing.sections, meeting);
  return recorded.length ? recordedSectionsDraftBlocked(recorded) : null;
}

/**
 * The minutes with template-seeded sections left out, for "has a draft been
 * started?" prompts: template defaults alone are not a started draft.
 */
export function withoutTemplateSeededSections<T extends { sections?: unknown }>(row: T, meeting?: DraftTemplateSource): T {
  if (!Array.isArray(row.sections)) return row;
  const defaults = templateDefaults(meeting);
  if (!defaults.length) return row;
  return {
    ...row,
    sections: row.sections.filter((section) => !(isRecord(section) && isTemplateSeededSection(section, defaults))),
  };
}

/**
 * The transcript text sent to the model. Explicit text (a paste) wins. Otherwise
 * a working transcript row is authoritative: its `text` is regenerated as
 * `Name: text` lines whenever a speaker is assigned or a line is edited. The
 * minutes `draftTranscript` copy is only used when no transcript row exists,
 * and never when it holds import metadata rather than a transcript.
 */
export function minutesDraftTranscript(input: {
  explicitText?: string;
  transcriptRow?: { text?: string } | null;
  draftTranscript?: string;
  draftIsImportMetadata?: boolean;
}): string {
  const explicit = (input.explicitText ?? "").trim();
  if (explicit) return explicit;
  if (input.transcriptRow) return (input.transcriptRow.text ?? "").trim();
  if (input.draftIsImportMetadata) return "";
  return (input.draftTranscript ?? "").trim();
}

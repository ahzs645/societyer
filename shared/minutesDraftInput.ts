/**
 * What an AI minutes draft is built from, and when a draft may not be written.
 *
 * Shared by the meeting page (to pick the transcript text and refuse early),
 * `minutes:generateDraft` (to refuse before calling the language model) and
 * `upsertFromDraftPortable` (the authoritative check).
 */
import { hasRecordedMinuteSectionContent } from "./sourceMinutesTransposition";

export const ADOPTED_MINUTES_DRAFT_BLOCKED =
  "Adopted minutes are frozen. Start an amendment before importing a draft.";
export const RECORDED_SECTIONS_DRAFT_BLOCKED =
  "Existing minute sections contain recorded content. Review the new draft separately before replacing them.";

type DraftTarget = {
  approvedAt?: unknown;
  adoptedSnapshot?: unknown;
  motionSnapshots?: unknown;
  sections?: unknown;
};

/** Why a fresh draft cannot replace these minutes, or null when it can. */
export function minutesDraftBlocker(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const existing: DraftTarget = row;
  if (existing.approvedAt || existing.adoptedSnapshot || Array.isArray(existing.motionSnapshots)) {
    return ADOPTED_MINUTES_DRAFT_BLOCKED;
  }
  if (hasRecordedMinuteSectionContent(existing.sections)) return RECORDED_SECTIONS_DRAFT_BLOCKED;
  return null;
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

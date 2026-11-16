/**
 * A notes meeting as text: the Markdown export (notes, AI notes, action
 * items, transcript), a short recap to copy or email, and the context the
 * meeting's Ask bar attaches for the assistant. Pure module.
 */
import { notesDraftMarkdown, notesDraftTemplate, type NotesDraftQuote } from "./ai/notesDraft";
import { AI_ATTACHMENT_MAX_BYTES, type AiTextAttachment } from "./aiAttachments";

export type NotesExportMeeting = {
  title: string;
  scheduledAt?: string;
  location?: string;
  attendeeIds?: string[];
};

export type NotesExportDraft = {
  template: string;
  summary: string;
  sections: Array<{ heading: string; points: string[] }>;
  decisions: string[];
  openQuestions: string[];
  quotes?: NotesDraftQuote[];
  generatedBy?: string;
};

export type NotesExportAction = { text: string; assignee?: string; dueDate?: string; done?: boolean; status?: string };

export type NotesExportInput = {
  meeting: NotesExportMeeting;
  notes?: string;
  draft?: NotesExportDraft | null;
  actionItems?: readonly NotesExportAction[];
  /** "Name: text" lines, optionally with [m:ss] prefixes. */
  transcript?: string;
};

export type NotesExportSections = { notes: boolean; aiNotes: boolean; actions: boolean; transcript: boolean };
export const ALL_NOTES_SECTIONS: NotesExportSections = { notes: true, aiNotes: true, actions: true, transcript: true };

const dateLabel = (iso?: string) => (iso ? iso.slice(0, 10) : "");

function actionLine(item: NotesExportAction): string {
  const done = item.done || item.status === "completed";
  const owner = item.assignee ? ` — ${item.assignee}` : "";
  const due = item.dueDate ? ` (due ${item.dueDate})` : "";
  return `- [${done ? "x" : " "}] ${item.text}${owner}${due}`;
}

/** The whole meeting as Markdown, with the sections chosen. */
export function notesMeetingMarkdown(input: NotesExportInput, sections: NotesExportSections = ALL_NOTES_SECTIONS): string {
  const { meeting } = input;
  const blocks: string[] = [`# ${meeting.title}`];
  const meta = [dateLabel(meeting.scheduledAt), meeting.location].filter(Boolean).join(" · ");
  if (meta) blocks.push(meta);
  if (meeting.attendeeIds?.length) blocks.push(`**Attendees:** ${meeting.attendeeIds.join(", ")}`);
  if (sections.aiNotes && input.draft && (input.draft.summary || input.draft.sections.length)) {
    blocks.push(
      `## AI notes (${notesDraftTemplate(input.draft.template).label})`,
      notesDraftMarkdown(input.draft).replace(/^## /gm, "### "),
    );
  }
  if (sections.actions && input.actionItems?.length) {
    blocks.push("## Action items", input.actionItems.map(actionLine).join("\n"));
  }
  if (sections.notes && input.notes?.trim()) {
    // The person's own notes keep their Markdown; their headings go one level down.
    blocks.push("## Notes", input.notes.trim().replace(/^(#{1,5}) /gm, "#$1 "));
  }
  if (sections.transcript && input.transcript?.trim()) blocks.push("## Transcript", input.transcript.trim());
  return `${blocks.join("\n\n")}\n`;
}

/** A short recap: what was decided and who does what. For copying into an email or chat. */
export function notesRecapText(input: NotesExportInput): string {
  const { meeting, draft } = input;
  const lines = [`${meeting.title}${meeting.scheduledAt ? ` — ${dateLabel(meeting.scheduledAt)}` : ""}`, ""];
  if (draft?.summary) lines.push(draft.summary, "");
  if (draft?.decisions.length) lines.push("Decisions:", ...draft.decisions.map((item) => `• ${item}`), "");
  const open = (input.actionItems ?? []).filter((item) => !(item.done || item.status === "completed" || item.status === "cancelled"));
  if (open.length) {
    lines.push("Next steps:", ...open.map((item) => `• ${item.text}${item.assignee ? ` (${item.assignee}${item.dueDate ? `, by ${item.dueDate}` : ""})` : item.dueDate ? ` (by ${item.dueDate})` : ""}`), "");
  }
  if (draft?.openQuestions.length) lines.push("Open questions:", ...draft.openQuestions.map((item) => `• ${item}`), "");
  if (lines.length <= 2 && input.notes?.trim()) lines.push(input.notes.trim(), "");
  return lines.join("\n").trim();
}

/** File name for an export: "2026-11-12 Partner call.md". */
export function notesExportFileName(meeting: NotesExportMeeting, extension: string): string {
  const base = `${dateLabel(meeting.scheduledAt)} ${meeting.title}`.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Meeting notes";
  return `${base}.${extension}`;
}

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/**
 * The meeting as an attachment for the assistant (the Ask bar): AI notes,
 * action items and notes first, then as much transcript as fits the
 * attachment limit, cut on a line boundary with a note saying so.
 */
export function meetingAskContextAttachment(input: NotesExportInput & { people?: string[] }, maxBytes = AI_ATTACHMENT_MAX_BYTES): AiTextAttachment {
  const head = notesMeetingMarkdown({ ...input, transcript: undefined }, { notes: true, aiNotes: true, actions: true, transcript: false });
  const people = input.people?.length ? `\n## People in the organization\n\n${input.people.slice(0, 80).join("\n")}\n` : "";
  let text = `${head}${people}`;
  if (utf8Bytes(text) > maxBytes) text = new TextDecoder().decode(new TextEncoder().encode(text).slice(0, maxBytes - 200)).replace(/�+$/, "") + "\n\n(Cut to fit.)";
  const transcript = input.transcript?.trim();
  if (transcript) {
    const room = maxBytes - utf8Bytes(text) - 120;
    if (room > 400) {
      const lines = transcript.split("\n");
      const kept: string[] = [];
      let used = 0;
      for (const line of lines) {
        const size = utf8Bytes(line) + 1;
        if (used + size > room) break;
        kept.push(line);
        used += size;
      }
      text += `\n## Transcript${kept.length < lines.length ? ` (first ${kept.length} of ${lines.length} lines)` : ""}\n\n${kept.join("\n")}\n`;
    }
  }
  const name = notesExportFileName(input.meeting, "md").replace(/\.md$/, " (meeting context).md");
  return { name, mediaType: "text/markdown", text };
}

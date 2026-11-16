/**
 * The pieces of the notes surface (MeetingNotesTab): the view switch with
 * Record and ••• beside it, the template starter for empty notes, and the
 * Ask bar that hands the meeting to the assistant.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, Copy, Download, Info, Mic, MonitorUp, MoreHorizontal, Printer, Send, Sparkles, Square, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { Menu, type MenuItem } from "@/components/Menu";
import { useAiChatVisibility } from "@/hooks/useAiChatVisibility";
import { Segmented } from "@/components/primitives";
import { useToast } from "@/components/Toast";
import { triggerBlobDownload } from "../../../lib/zip";
import { printPdfDocument } from "../../../lib/pdf";
import { markdownToHtml } from "../../../lib/markdown";
import { askGlobalAiAssistant } from "../../ai/aiAssistantEvents";
import { NOTES_DRAFT_TEMPLATES, type NotesDraftTemplateId } from "../../../../shared/ai/notesDraft";
import {
  meetingAskContextAttachment,
  notesExportFileName,
  notesMeetingMarkdown,
  notesRecapText,
  type NotesExportInput,
} from "../../../../shared/meetingNotesExport";
import {
  formatElapsed,
  recordingSupported,
  sharedAudioSupported,
  startMeetingRecording,
  stopMeetingRecording,
  useMeetingRecorder,
} from "../recorder/meetingRecorder";

export type NotesView = "notes" | "ai" | "transcript" | "actions";
export const NOTES_VIEWS: readonly NotesView[] = ["notes", "ai", "transcript", "actions"];
export function isNotesView(value: unknown): value is NotesView {
  return (NOTES_VIEWS as readonly unknown[]).includes(value);
}

export function NotesSurfaceBar({
  view,
  onView,
  phone,
  actionCount,
  hasDraft,
  record,
  more,
}: {
  view: NotesView;
  onView: (view: NotesView) => void;
  phone: boolean;
  actionCount: number;
  hasDraft: boolean;
  record: ReactNode;
  more: ReactNode;
}) {
  const items = [
    { id: "notes" as const, label: phone ? "Notes" : "My notes" },
    { id: "ai" as const, label: "AI notes", ...(hasDraft ? {} : { ariaLabel: "AI notes (not drafted yet)" }) },
    { id: "transcript" as const, label: "Transcript" },
    ...(phone ? [{ id: "actions" as const, label: "Actions", count: actionCount }] : []),
  ];
  return (
    <div className="notes-surface__bar">
      <Segmented<NotesView> aria-label="Notes view" className="notes-surface__views" value={view} onChange={onView} items={items} />
      <div className="notes-surface__tools">
        {record}
        {more}
      </div>
    </div>
  );
}

/** Record, Join & record, or the running recording's timer and Stop. `compact` (phones): a mic icon. */
export function RecordControl({
  meetingId,
  meetingTitle,
  joinUrl,
  canWrite,
  onStarted,
  compact = false,
}: {
  meetingId: string;
  meetingTitle: string;
  joinUrl?: string;
  canWrite: boolean;
  onStarted: () => void;
  compact?: boolean;
}) {
  const recorder = useMeetingRecorder();
  const toast = useToast();
  if (!canWrite || !recordingSupported()) return null;
  const active = recorder.phase === "recording" || recorder.phase === "starting" || recorder.phase === "stopping";
  if (active && recorder.meetingId === meetingId) {
    return (
      <button
        type="button"
        className={`btn-action notes-record is-recording${compact ? " btn-action--icon" : ""}`}
        onClick={() => { void stopMeetingRecording().catch(() => undefined); }}
        disabled={recorder.phase !== "recording"}
        // Phones: a stop square; the floating recording bar shows the time.
        {...(compact ? { "aria-label": recorder.phase === "starting" ? "Starting recording" : `Stop · ${formatElapsed(recorder.elapsed)}`, title: "Stop recording" } : {})}
      >
        <Square size={12} aria-hidden="true" fill={compact ? "currentColor" : "none"} />
        {!compact && (recorder.phase === "starting" ? " Starting…" : ` Stop · ${formatElapsed(recorder.elapsed)}`)}
      </button>
    );
  }
  if (active) {
    return compact
      ? <span className="notes-record__elsewhere" title={`Recording ${recorder.meetingTitle}`} aria-label="Recording another meeting" role="img"><Mic size={14} aria-hidden="true" /></span>
      : <span className="notes-record__elsewhere" title={`Recording ${recorder.meetingTitle}`}>Recording another meeting</span>;
  }
  const start = async (sharedAudio: boolean, join?: string) => {
    if (join) window.open(join, "_blank", "noopener,noreferrer");
    try {
      await startMeetingRecording({ meetingId, meetingTitle, sharedAudio });
      onStarted();
    } catch (error) {
      toast.error("Could not start recording", error instanceof Error ? error.message : String(error));
    }
  };
  const items: MenuItem[] = [
    { id: "mic", label: "Microphone", hint: "Your voice and anyone in the room", icon: <Mic size={14} />, onSelect: () => { void start(false); } },
    ...(sharedAudioSupported()
      ? [{ id: "shared", label: "Microphone + call audio", hint: "Also record a tab, window or screen you share (tick \"Share audio\")", icon: <MonitorUp size={14} />, onSelect: () => { void start(true); } }]
      : []),
    ...(joinUrl ? [{ id: "join", label: "Join & record", hint: "Open the meeting link and record with call audio", icon: <Video size={14} />, onSelect: () => { void start(sharedAudioSupported(), joinUrl); } }] : []),
  ];
  return (
    <Menu
      align="right"
      described
      sheetTitle="Record this meeting"
      trigger={
        compact ? (
          <button type="button" className="btn-action btn-action--icon notes-record" aria-label="Record" title="Record">
            <Mic size={14} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn-action notes-record">
            <Mic size={12} aria-hidden="true" /> Record <ChevronDown size={12} aria-hidden="true" />
          </button>
        )
      }
      sections={[{ id: "record", items }]}
    />
  );
}

/** ••• : Markdown, print (or save as PDF), the recap to paste anywhere, and on phones the meeting details. */
export function NotesMoreMenu({ exportInput, onOpenDetails }: { exportInput: () => NotesExportInput; onOpenDetails?: () => void }) {
  const toast = useToast();
  const run = (label: string, task: () => Promise<unknown> | unknown) => async () => {
    try {
      await task();
    } catch (error) {
      toast.error(`Could not ${label}`, error instanceof Error ? error.message : String(error));
    }
  };
  const markdown = () => notesMeetingMarkdown(exportInput());
  const title = () => exportInput().meeting.title;
  const items: MenuItem[] = [
    { id: "md", label: "Download Markdown", icon: <Download size={14} />, onSelect: run("export", () => triggerBlobDownload(new Blob([markdown()], { type: "text/markdown" }), notesExportFileName(exportInput().meeting, "md"))) },
    { id: "print", label: "Print or save as PDF", icon: <Printer size={14} />, onSelect: run("print", () => printPdfDocument({ title: title(), bodyHtml: markdownToHtml(markdown()) })) },
    { id: "copy", label: "Copy recap", hint: "Summary, decisions and who does what, to paste into an email or chat", icon: <Copy size={14} />, onSelect: run("copy", async () => { await navigator.clipboard.writeText(notesRecapText(exportInput())); toast.success("Recap copied."); }) },
    ...(onOpenDetails ? [{ id: "details", label: "Meeting details", hint: "Date, place, attendees, materials", icon: <Info size={14} />, onSelect: onOpenDetails }] : []),
  ];
  return (
    <Menu
      align="right"
      described
      sheetTitle="Meeting notes"
      trigger={
        <button type="button" className="btn-action btn-action--icon" aria-label="More: export and recap">
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
      }
      sections={[{ id: "more", items }]}
    />
  );
}

/** Headings to start empty notes from, matching the AI notes templates. */
export function templateHeadings(template: NotesDraftTemplateId): string {
  const shape = NOTES_DRAFT_TEMPLATES.find((entry) => entry.id === template) ?? NOTES_DRAFT_TEMPLATES[0];
  const headings = template === "general" ? ["Agenda", "Discussion", "Decisions", "Action items"] : [...shape.sections, "Action items"];
  return `${headings.map((heading) => `## ${heading}\n\n- `).join("\n\n")}\n`;
}

export function NotesTemplateStarter({ onPick }: { onPick: (template: NotesDraftTemplateId) => void }) {
  return (
    <div className="notes-template-starter" role="group" aria-label="Start from a template">
      <span className="muted">Start from a template:</span>
      {NOTES_DRAFT_TEMPLATES.map((template) => (
        <button key={template.id} type="button" className="btn-action" title={template.hint} onClick={() => onPick(template.id)}>
          {template.label}
        </button>
      ))}
    </div>
  );
}

const QUICK_PROMPTS = [
  "What are the action items, and who owns each?",
  "What did we decide?",
  "Draft a follow-up email to the attendees.",
  "Summarize this for someone who missed it.",
  "What's still open or unresolved?",
];

/** "Ask anything" about this meeting: opens the assistant with the meeting attached and sends. */
export function MeetingAskBar({ context }: { context: () => NotesExportInput & { people?: string[] } }) {
  const [question, setQuestion] = useState("");
  const assistant = useAiChatVisibility();
  if (assistant.hidden) {
    return (
      <p className="notes-ask notes-ask--off muted">
        <Sparkles size={14} aria-hidden="true" />{" "}
        {assistant.moduleEnabled
          ? "The AI assistant is hidden for you. Show it again from your profile menu to ask about this meeting."
          : <>Ask questions about this meeting with the AI assistant: <Link to="/app/settings?tab=modules">turn on AI agents in Settings</Link>.</>}
      </p>
    );
  }
  const ask = (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    askGlobalAiAssistant({ prompt: text, attachments: [meetingAskContextAttachment(context())], send: true });
    setQuestion("");
  };
  return (
    <form className="notes-ask" onSubmit={(event) => { event.preventDefault(); ask(question); }}>
      <div className="notes-ask__row">
        <Sparkles size={14} aria-hidden="true" />
        <input
          className="notes-ask__input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask anything about this meeting…"
          aria-label="Ask about this meeting"
        />
        <button type="submit" className="btn-action btn-action--icon" aria-label="Ask" disabled={!question.trim()}>
          <Send size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="notes-ask__prompts" aria-label="Suggested questions">
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" className="notes-ask__chip" onClick={() => ask(prompt)}>{prompt}</button>
        ))}
      </div>
    </form>
  );
}

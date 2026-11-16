# Meeting notes: working meetings, AI notes, action items and recordings

Formal minutes (agenda, motions, quorum, approval) stay as they were. This page
covers the lighter path for meetings that keep notes (`recordKind: "notes"`),
including meetings that aren't meetings of a governing body.

## General / working meetings

The meeting body picker has **General / working meeting** (stored as
`type: "Working"`, not "General": a society's *general meeting* is a members'
meeting). Use it for a staff check-in, a 1:1, or a call with a funder, partner
or vendor. The Meetings page has a **Meeting notes** button that starts one.

A working meeting:

- keeps notes by default (`defaultRecordKindForType`);
- takes no bylaw quorum (`quorumSourceLabel: "No quorum: working meeting"`)
  and no notice window, and isn't limited by the bylaws' electronic
  participation rule;
- stays out of the minute book and never counts toward board meeting cadence
  (`bodyKeyForMeeting` → `working`, `shared/continuity.ts`);
- only offers templates whose `meetingType` is `Working`.

## Transcript formats

`shared/transcriptFormats.ts` lists every accepted format in one place.
Timed: WebVTT, SubRip, SubViewer (`.sbv`, YouTube), Whisper/WhisperX JSON and
timestamped text from Otter (`Name  0:05`), Rev (`Name (00:05):`), Descript
(`[00:00:05] Name: text`) and Google Meet (a timestamp line, then `Name: text`
turns). A `.txt` with no timestamps imports as plain text. A `Name:` prefix
becomes a speaker once it repeats in the file, as for captions.

## AI notes (Notes tab)

`shared/ai/notesDraft.ts`. The person's notes plus the transcript become a
summary, sections, decisions, open questions and suggested action items, shaped
by a template: **General meeting**, **1:1**, **Check-in / stand-up** or
**External call**. The transcript lines carry `[mm:ss]` so the model can say
when an action was agreed.

- Connected workspace: `meetings:generateNotesDraft` uses the workspace's AI
  provider (AI setup), else the deployment's. With neither, it saves a
  rule-based draft labelled *Rule-based (no AI model connected)*. A provider
  failure saves nothing.
- Local workspace and desktop app: the on-device model
  (`src/features/meetings/localNotesDraft.ts`), saved through
  `meetings:saveNotesDraft`.
- The draft is stored in `meetings.notesDraft`; `workingNotes` is never
  rewritten. **Add to my notes** appends the draft as Markdown only when asked.
- The transcript is read only when the person may read it
  (`transcripts:getByMeeting`, decision A1), with in-camera sessions withheld.

## The meeting notes skill (how the AI writes notes)

`shared/ai/meetingNotesSkill.ts`. "Draft notes" doesn't ask the model for one
JSON blob. It gives the model **primitives with schemas** and the **context**
to use them, and the model calls tools:

| Tool | What it records |
| --- | --- |
| `write_summary` | Summary and sections (per template) |
| `add_decision` / `add_open_question` | One decision or open question per call |
| `add_action_item` | Text, `owner_person_id` / `owner_name` / `owner_speaker_label`, `due_date`, `at_seconds`, `goal_id`, `committee_id` |
| `add_quote` | Words kept as said, checked word for word against one transcript line (see Quotes) |
| `identify_speaker` | Who a diarization label (`SPEAKER_01`) is, with the quoted evidence |
| `finish` | Done |

**Context** (`meetings:notesSkillContext`): the organization's people with
directory ids, aliases and roles (directors and officers, committee members
and roles, staff, active volunteers, members, attendees first, up to 150), open
goals, active committees, and the transcript's speaker labels with sample
lines. Each register is included only if the caller (and, for a connector
token, its scopes) may read it, so the context never reveals more than the
person could read register by register.

**Every call is checked** (`createMeetingNotesSkillSession`): ids must be in the
context, dates must be real `YYYY-MM-DD`, speaker labels must exist, speaker
identifications need evidence. A refused call gets an error answer the model
can correct. Names are matched to people by name, alias or a unique first
name. An action owned by an unidentified speaker label takes that person once
the label is identified. Saving (`meetings:saveNotesDraft`) checks every id
again against the workspace.

**Runs on any model**: a tool loop over OpenAI-compatible and Anthropic
endpoints (hosted), the on-device client (including Claude Code / Codex, which
run their own loop through `onToolCall`), and JSON mode (`{"calls": [...]}`)
for models that refuse tools.

The AI notes read: summary, **Decisions** (highlighted), the discussion
topics (folded when there are more than ten points, the first open), open
questions, key quotes. Action items show their wording, owner, due date and
transcript time at a glance; **Details** edits the owner, date, goal and
committee and creates the task.

**Suggestions are applied by people**: the AI notes card lists **Who's
speaking** (each label, the person, the quoted evidence; **Name speaker** uses
`transcripts:assignSpeaker`).
**People the AI knows** shows the roster the model gets.

**Agent tools** (`shared/agentTools/tools/meetingNotes.ts`) expose the same
primitives to the in-app assistant, WebMCP and the MCP connector:
`get_meeting_notes_context`, `add_meeting_action_items`,
`name_transcript_speakers`. Remote connectors only propose drafts a person
approves; connector tokens have no people-register scope, so they get goals and
speakers but no roster.

**Prompt evaluation**: `scripts/fixtures/meetingNotesSkillFixture.ts` holds two
meetings with traps (an absent director, an outside guest, two people called
Sam, relative dates, a role two people share, a decision from last week). The
prompt was run by a larger and a smaller model given only the prompt, tools and
context; their calls are kept in `scripts/fixtures/meeting-notes-skill-replays/`
and checked by `npm run test:meeting-notes-skill` (all expectations met: owners,
due dates, goals, speakers, and no over-assignment).

## Use your own AI (copy a prompt, paste the JSON back)

**Use your own AI** on the AI notes card (`ManualNotesDraftDialog`, prompt and
import in `shared/ai/meetingNotesManualPrompt.ts`) drafts the AI notes with
any AI chat, which works when no AI model is connected to the workspace:

1. **Copy the prompt.** It carries the skill's rules (the same as the built-in
   AI's), each tool with its JSON Schema, an example of the JSON to return,
   the template, and the meeting's context. Blocks can be switched off:
   Transcript (off when you attach the file to the chat instead), Your notes,
   People and roles (ids, roles, attending), Goals and committees, Name the
   speakers, Key quotes (chips under Copy prompt; each one's description is
   its tooltip). **Add instructions** adds your own text at the end. A
   prompt over 120k characters says to attach the transcript instead.
2. **Paste what it returns** (`{"calls": [...]}`, also inside a code fence or
   with text around it); it's checked as it's pasted, then **Save as AI
   notes**. The calls run through the same session as the built-in AI's, in
   its lenient mode: a reply can't be corrected and resent, so an action item
   whose owner, goal or committee isn't listed (people changed since copying,
   or a reply pasted into another meeting) is kept without that link, and a
   quote that isn't word for word in the transcript is left out. The dialog
   lists both. Saving goes through
   `meetings:saveNotesDraft` (quotes re-checked there) and is labelled "Your
   own AI (pasted)".

Tested with a 57-minute Teams VTT (1,031 cues, three speakers; prompt about
80k characters): a larger and a smaller model, given only the prompt, each
returned JSON that imported with nothing left out, owners matched to the
People list, relative dates resolved and quotes found word for word.

## Action items (Notes tab)

`meetings.noteActionItems`, `shared/meetingNoteActions.ts`. Suggested items
(`origin: "ai"`) arrive with the draft; anyone with meeting edit access adds,
edits, ticks off and removes items. Each can name a person (people directory),
a due date, a goal and a committee.

- **Create task** (`meetings:createTaskFromNoteAction`) makes one task linked to
  the meeting, the person, goal, committee and the moment in the recording
  (`tasks.transcriptRef`), tagged `meeting-notes`, and links the item back. The
  task's source panel links to the recording at that time.
- Redrafting replaces only suggestions nobody edited, ticked off or turned
  into a task.
- **Turn notes into minutes** carries the action items (with their tasks) and
  the draft's decisions into the minutes draft.

## Recordings: where they are kept

`shared/meetingRecordingStorage.ts`. Settings → Runtime → **Meeting
recordings**: an administrator chooses **Keep recordings** or **Transcripts
only** (`societies.meetingRecordingPreference`). Where kept recordings go
depends on the workspace:

| Workspace | Kept in |
| --- | --- |
| Storage policy: SharePoint, transfer broker configured | SharePoint, through Meeting source files |
| Storage policy: native file storage | Workspace file storage (`meetingRecordings`, Convex `_storage`) |
| Desktop app | This computer (`meetingRecordings`, `local-filesystem` keys) |
| Browser-only workspace, or file storage turned off | Not kept |

**Transcripts only** refuses new recordings everywhere, including SharePoint
source uploads (transcript files are still accepted). Recordings already kept
stay until someone removes them. Whatever the setting, a recording can be
opened from the device in the Transcript tab and transcribed there.

The **Recordings** card (Overview and Sources tabs, meeting editors only) adds,
plays (Transcript tab → Attached recordings), downloads and removes recordings.
On a connected workspace with a live speech service it can also **Transcribe**
a recording on the server (up to 25 MB with OpenAI, 200 MB with a self-hosted
`WHISPER_ENDPOINT`); never with the demo provider. Desktop backups don't
include recordings.

## The notes surface (Notes tab)

A notes meeting opens on its Notes tab. One bar switches between **My notes**,
**AI notes** and **Transcript** (the view is in the URL as `?view=`), with
**Record** and **•••** beside it. Views you've opened stay mounted, so switching
keeps your place; a hidden view pauses its media.

- **Templates.** Empty notes offer the AI notes templates (General, 1:1,
  Check-in, External call) as starting headings.
- **Record.** Microphone, microphone + call audio (a shared tab, window or
  screen with "Share audio" ticked), or **Join & record** for a meeting with a
  link. A floating bar (`src/features/meetings/recorder/RecordingBar.tsx`)
  shows the timer and level on every page; navigating inside the app keeps
  recording, and leaving or reloading asks first. However it is stopped (the
  bar or the Notes tab's Stop), the file is saved where the workspace keeps
  recordings (see below) and opens in the Transcript view, also when that view
  was already open; if recordings aren't kept, the bar offers a download, and
  closing without keeping or downloading it asks first. Transcription happens
  after the recording ends, not live.
- **Crash-safe.** Audio is recorded at 32 kbps mono (about 14 MB an hour) in
  5-second chunks, each written to this browser's IndexedDB as it is recorded
  (`recorder/recordingStash.ts`). After a crash, a reload or a closed tab, the
  bar offers **Recover** (then it is saved like any other recording) or
  discard. A copy is removed once the recording is saved, closed or discarded;
  one updated in the last 30 seconds may be running in another tab and isn't
  offered. The bar warns when the microphone stops (unplugged, or taken by
  another app), a recorder error stops and keeps what was recorded, and the
  screen is kept awake while recording where the browser allows.
- **•••** downloads Markdown, prints (or saves as PDF from the print dialog),
  or copies a plain-text recap (summary, decisions, open next steps, open
  questions) to paste into an email or chat (`shared/meetingNotesExport.ts`).
  On a phone it also leads to the meeting details.
- **Ask anything.** The bar under the notes opens the AI assistant with the
  meeting attached (notes, AI notes, action items, people, then as much of the
  transcript as fits in 32 KiB) and sends the question. With the AI agents
  module off it points to Settings instead.
- **Phones.** One view at a time, with a fourth **Actions** view for action
  items; the Record and ••• buttons sit under the view switch.

## Recordings and transcripts (connected workspaces)

On a deployment with private Microsoft storage, one card, **Recordings and
transcripts** (`MeetingSourcesCard`), brings a meeting's files in. It sits above
the transcript (the Transcript tab and the notes surface's Transcript view) and
on the Sources tab. Drop or add a recording or a transcript file (VTT, SRT, SBV,
Whisper JSON/ZIP, TXT); each file's row then offers what fits
(`meetingFileRows.ts`):

- a recording: **Play** (loads it into the player here; one added from this
  device plays at once), **Transcribe** (the connected WhisperX processor, or
  the speech provider), and the transcription's progress on the same row, then
  **Review** and **Use transcript**, **Retry** or **Cancel**;
- a timed transcript file: **Use as the meeting transcript**;
- text: **Read** and **Use for minutes**; any file: **Preview** and **Download**.

Processor settings open from the card. This replaces the separate WhisperX
queue ("Upload a recording in Sources, then refresh") and the SharePoint
"Attached recordings" list. Without a transcript, the AI notes offer **Add a
recording or transcript**, which opens the Transcript view.

## Quotes

- **Quote in notes.** In the notes surface's Transcript view, select words
  (with a mouse, or a long-press on a phone) and choose **Quote in notes**.
  The words go under your notes as a quote with the speaker and a time that
  links back to that moment (`?tab=notes&view=transcript&t=…`). The toolbar
  also offers Copy quote and Copy link, as on the Transcript tab.
- **Key quotes in the AI notes.** The skill has an `add_quote` tool for up to
  three short quotes worth keeping word for word: a commitment, a decision in
  someone's own words, a point to remember. The session accepts a quote only
  if its words appear in one transcript line (ignoring case, punctuation and
  quote marks), and takes the speaker and time from that line, not from the
  model. A speaker label the skill identifies is replaced by the person's
  name. Quotes must be whole sentences, so a clipped "we should cut the
  program" can't stand in for "I don't think we should cut the program".
  Saving a draft checks every quote again against the transcript the saver
  may read (in-camera parts aside) and drops any that aren't there. Each
  quote's time opens the Transcript view there; "Add to my notes", Copy and
  the Markdown export include them.
- A selection across speakers is quoted with each speaker's own words. Quote
  links are app paths (`/app/meetings/…`), so they work on the web and in the
  desktop app.

## Who sees what

- **AI notes follow the transcript.** AI notes made from the transcript (its
  summary, quotes, who each speaker is) are only sent to people who may read
  the transcript (`minutes:write`); others see that AI notes exist. A draft
  made from the notes alone follows the notes. The meetings list never carries
  AI notes, only `hasNotesDraft`.
- **In-camera parts never reach the AI.** Drafting (hosted and on-device), the
  skill's speaker samples, the Ask bar and the notes export use the transcript
  without in-camera sessions, whoever asks. AI notes go with the working notes
  when those are withheld for an in-camera session.
- **In-camera sessions belong to formal minutes.** The transcript's "Mark as
  in-camera…" isn't offered on meetings that keep notes, and AI notes can only
  be drafted for meetings that keep notes.

## Saving safely

- **Action items** are changed one item at a time (`ops` on
  `meetings:setNoteActionItems`: add, patch, remove), applied to the list as it
  is on the server, so two people or two quick clicks never undo each other
  and a task link is never lost. A patch can't change the task link. The
  `add_meeting_action_items` agent tool adds the same way.
- **Notes** save against the version they started from. When someone else saved
  first, edits to different lines (or lines both added at the same place) are
  combined and saved automatically. When both changed the same lines, the
  editor offers **Keep both** (their notes, then your changed lines) or
  **Load saved notes**.

## Working meetings: duplicates

The Notes tab has no progress steps; the minutes path's steps show on the
Minutes tab of meetings that keep formal minutes. Several working meetings on
one day are not flagged as duplicates unless they have the same title.

## Meetings page: Timeline

The Meetings page has a **Table / Timeline** switch (remembered per browser).
The timeline (`shared/meetingTimeline.ts`, `src/features/meetings/MeetingsTimeline.tsx`)
groups meetings by day: the next 30 days soonest first, then today, then the
last 60 days newest first, with **Show earlier meetings** for more. Each row
says whether the meeting keeps notes or minutes, whether there are AI notes and
open action items, and offers **Join & record** for today's and upcoming
meetings with a link.

## Tests

- `npm run test:timed-transcript` — transcript formats.
- `npm run test:meeting-record-kind` — working meetings.
- `npm run test:meeting-notes-draft` — AI notes, action items, tasks, hosted permissions.
- `npm run test:meeting-notes-skill` — the skill: tools, context, checks, quotes, tool loop, adapters, replays.
- `npm run test:meeting-recordings` — recording storage choice, local and hosted.
- `npm run test:meeting-notes-surface` — timeline grouping, export and recap, Ask bar context, recorder file names, quote Markdown.
- `npm run test:meeting-notes-ui`, `npm run test:meeting-recordings-ui` — Playwright on the local runtime.

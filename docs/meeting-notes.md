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
| `identify_speaker` | Who a diarization label (`SPEAKER_01`) is, with the quoted evidence |
| `mark_attendee` | Someone who took part |
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

**Suggestions are applied by people**: the AI notes card lists **Who's
speaking** (each label, the person, the quoted evidence; **Name speaker** uses
`transcripts:assignSpeaker`) and **Took part** (**Add to attendees**).
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
  recording, and leaving or reloading asks first. On Stop the file is saved
  where the workspace keeps recordings (see below) and handed to the Transcript
  view; if recordings aren't kept, the bar offers a download. Transcription
  happens after the recording ends, not live.
- **•••** downloads Markdown or PDF, prints, copies a plain-text recap
  (summary, decisions, open next steps, open questions) or opens it in your
  mail app (`shared/meetingNotesExport.ts`). On a phone it also leads to the
  meeting details.
- **Ask anything.** The bar under the notes opens the AI assistant with the
  meeting attached (notes, AI notes, action items, people, then as much of the
  transcript as fits in 32 KiB) and sends the question. With the AI agents
  module off it points to Settings instead.
- **Phones.** One view at a time, with a fourth **Actions** view for action
  items; the Record and ••• buttons sit under the view switch.

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
- `npm run test:meeting-notes-skill` — the skill: tools, context, checks, tool loop, adapters, replays.
- `npm run test:meeting-recordings` — recording storage choice, local and hosted.
- `npm run test:meeting-notes-surface` — timeline grouping, export and recap, Ask bar context, recorder file names.
- `npm run test:meeting-notes-ui`, `npm run test:meeting-recordings-ui` — Playwright on the local runtime.

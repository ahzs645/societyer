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

## Tests

- `npm run test:timed-transcript` — transcript formats.
- `npm run test:meeting-record-kind` — working meetings.
- `npm run test:meeting-notes-draft` — AI notes, action items, tasks, hosted permissions.
- `npm run test:meeting-recordings` — recording storage choice, local and hosted.
- `npm run test:meeting-notes-ui`, `npm run test:meeting-recordings-ui` — Playwright on the local runtime.

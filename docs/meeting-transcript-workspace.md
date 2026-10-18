# Meeting transcript workspace

The meeting **Transcript** tab (`?tab=transcript`) reads a timed transcript alongside
the recording: waveform scrubber with a speaker lane, current line and word follow
playback, click any word or timestamp to seek, search, per-line edits that keep
their timings, and speaker labelling.

## Model

One meeting, three layers:

| Layer | What it is | Where |
| --- | --- | --- |
| Transcript | Timed evidence from the recording or a VTT/SRT/Whisper import. Correctable, never the official record. | `transcripts` row: `segments[]` (`speaker`, `text`, `startSec`, `endSec`, optional `words[]`), `speakers[]` |
| Notes | The secretary's informal working notes. | `meetings.workingNotes` (Markdown), edited on the Notes tab |
| Minutes | The structured, approvable record. | Existing minutes workflow |

Segments keep their raw diarization label (`SPEAKER_00`). `speakers[]` maps a label to
a name and optional `peopleDirectory` id, so a rename applies everywhere. Edits and
assignments regenerate `text` as `Name: text` lines and sync it into an unapproved
minutes draft, so AI drafting sees real names. Approved minutes are never touched.

Mutations (portable, `meetings:write`): `transcripts:importTimed`, `assignSpeaker`,
`updateSegment` (drops word timings for that line when its text changes),
`mergeSpeakers`, `unmergeSpeaker`. Parsing happens in the browser
(`timedTranscript.ts`); the server validates bounds. Rows over ~700 KB drop word
timings and keep segment timings.

## Access

**Who reads a transcript** (decision A1). Reading a working transcript
(`transcripts:getByMeeting`, `transcripts:jobForMeeting`) needs a role holding
`minutes:write` (Owner, Admin, Director) plus `meetings:read`, on both runtimes
(`requireTranscriptReaderPortable` in `shared/functions/minutesPrivacy.ts`). A connector
token also needs the `minutes:read` scope. Members and Viewers read the minutes instead:
the Transcript tab shows "Transcript not available — Transcripts are available to people
who keep the minutes. Read the minutes for the record." with a **Read the minutes**
button, and the Overview of a notes meeting reads "Minute-takers only". The minutes'
copy of the transcript (`draftTranscript`) is withheld from them too. Edits keep
`meetings:write`.

**In-camera sessions in the recording** (decision A2). Editors mark where an in-camera
session sits in the recording: select lines and choose **Mark as in-camera…** in the
selection toolbar, or **Mark as in-camera…** in a line's ⋯ menu. Pick one of the
minutes' in-camera sessions (session segments, or in-camera sections not yet in a
segment) or **New in-camera session** (titled "In-camera session", then "In-camera
session 2"…). Marking a session that already has a range extends it to cover both; the
divider's **Clear** removes it. `transcripts:markInCameraRange` (portable, needs
`meetings:write` and `minutes:write`) stores `recordingStartSec`/`recordingEndSec` on
the minutes' session segment. It refuses approved or adopted minutes: they are the
record, so their offsets can't change (start an amendment instead), and their transcript
stays withheld from readers without in-camera access.

Editors see marked ranges as a hatched band on the scrubber and a divider in the
transcript ("In camera: Finance committee update · 1:10–2:05" … "End of Finance
committee update"). While some in-camera session isn't marked, a note under the player
says connectors and public copies get no transcript.

Readers without in-camera access (AI connectors, and the public-session export) get the
transcript with each run of segments overlapping a marked range replaced by
"[In-camera session — not shown]" once every in-camera session is marked and every
in-camera section is named by a marked session. Otherwise the whole transcript is
withheld (`withheld: "in_camera"`). Untimed transcripts (pasted text) are always
withheld from them. See `docs/agent-tools.md` for the full rule.

## Speakers

**Combining is non-destructive.** `transcripts:mergeSpeakers { from, to }` (`from` is
one label or several) does not touch segments. It sets `mergedInto: <target raw label>`
on each source's `speakers[]` entry and keeps the source's own name. Everything that
shows a speaker resolves labels at read time (`speakerResolver` in
`shared/transcriptModel.ts`): `speakerName`, the regenerated `text`, the speaker panel,
chips, lane, turns and the minutes draft. Consecutive segments that resolve to the same
speaker form one turn. `transcripts:unmergeSpeaker { label }` removes `mergedInto`, so
the label is its own speaker again with its own name (an unnamed label drops out of the
map).

- The stored target is the speaker `to` already resolves to, so chains stay short. Older
  chains (A into B, then B into C) still resolve transitively. A merge that would make a
  cycle (`to` resolves to a source) or a chain longer than `SPEAKER_MERGE_MAX_DEPTH` (8)
  is refused. When reading, a cycle or an overlong chain leaves the label standing on its own.
- `assignSpeaker` keeps an entry's `mergedInto`. `importTimed` resets the map.
- Backward compatible: rows merged before this (segments relabelled, source entry
  removed) have no `mergedInto` and read exactly as before. There is nothing to undo for
  them and nothing to migrate.
- Colours index into the raw labels in order of first appearance, so combining and
  unmerging never recolour a speaker.

**UI.** Combining needs no confirmation. The status toast shows "Combined X into Y" with
**Undo**, which unmerges each source (10 seconds, above any open drawer). The speaker
panel and sheet list combined labels under their target ("also SPEAKER_04 · Unmerge").
The sheet's **Combine speakers…** lets you tick several labels and combine them into the
open speaker in one step.

**Review speakers** (`SpeakerReview.tsx`) opens after a timed import when there are two
or more labels or any raw `SPEAKER_n` label. It also opens from **Review speakers** in
the speaker panel header (or the chip row on narrow widths), and once on arrival with
`?tab=transcript&intent=review-speakers`. It uses the speaker drawer frame (side panel, or
a bottom sheet on phones). It shows one list, one row per displayed speaker, each with:
colour, name and raw label, talk time and line count, a sample quote, **Play sample**
when a recording is loaded, the attendee select, **Same person as…** to combine, and
combined labels with Unmerge. Focus moves to the target row after a combine.
Suggestions come from `speakerSuggestions.ts`, a pure helper tested on the fixtures. It
suggests combining labels that are equal after trimming, case-folding and `_`→space
(`speaker_03` ≈ `SPEAKER_03`; the named label is kept, otherwise the one heard longest).
It suggests assigning a label that is an attendee's name (case-insensitive) or their
unique first name. A label matching an attendee who already has a label is suggested
to combine into it. Each suggestion is an **Apply** chip. **Apply all suggestions**
combines each group in one call, then assigns. **Done** and **Skip for now** both close
the review, and the panel's "Name speaker" prompts remain.

**Who a speaker can be.** The attendee select and the phone sheet share one list,
built by the meeting page (`speakerCandidates.ts`): minutes detailed attendance, minutes
attendees, the meeting's expected attendees (`attendeeIds` resolved to directors or
members, or kept as names), the committee's current members when the meeting has a
`committeeId`, then current directors. Duplicates collapse by people-directory id, then
by case-insensitive name; a later duplicate fills in a missing `personId` or role. Lists
longer than six that mix sources are labelled ("Attended", "Expected", "Committee",
"Directors") as `optgroup`s in the select and headings in the sheet. So notes and
committee meetings, which record no attendance, no longer need every name typed.

**Meeting source files.** When an uploaded source is VTT, SRT or Whisper JSON, or a ZIP
whose JSON, VTT or SRT entry parses (`timedImportOffer.ts`), and it is 16 MB or smaller,
the card parses it in the browser. Once the original is attached, it offers **Open in
Transcript tab**. That asks the Transcript tab's "Replace working transcript?" question
when a transcript exists, calls `transcripts:importTimed`, and moves to `?tab=transcript`
(with the review intent when the speakers need it). Untimed text keeps the paged import
and "Use for minutes". The card only renders on broker-configured hosted deployments.

**Status toast.** Every action (assign, edit, combine, unmerge, import, link, copy, waveform
notes) announces in one toast, and the latest event wins: a new message replaces whatever
is showing, including an earlier Undo. Messages clear after 4 seconds, and Undo after its
own 10. Up to 768px, while a drawer or bottom sheet is open, the toast moves to the top of
the visible area (below the safe area, clear of the on-screen keyboard). It stops short of
the drawer's close button, so it never covers the sheet's actions or footer.

Checks: `npm run test:transcript-speakers` (resolution, chains, cycles, turns,
suggestions on inline copies of the oversplit and Teams fixtures, the source-file offer
including ZIP, merge/unmerge on both portable adapters, permissions, approved minutes)
and `npm run test:timed-transcript`.

## Record kinds

`meetings.recordKind` says how far a meeting goes: `"meeting"` (just the
meeting: date, attendees, materials), `"notes"` (informal notes, optionally with
a transcript) or `"minutes"` (agenda, motions, quorum and approval). A missing
value means `"minutes"`, so meetings created before the field existed behave as
before. Rows are not migrated. Helpers live in `shared/meetingRecordKind.ts`.

- **Creation:** "What do you want to keep?" in the meeting form. Board, AGM and
  SGM meetings default to formal minutes. Committees and other types default to
  notes. The default follows the body until the user picks a kind. Edit meeting
  can change it later.
- **Templates:** every kind keeps the template's agenda topics (they group
  materials) and its `templateSnapshotJson`. Only formal minutes get the
  template's recurring motions (and the "Schedule next meeting" adoption
  motion) at creation. The form's template summary says so per kind: "6 agenda
  topics · motions are added if you switch to minutes."
- **Overview:** notes and no-write-up meetings show notice, next meeting,
  meeting details (without quorum) and Conflicts & recusals. Export readiness,
  minutes approval, the gaps panel, proxies, minutes signatures, quorum rows,
  carry-forward counts and the Actions menu's approval and minutes-export items
  are formal-minutes only.
- **Tabs:** minutes meetings keep every tab. Notes meetings swap Agenda & minutes
  for **Notes** and hide Motions and Export. Just-the-meeting meetings show
  Overview, Transcript, Materials and Sources, with "Add notes" and "Start minutes"
  on Overview. `?tab=minutes` on a notes meeting opens Notes, and `?tab=notes` on a
  minutes meeting opens Agenda & minutes.
- **Notes:** autosave after a pause in typing, on blur and on page hide, through
  `meetings:update` (`meetings:write`). They are kept apart from `meetings.notes`.
  That field holds preparation notes (the offline preparation flow) and the
  provenance remarks that imports append, so neither should be copied into
  minutes.
- **Turn notes into minutes** (`meetings:startMinutesFromNotes`, portable, needs
  `meetings:write` and `minutes:write`): sets `recordKind: "minutes"` and seeds
  the minutes discussion with the notes. An empty discussion takes the notes. An
  existing draft keeps its text and the notes follow it. Approved minutes are
  never touched. A meeting with no minutes row gets the same empty skeleton the
  meeting page bootstraps. No AI runs. A draft with no motions also gets the
  motions creation skipped, built from the template snapshot (or, with no
  template, the agenda items that carry motion text); the result reports
  `motionsSeeded` and the toast says how many were added. Edit meeting and
  "Start minutes" on a no-write-up meeting use the same mutation.
- **Stepper:** Transcript · Notes · Minutes draft · Approved, computed from real
  state, appears on the Notes and Agenda & minutes tabs. The transcript is
  optional, so it is never the current step. Minutes meetings show Notes only
  when there are notes.
- **List:** the record kind wins in the Minutes column: "Notes" or "No write-up",
  even when a template gave the meeting a minutes stub. The Motions column shows
  "—" for them, and they do not count as "Held, no minutes".

**Motion labels** (`src/lib/motionDisplay.ts`): business motions are numbered 1, 2,
3… in minutes order; the adjournment record has no number and reads "Adjournment".
The Motions tab shows each number above the title, and its tally counts what it lists
("3 motions · 1 carried · 2 pending · plus adjournment"). Transcript pills, citations,
the Link to… menu (numbered motions, then the adjournment) and the ▶ chip's
aria-label use the same number and a short title: the motion's name, or its wording
without "BE IT RESOLVED THAT", "RESOLVED:", "MOTION:" or a leading "THAT". Live
motion rows are shown in the minutes' `motionIds` order so numbers stay stable.

**Create form:** while a time conflict is unacknowledged, the footer says
"Overlaps N other meetings" beside the disabled Schedule button, with **Review
conflict**, which scrolls to the conflict and focuses its acknowledgement.

Tests: `npm run test:meeting-record-kind` (now including templates on each kind and
seeding on conversion), `node --import tsx scripts/check-transcript-links.ts` (motion labels and tally) and
`npm run test:transcript-speakers` (speaker candidates).

## Playback

Recordings open from the user's device through an object URL and are never
uploaded. `index.html`'s CSP therefore needs `media-src 'self' blob:`. Without it
every recording fails with "could not be played". The waveform is decoded in the
browser at 8 kHz for files up to 200 MB. Larger files play without a waveform.

Recordings are therefore gone after a reload. When a transcript exists and no recording is
open, the toolbar says "Open the recording again to play — recordings stay on your device"
and names the last file opened from the device for that meeting ("Last opened:
board-meeting.wav (2.5 MB)"). Only the name and size are kept, in localStorage under
`societyer.transcript.lastRecording.<meetingId>`. Attached recordings are not remembered.

**Transcribe on this device.** In a browser-local workspace or the desktop app, once
speech-to-text is set up in Settings → On-device AI, an open recording gets
**Transcribe on this device** (meeting editors). It shows progress and Cancel, asks
before replacing a transcript, saves through `transcripts:importTimed` with provider
`local-whisper`, and opens Review speakers like an import. See
[local-ai.md](local-ai.md#speech-to-text).

**Search** shows "3 matches" until Next or Previous selects one, then "1 of 3", "2 of 3"…
(Enter and Shift+Enter step too). The first Next selects the first match.

**Attached recordings.** On a connected deployment with the transfer broker
(`VITE_MEETING_SOURCE_BROKER_URL`), meeting editors (`meetings:write`) also get
**Attached recordings**. This uses the same gate as Meeting source files and is
not shown in local or demo runtimes. It lists the meeting's `ready` sources of
kind `recording` with their size, then downloads the chosen one through the
broker's authenticated 5 MiB ranges. A progress bar and Cancel are shown while it
downloads. Each range length is checked before it is kept (`downloadMeetingSourceRanges` in
`src/lib/meetingSourceDownload.ts`, shared with "Download original"). The parts
become one Blob with a MIME type inferred from the extension, then a `File` that
plays through the same object-URL path as a device file, so waveform, peaks and
the speaker lane behave the same. Files over 200 MB carry a warning before
download: playback holds the whole file in memory and the waveform is skipped.
Choosing a device file cancels a download in progress. Object URLs are revoked when
the recording changes or the tab unmounts. This is a full download into memory,
not HTTP streaming. Check: `npm run test:transcript-source-playback`.

## Drafting minutes

**Draft minutes from transcript** shows for users with `minutes:write` when a
transcript exists. On a server workspace it calls `minutes:generateDraft`. In a
browser-local workspace or the desktop app it drafts with the on-device model when
one is set up in Settings → On-device AI (see [local-ai.md](local-ai.md)), then saves
through the portable `minutes:upsertFromDraft`. Without either it is disabled, with a
visible "needs a connected server or an on-device model" note and a Settings link; the
demo never drafts. It sends the transcript row's regenerated `text` (with
assigned names, e.g. `Jane Doe: …`), not `minutes.draftTranscript`
(`minutesDraftTranscript` in `shared/minutesDraftInput.ts`). It asks before
replacing a started draft. Adopted minutes, and drafts whose sections hold recorded
content, are refused up front with the server's message. `minutes:generateDraft`
repeats that check before calling the model, and `upsertFromDraft` checks again
atomically. On success the page moves to `?tab=minutes`, unless the user has left
the Transcript tab. Checks: `npm run test:transcript-minutes-draft` (convex-test
with a mocked OpenAI-compatible endpoint) and `npm run test:minutes-draft-shared`
(the server and on-device paths send the same prompt and store the same minutes).

## Layout

Breakpoints are container queries on `.transcript-workspace`, because the app
sidebar changes the available width independently of the viewport:

- **1100px and wider:** transcript plus a sticky 280px speaker panel.
- **760–1099px:** speaker panel narrows to 240px.
- **Under 760px:** speakers become a chip row, and a chip opens a bottom sheet
  (`Drawer`) with a sample quote, play-sample, attendee list, free text, combined labels
  and Combine speakers. A "Review speakers" chip ends the row for editors.
- **Under 420px:** player controls collapse to a single row.

The player sticks to the top of the meeting page's scroll container (`.page`). Only
while pinned (`is-stuck`), a `::before` strip masks the gap between the scrollport's top
edge and the player, so no text shows above it. `useStuck` measures that gap on scroll and
resize and sets it as `--transcript-player-mask`, so it follows the container's padding at
every breakpoint. (The old upward box-shadow was replaced by the phone card rule's hairline
shadows, which let a sliver of text show on phones.)

Checked live in the demo workspace (`/demo/app/meetings/<id>?tab=transcript`) at
320, 390, 768, 1024, 1280 and 1600px, in light and dark.

## Exports

With **Include transcript**, every minutes style ends with a Transcript section that has one
paragraph per stored `Name: text` line. The speaker prefix is bold, and an optional
leading timestamp (`[0:42]`) stays plain. Lines without a speaker prefix stay as plain
paragraphs (`renderTranscriptLinesHtml` in `minutesRenderer.ts`). The Word converter
(`src/lib/docx.ts`) also keeps newlines in `<pre>` and `white-space: pre*` content as
`<w:br/>`, so the preview, Word and PDF (all built from the same .docx) keep line structure.
Check: `npm run test:minutes-transcript-export`, which covers HTML for all six styles, the
Word XML and a 5,000-line transcript.

A public-session copy (the **Board Public** style) never uses the minutes' transcript copy.
With **Include transcript** it carries the transcript built from the timed segments by
`transcriptTextWithoutInCamera`: in-camera runs become "[In-camera session — not shown]"
when every session is marked (see Access), and the section is left out when any isn't.
In-camera agenda items are listed as "In-camera item". The **Public copy** toggle, which
also replaces names, leaves the transcript out entirely.

## References

Design and implementation references:

- [hyperaudio-lite](https://github.com/hyperaudio/hyperaudio-lite) (MIT): word timing model, binary search, selection-to-time-range links.
- [praveenVnktsh/minutes](https://github.com/praveenVnktsh/minutes) (MIT, a Meetily fork): scroll-follow intent rules, click-vs-drag guard, speaker rename/merge with sample quotes, notes-first summarising.
- [Meetily](https://github.com/Zackriya-Solutions/meetily) (MIT): template-driven summaries.

No code was copied. Avoid hyperaudio-lite-editor, which is AGPL.

## Touch devices

Emulate real touch devices (Playwright `devices[...]` with `hasTouch`/`isMobile`, so `pointer: coarse` and `hover: none` match) against the demo meeting. Verified on iPhone SE, iPhone 12, Pixel 7, iPad Mini and iPad Pro landscape: every transcript control is at least 40px, no sideways page scroll, a tap seeks without leaving a text selection, and the per-line actions stay visible (as quiet icons) without hover.

## Next

- Suggest combining voices that sound alike. This needs speaker embeddings from the
  diarizer, which the import formats do not carry.
- Undo for "Apply all suggestions" assignments. Only combines are undoable today.
- Exercise "Open in Transcript tab" in a broker-configured browser session. It is
  covered at unit level only.
- Offer "Enrich notes from transcript" as an AI step on the Notes tab.
- A "Remove link" action for linked motions/action items (the mutation already supports clearing).
- Stream attached SharePoint recordings instead of downloading them whole. This needs broker support for media range requests, or a MediaSource pipeline, so large files can play without being held in memory.

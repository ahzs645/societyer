# WP-G: meetings & minutes interface

Implements `findings/ui-meetings.md` F2–F30 (F1, the Markdown editor, belongs
to WP-A), schema findings B3/B4/B5/B8, and ui-people P9 for meetings. The goal
is that a reviewer can correct a transposed meeting record on the meeting
page itself.

## What was built

### Meeting detail page

- **Edit meeting** (F2, B8) is a header button and an Actions menu item
  (`EditMeetingDrawer`). It covers:
  - title;
  - body, picked in one control (`shared/meetingBodyPicker.ts`): Board,
    Special board, AGM, SGM, any committee, a special committee meeting, or
    an external body;
  - date and precision, with start and end time kept as local text plus a
    time zone. A date-only meeting stays date-only and is stored as the
    noon-UTC placeholder;
  - venue or electronic link;
  - status, including Cancelled and "Held — minutes missing";
  - quorum and notes.

  The drawer shows the source header as written, with one-click "use source
  time" and "use source location" buttons. The new optional `meetings.special`
  field holds the "special meeting" flag.
- **Header** (F3) shows the corrected values: body · long date · location ·
  committee link. The source header text appears underneath, marked "As
  written in source". The duplicated time is gone. The sidebar "Meeting
  details" panel behaves the same way.
- The header also has **Mark source reviewed**, **Merge duplicate…** and
  status and review badges.
- `UnsupportedDetailsBadge` appears on the meeting, on each motion, and in the
  Motions drawer. `MeetingGapsPanel` lists the representation gaps for the
  meeting and its minutes, with triage buttons.
- **Dates** (F14) go through `formatMeetingDate` and `meetingCalendarDate`
  everywhere a meeting date is shown. That covers the list, detail, sidebar,
  exports, dashboard, committee, library, portal, AGM workflow, the
  draft-minutes picker, the outbox email and the meeting pack. Date-only
  meetings never show 12:00 or 4:00 AM. Exports say "a time not recorded in
  the source".

### Attendance (F5, F13, F15, B4, B5, P9)

- `MeetingAttendanceGrid` has a view mode on the minutes tab and opens an
  editor in a large modal. Each row has:
  - name;
  - status: present, regrets, absent, staff, guest or proxy;
  - role;
  - affiliation;
  - represented organisation;
  - a people-directory person (`PersonPicker`);
  - a "counts for quorum" flag.
- Rows can be filled from the current minutes and register, from the parsed
  source record, from pasted text (one name per line, or comma separated), or
  from current directors.
- `screenAttendanceName` suggestions offer per-row "Not a person", "Split"
  and "Link to …" actions. Bulk versions are "mark all non-persons" and "link
  all exact matches". Present, regrets and quorum counts update as you edit.
- Saving calls `minutes:saveAttendanceGrid`, which does all of the following
  in one transaction:
  - writes `detailedAttendance` and derives `attendees`, `absent` and the
    meeting's `attendeeIds` from it;
  - updates or creates `meetingAttendanceRecords` with confidence
    `reviewed`;
  - marks unmatched register rows `removed` or `not_person`. They are kept,
    not deleted, because they are evidence;
  - records non-persons in the minutes' non-person evidence list;
  - marks the minutes' matching `personOccurrences` as `not_person`, with
    review history.
- Adopted minutes are refused.
- The "Present" stat and the readiness checks use `minutesPresentCount`. That
  count includes staff, guests and proxies and ignores role words and
  headings. If quorum is recorded as met but too few people are counted
  present, the card shows a warning.

### Motions (F6, F11, F12)

- `MotionEditor` gains the following fields:
  - mover and seconder person pickers (`movedByPersonId`,
    `secondedByPersonId`), with the free-text name still kept;
  - named abstainers and opposers, linked to people;
  - a dissent document (picked from the meeting's source and material
    documents);
  - the outcome as written in the source, plus a source locator.
- **Accept source wording** sets the outcome on every motion whose source
  text says "(Carried)" or similar, in one action.
- **Set outcome…** is a bulk modal for imported motions. It takes an optional
  override note.
- Consent items use a minutes picker and set the outcome to `received` (B3).
  The adopts-minutes picker lists the society's minutes.

### Agenda, sections and action items (F7, F10, F16, F22)

- Agenda items have an editable item number, requested action, scheduled
  time, consent flag and presenter (`AgendaItemDetailsModal`, opened from a
  pencil that appears on hover).
- Removing a section also removes its linked agenda item. The false "unsaved
  changes" warning is gone, because dirtiness is now compared with the stored
  section. A linked agenda item whose Remove button is disabled now explains
  why.
- `MeetingActionItemsCard` gives each action item a status (from the shared
  vocabulary), an assignee person picker, and **Create task**. Create task
  fills in the meeting, committee, assignee and mapped status, and links the
  task back to the action. The section editor no longer strips action status,
  person links or task ids.
- Minutes details: the JSON textareas are replaced by row editors
  (`StructuredRowsField`) for session segments, appendices, director
  appointments and special-resolution exhibits. Chair, secretary and recorder
  use name autocomplete. Call-to-order and adjournment times are editable.
  `nextMeetings[]` has its own row editor with a body choice.
- Substantive source sections open by default (up to 4). Trivial ones start
  collapsed.

### Review at scale (F17, F23, F24)

- **Meetings list**:
  - sorted by date, newest first;
  - review filter: all, needs review, reviewed, duplicates, no motions,
    date only, minutes missing, each with a count, kept in the URL as
    `?review=`;
  - body filter, kept in the URL as `?body=`;
  - new read-only columns and filter fields: `body`, `sourceReviewStatus`,
    `motionCount`, `presentCount`, `datePrecision` and `duplicateCount`;
  - search also matches people named in the minutes.
- Existing workspaces get the new columns: the page calls the idempotent
  `seedRecordTableMetadata.ensureForSociety` once when the meeting metadata
  has no `sourceReviewStatus` field. This needs the `settings:write`
  permission.
- **Bulk actions** (on the selected rows): mark source reviewed (with
  confirm), reopen review, set status, set body, delete (with confirm).
- **Merge duplicates**. Same-day, same-body meetings are grouped in a
  "duplicate groups" card. `meetings:mergePreview` shows what will move and
  `meetings:merge` does it, after a confirm step. The merge:
  - folds the duplicate's minutes into the kept meeting as an imported
    source version;
  - unions the source ids;
  - moves motions the kept meeting does not have and drops identical ones;
  - can add attendees found only in the duplicate;
  - re-points every reference: attendance register, person occurrences,
    signatures, gaps, agendas, tasks, documents and the other tables listed
    in `MEETING_REFS` and `MINUTES_REFS`;
  - deletes the duplicate and logs the activity.

  Adopted minutes block the merge. A different day or body only produces a
  warning.

### Exports (F20, F21)

- Source tables:
  - cell widths come from the table grid;
  - widths in twips are converted to percentages (the old code rendered tcW
    2049% as a percentage);
  - rowspan columns are filled with placeholder cells, so continuation rows
    keep their columns after a page break. vMerge broke across pages in
    docx-preview.
- On the PGAIR 2013-05-14 record the PDF went from 8 pages to 5. The tables
  are correct and the one-character columns are gone.
- Letterhead logos stay logo-sized (≤168 px). Header "DRAFT" watermarks render
  once, as a watermark marker. Alt text no longer leaks into the body.
- The technical field dump is gone. Internal copies only get a readable
  **Changes since import** list.
- File names follow `YYYY-MM-DD-title-minutes.ext`.

### Other fixes

- F4: closing a drawer with Escape, the X or the backdrop asks before
  discarding unsaved changes (`useDirtyCloseGuard`). This applies to edit
  meeting, create meeting, minutes details and agenda details. Escape inside
  an open `NameAutocomplete` list closes only the list.
- F8: Record approval offers only plausible approving meetings, held after
  this one and newest first (`approvingMeetingCandidates`). The date starts
  blank. Save is disabled while `minutesApprovalIssues` reports a problem:
  approved before the meeting, before the approving meeting, or in the
  future.
- F18: the import note says "Paperless OCR" only when there is a `paperless:`
  source id.
- F19: /app/minutes counts section-level actions ("N open of M", "All M
  done", "None recorded").
- F27: fixed the duplicate React key. The Tooltip → Badge ref warning is
  fixed by wrapping the Badge in a span.
- F28: `Tabs` takes opt-in `tabRoles` and `ariaLabel`, used on the meeting
  page. Agenda inputs have aria-labels.
- F29 (phone): the subtitle and date are visible, the tabs are labelled and
  scroll horizontally, the stat cards sit in one compact row, and long source
  ids wrap.

### Performance (F26)

Measured on the restored PGAIR profile on the same machine, with
`scratchpad/wpg/run/perf.mjs`:

| Step | Before | After |
| --- | ---: | ---: |
| List cold load | 12.7 s | 8.9 s |
| Meeting detail, hard load | 20.1 s | 8.6 s |
| "Agenda & minutes" tab | 19.1 s | 0.3 s |
| Back to list | 4.8 s | 0.6 s |
| Detail JS heap | 551 MB | 365 MB |

What changed:

- `minutes:listSummaries` replaces the full minutes rows on the list, the
  minutes page and the meeting page.
- Summaries and the merge reference scan read rows inside the `.filter()`
  predicate instead of collecting (deep-copying) whole tables. This works the
  same way on Convex.
- The person-links card loads only when asked for.
- `documents.list` loads only for material drafts.
- Meeting date formatters are cached.

The remaining cold-load time is runtime boot and the PortableQueryCache
re-running every watched query. That is WP-K's area.

## New and changed interfaces (for other WPs)

- **Portable functions** (manifest regenerated):
  - `minutes:listSummaries({ societyId })`: light rows with counts, review
    state, `peopleText` and `actionObservations`.
  - `minutes:saveAttendanceGrid({ minutesId, rows, nonPersons?, quorumStatusIfUnset? })`.
  - `meetings:attendanceRecords({ meetingId })`.
  - `meetings:mergePreview({ targetId, duplicateId })` and
    `meetings:merge({ targetId, duplicateId, addMissingAttendees? })`.
- **Schema**: optional `meetings.special: boolean`.
- **Shared pure modules**:
  - `shared/meetingAttendanceGrid.ts`
  - `shared/meetingBodyPicker.ts`
  - `shared/meetingDateEdit.ts`
  - `shared/meetingApproval.ts`
  - `shared/meetingMerge.ts`
  - `shared/meetingActionTasks.ts`
  - `shared/functions/minutesSummaries.ts`
  - `shared/functions/minutesAttendance.ts`
  - `shared/functions/meetingMerge.ts`
- **Components** (in `src/features/meetings/components/`): `EditMeetingDrawer`,
  `MeetingAttendanceGrid`, `PersonPicker`, `MeetingGapsPanel`,
  `MergeMeetingDialog`, `StructuredRowsField`, `MeetingActionItemsCard`,
  `AgendaItemDetailsModal`. The hook is
  `src/features/meetings/lib/useDirtyCloseGuard.ts`.
- **Small shared UI changes**:
  - `Tabs` has `tabRoles` and `ariaLabel` (opt-in);
  - `EvidenceRowsEditor` columns accept `choices`;
  - `NameAutocomplete` Escape closes only the open list;
  - `MotionEditor` takes `directoryPeople` and `documentOptions`.
- **Record metadata**: meeting fields `body`, `sourceReviewStatus`,
  `motionCount`, `presentCount`, `datePrecision` and `duplicateCount`, and
  status options `HeldMinutesMissing` and `Draft`.
- **Gates**:
  - `npm run test:meetings-review-ui` (`scripts/check-meetings-review-ui.ts`);
  - `npm run test:meetings-editing-ui` (Playwright, synthetic data). Set
    `MEETINGS_EDITING_URL` to reuse a running dev server.

## Assumptions and decisions

- **Approval-date validation is UI-only.** Enforcing it in
  `minutes:recordApproval` would break existing fixtures and back-dated
  imports.
- **Retired attendance register rows are kept** with status
  `removed`/`not_person`, because they are evidence of what the import read.
- **Person links** on attendance and motions are checked against the
  directory the workspace can see (`visibleDirectoryRows`). That includes
  shared and local directory rows that have no `societyId`.
- **External bodies** are stored as type `Committee` with `hostBody` set.
  Special meetings use the new `special` flag. Neither adds a new type enum.
- **Dissent documents** are limited to the meeting's source and material
  documents, so the picker does not load the whole library.
- **Merge** keeps the target's agenda when both meetings have one. It moves
  the duplicate's minutes whole when the target has none.
- **Two `PersonPicker`s now exist**: WP-H's Select-based
  `src/components/PersonPicker.tsx` and this WP's combobox in
  `src/features/meetings/components/PersonPicker.tsx`. They should be merged
  later.

## Deferred

- **F1** (Markdown editor): WP-A.
- **F23**, partly. The list is now sorted by date. The view "save changes"
  state on search/sort and the title-click side panel belong to the record
  engine (WP-A).
- **F25** (calendar and kanban layout, sidebar "Meetings 0" badge): record
  engine and shell, WP-A.
- **F12 and F16**, extraction quality (missing or run-on motions, merged
  agenda items, `| ` titles): import (WP-B, WP-L). Everything they get wrong
  can now be corrected in the UI.
- **F19**, partly. Evidence counts on /app/meeting-evidence and the minute
  book, and agenda titles carrying a different date, are not changed.
- **F9** did not reproduce. The counter is now fed by a live query
  (`actionObservations` in summaries).
- **F10**, partly. The JSON fields were replaced. The action-observation and
  quorum-checkpoint forms still have their expert fields.
- **F30**: the committee page cadence label is handled by WP-H. Creating an
  "Executive Committee" stays on the Committees page; the body picker then
  offers it.
- **People page → minutes "not a person"**: this WP covers the minutes →
  person-occurrence direction only. The reverse belongs to the people WP.
- **Clearing a field**: setting `quorumRequired` or an agenda item's
  `requestedAction` back to empty is not supported by the existing update
  mutations.
- **Pre-existing gate failures**:
  - `test:exports` fails because WP-C's `representationGaps`,
    `governanceExpectations` and `continuityPeriodMarks` tables are missing
    from export coverage.
  - The `interface-governance` "acting Member" test waits for a "Saved" toast
    on /app/users, a page this WP did not touch.

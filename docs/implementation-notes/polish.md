# Polish retest fixes

Branch `worktree-agent-a167fa041191e73f5`, based on `claude/clever-babbage-mu46rq` (including the final-fixes merge).

## What changed

| Item | Change | Where |
|---|---|---|
| MA-1 | A new motion's tallies start empty. Filling in a mover and seconder no longer counts as 2 votes For. | `src/components/MotionEditor.tsx` |
| MA-2 | The outcome picker spans the whole Add motion grid. In one grid column it was under the 480px container-query threshold, so the labels were dropped. | `_views-motions-editor.scss` |
| MA-3 | A collapsed motion shows its wording as a clamped second line (when it has a name), plus "Moved by X, seconded by Y". The agenda record's "Related motions" list shows the name with the wording under it. | `MotionEditor.tsx`, `MeetingMinutesColumn.tsx` |
| MA-4 | Pressing Escape in the inline section title closes at once only when nothing changed. Otherwise it asks "Discard changes to this section?" (Discard changes / Keep editing). | `useMeetingMinutesColumn.tsx` |
| MA-5 | New motions store `resolutionType: "Ordinary"`, which is what the select shows. | `MotionEditor.tsx` |
| MA-6 | "Agenda topics" leaves out an untouched source-notes dump, using the same rule the page uses to hide it (`visibleAgendaEntries`). | `sourceAgendaNavigation.ts`, `MeetingDetail.tsx` |
| MA-7 | `formatDueDate`: an ISO day is shown as "Oct 20, 2026" in the card and "October 20, 2026" in exports. Any other text is kept exactly as written. | `src/lib/format.ts`, `minutesRenderer.ts`, `meetingPackExport.ts`, `MeetingActionItemsCard.tsx` |
| MA-8 | `meetingNotYetHeld` is true for a Scheduled, Draft or Planned meeting dated on a later calendar day. A meeting dated today may be running, so it counts as possibly held. For a meeting not yet held: the "Present" tile reads "Expected"; the attendance badge reads "N expected"; the quorum badge reads "not yet determined" / "determined at the meeting"; and saving attendance does not stamp a quorum result. | `noticeWindow.ts`, `MeetingAttendanceGrid.tsx`, `MeetingProxiesCard.tsx`, `MeetingMinutesColumn.tsx`, `MeetingDetail.tsx` |
| MA-9 | On phones, the summary tile labels wrap onto a second line instead of being truncated with an ellipsis. | `_views-meeting-review.scss` |
| MA-10 | Edits to free-text motion fields (name, text, mover, seconder, override note, person ids) are saved after a 600 ms pause in typing, or on blur, unmount or `pagehide`. Structural changes save at once and carry any queued text with them. The local echo window restarts when the save is sent. | `MotionEditor.tsx` |
| (found) | Clearing a motion's name to retype it used to swap the input for the wording headline while you were typing. The input now stays while it has focus. | `MotionEditor.tsx` |
| A3 | Forward-looking demo records move forward in whole weeks from the story date (Tue 2026-04-21) so they are never in the past: the board meeting, its draft minutes, the packet task, committees' next meetings and scheduled maintenance. At or before the story date nothing moves, so tests that fix the clock there are unaffected. "Q2 board meeting" was renamed "Quarterly board meeting". | `staticConvexFixtures.ts` (`demoUpcoming`) |
| A4/O-3 | `society:createWorkspace` is a portable handler (`shared/functions/societyCreate.ts`) used by both runtimes. The Convex wrapper passes a hook that seeds record-table metadata; the local client seeds it after the mutation. The legacy mirror was removed, and the manifest now classifies the function as portable. | |
| A5 | Sidebar counts count as loading until the local workspace has hydrated, and every counted entry shows "…" while loading. Before hydration the seed answered, so a restored workspace showed 0. | `Layout.tsx`, `Layout.internal.tsx` |
| A6 | When today's month has no records, the record calendar opens on the most recent record on or before today, or else on the first upcoming one. Earliest and Latest jump buttons were added. The layout toggle's word buttons no longer inherit the 24px icon width. | `CalendarView.tsx`, `_components-tables-misc.scss` |
| A8 | `useCurrentUser` reads `users:get` as a record query, so a stale stored id is treated as "no current user". `users:get` was added to `DETAIL_RECORD_QUERIES`. | `useCurrentUser.ts`, `detailRecordQueries.ts` |
| P-O4 | A local "Record not found" query failure is logged with `console.debug`. Other failures still warn. A lasting not-found still reaches the page after the grace period. | `portableQueryCache.ts` |
| FF-1 | The date-and-time picker keeps focus on the typed-date field first, so a keyboard user can type the date straight away. The spec now follows that order: typed field, then Tab to Previous month. | `tests/interface-shared.spec.ts` |
| FF-2 | `meetings:get`, `committees:detail`, `goals:get` and `elections:get` are detail record queries, read with `useRecordQuery`. Meeting detail, minutes preview, AGM, election and person profile hold their sibling queries until the record exists, and show `RecordNotFound` or their own not-found state. All `/app/<area>/:id` routes were checked with a missing id. | |
| FF-3 | The DST calendar test pins `timezoneId: "America/Vancouver"`. | `tests/interface-calendar-views.spec.ts` |

## Decisions and assumptions

- **A3 dating.** Weeks are shifted forward rather than dates being made relative to today, so the weekdays in the story stay the same. Historical records (the 2025 AGM, approved minutes, filings, audit stamps) keep their real dates. A T3010 filing that is "Upcoming" with a 2026-09-30 due date is still in the past. The filings UI already flags it as overdue, which is a realistic demo state.
- **A4.** The portable handler follows the Convex semantics, which the local mirror had drifted from:
  - option validation;
  - address normalization;
  - the workflow is created by the new owner;
  - the activity rows match Convex.
  - The local mirror accepted the legacy act value `bc_societies_act`; hosted setup already rejected it. Two scripts used it and now use `societies_act`.
- **MA-8.** "Today" counts as possibly held, because the meeting may be running.
- **FF-1.** The typed-date field stays first in focus order (the reason it exists), so the spec was changed rather than the picker.

## For other areas

- **Detail pages read with `useRecordQuery` do not show generic local query failures (owner: final-fixes, local query error surfacing).**
  - Affected: DocumentWorkbench, and now meeting, committee, goal and election detail and the current user.
  - A non-not-found failure loops back to loading through `useQueries`, so the page stays on "Loading…" instead of showing the error boundary.
  - Repro: in the demo, patch `localDataClient.portable.runQueryTracked` to reject `goals:get`, then navigate client-side to `/demo/app/goals/static_goal_agm`. The query fails three times and the page stays on "Loading…".
  - Likely cause: `QueriesObserver.getLocalResults` creates a watch per read. Look at `PortableQueryCache.watchQuery` and the subscribe path, which re-run a failed key.
  - The P-O2 interface spec used a missing person to reach the error boundary; FF-2 made that a not-found state, so the spec now asserts that.

## Verification

- `npx tsc -b`, `npm run convex:typecheck`, `npm run lint` (0 errors)
- Gates:
  - new `npm run test:polish-retest`;
  - `test:static-parity`, `test:authorization-policy`, `test:permissioned-mutation`, `test:workspace-access`, `test:portable-manifest`, `test:portable-conformance-matrix`;
  - `test:platform-polish`, `test:meetings-retest`, `test:nav-counts`, `test:motion-governance`, `test:meetings-review-ui`, `test:meeting-governance`, `test:interface-route-coverage`;
  - workspace-creation gates: guided onboarding, snapshot round trip, packet autoseed, corporation flows, structured address and others.
- Playwright:
  - `meetings-editing.spec.ts` (3 tests, including the new polish test; the typing-speed test passes);
  - `interface-polish.spec.ts` (desktop and phone);
  - `interface-calendar-views`, `interface-final-fixes`, `interface-shared` and `interface-platform-retest` (desktop);
  - `demo-smoke` and `guided-setup` (one guided-setup test hard-codes port 43951 and could not run against a shared server).
- Browser:
  - restored PGAIR workspace on the dev server and in a production preview: sidebar loading counts, calendar opening and jumps, a held meeting still shows Present;
  - fresh local workspace (no warnings);
  - phone summary tiles.
- Screenshots: `scratchpad/shots/polish-*.png`.

# Tasks

The Tasks page (`src/pages/Tasks.tsx`) is the register of follow-ups for an organization: action
items from meetings, filing and governance work, and anything people add by hand. It offers a
grouped list, a board and the shared record table, all over the same filtered records.

## Files

| Path | What lives here |
| --- | --- |
| `src/pages/Tasks.tsx` | Page shell, view switcher, saved grouping, the edit drawer and the `TaskViewActions` used by every view |
| `src/features/tasks/taskModel.ts` | The joined row type, statuses and priorities, due-date buckets and labels, grouping, quick scopes, owners and primary links |
| `src/features/tasks/TaskListView.tsx` | Grouped list with collapsible groups, inline row edits and a composer at the foot of each group |
| `src/features/tasks/TaskBoardView.tsx` | Board: a column per status (or priority), cards with drag to move, and a composer per column |
| `src/features/tasks/TaskMenus.tsx` | In-place status, priority, due-date and "more" menus shared by rows and cards |
| `src/features/tasks/TaskScopeBar.tsx` | Quick scopes and the group-by select |
| `src/features/tasks/TaskQuickAdd.tsx` | The inline composer (Enter adds, Escape closes) |
| `src/features/tasks/TaskChecklist.tsx`, `shared/taskChecklist.ts` | Checklist steps inside a task and their validation |
| `src/features/tasks/TaskDetailExtras.tsx` | Drawer banner (overdue, blocked or done), notes and activity |
| `src/features/tasks/TaskVisuals.tsx` | Status and priority icons, due label, avatar, link chip, checklist badge |
| `src/features/tasks/TaskRepeat.tsx`, `shared/taskRecurrence.ts` | The Repeats control, the repeat mark, and the date rules for the next occurrence |
| `shared/functions/taskOccurrences.ts` | Creates the next occurrence when a repeating task is done |
| `shared/functions/taskNotifications.ts` | "Assigned to you", "due soon" and "overdue" notifications |
| `tests/interface-tasks.spec.ts` | Browser test for the list, board, checklist, undo and saved grouping |
| `src/features/tasks/timeline/` | Timeline view: `timelineMath.ts` (pure date maths), `timelineRows.ts` (tasks in, rows out), `TaskTimelineView.tsx` and its parts |
| `shared/taskSchedule.ts` | Start-date rules shared by the server and the timeline |
| `scripts/check-task-timeline.ts` | Timeline date maths, rows and the start-date rule (`npm run test:task-timeline`) |

## Behaviour

- **Grouping.** The list groups by status, due date, priority or owner, or not at all. The choice is
  saved per browser in `localStorage` and survives a reload. Done and Cancelled groups start
  collapsed. Unknown and Cancelled appear only for imported history.
- **Due dates.** A due date is free text. Only an ISO day (`YYYY-MM-DD`) is scheduled:
  - it is labelled Today, Tomorrow, Yesterday, a weekday within the week, or a short date;
  - it is red when overdue and amber when due within a day;
  - due-date groups are Overdue, Today, Next 7 days, Later and No due date.
- **Adding in place.** A task added from a group's composer starts with that group's values: its
  status, priority or due date. "Today" gets today's date and "Next 7 days" gets a date a week
  out.
- **Editing in place.** Rows and cards change status, priority and due date through their own menus
  without opening the drawer. Marking a task complete offers an undo that restores the previous
  status.
- **Quick scopes.** The scope bar filters to All, Assigned to me, Overdue, Due this week or No owner.
- **Checklist.** Steps belong to one task and have no owner or due date of their own; a step that
  needs one should become its own task. A task holds at most 100 steps of up to 300 characters
  each. Steps save straight away on an existing task, and rows and cards show progress as `done/total`.
- **Keyboard.** The arrow keys move between list rows, Enter opens a task, and Space selects it.
- **Timeline.** The view switch offers a timeline of current tasks with the same scope, filters, search and
  grouping as the list. A task with a start and a due date is a bar, a due date alone is a diamond, a start
  date alone is a short bar with an open end; tasks with neither sit in "Not scheduled" at the bottom, where
  clicking a day sets the due date. Day, week and month scales, Today, Fit and Earlier / Later; the scale and
  the task-list width are saved per browser. With `tasks:write` on a desktop, drag a bar to move it, drag an
  edge to change its start or due date, or focus a bar and use ← / → (Shift changes its length); each change
  saves with Undo. Phones are read-only: a tap opens the task. A start date can never fall after the due date.
- **Primary link.** A row shows the record the task belongs to: a meeting, filing, goal, commitment,
  document, workflow or committee.
- **Repeating tasks.** A task with a due date can repeat daily, weekly, monthly, yearly or every N of
  those, with an optional end date. Marking it Done creates the next one once (reopening and completing
  again does not make another): same wording, priority, owners, committee, tags and links, checklist
  unticked, status To do. The next due date counts from the previous due date and skips forward so it
  is not in the past; monthly and yearly rules keep the original day (31 Jan, 28 Feb, 31 Mar).
  Cancelling creates nothing, and nothing is created past the end date. The next occurrence does not
  send "assigned to you": its owners already had the task.
- **Notifications.** Responsible users are told when they are added to a task (never the person who
  added them), when it is due within the workspace's deadline lead time and when it becomes overdue.
  Each alert goes out once per due date; a new due date re-arms it. Only open current tasks alert.
  People without in-camera access see an in-camera task as "In-camera action". Each kind has its own
  switches in notification settings and is included in the daily digest; the weekly summary counts
  your own tasks that are due or overdue.

## Start dates, sub-tasks and board order

- **Start date.** `startDate` is a real calendar day (`YYYY-MM-DD`). It can't be after the due date
  when the due date is also a calendar day; the server refuses it on create and on any change to
  either date (`shared/taskSchedule.ts`). It sits beside the due date in the task form and is a
  "Start date" column the table can show. Quick add doesn't set it.
- **Sub-tasks.** A sub-task is a full task whose `parentTaskId` is another task in the same
  workspace, one level deep: a sub-task can't have sub-tasks, a task with sub-tasks can't become
  one, a task can't be its own parent, and historical actions take no part. The drawer's
  "Sub-tasks" section adds, ticks, opens and deletes them straight away (they are not part of the
  parent's draft); a sub-task's drawer links to its parent and offers "Make this a separate task".
  In the grouped list a sub-task sits indented under its parent (with a fold control) when both are
  in the same group, and otherwise stands alone with a hint naming the parent. Parents show
  "2 of 5" (Cancelled sub-tasks don't count). Sub-tasks count as tasks everywhere. Deleting a
  parent says how many sub-tasks go with it and deletes them; completing a parent leaves them alone.
  New sub-tasks take the parent's committee and goal.
- **Board order.** `position` orders cards within a board column for the whole workspace
  (`shared/taskPosition.ts`). Dragging writes the midpoint of the new neighbours, so one drag writes
  one task; the column is re-spaced only when neighbours get too close. Cards without a position
  keep the table's order after the positioned ones; dropping below them gives the ones above the drop
  point positions too. Dragging to another column still changes its status or priority and places
  the card where it was dropped. Alt+↑/↓ moves a focused card; the card menu has "Move to top" and
  "Move to bottom" (phones have no drag). Moves need `tasks:write` and show at once.

## Data

Tasks live in the `tasks` table (`convex/tables/policies.ts`); `checklist` is an optional array of
`{ id, title, done }`, `startDate` an optional `YYYY-MM-DD` day (the server refuses one after the due date), `parentTaskId` the parent of a sub-task
(index `by_parent`) and `position` the manual board order. Status values come from `shared/taskStatus.ts`. `recurrence` holds the repeat
rule; `recurrencePreviousTaskId` and `recurrenceNextTaskId` link occurrences; `dueAlertsSent` records
the due date each alert last went out for. Historical actions imported
from minutes can be promoted to current tasks with "Make current".

## Attachments

A task can hold any number of things it is about, in the `taskAttachments` table
(`convex/tables/taskAttachments.ts`, `shared/taskAttachments.ts`,
`shared/functions/taskAttachments.ts`): one row per thing, with its kind (`document` or
`opportunity`), its key as text and a display snapshot (title, buyer, closing date). The single
"Linked to" slots above still say where a task came from; attachments say what the work is about.

- **Drawer.** `src/features/tasks/TaskAttachments.tsx` lists them under the checklist. Documents are
  added from the workspace's documents; opportunities come from procurement review. Each opens and
  can be removed, and every change saves at once and is logged to the task's activity.
- **Rules.** Reading needs `tasks:read` and changing needs `tasks:write`. A document must belong to
  the workspace and be one the person may open; documents a reader may not open are left out of
  every list. Opportunities need the procurement review module. Attaching the same thing twice
  changes nothing. Deleting a task or a document removes its attachments.
- **Procurement.** An opportunity's action items are the tasks holding it. The notice page and the
  list's row menu offer "Create action item", "Add to an existing action item…" and an "Open" entry
  per task; once it is on a task, a new one is the separate "Create another action item".
- **Linked to.** The Tasks table's read-only column adds "Document" and "Opportunity" for attached
  things.
- **Test.** `npm run test:task-attachments`.

## Tests

`npm run test:task-structure` checks start dates, the sub-task rules (on hosted Convex and the local
runtime) and the position arithmetic.

```bash
npm run test:task-recurrence       # repeat date rules and the next occurrence
npm run test:task-notifications    # assigned, due soon, overdue, privacy and digests
npx playwright test -c playwright.interface.config.ts tests/interface-tasks.spec.ts --project=desktop
```

If Playwright's own Chromium is not installed, set `SOCIETYER_CHROMIUM_PATH` to a Chromium binary.

The test pins the clock with `page.clock.setFixedTime`, so the due-date labels and buckets are
stable.

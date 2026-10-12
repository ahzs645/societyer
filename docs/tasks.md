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
| `tests/interface-tasks.spec.ts` | Browser test for the list, board, checklist, undo and saved grouping |

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
- **Primary link.** A row shows the record the task belongs to: a meeting, filing, goal, commitment,
  document, workflow or committee.

## Data

Tasks live in the `tasks` table (`convex/tables/policies.ts`); `checklist` is an optional array of
`{ id, title, done }`. Status values come from `shared/taskStatus.ts`. Historical actions imported
from minutes can be promoted to current tasks with "Make current".

## Tests

```bash
npx playwright test -c playwright.interface.config.ts tests/interface-tasks.spec.ts --project=desktop
```

If Playwright's own Chromium is not installed, set `SOCIETYER_CHROMIUM_PATH` to a Chromium binary.

The test pins the clock with `page.clock.setFixedTime`, so the due-date labels and buckets are
stable.

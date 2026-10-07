# WP-A: platform / shared UI

Scope: shared editor, popovers, record tables, focus, routes, dates, global
search, i18n and phone tables. Page business logic owned by other packages was
only touched where a shared fix required a one-line change (date comparisons,
`today` derivations, a few plural strings).

## What was built, per finding

| Finding | Change |
|---|---|
| F1, D-11, P6 rich editor | `MarkdownEditorImpl` no longer races Crepe `create()` against `destroy()`: creation starts on the next task (StrictMode's synchronous mount/unmount/mount never builds a throwaway editor), each Crepe instance renders into its own container, and teardown waits for Milkdown. A rejected `create()`, an async `MilkdownError`/`Context "…" not found` while starting, a missing `.ProseMirror` view, or a 20 s stall re-throws into `MarkdownEditor`'s error boundary, which shows the plain Markdown textarea with the current value. While loading, the stored Markdown is painted via CSS so the box is never empty. `vite.config.ts` pre-bundles every Milkdown entry the lazy editor imports, so a late dependency re-optimization can't load two `@milkdown/ctx` copies (the likely source of the audit's `Context "nodes" not found` on long-lived dev servers). Escape hatch/test hook: `localStorage["societyer:plain-markdown-editor"] = "1"`. Verified in dev (StrictMode) and in `vite build` + `vite preview`: task description, minutes section notes, motion text and document comments mount, show stored text, edit and save; fallback path edits and saves. |
| H2, D-05 filter popover | New `src/lib/floatingLayer.ts`: `isOutsidePointerEvent(event, ...containers)` treats portaled panels (`[data-floating-layer]`, `.menu`, `.calendar`, `.menu-backdrop`, `.color-pop`, `.mention-popover`, cell-editor popovers) as inside. Used by the record-table Filter popover, header menu, aggregate menu, toolbar menus, RecordTable, `ViewportPopover`, `FilterBar`. `Select` and `UserPicker` portals carry `data-floating-layer`. |
| S-2 focus | Root cause: the grid keydown handler treated Ctrl/Cmd+K as `k` (row up), set the focused cell and pulled focus into the table. It now ignores modified keys (except Ctrl/Cmd+Enter) and events from buttons/links; the focus-follow effect never takes focus from outside the grid. Palette focus return: `useDialogFocus` keeps the original return target when its layout effect re-runs while open (Suspense re-reveal / StrictMode), which caused the first-open return to `<body>`. |
| S-1 routes | `/app/people-history` → `members:read`, `/app/source-model-coverage` → `documents:read` (its primary data is evidence registers); all three routes added to `tests/helpers/interfaceRoutes.ts` (`/app/people-directory/:id` as a `missing-record` fixture — the demo seeds no directory rows). |
| S-3/S-4 | Specs follow the renamed backup input and assert the disabled "Create session" + parse badge for invalid JSON. |
| S-5 | UI fixed: `CalendarView`'s layout button is "Agenda" (was a second "List" next to the page's List/Calendar toggle). `interface-calendar-views.spec.ts` updated. |
| S-6 | `playwright.interface.config.ts` honours `SOCIETYER_CHROMIUM_PATH`; the camera spec carries it into its own `launchOptions`. |
| S-7 | Hooks moved above early returns in `Communications.tsx` / `ImportSessions.tsx`; `usePrompt` click handler in `GlobalAiAssistant` renamed; `react-hooks/rules-of-hooks` is now `error` (0 errors). |
| G-08 dates | `shared/dateOnly.ts`: `todayDateOnly`, `isPastDue`, `daysUntilDate`, `relativeDateOnly`, `toDateOnly`, `parseDateOnly`, `addDaysToDateOnly`, `compareDateOnly`. Used for overdue/due-soon on deadlines (list + calendar tone), dashboard filings, commitments (and notice-task date arithmetic), tasks, timeline, insurance renewals, grant reports and volunteer screenings. `relative()` renders date-only values as today/tomorrow/in N days and fresh timestamps as "just now"; obligations "reviewed" uses the full timestamp. Every `new Date().toISOString().slice(0, 10)` "today" in `src/` and `shared/` (≈60 files, mechanical) is now the local day; firm overview, annual cycle, static demo dispatch and WebMCP likewise. |
| M7, M8 search/palette | `firm:search` also covers meetings, minutes (sections/discussion/motions), motions, members, tasks, committees, grants, policies, insurance and filings (per read permission, max 8 per kind; accent-insensitive, all terms must match). Hits route to the record: detail pages for documents, meetings, minutes (`?tab=minutes`), grants, insurance, committees, members, people directory; deadlines, tasks, motions and filings via a new generic `?record=<id>` deep link in `RecordTableScope` (opens the side panel; closing drops the parameter). Palette shows type + context, hides hits in disabled modules; "Add asset" is gated on the Asset register both in the palette and in `GlobalAssetCreate`. |
| L6 | `pluralize()` in `src/lib/format.ts`; record-table footer and Documents badges. |
| L10 | `@media (pointer: coarse)`: header cells 44px, sort buttons 40px, column menu 36px, view toggles 40×36, aggregates/toolbar 36px, DatePicker clear 32px. |
| L12 | "Save as" view uses the in-app prompt; `RecordTableViewToolbar` remembers the chosen/saved view per browser (`societyer:record-view:<society>:<object>`), so it stays selected after reload. |
| L20 | Demo banner label uses `blue-11` (7.3:1 in dark mode, was 2.9:1). |
| L22 | Notifications popover: `role=dialog`, label, focus in, Escape, focus return. |
| M10 i18n | `<html lang>` follows the language (`en`/`fr`). French catalogue now covers every navigation label (43 added + "Advanced setup" group, "Browser apps" key was missing), Settings tabs/cards/toggles, demo banner, record-table toolbar, Save-as prompt and modal default buttons. |
| G-30, D-17, M11 phone tables | Shared plain tables on phones keep words whole, give text cells a 6.5rem minimum and one-line headers, so they scroll sideways instead of wrapping per character. Card-edge `.table-wrap` no longer bleeds past the card. Record-table row actions are static and visible below 760px (sticky actions covered all cells on narrow non-touch windows); invisible hover actions no longer intercept clicks. |
| G-22 | Static demo keeps the selected workspace in `sessionStorage` for the tab, so a new workspace stays selected after reload. |

## Gates added
- `npm run test:date-only` (`TZ=America/Vancouver`, plus Auckland/Kolkata/UTC and DST cases) — also chained into `test:gap-contracts`.
- `npm run test:global-search` (every new kind through the static mirror, record routes).
- `npm run test:platform-polish` (en/fr catalogue parity and placeholders, every route label translated, plurals, floating-layer selector).

## Interfaces other packages can use
- `shared/dateOnly.ts` (also re-exported from `src/lib/format.ts`: `isPastDue`, `todayDateOnly`, `daysUntilDate`, `relativeDateOnly`, `toDateOnly`). Use these instead of `new Date(dueDate)` comparisons.
- `src/lib/floatingLayer.ts`: `isOutsidePointerEvent`, `floatingLayerProps` / `data-floating-layer` for any new portal.
- `RecordTableScope` deep link: `?record=<id>` (`RECORD_DEEP_LINK_PARAM`).
- `pluralize(count, singular, plural?)` in `src/lib/format.ts`.
- `firm:search` result has `subtitle` and the `GlobalSearchKind` union.

## Assumptions / decisions
- Could not reproduce the Milkdown error on a fresh dev server or under 20× CPU throttling; the evidence points at a stale long-lived dev dependency cache (duplicate ctx module URLs) combined with the StrictMode double mount. Both causes are now closed and any residual failure falls back to the textarea instead of an inert box.
- Server-side shared functions use the runtime's local calendar: correct for the local runtime (browser); a hosted Convex server stays on UTC, as before.
- Search scans society tables in memory (no new search indexes, no schema change); fine for workspace-sized data.

## Deferred / for other packages
- `/app/people-directory/:id` with an unknown id may still sit on "Loading" (P12/M1, owned by the people package); the new route fixture exercises it.
- Import review session cards that render one letter per line (`.import-session-row`, D-17/D-09) and the documents' frozen-title width are page-specific (documents package).
- `test:interface-checks` still chains with `&&` (suggestion only).

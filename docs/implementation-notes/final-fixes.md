# Final fixes (re-test follow-ups)

Open items from the suites, intake, governance and platform re-tests. Each one
has a gate or spec.

## SU-11: bundle budget (local data client)

- `shared/portable/lazyHandlers.ts`: `lazyHandlers(() => import("./x"))` returns
  async handlers with the module's signatures. The module is fetched the first
  time one of its handlers is called. A failed fetch is retried on the next call.
- The registry loads 30 heavy domains this way: intake, intake review, import
  sessions and queue, promotion domains, continuity, gaps, legal records and
  documents, accounting, inventory, minute book, elections, assets, grants,
  funding, AI agents, motion backlog, document catalogue, pathways, workflows,
  firm, minutes repair, meeting merge, and others.
  - Every entry still names its handler.
  - Hosted Convex never imports the registry.
- Dexie: the vault schema moved to `src/lib/localDexieDatabase.ts`.
  `LocalDexieRowStore` imports it when it opens the vault. Writes issued before
  the vault arrives wait for it (`database()`). Heavy-field splitting follows
  `persistent`, which is set synchronously.
- Result: `localDashboard` went from 910,601 to 598,284 gzip bytes. The budget
  stays at 900,000.
- Gates:
  - `test:local-client-lazy-domains`: registry and Dexie laziness, and lazy-handler semantics.
  - `test:frontend-bundle-budget`.
  - The offline local-recovery specs import the database class from its new module.

## SU-12 / O-8 / P-O3: performance

- Cause: a cold visit to Documents read the persisted projection memos (about
  11k rows) with one IndexedDB `get` per row.
  - Fix: `loadProjections` reads lists of 256 rows or more with one key-range
    `getAll`, then filters to the requested ids.
  - Spec: `offline-rollout-local-recovery.spec.ts` checks that the range read
    returns exactly what per-row reads return.
- Members: the "Membership rule versions" panel loads its query only once the
  panel is opened.
- Measurements:
  - Setup: restored large profile, production build, `perf:measure-local`.
  - Documents: 2.0–2.8 s, down from 3.1–4.4 s at the same load. With three
    extra busy processes it is 2.9–3.0 s.
  - Members: 1.5–1.7 s (2.2–2.3 s under the same extra load).
  - Imports: 1.6 s (2.3 s under load). This covers P-O3.
  - `npm run test:local-workspace-perf` passes. Every route is under 3,000 ms;
    Documents is the slowest at 2,821 ms.
- Remaining cost on Documents:
  - About 1 s of vault boot.
  - About 0.5–1 s for `documents:browse`.
  - Roughly 130 rows whose provenance memo misses on every visit (60–170 ms).
    Their cause was not found. Deferred.

## SU-13: desktop build

- The type errors were fixed on both branches. On the merge, the platform's
  `noImplicitAny: false` and the annotated parameters were kept, along with a
  single `@/*` path.
- `test:electron-architecture` now runs the desktop typecheck and checks the
  alias. CI runs it as well.
- `desktop:smoke` passes `--no-sandbox` when running as root, because Chromium
  refuses to start as root otherwise.
- Verified under Xvfb: `desktop:build` and `desktop:smoke` pass.
  - The Electron 42.3.0 zip was unpacked into the scratchpad and
    `ELECTRON_OVERRIDE_DIST_PATH` set, because the npm download is cut off.

## SU-14 / SU-15 / SU-16: gates

- SU-14: the tenancy probes now get valid arguments:
  - a joined date;
  - a known task status;
  - a historical-action task fixture;
  - a period status and key;
  - a gap status.
  The foreign-id checks for these five functions are now reached, and all
  five are blocked (no leak).
- SU-15: `scripts/lib/writeTrackedReport.mjs` rewrites a tracked report only
  when its content changes; run timestamps are ignored in the comparison.
  - Used by the provider gates, the PowerSync invalidation gate, the stage 2
    tenancy report and the authorization-surface recorder.
  - Gate: `test:gate-report-hygiene`. A gate run now leaves `git status` clean.
- SU-16: `offline-rollout-production.spec.ts` skips when the lab account file is
  absent, so `test:offline-rollout` loads and runs the local specs.

## Intake / import

- **X-02.** The effective date now comes from the first that applies:
  1. a stated effective date;
  2. a stated adoption date;
  3. the adopting meeting's day.

  This applies in the intake bundle and in the import-session policy
  applier. A month is never padded to a day. A labelled "Approved: <date>"
  line is a stated value (0.85), so bulk accept carries it into promotion. The
  Policies table also fits 1440 px:
  - the Lifecycle facts sit inside Status without repeating other columns;
  - badge groups wrap;
  - the text wraps at desktop widths.
- **X-04.** A day-precision source with an unambiguous local start time
  ("7:00 p.m.", "19:00", "07:00") is placed in the organization's time zone
  and stored with `scheduledAtPrecision: "datetime"`. The local text is kept.
  - The zone comes from an explicit `timeZone` if set, else the home province
    via `organizationTimeZone`. A BC society gets America/Vancouver. Federal or
    unknown jurisdictions get none.
  - An ambiguous "7:00" and date-only meetings stay date-only.
  - "Repair imported minutes" places the times of earlier imports and reports
    the count as `meetingTimesPlaced`.
  - Import identity and intake provenance compare the meeting's local calendar
    day (`meetingCalendarDate`), so an evening meeting still folds with its copies.
- **X-05.** Directors marked NeedsReview are listed as unconfirmed evidence and
  never counted as confirmed. When they would complete the requirement, the
  period is `source_only` with a "Confirm directors" action, shown in the
  period drawer.
- **X-06.** The View source drawer hides structural paths: `kind`, source ids,
  column keys, arithmetic checks and the organization name. Fields get human
  labels, for example "Attendance 3 › Status". The rows stay stored.
- **X-07.** A statement of directors maps to `ChangeOfDirectors`, the same kind
  as a notice of change of directors. Assumption: in the BC registry it reports
  the directors after a change; it is not an annual report.
- **INT-17.** Correspondence decision fields bulk-accept at 0.6 when they are
  stated and span-verified (`isBulkEligible` still requires both). Promotion
  keeps them as restricted source evidence.

## Platform items

- **P-O1.**
  - A document of another organization opens in that organization when the
    viewer belongs to it.
  - The linked-people panel reads the document's organization.
  - The panel has an inline error state with Retry.
  - The version, comment and signature panels wait for the document.
  - Verified on the restored large profile.
- **P-O2.** The local query cache keeps a failed query and `useQuery` rethrows
  it, as hosted Convex does.
  - A "not found" failure is surfaced only after a 1.5 s grace period, because a
    deleted row's watcher normally unmounts first.
  - A role-permission denial keeps the old stable `undefined`. Optional panels
    query what the role may not read, and the route gate explains denials.
  - Every page is wrapped in `PageErrorBoundary`, inside `RouteAccessGate`. It
    shows a readable message, Retry (which re-mounts and re-runs the queries)
    and Back to dashboard. It resets on a route or organization change.
  - The full desktop interface suite was run with the change. The remaining
    failures are listed under "Not mine".
- **P-O6.** Calendar sync keeps the time of timed events:
  - UTC times are shown in the viewer's zone;
  - TZID times are shown in their own zone;
  - floating times are shown as written;
  - all-day dates stay dates.

  The parser is in `shared/icsCalendar.ts`. Gate: `check-platform-polish`.
- **P-O5** (French body text) is out of scope and remains as listed.

## Not mine (seen while testing)

- `interface-shared.spec.ts:103` fails on this branch (none of these changes touch the picker): the
  date-and-time picker's focus now starts in the new typed-date input, not on
  "Previous month". This comes from the platform O-9 change.
- `interface-calendar-views.spec.ts:146` depends on the browser time zone. It
  only passes under the calendar-views config, which sets America/Vancouver.
- Meeting pages with a missing id show the page error boundary instead of a
  "Meeting not found" state: `meetings:get` throws "Record not found".
  Proposed fix for the meetings owner: gate sibling queries on the meeting, as
  Documents now does.

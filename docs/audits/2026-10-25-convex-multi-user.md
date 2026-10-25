# Convex, multi-user collaboration, and view audit

**Date:** 2026-10-25

**Repository:** `ahzs645/societyer`

**Reviewed baseline:** `2ebd01b948a984bfb017438b4043be83d1fa1a99` (`main`)

**Review branch:** `audit/convex-multi-user-2026-10-25`

## Outcome and evidence boundary

The highest-priority source defects were in personal notification isolation and simultaneous meeting editing. This branch fixes those defects, adds regression checks against actual Convex handlers with synthetic data, and makes several bounded-read and view-validation improvements. Convex is a reasonable architecture for a small collaborating team; the source review does not establish a need to change databases or upgrade a plan. Actual costs must be assessed from the deployment's measured usage.

This is a broad source and automated-behavior audit, with deeper review of meetings, minutes, agendas, motions, attendance, notifications, workspace access, and the Convex adapter. It is **not a claim that every screen was visually tested or that production data has been audited**.

The production site and Convex dashboard presented sign-in screens. The available Convex integration supplied development/scaling guidance, but did not expose this project's billing, function logs, tables, or usage metrics. Browser policy prevented reaching the local preview. No production data was accessed or changed, no messages were sent, and no production deployment or merge was performed during the audit.

The tracked DDC North build configuration points to `industrious-cricket-610`; the development configuration points to `gallant-anteater-27`. These are source configuration values, not confirmation that those deployments currently run this exact commit. Confirm the live project/deployment before comparing metrics or releasing changes.

## Coverage

| Area | Work completed | Remaining evidence needed |
| --- | --- | --- |
| Meetings, minutes, agendas, motions, attendance | Backend and frontend review; two-editor conflict, transaction rollback, save-queue, route identity, approval protection, and workspace tests | Authenticated browser walkthrough with representative real records; production duplicate/orphan inventory |
| Notifications | Recipient isolation, personal broadcast state, retention, digest planning, read-only-role behavior, UI integration, export policy | Live inbox/history sizes and receipt growth; user acceptance of the recent-200 window |
| Dashboard | Actual Convex return validation for corporation boards; source review of count queries | Measured query bytes, cache behavior, and latency on the live dataset |
| Workspace and permissions | Existing tenant/principal/role/module gates; cross-workspace deep-link regression; record metadata and export tests | Live membership configuration and intended Director export privileges |
| Finance, inventory, assets, grants, communications, other routes | Route/scope inventory, subscription counts, portable/static parity, CSS gates; specific chart/invoice-token repairs | Visual and role-based browser tests of the remaining screens; per-view function traces |
| Scheduled work | Cron inventory; reproduced workflow authentication failure with synthetic data | Which automations are enabled/used in production; scheduled run logs |
| Convex usage | Source hotspots, schedule-derived baseline, read-bounding fix, local JSONL summarizer | Team billing totals, deployment Health, function metrics, table sizes, and a representative log window |

The route gate covers **170 unique route patterns**: 171 path declarations, two index routes, one provider-only route, 30 dynamic routes, and 48 module-gated routes across 27 modules. This verifies fixtures and access scopes, not 170 rendered browser journeys.

## Implemented fixes

### 1. Personal notifications are isolated by the authenticated recipient

**Priority: high.** A targeted notification could be returned to a different user in the same workspace if that user's role could see its notification kind. Several record operations checked workspace ownership without also enforcing the recipient. Broadcast read/dismiss/snooze state was stored on the shared notification, so one person's action could change everyone else's inbox.

The signed-in principal now determines the recipient. A caller-supplied `userId`, where accepted for compatibility, must match that principal. Single-record and bulk changes reject another person's targeted notices. The UI no longer supplies a selected recipient ID.

Broadcast content stays shared, while the new `notificationReceipts` table holds each person's read, dismiss, snooze, and removal state. Member and Viewer roles can manage their own inbox without gaining permission to create alerts or send digests. Those higher-impact operations retain their existing write permission.

Two indexed sources—broadcasts and the person's own targeted notices—are each bounded to 200, then merged to the most recent 200 notices. Receipt lookups and bulk actions are bounded to that window. Another person's large private backlog can no longer crowd the current person's notifications out of the window. The bell subscribes to detailed rows only while open; the count remains subscribed.

Daily and weekly digest plans use the recipient's state. Tests construct plans without sending anything.

**Compatibility and retention:** Existing shared flags are the initial state until a personal receipt is written. That history cannot be attributed to individual users retroactively. Expired individual dismissals become removal tombstones; the source broadcast remains available to other people. A tombstone stays while its broadcast exists so a removed notice cannot reappear. This creates a deliberate storage-retention tradeoff to monitor. The count is for the recent inbox window, not an all-time unread total.

**Administrative backup scope:** Full workspace exports intentionally include notifications and receipts. Existing `exports:download` permissions allow Owner, Admin, and Director, but deny Member and Viewer. Personal inbox isolation is not a promise that privileged full-workspace exporters cannot read tenant records. Changing Director export access is a separate role-policy decision.

Sources: [shared notification handlers](../../shared/functions/notifications.ts), [Convex notifications and retention](../../convex/notifications.ts), [schema](../../convex/tables/communications.ts), [action policy](../../shared/functions/actionPolicy.ts), [bell](../../src/components/NotificationBell.tsx), [notification view](../../src/pages/Notifications.tsx).

Checks: [recipient isolation](../../scripts/check-notification-recipient-isolation.ts), [personal state](../../scripts/check-notification-personal-state.ts), existing notification settings, export coverage, record metadata permissions, and static parity.

### 2. Meeting writes reject stale edits and save related records atomically

**Priority: high.** Convex serializes transactions, but an editor can still submit an old complete array after another user's newer transaction. Existing whole-record/array replacements could therefore overwrite notes, sections, motions, attendance, or meeting fields.

The updated APIs accept optional `expected` values for the fields an editor opened. Before writing, the transaction compares that baseline with current state. Stale edits to the same field fail with a reviewable error, while independent field edits can succeed. Comparison normalizes object-key order and optional values, and rejects unsupported baseline values.

Section and agenda saves now use a single `minutes:update` with `syncAgenda`, replacing two separate mutations. The complete `expectedAgenda` snapshot also guards independent header/item edits—including title, details, presenter, and timing changes that do not modify minute sections or the agenda header timestamp. A failure rolls back both sides. Successful saves return canonical sections, motions, and agenda state for the next editor baseline.

The actual meeting drawer, attendance grid, agenda editor, section editor, note editor, and motion editor supply the new baselines. These checks are optional for API compatibility; older clients or internal callers that omit them retain last-write-wins behavior. This is conflict detection, not simultaneous rich-text merging.

Sources: [comparison helpers](../../shared/meetingConcurrency.ts), [minutes](../../shared/functions/minutes.ts), [Convex arguments](../../convex/minutes.ts), [meetings](../../shared/functions/meetings.ts), [attendance](../../shared/functions/minutesAttendance.ts), [minutes column](../../src/features/meetings/components/useMeetingMinutesColumn.tsx).

Checks: [meeting collaboration](../../scripts/check-meeting-collaboration.ts), including two authenticated editors, anonymous/reader denial, unrelated field edits, independent agenda metadata edits, and injected transactional failures.

### 3. Notes and motions keep their drafts until a save succeeds

**Priority: high.** A failed note autosave previously did not reject the explicit flush used by “turn notes into minutes.” Conversion could continue with older server notes. Concurrent blur/timer/convert writes could overlap. Motion editing discarded its optimistic list after a fixed 1.5 seconds even if the save had not succeeded.

Both editors now serialize saves, retain newer typing during an in-flight request, and preserve a failed draft in the open editor. Explicit note flush failures block conversion. Motion writes reconcile canonical server IDs into edits queued while a new motion was being created. Deleting and adding motions during a pending save preserves the correct identities. Embedded section saves wait for the motion queue before closing.

The queues also handle a collaborator's later subscription update arriving before an earlier mutation response, and a delayed subscription echo after an acknowledged save. Recovery controls let the user retry or deliberately load the saved copy. Browser unload warns when unsaved work remains.

**Remaining limitation:** These drafts are held in memory. SPA navigation or workspace switching can still discard them. This branch does not provide durable offline draft storage or a complete navigation-blocking workflow.

Sources: [notes controller](../../src/features/meetings/lib/notesAutosave.ts), [motion controller](../../src/features/meetings/lib/motionAutosave.ts), [notes tab](../../src/features/meetings/components/MeetingNotesTab.tsx), [motion editor](../../src/components/MotionEditor.tsx).

Checks: [notes autosave](../../scripts/check-meeting-notes-autosave.ts), [motion autosave](../../scripts/check-meeting-motion-autosave.ts).

### 4. Meeting identity, history, attendance, and source preservation

Several related integrity problems were corrected:

- Repeated/concurrent minutes initialization now reuses the existing canonical record rather than creating another minutes record and splitting later edits.
- Canonical motion-table writes participate in the same transaction. A synchronization failure is no longer swallowed while other minute changes appear successful. Motion history and unrelated first-class metadata survive edits, and unchanged motions are not rewritten unnecessarily.
- Agenda synchronization matches linked motions by ID before wording. A later section save cannot submit the same linked ID twice or restore stale proposed wording over an amended motion; the regression preserves amended wording, a Carried outcome, and its tally.
- New meeting/minutes scaffolds no longer turn all active directors or planned invitees into people recorded as present. Explicit attendee input is carried only when recording a Held meeting; quorum starts as `not_recorded` until confirmed. Attendance cannot auto-confirm quorum for a merely scheduled meeting. Existing historical records are not rewritten.
- Deleting a meeting cannot bypass the protection on approved/adopted minutes.
- Duplicate merging refuses a source snapshot larger than the supported bound rather than dropping evidence to fit and then deleting the duplicate. Oversized source records remain available for deliberate archival.
- Merge and carried-adoption activity use the actual member's display label instead of a generic “You.” This does not add complete page-view/session analytics.

Sources: [minutes](../../shared/functions/minutes.ts), [meeting lifecycle](../../shared/functions/meetings.ts), [agenda scaffolding](../../shared/functions/agendas.ts), [duplicate merge](../../shared/functions/meetingMerge.ts).

Checks: collaboration, snapshot immutability, meeting history/renderer, template materialization, record kind, and existing meeting regressions.

### 5. Meeting deep links use a consistent workspace and route identity

**Priority: high.** The meeting detail view could load the meeting and minutes from one workspace while using people, documents, and edit permissions from the currently selected different workspace. React route reuse also let a pending local draft survive while its mutation callback changed to another meeting.

The detail page resolves the meeting first and blocks supporting queries, writes, backfills, and draft-intent effects until the selected workspace matches. It offers an explicit “Switch to meeting workspace” action using the existing membership-checked setter. Supporting people/document queries use the matched meeting workspace. The detail component is keyed by meeting ID so one meeting's buffers and bootstrap promises cannot become another meeting's edits.

Sources: [MeetingDetail](../../src/pages/MeetingDetail.tsx), [workspace scope helper](../../src/features/meetings/lib/meetingWorkspaceScope.ts).

Check: [workspace selection integration](../../scripts/check-workspace-selection.mjs), using the real React workspace-selection hook, plus existing meeting UI checks.

### 6. Convex adapter reads stop after enough results are found

**Priority: medium; broad impact.** The portable Convex adapter implemented a JavaScript-filtered `take`, `first`, or `unique` by collecting the entire candidate range first. Even asking for one record could read all candidates.

It now iterates lazily and stops when enough matches are found. `unique` stops after a second match proves non-uniqueness. Filtering still precedes projection and preserves index order. Filtered pagination retains the native cursor, read bounds, and page-splitting metadata, then filters that page. Consumers must respect `isDone` even if a filtered page is empty. No current production call combining this adapter's filter and paginate was identified.

A deterministic 10,000-row fixture requesting two eligible rows reads **five rows**, rather than collecting all 10,000. This demonstrates the corrected algorithm; it is not a measured production cost reduction. Sparse predicates can still read many candidates and should be replaced with selective indexes where appropriate.

Source: [Convex portable adapter](../../convex/lib/portable.ts). Check: [bounded reads](../../scripts/check-convex-portable-bounded.ts), including actual Convex iterator and pagination behavior.

### 7. Dashboard, route coverage, and visual-token defects

The corporation dashboard could return `roleHolders` IDs and an unknown appointment date, while its Convex return validator required `directors` IDs and a defined date. The validator/type now accept the valid mixed board data. The actual query is tested against the real schema; anonymous access still fails.

Three already-existing routes lacked fixture/access-scope inventory entries: financial planning, the report catalog, and the payroll calculator. Their entries were added and the route gate passes. The commerce chart referenced an undefined text color, and invoice branding used undefined ink/muted/paper custom properties; those now use defined theme values. CSS-variable validation and Sass compilation pass. Visual browser QA remains outstanding.

Sources: [dashboard validator](../../convex/dashboard.ts), [dashboard regression](../../scripts/check-dashboard-corporation-convex.ts), [route fixtures](../../tests/helpers/interfaceRoutes.ts), [route scopes](../../shared/interfaceRouteAccess.ts), [commerce chart](../../src/features/financials/reports/CommerceReportView.tsx), [invoice styles](../../src/styles/_invoicing.scss).

## Remaining implementation work

### Scheduled workflows fail without an authenticated actor

**Priority: high if scheduled workflows are used. Reproduced, not fixed here.** [`workflows.scan`](../../convex/workflows.ts) is an internal cron action, but calls the public authorized `workflows.run` without a user session. A synthetic due workflow invoked through the actual Convex handler fails with `Authentication required.` and creates zero runs. The first failed candidate can also abort the rest of that scan.

The fix needs an explicit persisted automation authority/owner and an internal execution path that checks current membership, role, workflow status, and allowed operations before side effects. Failure of one workflow should not prevent processing other due workflows. Do not make the public runner unauthenticated or trust a caller-supplied `actingUserId` to solve this. The existing creator field alone is not an implementation of those checks.

### Existing duplicates and draft deletion dependencies need a data plan

The idempotent initialization fix prevents new duplicate minutes in the tested path. It does not merge duplicates already present in a live database. Run a read-only inventory of meetings with multiple minutes rows, broken meeting-to-minutes links, duplicate motion IDs, and foreign/missing parent references. Reconcile only after preserving all source versions and an owner review.

Draft meeting removal still has an incomplete dependency policy for first-class motions, sources/materials, tasks, transcripts, and related records. Approved minutes are protected by this branch, but draft cleanup should become an explicit archive or dependency-aware deletion flow. Blind cascading could destroy evidence or references needed elsewhere.

### Durable drafts and adoption UX

Add local durable drafts scoped by authenticated user, workspace, meeting, and editor type if offline resilience is required. Include versioned baselines, clear recovery, retention, and navigation behavior. Separately validate the complete preview/adopt/amend/package experience with two real browser sessions and representative historical records.

### Performance work should follow the measured hot functions

The baseline source scan found **1,211 `.collect()` call sites**: 96 in `convex` and 1,115 in `shared/functions`. Many are indexed, bounded by the domain, or intentional. This is an inventory of places to inspect, not 1,211 confirmed performance defects.

Likely measurement priorities are dashboard/nav counts, broad search, report totals, meeting detail payloads, per-recipient weekly digest summaries, and offline meeting preparation. Exact financial/dashboard totals must not be “optimized” by silently taking only the first page. Use selective indexes, paginated result lists, and maintained aggregates where the data shape warrants them.

Filtering/projecting returned objects after a read can reduce response size but does not undo the bytes already read from the database. Large source snapshots and transcripts should not ride along with every lightweight list/count query. Convex's official [best practices](https://docs.convex.dev/understanding/best-practices/) describe why broad collections and dependency sets increase database reads and query reruns; [pagination](https://docs.convex.dev/database/pagination) is appropriate for growing lists.

Direct React `useQuery` call counts provide a starting map:

| View | Direct hooks in the source |
| --- | ---: |
| Meeting detail | 20 |
| Accounting workbench | 14 |
| Financials | 13 |
| Inventory, Grants, Assets | 12 each |
| Treasurer, Communications, Minutes preview | 11 each |

These counts exclude nested/context hooks and do not mean every hook is active or independently billed. Permission/data guards and cache sharing matter. Gate expensive inactive tabs and split small summaries from full transcripts/packages after inspecting actual function traces. Speech refresh polls every ten seconds only while a speech job exists; this review did not find a general polling loop on every screen. Convex [realtime documentation](https://docs.convex.dev/realtime) explains automatic query caching.

The optional offline-preparation feature can synchronously rebuild multiple recipient downloads when a meeting changes. Its live feature flag was not available. If enabled, measure recipient fan-out and change-trigger frequency before broad rollout.

The production-mode build also provides a frontend loading-cost inventory. Its largest editor chunk is approximately 1,373 kB minified / 438 kB gzip; the local-data client is 931 kB / 240 kB; meeting detail is 385 kB / 116 kB. These are generated asset sizes, not measured initial page transfers or interaction latency. Existing static imports also defeat some intended dynamic splits for PDF generation and shared domain modules. Browser network traces should establish which assets each real journey loads before restructuring them.

### Hardening inventory

The endpoint scan found 38 explicit declarations without return validators in the baseline, concentrated in agent connectors, OAuth, offline meetings, pathways, and PowerSync. These deserve contract hardening, but are not automatically authorization defects. The regenerated stage-2 inventory has two unclassified HTTP entries (`/calendar/feed` and `/ai-chat/stream`); classification gaps must be checked against the handlers' actual authentication and scope logic, not reported as proven anonymous access.

The generated inventory was stale on `main` for several already-present finance/payroll endpoints. Regenerating it creates a large mechanical diff in addition to this branch's small API additions. Review it as generated inventory, not thousands of new application behaviors.

Maintainability remains a separate cleanup: the meeting detail/section editors and several shared components are very large. The legacy `components/MotionEditor.tsx` now consumes its feature-owned autosave controller, which triggers the repository's warn-only boundary rule. Follow the existing [frontend structure plan](../frontend-structure.md) by relocating the domain editor in a focused import-path migration; do not hide domain code in generic utilities to silence the rule.

## What can be said about Convex usage today

No actual bill, active-user count, query failure rate, storage total, bandwidth total, or user's interaction history was available. “A few users” is not enough to predict cost: data volume, subscription invalidation, heavy documents, and background work matter. A cache hit can serve multiple subscribers without another full database read; hook counts alone are not a bill.

The source schedules imply the following entries **if deployed and running continuously for a 30-day month**:

| Scheduled entry | Interval | Entries per 30 days |
| --- | --- | ---: |
| Offline meeting authorization repair | 1 minute | 43,200 |
| Billing automatic delivery scan | 5 minutes | 8,640 |
| Workflow scan | 15 minutes | 2,880 |
| **Subtotal of these three entries** | | **54,720** |

This is schedule arithmetic from [crons.ts](../../convex/crons.ts), not observed billed usage. It excludes nested queries/actions, hourly OAuth cleanup, daily/weekly jobs, retries, and human activity. A disabled feature can return quickly but still have its scheduled entry invoked. No monetary estimate should be inferred from this table.

### Complete the live usage review

Use the Convex team usage/billing dashboard for authoritative totals and the deployment's [Health view](https://docs.convex.dev/dashboard/deployments/health) for failures, cache behavior, scheduler lag, large reads, and contention. Use the [Functions view](https://docs.convex.dev/dashboard/deployments/functions) to identify the functions responsible.

Record the deployment, time window, plan, and whether preview/development traffic is included. Capture at least:

1. Function calls, database read/write usage, file-storage/transfer usage, and action runtime for the current billing window and a representative recent window.
2. Top functions by calls, read bytes/documents, errors, and latency; cache-hit coverage and optimistic-concurrency retries.
3. Table counts and average/large document sizes for meetings, minutes, motions, sources, transcripts, notifications, and receipts.
4. One representative two-user meeting session: open, edit notes, edit different fields, deliberately conflict on the same field, manage attendance, preview, and prepare a package.
5. A quiet period with nobody using the app, to separate baseline scheduled traffic from interactive traffic.

Avoid capturing meeting text or personal identities merely to explain cost. The existing last-login fields, activity rows, and motion history are not complete session/page-view analytics. If interaction analytics are desired, define specific events and retention deliberately rather than inferring user behavior from function invocations.

### Read-only log summarizer included

[`scripts/summarize-convex-usage.mjs`](../../scripts/summarize-convex-usage.mjs) aggregates the installed Convex CLI's JSONL completion events locally. It does not access the network, request credentials, or change a deployment. It reports function/type/component, completion/error counts, p50/p95/max execution time, resource totals with metric coverage, sampled cache results, and retry/contention counts. It excludes raw messages, error text, identities, arguments, and OCC document IDs.

From an already-authorized CLI session, first confirm the deployment selection, then collect a representative window:

```bash
npx convex logs --deployment industrious-cricket-610 --history 10000 --jsonl > /tmp/societyer-convex.jsonl
```

The command includes history **and continues streaming**. Stop it with Ctrl-C after the desired window. Keep raw logs local/private. Summarize them with:

```bash
node scripts/summarize-convex-usage.mjs /tmp/societyer-convex.jsonl > /tmp/societyer-usage-summary.json
```

Or use `npm run usage:summarize -- /tmp/societyer-convex.jsonl` for interactive output. A captured log sample is not a monthly bill, distinct-user count, or page-view count. Missing metric fields remain missing, not zero. CLI completion records can omit cached subscriber deliveries, so sampled cache percentages are not the dashboard's total cache-hit metric.

## Verification and release

### Completed automated checks

- New `test:convex-multi-user` suite: bounded adapter reads, actual corporation dashboard query, targeted notification isolation, personal broadcast state/retention, and usage summarizer.
- New `test:meeting-collaboration` suite: actual Convex two-editor transactions and the notes/motion save queues, including deliberate failures and delayed subscription timing.
- App and Convex TypeScript checks; app required a 4 GB heap in this environment after the default 2 GB process exhausted its heap.
- Existing authorization-policy and multi-user pipeline gates: Clerk, gateway Better Auth, and hosted-broker fixtures; principal, membership, role, module, last-owner, invitation, API/workflow authority, and cross-workspace checks.
- Stage-2 enforcement: **21/21 gates passed**. The tenancy probe reported 4,555 blocked attempts, zero leaked reads, zero leaked writes, 16 harness errors, and 1,669 not-applicable probes. These are harness results, not a proof that every path is secure; errors/non-applicable cases are not passing security cases.
- Portable manifest/scan checks and the Convex differential oracle. The refreshed inventory reports 1,544 Convex functions and 1,251 registry entries; categories include portable, capability, server-only, and static fallbacks.
- Static parity: **526 frontend writes**, 491 handled and 35 explicitly intentional offline no-ops, zero pending implementations.
- Export coverage: **280 business tables** covered, with 39 explicit internal auth/sync exclusions.
- Workspace-selection integration, existing meeting UI/retest/history/snapshot/template checks, notification settings, dashboard resource authority, and metadata permission checks.
- Route coverage, CSS custom-property validation, Sass compilation, and `git diff --check`.
- Targeted ESLint completed with zero errors and 52 warnings, including 21 files outside its configured globs and existing size/hook warnings. The MotionEditor boundary warning above is also present. This is not a claim of warning-free lint coverage for shared TypeScript or test scripts.

`NODE_OPTIONS=--max-old-space-size=6144 npm run build:ddcnorth` passed: backend typecheck, application project build, and Vite production-mode bundling (6,059 modules transformed). Vite reported existing mixed static/dynamic import and large-chunk warnings; they are captured in the performance follow-up above, not treated as build failures.

### Validation still required

The attempt to push to an anonymous local Convex backend failed because that backend did not start within its startup timeout. Typechecks and `convex-test` handler tests passed, but this is not a successful hosted schema deployment. Browser smoke/visual testing was blocked by the available browser environment and production sign-in. There has been no production performance measurement or live data migration rehearsal.

Before release:

1. Deploy backend/schema changes to the intended development/staging environment and verify the new notification index/table and optional meeting arguments. Deploy the backend before the new frontend.
2. Run a two-account browser walkthrough: targeted notices, independent broadcast state, meeting workspace switching, simultaneous notes/sections/agenda/motions/attendance edits, conversion after a failed save, preview/adoption, and route navigation with a pending save.
3. Inspect historical duplicate minutes and orphan relationships read-only. Do not automatically rewrite approved minutes or globally reset historical notification flags.
4. Measure a quiet window and a representative collaboration session. Prioritize the highest read/latency functions before further query restructuring.
5. Decide the scheduled-workflow authority fix, draft archival policy, durable draft requirements, and privileged export role policy separately.

The new regression suites are included in the portable-conformance CI workflow. This branch is prepared for review; it does not itself authorize or perform a production rollout.

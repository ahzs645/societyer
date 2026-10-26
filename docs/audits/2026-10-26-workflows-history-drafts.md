# Follow-up: scheduled workflows, historical integrity and draft recovery

**Date:** 2026-10-26  
**Repository / review:** `ahzs645/societyer`, [draft PR #61](https://github.com/ahzs645/societyer/pull/61)  
**Starting point:** the previously reviewed PR tree at `d55c9cb4158bf6ea94dc55c64b4861e9dfcfa5ee`.

This follow-up implements the three items requested after the [initial multi-user audit](2026-10-25-convex-multi-user.md). The code is prepared for review and staging; it has not been merged or deployed. Verification uses synthetic records. No production records, credentials, messages or schedules were changed.

| Item | Delivered | Remaining operational step |
| --- | --- | --- |
| Scheduled workflows | Explicit person-authorized grants, current authority checks, an internal transactional executor, real UTC recurrence, failure isolation and review/revoke controls | Deploy to staging, review each intended schedule, and authorize it through the connected app |
| Historical records | A read-only export checker with scope/completeness evidence, duplicate and reference checks, private reports and operator instructions | Supply a real export and run the checker; actual historical records have not been inspected |
| Draft recovery | Durable device drafts for meeting notes, motions, new motion input, minutes sections, agendas, attendance and meeting details | Authenticated browser walkthrough, including reload, offline/reconnect, account switches and two tabs |

## 1. Scheduled workflow authority

### The original failure and the replacement

The cron action called the public, authenticated workflow runner without a user session. Convex does not propagate authentication into scheduled functions; removing the public authentication check would have created an unsafe execution path. See [Convex scheduled-function authentication](https://docs.convex.dev/scheduling/scheduled-functions#auth).

The scheduler now selects at most 25 explicitly enabled due workflows through an index and calls an internal mutation for each. That mutation validates a stored authorization grant, checks the scheduled occurrence, performs the supported effects, records the run and advances the schedule in one transaction. Concurrent attempts and retries cannot create a second run for the same occurrence. A failure in one workflow is caught separately; a failed transaction leaves no partial task or notification writes and disables that schedule for review.

The grant records the signed-in authorizer, their exact issuer/subject and external identity binding, an expiry, a version, and a fingerprint of the workflow's execution definition. The public grant mutation accepts no substitute actor ID. It rejects machine-bridge tokens even when they name a valid owner. The reviewed definition and fingerprint come from one status-query snapshot, and authorization rejects a concurrently changed definition.

Every execution rechecks current membership, identity status/binding, `tasks:write`, workspace status, enabled modules, expiry, workflow state and definition fingerprint. Insurance review additionally requires its module and financial read permission. Under the current role matrix, Owner and Admin can grant scheduling authority. A historical creator field alone confers no schedule authority.

Changing executable configuration or nodes revokes approval. Pausing also disables the schedule; reactivating does not silently renew it. Ordinary public get/list responses omit the raw identity-binding grant; the status query exposes only the information needed to review the schedule. Imported local backups strip execution authority while preserving workflow definitions and run history.

### Product behavior and supported work

The workflow detail page provides **Review and authorize**, renewal, and **Revoke scheduled runs**. The UI offers 30-, 60- or 90-day grants; the server enforces a maximum of 90 days. The review names the effects that will occur. Workflow detail reads and edit controls are gated to the workflow's workspace, and account/workspace changes reset its local form state. Local/demo mode cannot grant hosted scheduling authority.

The supported automatic executor covers the standard internal recipes:

| Recipe | Automatic effects | Work still requiring a person |
| --- | --- | --- |
| Insurance renewal | Creates missing review tasks for the existing 60-, 30- and 7-day renewal checkpoints, assigns them to the authorizer, records a run and creates an in-app notice | Confirm coverage, contact providers, approve any actual renewal and complete remaining steps |
| AGM preparation | Records a review run and creates an in-app notice | Prepare/approve the agenda, send notices and record governance evidence |
| Annual report review | Records a review run and creates an in-app notice | Review and submit the filing, then record its evidence |

The runs finish as `manual_required`, not as a claim that notices were sent or reports filed. Insurance uses the organization's calendar date for policy review, including around UTC midnight. Its current transaction has an explicit 500-policy and 500-existing-task ceiling; exceeding a ceiling fails closed and leaves a reviewable blocked schedule. Larger workspaces need a separately designed batched executor.

External/n8n providers, AI steps, input-driven or custom executable configurations are rejected before authorization. No scheduled adapter for these was silently enabled. The existing authenticated manual runner and its external callback paths remain separate and were regression checked.

### Timing correction

The previous timing helper ignored the stored cron expression, adding 24 hours for any cron and one hour for a date-offset trigger. The new helper computes the next actual daily/weekly UTC occurrence. Numeric lists, ascending ranges and steps are supported in minute, hour and weekday fields; Sunday can be 0 or 7. Day-of-month and month must be `*`.

The 15-minute scan is retained. Runs can start after their due minute, and multiple missed occurrences are combined into one run rather than replayed in a burst. Monthly/calendar-specific and date-offset triggers are explicitly unsupported until their executor and evidence rules are implemented. They no longer acquire an invented next-run delay. UTC schedule behavior aligns with [Convex's cron convention](https://docs.convex.dev/scheduling/cron-jobs#supported-schedules).

## 2. Read-only historical integrity audit

The new [operator guide](../meeting-integrity-audit.md) documents supported formats, exact commands, scope declarations, exit codes and limitations. The checker accepts native Convex ZIPs/extracted exports, workspace JSON, local snapshots, and Societyer version 1/2 archives. It never opens a database client, authenticates, downloads referenced files or performs repairs.

Schema-defined ID relationships drive the audit, with application-specific handling for signatures, source evidence and other documented polymorphic links. Within the meeting graph and its linked evidence, it checks duplicate minutes, candidate duplicate meetings, canonical meeting/minutes back-links, motions and agenda positions, parent mismatches, cross-workspace references, documents, tasks, sources, transcripts, attendance and approval/history relationships. Other tables are consulted as referenced targets; unrelated rows are not generally audited. Free-text attendance names and arbitrary strings are not guessed to be IDs. Unresolved retained-history targets and questions about attendance/quorum remain review flags. Structural contradictions can be confirmed within the supplied export, but do not establish actual attendance, legal quorum, valid adoption or a live authorization exposure.

The report separates observed contradictions from unresolved references. A target missing from a paginated, filtered or incomplete export is not declared corrupt merely because it is absent. Confirmed missing-target findings require declared complete, unredacted, point-in-time coverage. Missing tables remain missing even when a complete snapshot is declared, and a scope declaration cannot override an export's explicitly declared redaction. Component prefixes are kept separate. With a workspace filter, rows whose owner cannot be resolved are reported as excluded rather than silently treated as belonging to that workspace.

Inputs are fingerprinted before and after processing. With `--output`, the report is created as a new private file outside the source; input paths and existing outputs cannot be overwritten. Otherwise the report is written to stdout. Reports contain record IDs, field paths, counts, severity and coverage, but omit meeting content, titles, names, emails, credentials and transcript text. Native Convex storage binaries are not checksum-verified; optional file verification checks bundled bytes against Societyer file-manifest hashes, with explicit inventory/checked counts. External and unavailable files are never fetched or certified by the checker.

From an already authorized CLI session, the operator can obtain the tracked deployment's snapshot:

```bash
npx convex export --deployment industrious-cricket-610 \
  --path /tmp/societyer-meeting-snapshot.zip

node --import tsx scripts/audit-meeting-integrity.ts \
  --input /tmp/societyer-meeting-snapshot.zip \
  --complete-snapshot \
  --output /tmp/societyer-meeting-integrity.json
```

Confirm the deployment first. The complete-snapshot flag asserts that the export completed and has not been filtered or modified. For an existing ordinary workspace export, omit it and keep the checker's coverage qualifications. Exit codes are 0 for no issues within declared scope, 1 for confirmed errors in the export, 2 for invalid input/arguments, and 3 for unresolved coverage or review findings. See the guide before interpreting them.

**No actual historical cleanup is approved by this tool.** Duplicates and approved/source history require a separate record-by-record reconciliation plan after reviewing a real snapshot. The incomplete draft-meeting deletion/archive policy identified in the initial audit remains separate work.

## 3. Durable meeting drafts

Recovery copies are versioned and scoped to the runtime/backend, authenticated account, membership user, workspace, meeting, and editor. Edits are written synchronously before the autosave delay or navigation. Each editing session owns immutable revision keys, so an older response or another tab's discard cannot remove a newer revision.

Returning to an editor offers explicit recovery/discard controls. Restoring a draft does not save it to the server. Notes and motions pause their autosave until **Save recovered draft** is chosen; forms retain their explicit Save action. Original field and agenda baselines travel with the draft, so a collaborator's later edit produces a conflict rather than being overwritten. Acknowledged saves rebase later typing onto the exact accepted server fields, not a possibly newer subscription response.

Covered editors are notes, existing motions, new motion input, minutes sections, agenda rows, the attendance grid, and the Edit meeting drawer. Initial agenda creation now compares both the prior agenda and the absence of minutes, then creates the agenda and its first minutes/motions atomically. It no longer relies on two separate frontend writes. Meeting/attendance mutations return only their accepted baseline fields needed by the editor, preserving existing count responses and excluding unrelated record content.

Form sessions isolate delayed completions from a later edit session. Pending saves retain a recovery copy even when the user types back to the original value before the earlier save completes. Motion confirmation callbacks use current identities/state rather than stale array positions.

Drafts stay on the current browser/device profile until saved or explicitly discarded; there is no age-based eviction or sign-out purge. The application only offers recovery within the matching verified account/workspace. Clearing site data removes device drafts, and these copies do not sync to another device. Storage failures and quota limits are shown explicitly, preserving the last readable recovery copy and the current in-memory edit; the interface does not claim that an unsuccessful local write is durable.

Transcript/source/package review fields, approval/evidence dialogs, standalone task/action-item forms, meeting creation and other app modules are not covered by this recovery feature. Transient subcontrol text is retained only after it enters the covered editor draft; examples include a decision-list add box and an override-confirmation note. On-device AI generation workflows are unchanged.

## Verification and release

The focused gates are wired into the existing portable-conformance workflow:

```bash
npm run test:workflow-schedule
npm run test:meeting-collaboration
npm run test:meeting-draft-recovery
npm run test:meeting-integrity
```

They cover actual Convex authorization/transaction handlers with synthetic tenants, timing boundaries, identity changes, grant revocation and expiry, replay protection, real renewal-task writes, failure isolation, original-baseline conflicts, storage failures, multi-tab revision interleavings, editor-session transitions, export formats/completeness and honest report exits. Browser hook tests and storage/queue simulations do not replace a real offline/two-account walkthrough.

Local verification passed for the four focused gates above, the actual React recovery hooks, application and Convex TypeScript checks, and the production Vite bundle. Stage-2 enforcement passed all 21 suites: 4,555 blocked probes, zero leaked reads/writes, 16 harness errors and 1,674 not-applicable probes. The errors and not-applicable probes are not claimed as passing security coverage. The existing authorization, manual workflow runner/callback, meeting UI/history and workspace-selection checks also passed.

The regenerated portable manifest and function inventory pass their checks; static parity covers 528 frontend writes with zero pending handlers. Route coverage remains 170 unique patterns. CSS-variable validation, Sass compilation and diff checks pass. Targeted ESLint reports zero errors, with size/import/hook warnings and ignored file globs. Vite reports its existing large-chunk and mixed-import warnings. GitHub CI must run on the published follow-up head; passing checks on the earlier PR head do not validate these new commits. Local hook/storage tests do not establish authenticated browser behavior.

An anonymous local Convex validation attempt could not start its backend within 30 seconds, even after the network-restricted download was permitted. No hosted schema push is claimed. The available Convex plugin still supplies guidance rather than deployment data; no live CLI credentials or production snapshot were available.

Deploy the backend/schema before the frontend. Staging must verify the two new workflow indexes, the optional grant/run metadata, the schedule status/authorization endpoints, and the additional agenda/baseline arguments. Existing schedules remain unapproved until individually reviewed. Then exercise two users and two tabs through offline editing, navigation/reload, recovery, a conflicting collaborator save, schedule authorization/revocation, and one supported scheduled run. Run the integrity checker against an actual consistent export before making any historical repair decision.

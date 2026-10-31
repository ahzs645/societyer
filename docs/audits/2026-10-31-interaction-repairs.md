# Interaction audit implementation — 31 October 2026

Baseline: `4aadbc8fbad1a8d049314e1999ba9f595907fc90`. Scope: the 13 interaction findings and three workflow risks from the October 31 source audit. No production records, credentials, provider deliveries, or deployments are changed by this PR.

## Implemented contract and evidence

| Audit | Implementation | Regression evidence |
|---|---|---|
| S01 | `clearFields` distinguishes removal from omission for all 14 optional task fields; hosted validator and shared local handler agree. Legacy clear flags remain supported. | `check-interaction-task-contract.ts`: actual Convex and LocalStoreDb readback of every field, malformed/foreign/Viewer rejection. |
| S02 | Responsible users are an array throughout the shared create/edit form; additive picker and explicit removal preserve other assignments. | Handler tests plus browser multi-owner save/reload. |
| S03 | Ordinary and paged transcript downloads share the same privacy consent and serializer for TXT, JSON, VTT and SRT. All pages load before any download; failures, cancellation, changed identity/context and a 64 MB bound prevent partial exports. | `check-interaction-transcript.ts`: cross-page redaction, all formats, unmarked-session blocking/acknowledgement, authorization, load failure/abort/limit; existing export/round-trip tests. |
| S04 | Transaction URLs use the runtime-aware absolute route helper and retain the workspace. File links are explicitly local, not public shares. | `check-interaction-navigation.ts`: root, subpath, demo and Electron hash URLs. |
| S05 | Transcript copying and reading use router pathname/search, not the outer browser query; selection, paged seeking and playback react to changed search. | Runtime link round trips and existing transcript checks. |
| S06 | Palette pinning is restricted to durable registered pages/commands; unsupported dynamic results are not offered as favorites. Unavailable command pins can be removed. Valid permission-hidden pins are not destroyed. | Pin eligibility tests; command permission filtering in both consumers. |
| S07 | Today is normalized to a calendar day, date parsing rejects overflow, and the shortcut is disabled outside constraints. | Actual DatePicker browser test with min=max=today after midday. |
| S08 | Year browsing has its own cursor; range arrows move one complete 13-year window rather than a month. | Actual DatePicker browser year-grid assertions. |
| S09 | URL-owned task filters reconcile workspace/store/view and parameter values. Removing parameters removes only the corresponding URL-owned filter, preserving manual constraints. | Interface gates and source review; URL/history browser qualification is tracked separately below. |
| S10 | Bell and Notifications page use the same read-state activation hook and report mutation errors. | Browser click/keyboard read-state persistence checks. |
| S11 | Linked notifications own their handler on the actual link; non-links use real buttons, with clear/snooze kept separate. | Browser Enter/Space activation and panel closure. |
| S12 | TypeScript binding-aware inventory sees wrappers, aliases, namespaces, destructuring and literal computed refs. Unknown/partially dynamic hook refs fail the gate; dispatch classification ignores comments and fixture strings. | `check-interaction-write-inventory.ts`; full parity inventory. The newly found hosted-only paged transcript edit rejects explicitly in local mode; local UI offers a timed-file import instead. |
| S13 | Sidebar, rail and mobile tab projection share the same Favorites ordering, after authority filtering. | Order/permission projection tests and phone/desktop reload test. |
| R01 | Follow-up creation, agenda, approval motion, minutes and carry-forward share one transaction. A durable request key returns the same graph after lost acknowledgements; changed payload/source rejects. Source fingerprints avoid storing confidential wording in replay receipts. | `check-interaction-scheduling.ts`: actual Convex and LocalStoreDb fault injection, full rollback, retry, concurrent calls, source drift and role checks. |
| R02 | All checklist changes, including unfinished add and rename input, are staged with task fields. Cancel never silently commits them; Save validates/commits them together. | Handler readback plus browser staged/buffered checklist test. |
| R03 | The task editor reuses the identity-bound durable draft journal and close guard. Recovered baselines reject stale overwrites. Failed saves preserve drafts; quota errors never claim durability. Swipe dismissal restores a form when its close guard vetoes dismissal. | Existing comprehensive journal/hook regressions; task browser failed-save/reload/recovery and phone swipe test. |

## Reproduce

```sh
npm ci
npm run test:interaction-audit
npm run convex:typecheck
NODE_OPTIONS=--max-old-space-size=6144 npx tsc -b
npx playwright install --with-deps chromium
npm run test:interaction-audit-ui
npm run build
```

The browser suite uses an opt-in local IndexedDB runtime and synthetic fixtures through normal permission-checked mutations. Four Chromium viewports cover 320, 390, 768 and 1440 pixels. The a small control fixture render the actual shared components; they are not a replacement implementation. Fault injection is available only in the existing opt-in E2E harness, not a hosted endpoint.

## Rollout and boundaries

Deploy the updated Convex schema/functions **before** a connected frontend: `meetings.by_society_follow_up_request`, optional replay fields, follow-up arguments, task `expected`, and task `clearFields` are additive but an older backend cannot accept the new arguments. Local/desktop packages include their shared handlers. No automatic production migration or historical repair is included.

Legacy task callers that omit `expected` retain their previous last-write-wins behavior. The new full editor supplies a baseline. The same-device draft journal is not server synchronization or cross-device backup. A new task create is not a globally idempotent operation; this PR's replay contract specifically covers follow-up scheduling.

The parity inventory is **source classification**, not proof that an external provider delivers a message, sync or filing. Existing intentional offline no-ops remain labeled as such. Paged server transcripts are unavailable locally until a timed transcript is imported; local UI does not fake a successful remote edit.

Physical iOS/Android keyboards, Safari/WebKit, authenticated production integration delivery and backend rollout are separate qualification. Browser tests are emulations, not physical-device sign-off. No claim is made that every feature or third-party provider in the repository has been exercised.

## Verification record

Local handler, navigation, export, inventory and existing regression gates were exercised against this change. Local browser navigation was blocked by the execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`), so browser evidence must come from the pull-request CI runs. See PR checks for the tested head and browser artifacts; a pending check is not counted as passing.

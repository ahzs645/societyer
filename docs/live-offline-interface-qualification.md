# Live offline and interface qualification

This qualification continues the PowerSync meeting pilot and tests the actual Societyer application against an isolated self-hosted Convex deployment. It uses real Better Auth sessions, Convex-verified JWTs, native storage HTTP transfers, and the PowerSync SQLite SDK. No production tenant, provider credentials or Zoer deployment is involved.

## Reconciled source baseline

The starting working branch was `work` at `bac427b`. Current `origin/main` was fetched and remains `4b15fd20f3b82baa6b18cb95be7b2c62404884b3`. It is an ancestor of the starting branch, as is the required authentication commit `cc52e24487f42c19f81b2d22385091006bc70b44`. The starting branch contains four subsequent interface/pilot/auth-roadmap commits; no divergent main commits or merge conflicts were present. The actual working diff is reviewed and verified against this baseline, rather than the older research documents.

Clerk sign-in/profiles, tenant-restricted Better Auth Microsoft mode, Societyer workspace roles, identity binding and last-active-Owner protections remain in place. React Router and Convex remain the application's routing/data setup. The native Convex Auth pathway is still a separately documented option.

## Completed live service qualification

| Qualification | Result | Scope |
| --- | --- | --- |
| PowerSync protocol | 11 grouped checks passed | Actual experimental Convex export stream, signed claims, workspace isolation and automatic pilot role invalidation |
| PowerSync live browser | 36 unique scenarios qualified | 320, 390 and 1440px, actual SDK SQLite, native commands/files, offline reload/reconnect, five roles, cache revocation and races |
| Pilot native server | 16 groups passed | Actual Convex JWT verification, native meeting graph, file bytes, replay, concurrent clients and Owner protections |
| Pilot adapter and fixture checks | 39 native-adapter, 34 fixture browser and 2 built fixture PWA checks passed | Separate deterministic contracts and offline build qualification |
| Production roles/workspaces | 84 groups passed, 722 measured API attempts | 406 queries and 316 mutations; 294 completed and 428 rejected as expected |
| Published intake | 6 groups passed, 19 API attempts | Explicitly published anonymous intake, private/disabled/unpublished denial |
| Native production uploads | 8 groups passed | Actual native HTTP bytes, authoritative metadata, workspace claims and document/asset/inventory role gates |
| Native encrypted vault | 9 groups passed | Create/update/reveal, role/actor/workspace denial and Owner-only policy protection |
| Eligible-Member election APIs | 6 groups passed, 46 API attempts | Positive nomination/ballot, actor/foreign/duplicate denial, privacy and exact tally |
| Eligible-Member browser | 4 cases passed | Positive nomination and ballot at 320, 390, 768 and 1440px, including reload persistence |
| Live restricted projections | Dashboard 3, legal registers 4 and evidence/minute-book 6 groups passed | Actual broker sessions, permitted sections retained, restricted history and writes denied |
| Full actual Convex application | 420/420 distinct browser cases passed; 105 per width | Owner, Admin, Director, Member and Viewer at 320, 390, 768 and 1440px |
| Private binder document coverage | 2 live API groups and 4 browser cases passed | Owner full assessment, Viewer unknown completeness, private-title redaction, eight authorized workspace reloads |
| Shared responsive components | 44 local and 28 live browser cases passed | Resize, menus, calendars, long headings/toasts and protected vault controls; the live 28 are included in the 420 |
| Local image persistence | 12 browser cases passed | Logo, asset and inventory photos survive reload at 320, 390, 768 and 1440px |

All 420 planned full-app cases executed and passed, with zero unresolved outcomes. Their coverage includes 544 checks over all 136 route patterns (540 hosted states and four demo-only safe redirects), 268 permitted Member reads, 228 hosted Member entry denials, and four separate Member demo-lab redirects. Four positive scoped portal cases, 24 global-dialog/meeting-detail cases, 28 shared cases and four eligible-Member election cases are included in this total.

The final four cases supplement the completed 416-case baseline with private-core-document access and eight real Owner/Viewer workspace reloads. Each uses the actual workspace picker, hard reload and authenticated native overview. Fixtures and temporary memberships are cleaned up. The evidence retains 73 distinct initially failing cases and 93 failed attempts, all with a final passing outcome; application defects, fixture errors, selector/timing errors and interrupted/unstarted cases are distinguished.

## Changes verified by the qualification

Production uploads now require an authorized workspace and validate the requested purpose (legacy callers default to document uploads), use the eventual attachment's permission, and bind native storage to the authorized workspace. Logo upload retains its branding permission. Native storage IDs no longer enter the ordinary row-reference resolver. Hosted branding reacts to edits, and local image conversion persists bytes through IndexedDB.

The live pilot now handles session changes, offline startup and reconnect, read-only replica capability changes, concurrent acknowledgement races, and revoked downloaded bytes. A delayed download cannot restore a revoked cached attachment. Recovery drafts and durable authored operations retain their own isolation.

The role review fixes cross-workspace directory/portfolio exposure, atomic batch authorization, Director minutes-approval/adoption escalation, specialized election actor substitution and an Admin bypass of Owner-only vault access. Closed global dialogs, AI panels and unsupported WebMCP tools no longer subscribe to inaccessible resources. Read-only controls and callbacks follow the operation's current permission, and backend checks remain authoritative.

Dashboard, minute-book, evidence-register, meeting-package and library projections preserve each underlying resource permission and document ACL. Missing permission is reported as restricted coverage rather than empty data or a false compliance result. Legal register history preserves protected prior types after a record changes type or is deleted. Populated Member detail tabs retain permitted notes and content while settings, audit and layout controls use their own authority. Native scoped-service regressions supplement the real browser-role tests; this lab does not claim live service-token transport coverage.

Settings branding, inventory, retention and shared-view controls now use their exact write permissions. Public grant submission captures current editor content synchronously, so an immediate submit retains the last keystroke. Auth initialization retains the workspace preference while clearing ephemeral identity; confirmed sign-out clears it, and resolved memberships still reject foreign preferences.

Private supporting documents now mark minute-book coverage as limited. Document-dependent checks and gaps become unknown instead of reporting missing evidence; unknown checks do not inflate failure counts. Owner assessment and visibility remain available.

Shared responsive fixes keep resized dialogs inside the viewport, wrap long headings/toasts, re-anchor menus/calendars while scrolling, and preserve nested Escape/focus behavior. Test harness corrections and resource contention are recorded separately from application bugs in the evidence.

## Evidence and reproduction

The [authorization report](live-authorization-qualification.md) contains the fixed-role matrix, request counts, Owner protections and module-switch semantics. [The live lab runbook](../experiments/live-qualification/README.md) starts the actual application backend/broker and generates private fixtures. [The PowerSync runbook](../experiments/offline-convex/local/README.md) reproduces the isolated connector/SDK pilot. Public JSON evidence lives in `artifacts/offline`; credentials and browser traces remain ignored under local environment files and `tmp`.

The static authorization inventory enumerates 920 public wrappers: 877 declared fixed permission policies and 43 specialized handlers. It is source coverage, not 920 live endpoint/state tests.

The final source checks, rerun after the workspace reload fix, are `npm run test:reconciled-security`, `npm run server:typecheck`, `npm run build:pages` and `npm run test:interface-checks`. They pass after restoring the existing controller-read helper exports used by the sensitive-history regression. The combined build reports large chunks, and focused lint reports existing structural warnings with no errors. Browser evidence combines distinct completed cases from full and focused runs; it does not describe those manual reruns as one uninterrupted green run. Failed attempts remain in the public summaries, with their cause and final outcome.

## Limits and release boundaries

PowerSync currently qualifies meeting preparation. Other Societyer modules have not been converted to offline replicas. Automatic pilot projection invalidation covers exported user `setRole`, `upsert`, `remove` and `securityDisable` paths; other document/material ACL changes, identity changes and time-based expiry still require production invalidation support. Offline clients cannot receive revocations until connectivity returns. Pending SDK operations can hold a replication checkpoint, so explicit native authorization denial clears mirrored reads/downloaded bytes while keeping authored recovery work.

The actual full-app lab exercises Better Auth email login and native Convex storage. Clerk/Microsoft external login, production PowerSync credential delivery, RustFS/R2 connections, external AI/accounting/mail/registry services, physical devices and packaged Electron are not live-qualified here. Clerk/Microsoft policy preservation and external storage binding contracts have separate native regressions. Wave views use labelled synthetic native cache data; external provider configuration/unavailable states are not successful external operations.

Optional module settings control visibility and selected execution/intake gates; they do not universally revoke every API or rewrite fixed role grants. Viewport/touch tests use Chromium at 320, 390, 768 and 1440px. Route checks distinguish native populated records, unavailable/missing/token states, and the demo-only table-field lab. Large build chunks remain a performance follow-up; no Lighthouse or physical-device performance score is claimed.

The final command exits, source fingerprint, starting baseline and compact coverage totals are recorded in `artifacts/offline/qualification-summary.json`. The tested changes are committed on the working branch; this qualification does not publish them to main or deploy a public production service.

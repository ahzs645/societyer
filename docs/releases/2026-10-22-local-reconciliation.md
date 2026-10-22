# Local checkout reconciliation — 2026-10-22

The primary checkout was on `main` at `eb7489af`, 107 commits behind
`origin/main` (`38b52f82`). It contained 103 modified and 14 untracked files.
The procurement-reader-redesign checkout was at `51fc7c0c`, ten commits behind,
with 22 modified and three untracked files. These were preserved working copies
from the earlier release, rather than additional unfinished features.

## Review

Reviewed all 142 changed file entries across both checkouts against the latest
main and their originating releases. Of these, 114 matched main byte for byte.
The other 28 were older versions or compositions of the work already integrated
in `37de00fb` and `e84960dc`, followed by the procurement fixes and document
scrolling release through `38b52f82`.

The retained main implementation includes:

- Paged WhisperX transcripts and minute drafting, privacy checks, transcript
  exports, local AI and MCP connectors.
- Shared PDF/Word preview, fullscreen reading, bounded scrolling and overlay
  scrollbars.
- Global indexed procurement ordering/filtering, safe cursor restarts, infinite
  scrolling, phone cards, table display options and spreadsheet editing.
- The expanded finance routes, authorization inventory and export classifications.

Reapplying the old full files would remove these later integrations. No feature
patch from either preserved checkout needed to be reapplied. Local snapshot
branches `codex/preserve-main-20261022` and
`codex/preserve-procurement-20261022`, plus binary patches and file archives,
retain the original contents before the checkouts are updated.

One current-main verification defect was found and fixed:
`procurementMaintenanceLeases` was absent from the export coverage classification.
It is now explicitly excluded as temporary deployment-bound maintenance ownership,
consistent with the existing importer/projection exclusions. Business exports and
the production schema are unchanged.

The meetings release guide now records that its formerly pending items shipped
on October 19.

## Verification

- Frontend, Convex and Electron TypeScript checks and the DDC North production
  build passed.
- All 36 targeted regression scripts passed after correcting the export
  classification: procurement, previews, shared tables, meeting sources,
  transcripts, privacy, local AI, MCP, authorization and session handling.
- The portable manifest matched; all six parser tests passed.
- The tenancy harness reported zero leaked reads, zero leaked writes and zero
  new leaks. Its 16 existing harness errors remain recorded in the unchanged
  baseline report; they are not an assertion that every hosted route ran locally.
- Convex production deployment preview completed schema validation and reported
  no index deletions.
- Desktop and phone browser verification passed: 28 tests, four device-specific
  skips, no failures or retries. Run with Node 24 and the matching Playwright
  headless Chromium; the machine's Node 26/browser combination stalled.

## CI runner correction

The existing legal browser workflow failed before running its tests because
`ubuntu-latest` now selected Ubuntu 26.04, unsupported by locked Playwright
1.59.1's Chromium dependency installer.
The browser job is now pinned to supported Ubuntu 24.04. Dependencies and the
non-browser legal job are unchanged.

Earlier main browser runs also exposed two stale assertions, corrected without
changing product behavior: the static-route sweep now matches wildcard patterns
against the concrete routes it visits (including procurement `/home`), and the
corporation smoke test checks the current setup-summary heading instead of the
retired inline directors/shareholders task text.
The AST route-coverage check also identified the already-shipped OAuth consent
route missing from the interface fixture manifest; it now has an invalid-request
fixture alongside the existing public sign-in/reset routes.
All four corporation browser tests and the static sweep guard now pass locally;
the AST check covers all 167 route patterns. These follow-up changes touch only
tests, CI and this record.

## Production refresh

Application source: `1368b294` (runtime code retained from `38b52f82`). Follow-up
changes to this record and the CI runner do not change the deployed application.

- Convex: `industrious-cricket-610`, deployed successfully with TypeScript and
  schema validation, no index deletions. All 1,412 function definitions and 40
  HTTP route definitions match the pre-deploy metadata; no endpoints were lost.
- Meeting transfer Worker: `societyer-ddcnorth-meeting-transfer`, version
  `ecc4429b-cd1d-4d4c-8870-4c05dfa2376e`.
- Cloudflare Pages production: `4838a657-4b7b-49fa-9874-b8b44515e465`, branch
  `main`, source `1368b294`, https://societyer-ddcnorth.pages.dev.
- Production HTML and all six entry/preload JS/CSS assets matched the reviewed
  local build byte for byte. OAuth framing/referrer headers and discovery passed;
  anonymous MCP and meeting-transfer requests returned HTTP 401.
- Production authentication still allows only `ddcnorth.com`, with email
  delivery and signup enabled. The existing signed-in browser session survived
  reload and loaded the procurement reader's live results.

The non-browser legal job and GitHub Pages deployment passed on `1368b294`.
The corrected legal browser workflow will rerun on the follow-up commit.
Full logs, browser results and original working-file archives are retained in
the local `societyer-consolidation-20261022` backup directory.

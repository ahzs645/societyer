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

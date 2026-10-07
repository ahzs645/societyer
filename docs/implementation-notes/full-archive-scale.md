# Full-archive scale: compact reviews, streaming backups, per-record apply, embedded minutes

Follow-up to the PGAIR re-transposition (WP-R). Three problems found there:

1. A **fully reviewed archive did not fit in a backup.** Promoting every class through the review screen
   accepted 89,285 fields in 1,926 documents and promoted 1,048. The workspace grew to about 285 MB and
   190,000 rows, past the 256 MB / 200,000-record backup limits.
2. **Import "Apply sections" was all-or-nothing.** One blocked record (13 duplicate policy names; 192
   meeting materials whose meeting was still pending) held back the whole section.
3. **Minutes embedded in agendas and packages** (36 on PGAIR) reached the workspace only through import
   sessions, without field provenance.

No real names or real data are in this note or in the repository. The real-archive check ran in the
session scratchpad (`fas/`).

## 1. Why the archive did not fit, and what changed

### Where the limits are enforced

| Limit | Where | Before | Now |
| --- | --- | --- | --- |
| Records in one JSON file (`.json` backup, or `workspace.json` in a ZIP) | `src/lib/workspaceArchive.ts`, `shared/onboardingBackup.ts` (`MAX_SETUP_BACKUP_BYTES`) | 256 MB, export refused above it | Still 256 MB for a *single* JSON file: it is parsed as one string |
| Records per restore | `validateSetupBackup` | 200,000 | 1,000,000 (`MAX_RESTORE_RECORDS`) |
| Records of a chunked (version 2) ZIP | `readChunkedDatabase` | — | 1 GB of JSON (`MAX_CHUNKED_RECORD_BYTES`) |
| Whole archive (expanded) | `MAX_ARCHIVE_BYTES` | 1 GB | 3.5 GB (plain ZIP, no ZIP64) |
| Local store | `LocalDexieRowStore.importSnapshot` | no size limit; 10,000 change-journal entries | unchanged |
| Hosted (Convex) organization export | `src/pages/Exports.tsx` → `buildWorkspaceArchive` | the same 256 MB limit | the same streaming writer; above the v1 limits it writes version 2 |

### Why the rows exploded (measured on the full-review profile, `sizes-B.json`)

| Table | Rows | MB | Cause |
| --- | ---: | ---: | --- |
| `intakeFieldReviews` | 89,285 | 83 | One row per bulk-accepted field, each copying the value and up to 20 locators with quotes |
| `intakeExtracts` | 2,262 | 70 | Extracted text and layout of every reviewed file, kept after promotion |
| `fieldProvenance` | 46,525 | 46 | One row per promoted field, copying the value and the locator with its quote |
| `documents` (content) | 5,262 | 47 | Each promotion is an import session: a session document plus staged record documents whose JSON payload repeats the file's extracted text (up to 180,000 characters), on top of the created document's own copy |
| `intakeExtractions` | 2,033 | 37 | The field trees (kept: provenance reads them) |
| `intakeFiles`, `intakeProcessingLog` | 22,237 | 21 | Run catalogue and audit log (kept) |

So the extracted text of a promoted file was stored three times (extract, staged record, document), and
every bulk-accepted field was stored twice more (review row, provenance row) with copies of what the
extraction already holds.

### Fixes

- **Batch review rows** (`shared/intake/review.ts`, `intake:reviewFields`, `bulkAccept`,
  `linkNameAcrossRun`). Plain accepts of several fields of one document with the same note are one row:
  `fieldPath: "@batch"` and `fieldPaths` with index ranges (`attendance[0-41].nameAsWritten`,
  `motions[0-3,5].text`). No value or locator copies. `latestDecisions` expands a batch row into one
  decision per field (same decision, reviewer, time and note), so every reader (review screen, promotion,
  readiness, merge candidates) is unchanged. Undo deletes the batch row. Edits, rejections and "can't
  represent" stay one row per field with their copies. Because accepted values are now read from the
  extraction, `intake:saveExtraction` refuses to replace an extraction that has reviews.
- **Provenance by reference** (`shared/intake/provenance.ts`). New rows keep the reviewed value only when
  it was edited, and only the locator `kind` plus anything that differs from the extraction field's primary
  locator. `hydrateProvenance` restores value, locator and quote for every reader
  (`provenanceForRecord(s)`, `provenanceForExtraction`, View source). Legacy rows hydrate to themselves.
- **"Compact this intake run"** (`shared/functions/intakeCompaction.ts`, run details → Storage).
  `intake:compactionPlan` says what would change; `intake:compactRun` does it in bounded steps (cursor,
  ~2,000 writes per call) and records the result on the run (`intakeRuns.compaction`):
  1. folds legacy per-field accept rows into batch rows (`planReviewCompaction`; same extraction,
     reviewer, time and note — what a bulk accept wrote);
  2. slims legacy provenance rows (`slimProvenance`);
  3. removes the staged copies of applied records in the run's promotion sessions and its bundle session
     (`importSessions:compactAppliedRecords`, also a "Compact applied…" button per session): the session
     keeps a summary (`compactedRecords`: counts, and where each removed record landed); summaries add the
     compacted counts back; idempotency is unaffected because `importTargets` remembers applied records;
     gaps that pointed at a removed record keep their session link;
  4. removes the extracts no open review needs (open extractions' files, their version-cluster members and
     the packages of open embedded minutes keep theirs).

  Never removed: extractions, files, clusters, the processing log, review decisions, provenance, native
  records, document versions, saved originals. The confirmation names what is removed.
- **Lazy heavy fields for intake** (`HEAVY_FIELD_POLICY`): `intakeExtracts.blocks/text` and
  `intakeExtractions.record`; storage layout 3 moves them for existing vaults (only the new tables).
  The review queue (`intake.queueItem/v1`) and run summaries (`intake.extractedFacts/v1`) read memoized
  projections; `getRun` and run summaries project the field trees away; covering cluster copies reads only
  the cluster's files.
- **Deferred tables** (`DEFERRED_HYDRATION_TABLES`: the eight intake tables and `fieldProvenance`). Boot
  no longer reads their rows; the first read of one loads that table (`LocalDexieRowStore.ensureTables`).
  `LocalStoreDb` loads a deferred table before reading it, inline so reads that need no load keep their
  exact timing (the conformance matrix's lazy engine defers the same tables: 0 divergences); an id it
  cannot place loads the deferred tables first, unless the id's prefix names a loaded table; the store
  loads a table before writing to it; exports load everything. Legacy synchronous row access does not
  see deferred tables (no legacy code reads them).
- **Streaming ZIP backups** (`src/lib/zipStream.ts`, `src/lib/sha256Stream.ts`,
  `buildWorkspaceArchive`, `readWorkspaceArchiveFile`). Records are serialized a batch at a time into
  Blob segments (the local export streams rows from the store table by table, loading lazy fields 500
  rows at a time — `exportSnapshotSource`), entries are deflated through `CompressionStream` and read back
  from file slices through `DecompressionStream`; files stay slices of the archive. No single string or
  buffer holds the workspace.
  - **Version 1** (one `workspace.json`) is still written whenever the workspace is within 256 MB and
    200,000 records, so every older build restores it (JSZip reads the streamed archive; gated).
  - **Version 2** (`database/meta.json` + checksummed JSON chunks of ≤ 8 M characters per table, listed in
    the manifest) is written only above those limits — workspaces older builds could not restore anyway.
    Older builds refuse it with "not a supported Societyer ZIP backup"; this build refuses a future version
    with "written by a newer version".
  - Reading verifies every chunk's size and SHA-256, the manifest counts and every file's checksum, as before.

## 2. Per-record "Apply sections"

`applyApprovedSectionRecordsPortable` (`shared/functions/importSessions.ts`):

- Records are applied one at a time in dependency order; a record whose checks fail is **blocked** and the
  rest still apply. Records blocked only by something applied later in the same pass are retried (up to
  three passes).
- A blocked record stays **Approved** with `blocked: { reason, issues, duplicateOf?, waitingFor?, atISO }`,
  a review note and the tags `promotion-blocked` / `promotion-waiting`. Reasons:
  `duplicate` (with the register record it duplicates, for policies), `waiting` (a meeting material or
  proxy whose meeting is not on record yet; a grant report whose grant is not), `invalid` (anything else,
  including an ambiguous meeting).
- **Dependents apply automatically**: when `applyApprovedMeetings` creates meetings (any session, including
  an intake promotion), records waiting for a meeting in any session of the organization are checked and
  applied (`applyWaitingDependentsPortable`, bounded to 500 per call; skipped silently when the person
  lacks a permission they need).
- **One-click resolutions** (`importSessions:resolveBlockedRecords`, settings write; several records at
  once): `link_existing` (a duplicate counts as applied to the register record it duplicates and is
  remembered in `importTargets`), `retry`, `defer` (back to Pending) and `skip` (Rejected). Each leaves a note.
- The result lists `blocked` with reasons; when everything was blocked it still reports
  `preflightBlocked: true` (older callers). Intake promotion keeps all-or-nothing semantics
  (`allOrNothing: true`): one document's records are one unit.
- UI: Import sessions → session panel "N approved records could not be applied", grouped by reason, with
  Link / Retry / Defer / Skip per record and for the whole group (Skip confirms); the apply toast says what
  applied and what is blocked. The agreements register's records go through the same loop.

## 3. Minutes embedded in packages

- `stageRunInWorkspace` now stages a derived extraction (`<package>#part-N`, `parentFileKey`) when it is
  the reconciled canonical copy of a meeting (no standalone minutes exist). Derived copies of minutes that
  also exist standalone stay inside the package's extraction, as before.
- `intakeExtractions.parentFileKey` (optional). The row lives on the package's file (`fileId`), so the
  review screen shows the package original and highlights the minutes' spans in it (locators were already
  rebased onto the package blocks). The queue labels it "Embedded minutes".
- Promotion: the package is the minutes' only source document (its own class, so promoting the package as
  an agenda and its minutes cites one document); no placeholder for the derived key; no cluster covering.
  Field provenance is written like for any minutes.
- `intake:reconcileRun` no longer derives stored derived extractions a second time.

## Gates

| Gate | What it proves |
| --- | --- |
| `npm run test:intake-archive-scale` (`scripts/check-intake-archive-scale.ts`) | Synthetic fully reviewed run (`scripts/perf/synthetic-intake-archive.mjs`, legacy layout: 169,557 rows, 261 MB) exceeds the old limits; compaction (on the browser engine: lazy fields, deferred tables, indexes) brings it to 80,003 rows / 165 MB in 29 steps (16 s); every field decision, every sampled provenance row as View source reads it, session counts and open extracts unchanged; compacted export is version 1, uncompacted is version 2; both read back and restore with every id. Time and memory per phase are printed. |
| `npm run test:import-apply-per-record` | Valid records (incl. agreements) apply past blocked ones; duplicate / waiting / invalid reasons; waiting material applies when its meeting is created; link / defer / skip / retry; idempotent re-apply; compaction keeps counts and idempotency; all-blocked still `preflightBlocked`; intake stays all-or-nothing. |
| `npm run test:workspace-archive` (extended) | JSZip (older builds) reads streamed v1 archives with matching SHA-256; v2 round trip with empty tables, unicode and multi-chunk tables; chunk checksum failures; newer-version refusal; streaming from the local row store. |
| `test:intake-review`, `test:intake-ai` (extended) | Batch rows (one row, ranges, no copies, per-field decisions, undo); embedded minutes staged, promoted with provenance, sourced to the package, no second derivation. |
| `tests/offline-rollout-local-recovery.spec.ts` (new test) | In the browser: layout 2 → 3 moves intake heavy fields; boot reads only non-deferred tables; first query / id lookup / write loads them; backups include them. |
| `test:portable-conformance-matrix` | Lazy engine with deferred tables agrees with MemoryDb across the registry. |
| `test:local-workspace-perf` (extended) | Base synthetic workspace plus a compacted archive-scale intake run (96,089 rows, ~351 MB of records) restored from a **version 2** ZIP written by the app's own writer; fails a restore over 60 s; measures `/app/intake` too. Run with tsx. |

Measured with `test:intake-archive-scale` at scale 1 (Node 22, the same streaming code the browser runs):

| Phase | Time | JS heap growth | Buffers (Blob/ArrayBuffer) |
| --- | ---: | ---: | ---: |
| Export compacted (v1, 165 MB records → 20 MB ZIP) | 7.1 s | +22 MB | 283 MB |
| Read compacted | 3.7 s | +167 MB (parsed rows) | 102 MB |
| Export uncompacted (v2, 261 MB → 28 MB ZIP) | 7.5 s | +49 MB | 383 MB |
| Read uncompacted | 5.4 s | +339 MB (parsed rows) | 229 MB |

The old writer needed the whole snapshot object, one JSON string of the full size, its UTF-8 bytes and
JSZip's copy at once (several times the record size in the tab's heap); in a browser, Blob bytes live
outside the tab's heap.

## Real archive (PGAIR run8, session scratchpad only)

RESULTS_PLACEHOLDER

## Assumptions and decisions

- Compaction is explicit (a person runs it) and never automatic, and restore does not compact: a
  restored workspace has exactly the backup's rows and ids. New reviews and provenance are compact from the
  start, so compaction mostly matters for runs reviewed before this change and for staging.
- A batch row's per-field audit (decision, reviewer, time, note) is complete; what it no longer stores is a
  copy of the accepted value. The extraction is immutable once reviewed, so the value cannot drift.
- Older builds restoring a backup made by this build: version 1 archives restore; batch review rows are not
  understood by older builds (fields accepted in bulk show as unreviewed there) and slim provenance rows
  show no quote. Data is not lost; it is read correctly again by this build.
- Limits: 1,000,000 records and 1 GB of record JSON per restore are what a 64-bit browser tab holds
  comfortably after parsing (the scale gate's 261 MB read peaks at +339 MB heap); 3.5 GB archive (ZIP32).
- `fieldProvenance` stays one row per field (now ~490 bytes); grouping rows per target record would cut
  ~45k rows more but changes every reader, and deferred hydration already keeps them off boot.
- Embedded minutes that duplicate a standalone copy are not staged separately: the standalone copy is the
  record and the package is cited as its material.
- "Promote all ready" skips documents nobody reviewed anything in (status `pending_review`).

## Deferred

- Hosted Convex export still fetches every table into the page before writing (now streamed into the ZIP);
  a per-table paged writer would bound that too.
- Grouped provenance rows (see above) and a paged processing log.
- The perf gate's absolute numbers depend on machine load; see the measurements above for this run.

## For other work packages

- Read provenance through `intake:provenanceForRecords` / `provenanceForExtraction` (hydrated); never read
  `fieldProvenance.value` / `locator.quote` directly — use `hydrateProvenance` from `shared/intake/provenance.ts`.
- Review rows: always interpret through `latestDecisions` (batch rows carry `fieldPaths`).
- New staging tables that pages outside their own screens never read can join `DEFERRED_HYDRATION_TABLES`.
- `applyApprovedSectionRecordsPortable(ctx, { sessionId, recordIds, allOrNothing })`; results carry
  `blocked: BlockedImportRecord[]`.
- `buildWorkspaceArchive(databaseOrSource, collectFiles, onProgress, { format, onRows })` accepts a
  `DatabaseSource` (row batches per table); `LocalDexieRowStore.exportSnapshotSource()` provides one.

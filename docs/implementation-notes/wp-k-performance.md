# WP-K — Performance at real-workspace scale

Scope: the local runtime's data layer (row store, portable query engine, query
cache, workspace boot, IndexedDB layout) and the shared list queries. Pages were
touched only to switch a list to a lighter query.

## Problem (measured, not assumed)

Restored PGAIR backup: 27.8k rows, `workspace.json` 200 MB. Where the bytes are:

| Field | Size |
| --- | --- |
| `documents.content` (10,938 rows) | 136 MB |
| `minutes.sourceMeetingRecord` (142 rows) | 31 MB |
| `minutes.sourceTransposition` | 3.9 MB |
| everything else | ~30 MB |

Root causes found in the code and confirmed with CPU profiles:

1. **Every boot deserialized the whole 200 MB** from the IndexedDB `records`
   store into an in-memory cache, with an O(n²) merge (`upsertLocalRow` copied the
   table array per record).
2. **Every query cloned every row it touched through a JSON round trip,
   including content**, and `ctx.db.get(id)` scanned every row of every table to
   find the id's table.
3. **Every store change re-ran every watched query** and compared results with
   `JSON.stringify` on both sides (tens of MB for the documents list).
4. **Each legacy transaction deep-cloned the whole workspace** (`transactionAsync`
   JSON-copied the cache) and each batch commit deep-cloned every touched table.
5. **List queries returned heavy fields nobody displays**: `documents.list`
   (content, used by pickers and the meeting page), `minutes.list` (verbatim
   source records, used by the meetings list and every meeting page).
6. Importing the `staticConvex` barrel **constructed a second demo client**,
   which opened and hydrated a second IndexedDB vault and ran its metadata seed
   on every boot.
7. `/app/members`: 119 `personHistory:forRecord` subscriptions each ran several
   times (React re-subscriptions re-ran the query every time) (once the other fixes stopped the crash: 476 runs, 17 s, 1.6 GB heap).

## What was built

### Storage layout 2 — lazy heavy fields (`shared/portable/heavyFields.ts`)

- `HEAVY_FIELD_POLICY`: `documents.content`, `minutes.{sourceMeetingRecord,
  sourceTransposition, draftTranscript}`, `transcripts.{text, segments}`. A value
  is externalized only when it serializes to more than 1 KB.
- `LocalDexieRowStore` writes those values to a new `recordFields` object store
  (Dexie v5); `records` keeps the light row plus an `external` field list. Boot
  reads only light rows (~30 MB for PGAIR).
- **Migration**: on first boot of an existing vault (`meta.storageLayout` < 2)
  the heavy values are moved a chunk of 100 rows at a time, idempotently (an
  interrupted run resumes), and the legacy v1 `meetings`/`minutes` mirrors are
  cleared — `records` is authoritative; the mirrors are still read to upgrade a
  vault whose `records` is empty. No row schema changed; backups are unchanged.
- **Backups stay complete**: snapshot export is now async and materializes every
  heavy field (`exportLocalWorkspaceSnapshotAsync()`); verified on PGAIR — the
  215 MB records JSON carries all 10,944 `content` and 142 `sourceMeetingRecord`
  fields. The synchronous `exportLocalWorkspaceSnapshot()` is kept for Node and
  in-memory runtimes and **throws** rather than return an incomplete backup when
  fields are lazy.
- Restore no longer deep-copies the parsed backup (validation is structural; the
  sanitizers and migration already build new rows), halving peak restore memory.

### Portable contract additions (all three adapters: Convex, MemoryDb, LocalStoreDb)

- `query(...).omitFields(...fields)` — projection. Predicates still see the whole
  row. On Convex it trims the returned rows; locally an omitted heavy field is
  never loaded.
- `ctx.db.get(id, table, { omitFields })` — same for single rows.
- `query(...).collectProjected(key, project)` — `collect().map(project)` on
  Convex/MemoryDb. Locally the result of the pure `project` is **memoized per row
  revision**, persisted in a new `projections` store (Dexie v6) per production
  build, computed in bounded chunks of 250 rows, and serialized per key so
  concurrent runs share work. Used where list data is *derived from* heavy
  content: document provenance (`documents:browse`), import-candidate queue items
  (`importSessions:reviewQueue`/`pendingByTarget`), and the minutes source-ACL
  facts (`minutes:listSummaries`). This replaced WP-I's content-identity caches,
  which pinned every document's text in memory.
- Semantics are proven equal: the conformance matrix now runs a third engine,
  LocalStoreDb over a lazy/indexed store that externalizes *every* non-empty heavy
  field, against MemoryDb across all 947 registered functions (0 divergences).

### Local engine (`shared/portable/localRowStore.ts`, `src/lib/localDexieRowStore.ts`)

- Per-table `Map`s with an id → table map (O(1) `get`, `tableOf`), cached arrays,
  and lazily built **compound equality indexes** over all eq constraints of a
  query (e.g. `societyId + category`), dropped on write.
- Lazy evaluation: a row whose lazy field is touched by a constraint or predicate
  throws `HeavyFieldNotLoaded` from a guard proxy, is loaded and evaluated again in
  full — predicates always see complete rows. Each row is evaluated once.
- Batch commits snapshot only the touched rows (undo log) instead of tables;
  legacy `transactionAsync` uses the same undo log instead of cloning the
  workspace. Legacy light-row upserts carry existing heavy values forward.
- Clones use WP-I's `jsonClone` (shares strings); freshly loaded heavy values are
  not copied twice. Hydration is one pass straight into table maps.
- Every row carries a revision (`records.rev`, renewed on write; a persisted
  `dataEpoch` covers rows not written since a restore/reseed).

### Query cache (`src/lib/portableQueryCache.ts`)

- `PortableRuntime.runQueryTracked` reports which tables a query (including its
  authorization reads and nested queries) read; the store reports which tables a
  write touched. Only intersecting queries re-run; `users` is always a dependency;
  a query that looked up a non-existent id, or a legacy-dispatch query, is
  "unbounded" and refreshes on every write.
- A query with a run in flight, or a fresh result whose tables are untouched, is
  not re-run for another subscriber (members on the dev server: 476 → 238
  forRecord runs, i.e. once per seat per StrictMode mount).
- Structural equality instead of double `JSON.stringify`.
- Opt-in diagnostics: `globalThis.__SOCIETYER_QUERY_PROFILE__` (per-query wall
  time) and `__SOCIETYER_LOCAL_BOOT__` (vault read time and row count).

### Shared list queries

- `documents:listSummaries` (new): `documents:list` without `content`. Used by the
  meeting page (material picker) and the task / asset / commitment pickers.
  `documents:list` itself is unchanged for API compatibility, but filters
  internal import rows inside the query so their content is never loaded locally.
- `minutes:listSummaries` (new): `minutes:list` without `sourceMeetingRecord`,
  `sourceTransposition`, `draftTranscript`; the same source-ACL decision (a
  restricted record keeps its small restriction marker). Used by the meetings
  list, the meeting page, the minutes page and the draft-minutes picker.
  `minutes:list` is unchanged (it is exposed by the API gateway).
- `minutes:list`/`listSummaries` memoize the document access predicate per call
  and look up source documents without their content.
- `documents:reviewQueues` projects `content` away.

### Boot

- The eager demo client in `src/lib/staticConvex.ts` is now created on first use
  (`getStaticConvex()`); adapters import the client class directly.
- After a restore the client seeds record-table metadata and warms the heavy
  projections in the background (idle callback), awaiting durable memos.

## Measurements

Reproducible with `npm run perf:measure-local -- --base <url> --profile <restored
profile>` (fresh browser process per route; ready = visible h1, nothing
`aria-busy`, route content present; heap via CDP `Performance.getMetrics`, before
and after a forced GC). Machine: 4 CPUs shared with ~6 agents (load 3–7), so
absolute numbers carry ±30 %.

PGAIR, production build (`vite build` + `vite preview`, `VITE_RUNTIME_MODE=local-indexeddb`):

| Route | Before: ready / heap (after GC) | After: ready / heap (after GC) |
| --- | --- | --- |
| /app | 10.1 s / 373 MB (342) | 1.7–1.8 s / 126 MB (52) |
| /app/meetings | 13.2 s / 393 MB (393) | 1.7–1.8 s / 75 MB (55) |
| meeting detail (largest minutes) | 16.3 s / 764 MB (490) | 1.6–1.8 s / 86–138 MB (75–95) |
| /app/documents | 11.6 s / 636 MB (423) | 2.6 s / 150 MB (82) — 4.6 s on the very first visit when the post-restore warm-up was interrupted |
| /app/imports | 8.3 s / 380 MB (353) | 1.8–2.0 s / 94 MB (71) |
| /app/people-directory | 7.2 s / 362 MB (344) | 1.6–1.7 s / 62 MB (52) |
| /app/tasks | 8.6 s / 680 MB (427) | 1.6 s / 64 MB (55) |
| /app/members | renderer crash | 1.6 s / 64 MB (52) |

PGAIR, dev server: before /app 8.0 s / 390 MB, meetings 12.2 s / 791 MB, meeting
detail 21.1 s / 1.76 GB, documents 11.0 s / 595 MB, tasks 10.9 s / 883 MB,
members crash; after /app 2.4 s / 201 MB (68), meetings 2.6 s / 130 MB, meeting
detail 2.2 s / 116 MB, documents 4.8 s / 248 MB (104; dev keeps projection memos
in memory only, so every cold dev load recomputes them), imports 2.6 s, people
2.7 s, tasks 3.0 s, members 2.8 s / 80 MB.

Vault boot (read + build) on PGAIR: ~0.8 s for 29k light rows. PGAIR restore:
20.7 s end to end in the browser (was 22.7 s), dominated by ZIP parsing.

The "before" column is the base commit of this work package; WP-H (members
render) and WP-I (documents page) landed on the integration branch meanwhile and
contribute to the members and documents "after" numbers.

## Gates

- `npm run test:local-workspace-scale` (Node, `scripts/check-local-workspace-scale.ts`):
  lazy vs eager equality, omit/get projections never load, predicates over lazy
  fields see full rows, memoized projections re-project only written rows and
  hand out copies, compound indexes, table-scoped cache refresh, and list-query
  budgets plus "warm runs load nothing" on a synthetic workspace.
- `npm run test:local-workspace-perf -- --base <url>` (browser,
  `scripts/check-local-workspace-perf.mjs`): generates a ~209 MB synthetic backup
  (`scripts/perf/synthetic-workspace.mjs`, 17k rows, no real data), restores it
  through Settings → Restore, then cold-loads 8 routes twice and fails if any is
  not interactive within `--max-ready-ms` (3000) or its heap (before or after GC)
  exceeds `--max-heap-mb` (200). Last run: all 16 loads 1.2–2.7 s, heap ≤ 158 MB.
- Conformance matrix: third (lazy/indexed) engine; fixture documents now carry
  content so lazy loading is exercised (69 on-demand loads, 0 divergences).
- `tests/offline-rollout-local-recovery.spec.ts`: two new browser tests (heavy
  fields across reopen, legacy patches and backup; in-place layout 1 → 2
  migration). All five pass.
- Passing: test:portable-runtime, portable-live-runtime, portable-query-cache,
  portable-conformance-matrix, portable-convex-oracle, portable-manifest,
  static-parity, authorization-policy, permissioned-mutation, workspace-access,
  workspace-archive, hosted-identity, local-snapshots, document-categories,
  import-session-completion, pgair-review-workflows, person-history,
  member-history, motions-resolve-parity, and the snapshot-using scripts
  (clone-society, corporation-mvp-flow, guided-onboarding, import-core-fidelity,
  meeting-history, …); `tsc -b`, `convex:typecheck`; lint 0 errors.

## Decisions and assumptions

- Heavy fields are an explicit allow-list plus a 1 KB threshold, not "any big
  field": legacy code that reads cached rows directly keeps seeing every other
  field, and the policy documents exactly what can be lazy.
- `omitFields`/`collectProjected` are contract additions rather than local-only
  hints so Convex runs the same handler with the same results (and returns
  smaller payloads). Projections must be pure; their key plus a hash of the
  function source plus the production chunk URL (which changes with any handler
  code) namespace persisted memos. Development keeps memos in memory only.
- New `listSummaries` queries instead of changing `documents:list`/`minutes:list`:
  both are public API (`server/api-gateway.ts` exposes `minutes.list`), and a few
  screens read `content` from the full list (privacy policy drafts).
- Light rows still load eagerly at boot (~0.8 s). Lazy per-table hydration was
  not built: the sync legacy row API (`rows()`, legacy dispatch) would need every
  table anyway, and the slowest page (documents) needs the two largest light
  tables, so it would not move the worst case.

## Deferred

- **Worker offloading of restore/parse**: restore is a one-time action, now
  ~20 s for 200 MB with no deep copy; moving ZIP/JSON parsing to a worker is
  worthwhile but not on any measured page path.
- **First visit to Documents right after a restore** recomputes provenance and
  candidate projections if the background warm-up was cut short (4.6 s on PGAIR);
  every later visit reads persisted memos (2.6 s).
- The demo database re-adds missing demo seed rows on every boot
  (`putMissingSeedRows`), so a backup restored into the demo vault gains the demo
  society. Pre-existing behaviour, left as is (now a single bulkGet).
- `documentProvenanceCached`'s id cache (WP-I) still pins content for callers
  outside `documents:browse` (evidence registers); it is bounded by what those
  screens read.

## For other work packages

- Use `documents:listSummaries` / `minutes:listSummaries` for lists and pickers;
  open one record with `documents:get` / `minutes:getByMeeting` for heavy fields.
- In portable handlers, project heavy fields away with `.omitFields("content")`
  when a list does not show them, and derive list data from heavy fields with
  `.collectProjected("<name>/v1", pureFn)` (bump the key when the logic changes).
- Local snapshot export: `exportLocalWorkspaceSnapshotAsync()` in app code;
  `LocalDexieRowStore.exportSnapshot()` is async.
- `LocalDexieRowStore.onUpdate(listener)` now passes the set of changed tables.
- Perf diagnostics: `globalThis.__SOCIETYER_QUERY_PROFILE__ = {}` before boot.

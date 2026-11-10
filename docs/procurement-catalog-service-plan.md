# Procurement catalog service: implementation plan

Status: deployed for DDC North, 2026-11-10. Three real publications passed full
qualification and the Owner selected the service. See `procurement-catalog-service-rollout.md`
for observed releases, local publisher operations and the 14-day Convex fallback;
the proposal below records the original design.
Audience: the engineer or agent who will implement it. It is written to be read cold.

## 1. The idea in one paragraph

Today the hosted procurement reader gets every list row, notice, search result and
chart from Convex, and each publish is imported into Convex row by row. This plan
moves the read-only procurement catalog out of Convex and onto a small service on
the owner's VPS. Zoer keeps scraping exactly as it does now and keeps publishing
the archive and original documents to SharePoint. After each publish it also
updates one SQLite file on the VPS, sending only the parts that changed with
`sqlite3_rsync`. The browser downloads the whole list once per publication (about
2 MB compressed) and filters, sorts, groups and counts locally. It asks the VPS
only when someone opens a notice, searches inside notice text, or opens a chart.
Convex keeps what people write: sign-in, permissions, triage decisions, tasks, and
the SharePoint document broker. When the service has run cleanly in parallel, the
Convex catalog tables and the import pipeline are removed.

```
Zoer box (scrapes, unchanged)
   ├─► SharePoint: full archive + original documents (unchanged)
   └─► VPS: catalog.sqlite, changed pages only (sqlite3_rsync over SSH)

Browser ──► Convex: sign-in, permissions, decisions, tasks, document downloads,
        │           and a short-lived signed grant for the VPS
        └─► VPS: list files, notice details, text search, analytics
```

Only the Procurement review page talks to the VPS. Nothing outside
`src/features/procurementReview/` calls a procurement API, and the page is
lazy-loaded from `src/main.tsx`, so a VPS outage affects that page and nothing else.

## 2. Why

Measurements are from the retained 2026-10-23 export (21,877 awards, 3,752
opportunities) and from the rollout notes in `docs/`.

| Problem today | Evidence | What this plan does |
| --- | --- | --- |
| Filtered analytics and "show matching awards" read the whole awards table | 46.0 MB of input and 19 s for a 50-row result (`docs/procurement-journal-analytics-2026-10-23.md`) | The service holds the rows in memory and runs the same engine |
| Publishing pauses readers | 22 min 15 s read pause on 2026-10-22 (`docs/procurement-convex-catalog.md`) | A publish is a file sync plus an atomic switch |
| Narrow filters scan and stall | "Keep checking" button, single sort only, "groups cover loaded results" (`reader/ServerNoticeRows.tsx`) | The whole list is local, so filters, multi-sort, grouping and counts are instant and exact |
| No search inside notice text | Documented limit of the hosted list search | Full-text index on the VPS |
| List rows carry a 39.5 MB analytics blob the page strips before returning | 61% of the 64.6 MB list table; 15 indexes on that table | Not stored in Convex at all |
| A long import pipeline to operate | Delta planner, read gate, retirement tool, analytics seeding, a pinned operator runtime | Removed after cutover |

Cost is not the reason. The dashboard figures recorded on 2026-10-22/23 were about
2.8 GB storage and 4.9 GB database I/O against 50 GB allowances.

A browser-side list file measured from the same export:

| List | Rows | Raw | Gzipped |
| --- | ---: | ---: | ---: |
| Opportunities | 3,752 | 2.5 MB | 0.49 MB |
| Awards | 21,877 | 8.3 MB | 1.57 MB |

For comparison, the October browser-SQLite approach that broke phones was
72.8 MiB compressed and 459 MiB expanded.

## 3. Scope

In scope:

- A read-only catalog service in this repository, deployed to the VPS.
- A builder that turns a verified export into `catalog.sqlite`.
- A publish step in Zoer that syncs that file to the VPS and activates it.
- A third reader data source in the frontend, behind a per-workspace switch.
- A parallel run, cutover, and removal of the Convex catalog tables and import code.

Out of scope:

- Scraping, collectors and the Zoer catalog. They do not change.
- SharePoint publishing and document storage. They do not change.
- The no-login demo reader (`snapshotSource.ts`). It does not change.
- Postgres or any database server. Keep queries plain so the engine could be
  swapped later, but do not build for it now.
- The upstream fidelity fixes from the 2026-11 review (dropped `sourceFields`,
  the source-revision fingerprint). They are a separate track. The builder reads
  the same export, so those fixes flow through when they land.

## 4. Decisions to confirm with the owner before building

1. **Where review evidence lives.** Each workspace already has its own publication
   folder (`Zoer/bc-bid-monitor/<workspaceId>`), and its snapshot includes that
   workspace's review evidence (91 rows in October). Recommended: keep one
   `catalog.sqlite` per workspace on the VPS, evidence included, served only to
   grants for that workspace. That removes the Convex import entirely and keeps a
   publication atomic. The cost is that the VPS then holds workspace-private
   review rows, not only public tender data. The alternative is to keep evidence
   in Convex through a small dedicated replace-all mutation; that keeps private
   data off the VPS but leaves two stores to keep in step for every publication.
2. **Hostname.** A dedicated subdomain for the service (for example
   `catalog.<owner domain>`), reached through a Cloudflare Tunnel.
3. **Retention before cleanup.** How long the Convex catalog stays as a fallback
   after cutover. This plan assumes 14 days.

## 5. Architecture

### 5.1 `catalog.sqlite`

One file per workspace. Built from the verified export directory that
`scripts/procurement/export-convex.py` already produces (`procurementRecords.jsonl`,
`procurementDetails.jsonl`, `procurementDocuments.jsonl`, `procurementEvidence.jsonl`,
`procurementTaxonomyTerms.jsonl`, `activation.json`). Mirror the field names in
`convex/tables/procurement.ts`; do not invent a second projection.

| Table | Purpose |
| --- | --- |
| `meta` | `schemaVersion`, `societyId`, `folder`, `publicationId`, `generation`, `sourceSnapshotId`, `contentHash`, `inventoryHash`, `publishedAt`, `collectedAt`, coverage JSON, per-table counts, journal sequence |
| `notices` | One row per opportunity or award: the list columns plus `analytics_json`, `archived`, `row_hash` |
| `details` | `record_key`, `data_json`, `row_hash` |
| `documents` | Document metadata, indexed by `record_key` |
| `evidence` | Review evidence, indexed by `record_key` and `source` (see decision 1) |
| `taxonomy_terms` | The compact dictionary |
| `notice_text` | FTS5 index over title and notice body text |

Rules for the builder (`scripts/procurement/build-catalog-db.ts`, new):

- **Update in place.** Keep a persistent origin file in the publisher's work
  directory. For each table, upsert rows whose `row_hash` changed and leave the
  rest untouched, inside one transaction. A from-scratch rebuild reshuffles pages
  and would make `sqlite3_rsync` resend most of the file.
- **Removals.** Follow the existing rule: a notice missing from a publication
  whose coverage is explicitly complete is marked `archived`, not deleted. An
  incomplete publication removes nothing.
- **Integrity.** Write the export's `inventoryHash` and per-table counts into
  `meta`. Provide `--verify`, which recomputes per-table hashes from the rows in
  key order and compares them with `activation.json`.
- **Rebuild.** `--rebuild` builds from scratch into a new file, for schema changes.
- Keep the FTS index updated in the same transaction.

Built-in SQLite is enough: `node:sqlite` with FTS5 (both `unicode61` and `trigram`
tokenizers) was confirmed working on Node 26.7 (SQLite 3.53.4). The auth server
already uses `node:sqlite` (`server/auth-config.ts`). The service image must run a
Node version where `node:sqlite` needs no flag; add a startup self-test that
creates an FTS5 table and fails fast if it cannot.

### 5.2 The service

New code under `server/procurement-catalog/` with its own Dockerfile. Read-only at
runtime except for activation.

On-disk layout on the VPS:

```
/srv/procurement-catalog/
  staging/<workspaceId>/catalog.sqlite          # sqlite3_rsync replica, never served
  releases/<workspaceId>/<publicationId>/
      catalog.sqlite                            # served, opened read-only
      list-opportunity.json.gz
      list-award.json.gz
  current/<workspaceId> -> releases/<workspaceId>/<publicationId>
```

Activation (operator-authenticated, called by the publisher after the sync):

1. Run `PRAGMA integrity_check` on the staging file.
2. Check `meta` against the publication ID and `inventoryHash` the publisher sent,
   and recompute the per-table hashes.
3. `VACUUM INTO` a new release directory, so the served file is a clean,
   consistent copy that later syncs cannot touch.
4. Build the two list files from `notices` (see 5.4).
5. Load the analytics inputs into memory and precompute the ten default views.
6. Switch `current` atomically and reopen. Keep the previous release; delete older ones.
7. Return a receipt: publication ID, activation time, counts, hashes, bytes received.

Any failure leaves `current` untouched.

HTTP API. Every route except `/healthz` requires a valid grant, and the workspace
in the path must equal the workspace in the grant.

| Route | Returns |
| --- | --- |
| `GET /healthz` | Liveness and the active publication IDs |
| `GET /v1/<ws>/catalog` | The current publication pointer in the shape of `ReaderCatalog` (`reader/source.ts`) |
| `GET /v1/<ws>/p/<pub>/list/<kind>.json` | The whole list for a kind, pre-compressed |
| `GET /v1/<ws>/p/<pub>/notice?key=` | Summary, detail JSON, the complete document inventory, and `removed: true` when archived |
| `GET /v1/<ws>/p/<pub>/review?key=` and `/reviews` | Review evidence for one notice, and the catalog-wide rows |
| `GET /v1/<ws>/p/<pub>/search?q=&kind=&limit=` | Record keys and snippets from the text index |
| `POST /v1/<ws>/p/<pub>/analysis` | `{request, asOf}` in, the existing `AnalysisResult` out |
| `POST /admin/activate`, `GET /admin/status` | Operator only |

- Responses under `/p/<pub>/` never change, so send
  `Cache-Control: private, max-age=31536000, immutable`. A publication ID that is
  no longer held returns 410 and the client re-reads `/catalog`.
- Analytics must call `buildAnalysis` from `shared/procurementAnalytics.ts`
  unchanged, with a small in-memory cache keyed by `analysisIdentity`. Do not
  write a second implementation in SQL.
- Returning the complete document inventory with the notice fixes the pagination
  defect where a source-only addendum disappears after the tenth stored file.
- Returning `removed: true` fixes the defect where a notice removed from the
  latest publication opens as an ordinary notice.
- No client-supplied SQL. Bound every parameter and every response size.
- CORS: an allow-list of the site origins, mirroring `pinnedSiteCors` in
  `convex/sharePointHttp.ts`.

### 5.3 Access grant

Convex stays the only authority on who may read.

- New Convex Node action `procurementCatalog:grant({societyId})`. It runs the same
  authorization the document broker relies on (`procurementReview.folder`:
  membership, `documents:read`, module enabled), then signs a short-lived ES256
  token with `node:crypto`: issuer, audience `procurement-catalog`, user ID,
  `societyId`, `folder`, expiry about 10 minutes. It returns the token, its
  expiry and the service base URL.
- The private key is a Convex environment variable. The VPS holds only the public
  key, so a compromised VPS cannot mint grants.
- The client keeps the token in memory, refreshes it at about 80% of its life and
  on a 401, and sends it in the `Authorization` header.

### 5.4 Reader

New `src/features/procurementReview/reader/httpSource.ts` implementing
`ReaderSource`:

- `useList(kind)` fetches the whole list file once per publication.
- **Do not implement `usePage`.** `CatalogBrowser.tsx` switches on its presence;
  without it the reader uses the local table path the demo already uses, which
  gives multi-sort, grouping across everything, exact counts and no scan budget.
- `useAnalysis`, `useRecord`, `useDocuments`, `useDocumentTip`, `useReview`,
  `useReviews` call the service.
- `readDocument` and `previewId` stay exactly as in `convexSource.ts`: document
  bytes still come from SharePoint through the Convex broker.

The list file must carry every field the local path reads: the `ListRow` columns,
`closingAt` and `closingDate`, `sourceRevision`, and the fields
`shared/bcBidSourceFilters.ts` matches on (`sourceId`, `opportunityTypeGroupCode`,
`industryCategories`, `sourceRegionPath`, `historicalTypeReferenceId`,
`taxonomyReleaseId`, `classificationCodes`). Confirm the local path applies those
source filters before relying on it.

Selection lives in `pages/ProcurementReviewPage.tsx` (`HostedProcurementReview`):
a per-workspace setting, for example `integrationSettings.procurementCatalogSource`
with values `convex` (default) and `service`, plus a build-time base URL.

Smoothness requirements, which are acceptance criteria and not polish:

- Keep the current list on screen while a new publication's list downloads, then swap.
- Prefetch a notice when its row is hovered or focused; keep recent notices in memory.
- Load the awards list only when Awards is first opened.
- Changing a filter, sort or grouping must not show a loading state.
- Learn about a new publication from the existing reactive `procurementStatus:get`
  and by re-reading `/catalog` on focus.
- Triage decisions from PR #88 are overlaid on the local rows by record key and
  filtered locally.

### 5.5 Publish step in Zoer

`packages/plugin-site/src/sharepoint/societyer-publication.ts` currently runs, after
the SharePoint commit: report source, export, precompute analytics, upload
sidecars, apply to Convex, upload the serving receipt, acknowledge the journal.

Add a serving mode for the catalog service that replaces the precompute and apply
steps:

1. Report the source publication (unchanged).
2. Export and verify (unchanged).
3. Run `build-catalog-db.ts` against the persistent origin file, then `--verify`.
4. Sync the origin to the VPS staging file with `sqlite3_rsync`.
5. Call `/admin/activate` and wait for its receipt.
6. Report the source as ready, upload the serving receipt to SharePoint, and
   acknowledge the journal sequence, as today.

`convex/procurementStatus.ts` currently verifies "ready" against the Convex
catalog. It needs a service path that records the service's activation receipt
instead. During the parallel run the publisher runs both serving modes.

### 5.6 `sqlite3_rsync`

`sqlite3_rsync ORIGIN REPLICA` makes the replica a copy of the origin and sends
only the pages that differ. It is an official SQLite tool that launches its remote
half over SSH.

- Build it from the SQLite source tree at one pinned version on both machines. A
  prebuilt binary was reported to need a newer glibc on some systems. It is not
  installed on the development Mac, so nothing here has been run.
- The origin is the builder's persistent file. The replica is the staging file on
  the VPS. Never serve from the replica.
- Use a dedicated unprivileged user on the VPS with one SSH key, restricted in
  `authorized_keys` to running `sqlite3_rsync` against the staging directory.
- Both files must use the same page size. Check the pinned version's journal-mode
  requirement; older versions required WAL on both ends.
- Record bytes transferred per publish in the serving receipt, so the benefit is measured.
- **Fallback to a full copy** when the replica is missing, versions differ, the
  sync fails, or activation rejects the result: `VACUUM INTO` a snapshot, compress
  it, copy it over, and activate. The full file is small enough that this is a
  normal path, not an emergency. Implement the full-copy path first and add
  `sqlite3_rsync` second.

### 5.7 VPS setup

The VPS is in Toronto with 32 GB RAM and a 480 GB SSD, with key-only root SSH.
Connection details come from the owner; they are deliberately not in this file.
This workload needs well under 1 GB of memory and a few GB of disk.

- Start with a read-only inventory (what runs there, Docker version, ports, disk)
  and get the owner's approval before changing anything.
- Create a deploy user; do not run the service as root.
- Run the service with Docker Compose: non-root user, read-only root filesystem,
  one volume at `/srv/procurement-catalog`, a health check, log rotation.
- Expose it only through a Cloudflare Tunnel. Publish no HTTP port. Keep the
  firewall to SSH only.
- Monitor `/healthz` from outside.
- No backups are needed: the service is rebuildable from the publisher's origin
  file or from a SharePoint snapshot.

## 6. Phases

| Phase | Work | Done when |
| --- | --- | --- |
| 0 | Owner confirms section 4. Read-only VPS inventory. | Decisions recorded; inventory reviewed. |
| 1 | Builder and `catalog.sqlite` schema, with tests. | The retained October export builds and `--verify` passes; a one-row change touches only a few pages. |
| 2 | Service: activation, API, analytics, text search. | It serves the October export locally; the ten default analyses equal `buildDefaultSummaries` exactly. |
| 3 | Grant action and service-side verification. | Signed-out, expired and wrong-workspace requests are refused; tests cover each. |
| 4 | `httpSource.ts` and the workspace switch. | DDC North reads from the service on desktop and at 390 × 844 with no loading state between filters. |
| 5 | VPS deployment and the Zoer serving mode: full copy first, then `sqlite3_rsync`. | A real publish reaches readers with no read pause, and the receipt records bytes sent. |
| 6 | Parallel run with a parity check. | Three consecutive publications match (below). |
| 7 | Cutover, then the Convex cleanup in section 7. | Convex holds no catalog rows and the page still works. |

Parity check (new `scripts/check-procurement-catalog-parity.ts`), comparing the
service with Convex for the same publication:

- counts per kind;
- every list row;
- every rendered notice model, using the same comparison the existing notice
  projection test uses;
- every notice's document inventory;
- the ten default analyses and a sample of filtered ones.

Also test on a real phone that 21,877 awards load and filter acceptably. If they
do not, keep opportunities local and add a paged awards endpoint.

## 7. Convex cleanup after cutover

Do this only after every workspace that uses procurement has run on the service
for the agreed retention period and parity has passed on the last three
publications. Each step is a separate release.

**Step 1: back up and stop writers.**
- Take a private `npx convex export` of production, verify it, and retain it with
  the matching SharePoint source snapshot and the last successful export directory.
- Tag the commit that still contains the import tooling. After step 4, rollback
  means re-importing from the retained export with the tooling at that tag.
- Remove the Convex apply and analytics-seed steps from the Zoer publish.
- Confirm no import is pending and no read gate is held.

**Step 2: frontend stops reading the Convex catalog.**
- Remove `useConvexReaderSource` from the hosted page and delete the `convex`
  option. Keep the demo snapshot reader.
- Leave the Convex functions deployed for this one release so tabs opened before
  the release keep working until they reload.

**Step 3: remove the functions.**
- Remove the catalog reads from `convex/procurementReview.ts` (`catalog`,
  `records`, `list`, `record`, `documents`, `documentTip`, `evidence`, `review`,
  `reviews`, `page`) and the modules `procurementAnalytics.ts`,
  `procurementAnalyticsJobs.ts`, `procurementSync.ts`, `procurementImport.ts`,
  `procurementTaxonomy.ts`. Keep `procurementMaintenance.ts` until step 4 is done.
- Keep `procurementReview.folder` and `setFolder`, `procurementReviewHttp.ts`
  (the SharePoint document broker), `procurementStatus.ts` in its service form,
  and the new grant action.
- Update the authorization inventory and the tenancy inventory that CI checks,
  and the table lists in `docs/shared-workspaces/migration-and-cutover.md`.

**Step 4: delete the data.**

Tables to empty:

| Table | Note |
| --- | --- |
| `procurementRecords` | Largest; 15 indexes |
| `procurementDetails` | |
| `procurementDocuments` | |
| `procurementEvidence` | Only if evidence moved to the service (decision 1) |
| `procurementSearch` | N-gram search projection |
| `procurementTaxonomyTerms`, `procurementTaxonomyReleases` | 89,972 terms |
| `procurementAnalytics`, `procurementAnalyticsArtifacts`, `procurementAnalyticsBundles` | |
| `procurementSyncRuns`, `procurementSyncBatches`, `procurementImportJobs`, `procurementMaintenanceLeases` | Import bookkeeping |
| `procurementCatalogs` | Replace with the service receipt held by `procurementStatus` |

Keep `procurementSourcePublications` (publication receipts) unless
`procurementStatus` no longer needs it.

How to delete:

- First deploy a schema that drops the secondary indexes on `procurementRecords`
  and `procurementSearch`. That frees the index copies at once and makes the row
  deletes cheaper.
- Delete rows in bounded batches with one worker, reusing the guarded purge in
  `procurementMaintenance.ts` and `scripts/procurement/retire-convex.ts`. Keep
  their limits (100 rows and 500 KB per transaction) and feed key ranges from the
  verified backup. The October notes record that scanning already-deleted index
  ranges exceeded Convex's system-operation budget, and that a lost CLI response
  did not mean server-side deletes had stopped.
- The existing tools refuse to delete the active generation. Add one explicit,
  operator-only entry point for this retirement that requires the workspace ID
  and the backup's SHA-256 as confirmation. Do not weaken the general guard.
- Never use `--replace-all`, and never replace the whole database to remove
  procurement.

**Step 5: remove the schema and the tooling.**
- Remove the emptied tables from `convex/tables/procurement.ts` and
  `convex/tables/procurementAnalytics.ts`, then `procurementMaintenance.ts`.
- Remove `scripts/procurement/apply-convex.ts`, `delta.py`, `retire-convex.ts`,
  `index-search.ts`, `restore-export.py`, `operator-client.ts`,
  `precompute-analytics.ts` and the seed half of `analytics-artifacts.ts`, with
  their checks.
- Keep `export-convex.py`, `integrity.py` and `verify-export.ts`: they produce
  and verify the builder's input.
- Rewrite `docs/procurement-convex-catalog.md` and
  `docs/procurement-review-operations.md` for the new flow, and update the Zoer
  publishing guide.

**Step 6: verify.**
- A fresh `npx convex export` shows zero rows in every removed table.
- The Procurement review page, document preview and download, and the PR #88
  triage actions all work for each workspace.
- Note the dashboard's storage figure after its counters catch up; they lag.

Rollback: until step 4, switch the workspace setting back to `convex`. After step
4, re-import from the retained export using the tagged commit.

## 8. Not yet verified

The implementer should check these before depending on them.

- `sqlite3_rsync`'s current flags, its journal-mode requirement at the pinned
  version, and how to restrict its remote half in `authorized_keys`.
- Whether the local table path handles 21,877 awards acceptably on a phone.
- That the local table path applies the BC Bid source filters.
- How `procurementStatus.ts` should accept a service activation receipt.
- Whether First Form uses procurement in production, and so how many workspace
  files the VPS will hold.
- That a Cloudflare Tunnel and a subdomain are available on the owner's account.
- How often publishes run, which decides how much `sqlite3_rsync` saves over a
  full copy.
- Measured sizes are from the October export; the catalog has grown since.

## 9. Pointers

Societyer:

- `src/features/procurementReview/reader/source.ts`: the `ReaderSource` contract.
- `src/features/procurementReview/reader/convexSource.ts`, `snapshotSource.ts`:
  the two existing implementations.
- `src/features/procurementReview/reader/CatalogBrowser.tsx`,
  `ServerNoticeRows.tsx`: local versus server-paged list.
- `shared/procurementAnalytics.ts`, `shared/procurementAnalyticsArtifacts.ts`:
  the analytics engine and the ten default views.
- `scripts/procurement/export-convex.py`, `verify-export.ts`, `integrity.py`:
  the verified export.
- `convex/procurementReviewHttp.ts`: the document broker and its authorization pattern.
- `convex/tables/procurement.ts`: field names to mirror.
- `server/auth-config.ts`, `docker/api.Dockerfile`: the existing Node service
  and its use of `node:sqlite`.
- `docs/procurement-convex-catalog.md`,
  `docs/procurement-journal-analytics-2026-10-23.md`: history, measurements and
  operational lessons.

Zoer:

- `packages/plugin-site/src/sharepoint/societyer-publication.ts`: the publish step to extend.
- `docs/societyer-sharepoint-publishing.md`: how publishing runs and resumes.
- `docs/catalog-change-journal.md`: the change journal and its sequence numbers.

External references:

- SQLite `sqlite3_rsync`: https://sqlite.org/rsync.html
- The "Baked Data" pattern this follows: https://simonwillison.net/2021/Jul/28/baked-data/

# Hosted procurement: Convex records, SharePoint documents

The October 18 phone report exposed a flaw in the first hosted release: it downloaded the entire 72.8 MiB compressed SQLite catalog and unpacked 459 MiB on the device. Memory pressure could reload a mobile tab; session refresh also reset workspace authorization. Incrementally downloading those same bytes would not fix the memory cost.

The hosted page now uses indexed, authenticated Convex queries. The list reads a kind's compact rows (`procurementReview:list`: no notice bodies, no search corpus; about 300 bytes a row) in pages of up to 1,000 rows or 4 MB read, showing the first rows straight away while the rest arrive, and keeps them for the visit. Sorting, filtering and search then run in the browser over the whole kind, so every column sorts and filters across the entire catalog, not one page. A notice body is fetched only when the notice opens. Document names and review/evidence rows are separately paginated; the catalog-wide insights read every published review row (`procurementReview:reviews`, pages of 500 rows or 4 MB, stopping after 5,000 rows and saying so). File bytes remain in the existing private SharePoint site, fetched through the existing workspace-scoped broker only on Download, with SHA-256 verification. The no-login demo retains its small browser snapshot.

Only opportunities and awards are imported into the versioned list/detail tables. All taxonomy terms are retained in a compact dictionary shared across generations of the same workspace and taxonomy release. The complete original SQLite snapshot remains in SharePoint, including full definitions, ancestor arrays, classification links, provenance, raw connector payloads, reference records and collector state. The active catalog records its source snapshot ID and SHA-256, so compact projections are traceable to their complete source. No unique source information is discarded. There are separate tables for list projections, notice details, document metadata, published evidence, and one active-generation pointer per workspace. No document binary or extracted document text is imported into Convex. The list's search box searches the loaded rows in memory: title, buyer, issued-for organisation, the source's reference number and the award's supplier (with the other visible columns). It is not full-text search of notice bodies or documents. The hosted interface is a native Societyer list/detail reader. The embedded plugin's SQL console, market analytics and specialized analysis dashboards remain available in the snapshot/demo build; they are not recreated as arbitrary SQL over Convex. Published reviews and evidence are available as paginated source records.

## Initial migration

Source: existing published snapshot `20261018T170258Z-1138c2082de4`, workspace `xd7g6bpdvp4p2bz1dr9h3mh3918ggdzf`. Export verifies every compressed catalog part and the assembled SQLite checksum before producing metadata. Expected counts: 120,157 records and details, 2,374 document metadata rows, 91 published review/evidence rows. This includes 3,752 opportunities, 21,877 awards and 89,972 taxonomy terms. Existing SharePoint file objects and permissions are reused.

The separate reader/publisher Entra apps, site, credential rotation, workspace folder, and Zoer publishing steps are documented in [operations](procurement-review-operations.md). No extra tenant permissions, container, SQL server, or runtime upload token is introduced.

## Publishing a future data update

These are two distinct steps: Zoer publishes files/snapshot to SharePoint, then a deployment operator imports the verified metadata into Convex. Publishing SharePoint alone does **not** change the hosted catalog. There is no automatic schedule yet.

1. Publish the current Zoer snapshot to the workspace folder using [the existing publisher procedure](procurement-review-operations.md). Wait for its successful manifest write. Keep the previous snapshot/files during rollback retention.
2. Use a clean, current Societyer checkout with dependencies installed, Python 3.9+ and authenticated Convex CLI deployment access. The existing private publisher config must stay outside Git, mode 0600. It can read the published site with its existing `Sites.Selected` grant. A metadata export directory contains procurement data; keep it private and outside Git.
3. Export (use a **new**, nonexistent output directory each time):

   ```sh
   python3 scripts/procurement/export-convex.py \
     --config "$HOME/.config/zoer/sharepoint-procurement.json" \
     --society-id WORKSPACE_ID \
     --output /tmp/societyer-procurement-NEW_SNAPSHOT
   ```

   For a deliberate re-projection of the **same** source snapshot after changing the profile or list columns, pass a new `--generation-suffix reader-v2-REVISION` (letters, digits, hyphens and underscores). Generation IDs are immutable; never append to an already-used ID. The reader caches list rows by generation, so patching an active generation in place would leave already-open clients with stale columns. A fresh compact generation plus atomic activation invalidates that cache; backed-up retirement then removes the superseded indexed copies. Unchanged content is automatically reused by the apply step.

   The default folder is `Zoer/bc-bid-monitor/WORKSPACE_ID`; use `--folder` for an approved child folder matching Societyer's setting. The exporter prefers the checksum-verified compressed `review` companion when present, falling back to the complete SQLite catalog for older publishers. It exports notice/document/evidence JSONL and `metadata.zip`, plus one `taxonomy-<contentHash>.zip` per complete compact taxonomy release, then removes its downloaded source copy. `--keep-source` retains that private local copy for a companion-only bootstrap. The original SharePoint source archive is never removed by this tool. It does not download the documents. Oversize metadata rows fail explicitly; they are not silently truncated (only the search projection is bounded).
4. Review the plan with the same command plus `--dry-run`, then import and activate against the **explicit intended deployment**:

   ```sh
   npx tsx scripts/procurement/apply-convex.ts \
     --deployment industrious-cricket-610 \
     --input /tmp/societyer-procurement-NEW_SNAPSHOT
   ```

   Unchanged hosted content reuses the active generation without importing rows or scanning the catalog again; publication/source metadata is refreshed. Otherwise the tool reserves each taxonomy release, bulk-imports it once, and verifies its exact canonical SHA-256, unique keys and count. Already verified releases are reused on later publications without another full taxonomy scan. It then refuses duplicate notice-generation appends, imports the four versioned metadata tables, verifies their counts in bounded queries, checks the workspace folder still matches, and atomically activates the pointer. Changed dictionary content under the same release ID is refused: publish a new reference release instead. Readers retain the prior generation until validation succeeds. Other workspace data is untouched. Do not use `--replace-all` or replace shared tables.
5. Open the live workspace's Procurement review page: verify the list loads every row (the toolbar counts up to the kind's total), sorting a column and a status or buyer filter, a keyword search, the Documents column's paperclips, notice details and a stored PDF. Network activity should show small Convex requests; there should be no `catalog.part-*` requests. File parts should appear only after a document download is requested. Existing clients receive the new catalog generation reactively.
6. Remove private local exports after validation. Retain rollback metadata securely for your chosen retention period. Old Convex generations are retained by default; prune explicitly with the procedure below so repeated full imports do not grow storage indefinitely.

If the CLI is interrupted during import, the backend import may still be running. Check its completion in the Convex dashboard/CLI. **Do not append that generation again.** Once complete, run the same apply command with `--activate-only`; it validates counts before activation. An incomplete generation remains invisible. For a failed partial notice generation, use guarded cleanup, then export/import afresh. A reserved but incomplete taxonomy release fails verification and cannot activate; inspect the CLI import result rather than appending it again. Keep the export directory until both imports and activation succeed.

## Retention and rollback

To roll back, keep the prior export's `activation.json`, its imported generation rows, and the matching SharePoint documents. Run `npx convex run procurementImport:activate '<the prior activation JSON>' --deployment industrious-cricket-610`. This validates counts and restores the pointer. It cannot activate another workspace's folder. All operator JSON should be passed as a literal argument or by a script using argument arrays, never interpolated into shell command text.

Retiring redundant inactive generations reclaims indexed copies without deleting unique source information. First export the production database to a private ZIP (`umask 077; npx convex export --deployment industrious-cricket-610 --path PRIVATE_BACKUP.zip`), verify it, and retain it alongside the complete SharePoint source snapshot. Backups contain confidential database/auth data and must stay outside Git. To restore the backup's formerly active generation after retirement, run `python3 scripts/procurement/restore-export.py --backup PRIVATE_BACKUP.zip --workspace WORKSPACE_ID --output PRIVATE_NEW_RESTORE_DIRECTORY`. This offline tool verifies ZIP integrity and counts, preserving every stored procurement field while removing Convex-generated IDs from the four-table append archive. In the same deployment/workspace, run the normal `apply-convex.ts` against that directory to import, validate and reactivate it. Shared taxonomy releases remain in place during retirement. The restore-preparation tool never writes to a deployment, and refuses an existing output directory. Never replace the whole production database to restore procurement alone.

The maintenance tool is dry-run by default and retains one previous generation:

```sh
npx tsx scripts/procurement/retire-convex.ts \
  --deployment industrious-cricket-610 --workspace WORKSPACE_ID \
  --backup PRIVATE_BACKUP.zip
```

With `--backup`, the plan covers only generations present in that verified backup; any later unbacked generation is left alone. After reviewing the exact generations, add `--apply`; choose `--keep-previous 0` only when a verified private backup provides rollback for all earlier generations. The tool verifies ZIP integrity and that each candidate's records/details are present, prints its SHA-256, and uses short, bounded backend action slices with progress output that refuse the active generation on every delete batch. Large deletions can make discovery queries over already-deleted index prefixes exceed Convex's system-operation budget. The verified backup supplies bounded key ranges (up to 500 keys or roughly 1 MB of source rows) instead of scanning those prefixes. Each request runs at most ten delete pages, carries continuation cursors across deletes, and verifies exhaustion of every backup range. If a CLI response is lost, inspect server completion before retrying; rerunning the retirement tool resumes from remaining inactive rows and also finds generations whose list rows were removed before their detail rows. Shared taxonomy releases and all SharePoint files/source snapshots are retained. Do not remove shared content-addressed file objects while retained snapshots reference them. Backup retention is an operator decision; these scripts do not expire backups or delete source archives.

## Updating the UI

The hosted reader is `src/features/procurementReview/reader/` (list, notice page, documents, review), mounted by `pages/ProcurementReviewPage.tsx`; backend queries are in `convex/procurementReview.ts`. The pages read through a small data-source contract (`reader/source.ts`): Convex for hosted workspaces, the bundled snapshot for the no-login demo. Open the demo's copy at `/demo/app/procurement-review?view=reader` to see exactly what a signed-in reviewer sees, on desktop and phone widths, without a deployment. What a notice shows is decided in `lib/notice.ts` (facts, deadline, status, and only those BC Bid page fields that don't repeat them) and `lib/review.ts` (Zoer's decision, AI suggestion, requirements, facts, tasks and changes); `scripts/check-procurement-notice.ts` covers both.

Updating these uses the normal Societyer build + Cloudflare Pages deploy and Convex deploy. Rebuilding the `files` plugin bundle does not change this hosted reader. Its bundle is still used by the snapshot/demo page, updated with the plugin build/sync procedure in the operations guide. Future richer hosted controls should call typed, bounded Convex queries, not reintroduce whole-catalog browser SQLite.

### Sortable dates (October 18, 2026)

The list sorts by `procurementRecords.date`. The first imports stored each source's own date text there ("Wed Oct 7, 2026 3:00 PM (PDT)", "10/05/26 2:00pm", "submissions can be received at any time"), so the newest-first order was alphabetical by weekday. The exporter now writes `date` as `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` in the source zone (from the connector's `closingAt` when it has one) and keeps the source's words in `dateText`; an unreadable date is empty and sorts last. The reader's default view, "Open, closing soonest", filters to the derived Open status and closing today or later, in ascending order. **This takes effect with the next export and import**; until then the reader reads a sortable date out of the old text where it can, and rows whose text isn't a date sort last.

### Whole-catalog list (October 18, 2026)

The list used to page 25 rows through a server query, so its sort and filters only saw one page. Each `procurementRecords` row now carries the list's own columns, written by the exporter (`project_record` in `scripts/procurement/export-convex.py`, mirrored for the demo in `reader/snapshotSource.ts`):

- `issuedFor`: whom the notice is issued for, only when that differs from the buyer;
- `reference`: the source's own number (Zoer's synthetic catalog keys are left out, as on the notice page);
- `documents`: files in the documents table that are published and available; `listedDocuments`: files the notice lists that weren't downloaded (matched by name as the notice's Documents tab matches them);
- awards: `supplier`, `value` (a number when the source's value reads as one, otherwise absent), `currency` and `procurementType`.

The former search corpus (up to 16 KB per row) is replaced with short list-column text only for already-open older reader tabs. The `records` query and its search/status indexes remain for compatibility and rollback; the new reader uses `list` and searches its loaded rows. Notice bodies and raw source payloads are never duplicated into that compatibility corpus. All the new fields are optional: rows from older imports still load, with empty documents, issued-for, supplier and value columns. **Re-export and re-import to fill them in.**

## Authentication regression and checks

Email/password sign-in now uses the requested app URL as its callback. Only an emailed verification link uses `verified=1`. Login waits for session/workspace initialization instead of flashing a sign-in form while authorization is pending. A refreshed session object with the same account/session ID no longer reruns membership initialization, and a background session refresh with an existing session no longer resets Convex auth loading. A membership lookup that exceeds 30 seconds presents a retryable error rather than an endless Authorizing page. Actual expiration, revocation, domain verification and workspace permissions still apply.

Run `npx tsx scripts/check-procurement-convex.ts`, `npm run test:auth-token`, `npm run test:auth-email-policy`, and `npm run build:ddcnorth`. The Convex regression uses the real schema and registered functions with synthetic data: the whole-kind list in bounded pages without duplicates, older imports' empty columns, catalog-wide review rows, small payloads, foreign-workspace denial, anonymous denial, read-only roles, incomplete import rejection and folder/module gates.

For the React refresh regression, start Vite in the DDC North mode and open `/scripts/fixtures/auth-refresh.html`. It uses a fake client and synthetic memberships without network credentials. Click Refresh same session, Finish refresh: Authenticated stays true, membership queries remains 1, workspace mounts remains 1. Click End session: Authenticated becomes false and the workspace disappears. It is a development fixture, not a production route.

## Live browser qualification and shared previews

The signed-in DDC North owner session was checked after rollout: initial catalog and phone-size rendering, two distinct 25-record pages, search for notice `233770`, notice details, and a real SharePoint PDF download. The downloaded PDF was 56,534 bytes with its published SHA-256. Full reload retained the session and returned 25 rows without any `catalog.part-*` or procurement blob requests. Opening `/login` while signed in returned to `/app` without an email-verification banner.

Procurement previews use the platform-wide [shared file preview dialog and pane](file-previews.md), with selected-file fetches and checksums. The DDC North broker now opts into seven-day renewable login persistence (`AUTH_PERSISTENT_SESSION_DAYS=7`); existing legacy broker policies elsewhere remain fixed by default. The browser rechecks online sessions every five minutes and on focus/reconnect; access JWTs still expire after five minutes; account/workspace checks and password-reset session revocation remain in effect.


## October 18 procurement reader release

The updated reader is live on Cloudflare Pages deployment `9fbfcff1`, frontend commit `7a50edb0` (including the hosted reader release `7f63c005`). The bundled Zoer plugin was built from clean `files` main commit `6fbf90284cf7b61d538ba27078bed29854fbc3e2`; its public JavaScript and stylesheet were downloaded from the live site and matched `source.json` hashes. A linked release checkout must resolve the shared Zoer UI to its real path, otherwise importer-specific bridge substitutions can miss their targets and pull Zoer app/demo dependencies into the bundle. `files/zoer/dashboard-config.ts` now canonicalizes that dependency path.

Production Convex `industrious-cricket-610` has the bounded review query and optional `dateText` schema field. Verified snapshot `20261018T170258Z-1138c2082de4` was reprojected into generation `20261018T170258Z-1138c2082de4-dates-v2`: 120,157 list records, 120,157 details, 2,374 document metadata rows and 91 evidence rows. All counts passed before atomic activation. The prior generation remains available for rollback; document bytes and tenant grants are unchanged.

Signed-in live checks covered the 25-record table, next-page navigation, server search for `233770`, the existing `?record=opportunity:233770` bookmark, the native Overview/Documents/Review tabs, the published Zoer AI summary, and the real two-page SharePoint PDF in the shared preview with fullscreen. At 390 × 844 the notice uses the phone layout. Initial catalog browsing requested no `catalog.part-*` or procurement file broker bytes. Source deadline wording stays distinct from the source's possibly stale Open status.

Validation passed: 750 plugin tests, plugin type check and build; procurement reader/notice/Convex tests; export projection tests; record-table utility, acceptance and inline-edit checks; file-preview regressions; full DDC North production build; portable manifest consistency. Existing invitation changes on main were preserved when integrating the reader. Convex reported the account above Free-plan limits during deployment; this release did not alter billing plans or enable paid services.

## Compact storage profile (October 18, 2026)

`review-profile.json` is mirrored in Zoer and Societyer. It defines a transport projection, not a source-deletion policy. All 89,972 taxonomy terms keep key, release, scheme, version, code, title and parent key; complete definitions and original hierarchy/provenance stay in the checksummed source archive. The 1,639 referenced terms (including ancestors) are a diagnostic count, not a filter. Taxonomy terms are indexed once per workspace/release, without a catalog generation field. Notice projection tests compare the rendered notice model against all 25,629 original notices; document and published evidence references are retained. Three pre-existing document rows whose parent notices are missing remain in the source archive and backup, rather than appearing as unreachable hosted attachments.

Zoer's normal publisher creates both the full backward-compatible SQLite snapshot and a small `review` companion, committing the manifest last. To add the companion to an existing source snapshot without recollecting or uploading binary files, use `publish:review` from Zoer with the exact verified SQLite copy; it refuses a source checksum mismatch or a concurrently changed manifest. Companion parts are content-addressed so old readers remain valid during publication. See [Zoer publishing](../../zoer/docs/societyer-sharepoint-publishing.md) in a sibling checkout.

### Data-quality findings

The source has 89,972 distinct `(releaseId, code)` taxonomy keys and no repeated keys; its size is not evidence that most terms are duplicates. The duplication was in how catalog generations and list/detail projections stored them. There are also 1,483 opportunities with identical `descriptionText` and `sourceDescriptionText`; the projection keeps one complete copy. URL-only notice deduplication would destroy information: 21,103 distinct award records share a BC Bid browse URL, and 1,373 notices point to the same CanadaBuys CSV feed. Source keys and provenance must distinguish these records. Document storage already uses content hashes: 2,374 source document references resolve to 1,806 distinct hashes (nine have no hash); repeated references do not require another binary copy.

### Verified compact rollout

The compact hosted generation `20261018T170258Z-1138c2082de4-reader-v2` is active on production `industrious-cricket-610`: 25,629 list rows, 25,629 details, 2,371 attached document references, 91 evidence rows and all 89,972 compact taxonomy terms. The dictionary's canonical SHA-256 was checked server-side before activation. A second apply reused the active generation without importing or scanning its rows. The original source snapshot remains `20261018T170258Z-1138c2082de4`, SHA-256 `1138c2082de44e7c77f938f4b87ce2ac74a514899a5fd2cb61982754101f1fe1`; its full SQLite archive and document objects were not replaced. The added compressed metadata companion is 6,504,851 bytes. Independent companion and full-source exports produced identical activation metadata.

All 25,629 rendered notice models compared equal before/after projection. Their encoded detail documents total 35,567,434 bytes versus 85,295,002 bytes previously, excluding indexes. This is a document-size measurement, not a fresh billing-dashboard GB reading. [Convex charges indexes as additional table copies](https://docs.convex.dev/understanding/best-practices/#check-for-redundant-indexes), so keeping large source payloads out of these indexed projections matters. The older search/status indexes remain deliberately for open-tab compatibility and rollback.

Cloudflare production `f79184fe` includes the restored award list columns and a legacy-bookmark redirect: `?record=opportunity:…` becomes `?notice=opportunity:…` before mounting the shared table. This prevents its inspector from taking the notice's Documents tab back to Overview. Live checks confirmed retained sign-in after reload, all 21,877 awards loaded, populated award analytics (13,231 valued rows), notice detail preservation and the original two-page SharePoint PDF in the shared fullscreen preview.

A private full database export was CRC-verified before migration. Offline restore preparation reproduced the prior active generation's 120,157 records/details, 2,374 document references and 91 evidence rows without writing them back. Retiring the two old indexed generations preserves that backup and the complete source archive. This work does not change billing; the tenant had already moved to Professional before this optimization. Existing repository-wide CI failures remain outside this storage change (the authorization gate flags `meetingTranscription.ts`, and the legal browser sweep has route-coverage/corporation-flow failures); targeted publisher, importer, restoration, query-isolation, notice, market and portable-manifest checks and production type checks/build passed.

Final cleanup was independently verified with a fresh complete database export: only the compact generation remains (25,629 records/details, 2,371 document references, 91 evidence rows), plus 89,972 shared terms and one verified release registry row. Both superseded generations are absent. Serialized procurement table data, including the new complete dictionary, is 99,928,101 bytes versus 544,514,369 bytes before (81.65% smaller, excluding index storage and the tiny catalog pointer). The pre-migration backup remains protected locally; a separate compact snapshot was CRC-verified too. These export sizes must not be described as a fresh billed-GB dashboard reading.

Maintenance lesson: a lost CLI response did not mean its server-side deletes stopped. Repeated unbounded reads at the beginning of a heavily deleted index range then hit Convex's system-operation budget. The final operator tool uses the verified backup as its generation inventory, bounds each range by source keys/bytes and preserves pagination cursors across deleted pages. Its range deletion, restart idempotence, cursor continuation and active-generation refusal have regression coverage. Empty-range verification was stopped after the full export had independently proved complete cleanup, avoiding redundant reads.

## Incremental publications and bounded browsing

Changed publications can now reuse the active storage generation. Retain the previous **successful** private export and pass it to the next verified export:

```sh
python3 scripts/procurement/export-convex.py \
  --config /secure/sharepoint-procurement.json --society-id WORKSPACE_ID \
  --output /secure/exports/NEW_PUBLICATION --baseline /secure/exports/LAST_SUCCESSFUL
npx tsx scripts/procurement/apply-convex.ts --deployment DEPLOYMENT \
  --input /secure/exports/NEW_PUBLICATION --dry-run
npx tsx scripts/procurement/apply-convex.ts --deployment DEPLOYMENT \
  --input /secure/exports/NEW_PUBLICATION
```

Alternatively, Zoer's `packages/plugin-site/bin/plan-review-import.ts --baseline LAST_SUCCESSFUL --input NEW_PUBLICATION` emits the same delta contract. These tools stream payloads and compare compact key/hash inventories locally; they do not read every production detail to discover changes. Full verification/projection of the published source still happens locally. This is incremental **Convex ingestion**, not incremental scraping or a claim that the whole source archive stops being published.

The delta contains complete new/changed rows and their previous values. Unchanged rows are not rewritten. Original source IDs distinguish notices; URL-only deduplication is forbidden. A missing row in a complete published catalog becomes an archived row, preserving its payload. A failed/incomplete scrape must not be published as an authoritative replacement. Zoer's publisher now retains all source snapshots and their per-snapshot manifests by default, and never garbage-collects document binaries. Apply a separate reviewed retention policy only after defining recovery requirements.

The importer verifies the delta's byte hash, operation count, workspace and baseline hash before starting. Internal mutations apply bounded batches with a durable sequence checkpoint. Each row's previous value is checked before replacement. Exact retries skip already committed batches. Another plan cannot acquire the same workspace while one is pending. Readers pause while a publication is incomplete, including after failure; rerun the **same command with the same private export** to resume. Do not unlock it manually or import a different plan over it. Finish verifies the resulting notice counts and taxonomy releases, then changes the publication pointer. A publication ID can differ from `storageGeneration`; retirement guards protect the latter. Keep the successful export for the next baseline and for reverse-plan recovery.

The hosted list and organisation pages fetch at most 50 candidates per query, with read budgets, indexed ordering and opaque continuation cursors. Search uses a separate n-gram candidate projection plus an exact verifier (every word, any order, accent folding, quoted phrases and compact references); ordinary filters apply to candidates before returning them. Sparse filters may return an empty batch with a continuation, so the interface explicitly offers Next rather than claiming the catalog has no matches. Open/upcoming dates and organisation/date browsing narrow the index range. Table grouping applies to the current page; sorting supports one indexed field at a time. The offline demo keeps its local whole-snapshot table.

Opening a notice no longer silently loads an entire kind to compute the organisation badge. Complete buyer and catalog analytics remain available through an explicit load action; these still read compact metadata for the selected dataset. Precomputed aggregate/cube analytics and incremental scraping itself are follow-up work, not implemented by this release. Additional browse indexes trade some storage/write overhead for bounded interactive reads; review actual index use as the supported controls change.

The design follows [Convex cursor pagination](https://docs.convex.dev/database/pagination) and the primary-key/change-tracking principles of [Airbyte incremental deduplication](https://docs.airbyte.com/platform/using-airbyte/core-concepts/sync-modes/incremental-append-deduped). We do not deploy Airbyte or Debezium; a verified snapshot diff supplies changes because these collectors do not expose a database CDC log.


For initial adoption on an existing compact generation, materialize `procurementSync:indexSearchSlice` with `{societyId, cursor:null}` and repeat with the returned cursor until `done:true`. Each slice handles at most ten bounded pages; restarting from null is safe and reuses identical index rows. Search falls back to bounded scanning until ready. Later changed-row imports maintain candidate entries atomically with their notices. This derived index trades storage for substring-compatible search without reading the whole catalog. Full-text search candidates are still checked against the exact query to reject false positives. The approach is analogous to [PostgreSQL trigram indexing](https://www.postgresql.org/docs/current/pgtrgm.html); no PostgreSQL service is introduced.

### Incremental release verification

Societyer application commit `37de00fb` (including `7a40ea44`) is deployed to DDC North Cloudflare production `b85ea037`, with the corresponding backend on production Convex `industrious-cricket-610`. Zoer publisher changes are on main at `5012b045` (feature commit `c0fbe2f9`); this operator CLI change does not require a Zoer backend/container rollout. The release also includes the shared mobile table/search and document preview improvements described in [file previews](file-previews.md).

The real unchanged-source export generated zero delta operations. A separate production check applied one existing record's exact current values, retried the same batch, and finished successfully: the applied count remained one and the complete stored record, including its ID and creation time, compared identical. The final catalog reports 3,752 opportunities, 21,877 awards, search ready, and no pending import lock. All 25,629 search projections were initialized. The publication and physical storage generation remain `20261018T170258Z-1138c2082de4-reader-v2`; no invented source publication was activated. Insert/update/archive/conflict and partial-run behavior were tested with synthetic fixtures, rather than fabricating changes in the production catalog.

Signed-in live checks at 390 × 844 covered successive server batches, clearing a no-results search without clearing the preset, the Edited marker and preset restoration, multiword `ministry forests`, and compact reference `on0037021` finding source reference `ON-003702-1`. A real SharePoint PDF rendered in the shared preview, entered fullscreen and jumped to page two. The browser's original viewport was restored; navigating to `/login` retained the session and redirected to the dashboard. Real iPhone pinch gestures were not exercised.

Targeted procurement/import/search/table/preview checks, Societyer and Convex type checks, and the DDC North production build passed. Zoer's publisher suite passed 22 tests with 166 assertions and its type check. Repository-wide authorization CI still reports the pre-existing `meetingTranscription.ts` public-entry-point classification; this is not a claim that all CI is green. New search projections and browse indexes add derived storage, so the earlier compact-export byte reduction above must not be treated as the current total billed database size.

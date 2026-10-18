# Hosted procurement: Convex records, SharePoint documents

The October 18 phone report exposed a flaw in the first hosted release: it downloaded the entire 72.8 MiB compressed SQLite catalog and unpacked 459 MiB on the device. Memory pressure could reload a mobile tab; session refresh also reset workspace authorization. Incrementally downloading those same bytes would not fix the memory cost.

The hosted page now uses indexed, authenticated Convex queries. It requests 25 small list projections at a time, searches on the server, and fetches a single notice body when opened. Pagination uses Previous/Next so device memory does not grow with every page visited. Document names and review/evidence rows are separately paginated. File bytes remain in the existing private SharePoint site, fetched through the existing workspace-scoped broker only on Download, with SHA-256 verification. The no-login demo retains its small browser snapshot.

All catalog kinds are imported, including taxonomy/reference records. There are separate tables for list projections, notice details, document metadata, published evidence, and one active-generation pointer per workspace. No document binary or extracted document text is imported. Search covers the source's title, organization and search text; it is not full-document OCR search. The hosted interface is a native Societyer list/detail reader. The embedded plugin's SQL console, market analytics and specialized analysis dashboards remain available in the snapshot/demo build; they are not recreated as arbitrary SQL over Convex. Published reviews and evidence are available as paginated source records.

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

   The default folder is `Zoer/bc-bid-monitor/WORKSPACE_ID`; use `--folder` for an approved child folder matching Societyer's setting. The exporter downloads to temporary local disk, verifies checksums, exports metadata JSONL and `metadata.zip`, then removes the SQLite copy. It does not download the documents. Oversize metadata rows fail explicitly; they are not silently truncated (only the search projection is bounded).
4. Import and activate against the **explicit intended deployment**:

   ```sh
   npx tsx scripts/procurement/apply-convex.ts \
     --deployment industrious-cricket-610 \
     --input /tmp/societyer-procurement-NEW_SNAPSHOT
   ```

   This checks that the generation has no existing rows, appends only the four procurement metadata tables, verifies their counts in bounded server queries, checks the workspace folder still matches, then updates the active pointer in one mutation. Readers retain the prior generation until validation succeeds. Other workspace data is untouched. Do not use `--replace-all` or replace shared tables.
5. Open the live workspace's Procurement review page: verify first/next page, keyword and status search, notice details and a stored PDF. Network activity should show small Convex requests; there should be no `catalog.part-*` requests. File parts should appear only after a document download is requested. Existing clients receive the new catalog generation reactively.
6. Remove private local exports after validation. Retain rollback metadata securely for your chosen retention period. Old Convex generations are retained by default; prune explicitly with the procedure below so repeated full imports do not grow storage indefinitely.

If the CLI is interrupted during import, the backend import may still be running. Check its completion in the Convex dashboard/CLI. **Do not append that generation again.** Once complete, run the same apply command with `--activate-only`; it validates counts before activation. An incomplete generation remains invisible. For a failed partial generation, use the guarded cleanup below, then export/import afresh.

## Retention and rollback

To roll back, keep the prior export's `activation.json`, its imported generation rows, and the matching SharePoint documents. Run `npx convex run procurementImport:activate '<the prior activation JSON>' --deployment industrious-cricket-610`. This validates counts and restores the pointer. It cannot activate another workspace's folder. All operator JSON should be passed as a literal argument or by a script using argument arrays, never interpolated into shell command text.

Prune an **inactive** generation only after its rollback retention expires (or to remove a failed partial import):

```sh
npx convex run procurementImport:purgeGeneration \
  '{"societyId":"WORKSPACE_ID","generation":"INACTIVE_SNAPSHOT_ID"}' \
  --deployment industrious-cricket-610
```

The backend refuses to delete the active generation and deletes bounded batches. This does not delete SharePoint documents. Do not remove shared content-addressed file objects while retained snapshots reference them.

## Updating the UI

Hosted list/detail code is in `src/features/procurementReview/pages/ProcurementReviewPage.tsx`; backend queries in `convex/procurementReview.ts`. Updating these uses the normal Societyer build + Cloudflare Pages deploy and Convex deploy. Rebuilding the `files` plugin bundle does not change this hosted reader. Its bundle is still used by the snapshot/demo page, updated with the plugin build/sync procedure in the operations guide. Future richer hosted controls should call typed, bounded Convex queries, not reintroduce whole-catalog browser SQLite.

## Authentication regression and checks

Email/password sign-in now uses the requested app URL as its callback. Only an emailed verification link uses `verified=1`. Login waits for session/workspace initialization instead of flashing a sign-in form while authorization is pending. A refreshed session object with the same account/session ID no longer reruns membership initialization, and a background session refresh with an existing session no longer resets Convex auth loading. A membership lookup that exceeds 30 seconds presents a retryable error rather than an endless Authorizing page. Actual expiration, revocation, domain verification and workspace permissions still apply.

Run `npx tsx scripts/check-procurement-convex.ts`, `npm run test:auth-token`, `npm run test:auth-email-policy`, and `npm run build:ddcnorth`. The Convex regression uses the real schema and registered functions with synthetic data: pagination without duplicates, search, small payloads, foreign-workspace denial, anonymous denial, read-only roles, incomplete import rejection and folder/module gates.

For the React refresh regression, start Vite in the DDC North mode and open `/scripts/fixtures/auth-refresh.html`. It uses a fake client and synthetic memberships without network credentials. Click Refresh same session, Finish refresh: Authenticated stays true, membership queries remains 1, workspace mounts remains 1. Click End session: Authenticated becomes false and the workspace disappears. It is a development fixture, not a production route.

## Live browser qualification and shared previews

The signed-in DDC North owner session was checked after rollout: initial catalog and phone-size rendering, two distinct 25-record pages, search for notice `233770`, notice details, and a real SharePoint PDF download. The downloaded PDF was 56,534 bytes with its published SHA-256. Full reload retained the session and returned 25 rows without any `catalog.part-*` or procurement blob requests. Opening `/login` while signed in returned to `/app` without an email-verification banner.

Procurement previews use the platform-wide [shared file preview dialog and pane](file-previews.md), with selected-file fetches and checksums. The DDC North broker now opts into seven-day renewable login persistence (`AUTH_PERSISTENT_SESSION_DAYS=7`); existing legacy broker policies elsewhere remain fixed by default. The browser rechecks online sessions every five minutes and on focus/reconnect; access JWTs still expire after five minutes; account/workspace checks and password-reset session revocation remain in effect.

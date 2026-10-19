# Societyer local-work reconciliation and procurement tables — 2026-10-19

Reconciled the saved local meeting/transcript, local AI, connector and shared UI changes onto main in an isolated checkout. The original working checkout and its patch backup remain untouched. Retained the newer authenticated cursor reader, collapsible search, shared file preview and paged transcript support when resolving conflicts.

## Procurement browsing

- Column clicks keep the newly selected ordering. Hosted browsing exposes one indexed sort; sorting is global across pages, including when searching. A search without a selected sort may use search relevance.
- The Source column remains filterable/groupable, but cannot advertise sorting by its derived label: the database has no matching source-label ordering index.
- Number and amount menus offer equal/not equal, greater/less than, inclusive comparisons and presence checks. Boolean filters need no typed value. All use the shared themed controls.
- Unique notice titles, amounts and document counts do not offer grouping. Buyer, status, source, supplier, type and dates can be grouped. Groups count loaded results, not the unseen catalog.
- The hosted reader appends 50-candidate pages on reaching the visible end. Only the current page remains subscribed. Resetting search/filter/sort/catalog discards previous pages as one unit; re-delivery replaces a page and record IDs are deduplicated.
- Filtering an indexed range can produce empty batches. At most four additional empty batches continue automatically; Load more remains available. This avoids silently scanning the entire catalog.
- Long tables use the remaining viewport height instead of a fixed 600px box. Phone cards also load on reaching the end. Virtualization keeps offscreen rows out of the DOM; documents are still fetched only for preview/download.

## Why retain the existing table

The shared engine already uses react-virtuoso, typed filters, saved views and a Convex adapter. TanStack Table is headless: its server-pagination mode still needs correctly paginated and sorted server queries. TanStack Query would overlap the existing Convex query subscriptions. Neither solves the adapter defects automatically; no new dependency was needed.

References: https://tanstack.com/table/latest and https://tanstack.com/query/latest.

## Export and access boundaries

Processor methods now use the shared authorization wrappers as well as their existing transcript-reader/human checks. Hosted processor operations are unavailable offline; device transcription remains the local path.

Workspace restoration exports do not restore sign-in delivery state, processor pairing/leases/page receipts, or the imported procurement projection. These contain deployment-bound capabilities or bindings. Procurement originals remain in SharePoint and can be re-imported. Paged transcripts must also be downloaded through the transcript workspace export; the general workspace JSON export is not a standalone backup of processor page storage. A full Convex deployment export remains the backup for those rows. No production rows are removed by this release.

## Checks

- Production frontend and Convex TypeScript build.
- 21 suites with portable access enforcement enabled.
- Meeting/transcript privacy, transfer, export, AI, connector and shared table checks.
- WhisperX queue and transfer tests, including verified ranges, cancellation, permissions and paged editing.
- Procurement regression verifies numeric ordering across cursor boundaries with and without search, and numeric threshold filters.
- Desktop and phone shared-table browser checks; live procurement verification follows deployment.

## Deploy/update

From a clean main checkout, run `npm ci`, `npm run build:ddcnorth`, deploy Convex with the production env file, then deploy `dist` to the existing Cloudflare Pages project `societyer-ddcnorth` on branch `main`. Keep credentials in the operator environment, never in Git. Record both the source commit and Pages deployment ID after rollout. The native hosted procurement reader is built with Societyer; changing it requires the Societyer build. Changes to the separate embedded Zoer plugin additionally require its build and the documented procurement asset sync before building Societyer.

## Live follow-up

- Confirmed automatic loading from 50 to 100 notices on the production site, with a 504px table filling the 773px viewport below the toolbar.
- Header filters moving saved conditions into an AND group now preserve indexed date bounds; a regression covers historical records before the matching range.
- ViewportPopover participates in the shared floating-layer stack, so nested numeric choices paint above the column menu. A pointer-selection regression passes on desktop and phone.
- A bounded empty batch offers continuation rather than claiming there are no matches in the unseen remainder.

Numeric ranges now narrow the ordering index before pagination, preserving legacy missing counts as zero. Server cursors include their query-plan identity. Older deployment cursors restart safely and clear the accumulated pages, so an open browser survives an index/range plan update. When changing the paging planner, bump its plan version.

Source reconciliation: Societyer includes the saved local meeting/AI/UI changes; Zoer workspace setup is on main (live deployment left to the separate Hostinger task at the user's request); Connect retention is on main with passing PHP 8.1–8.3/package CI, and its stable publication remains subject to the hosting/updater qualification receipt required by its README; the playbook's Zoer-only tooling and tests are on main. Original dirty checkouts remain untouched.

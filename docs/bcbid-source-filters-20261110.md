# BC Bid source filters and public tabs

The portal now accepts five independent URL-backed BC Bid filters on the opportunity list:
current type group (all 23 source choices), official industry category (Construction,
Goods, Services), official region (38 hierarchical entries), historical opportunity
type (33 choices for April 2015–December 2022), and eight-digit UNSPSC code including
its descendants. They combine with the normal table filters and search. Selecting a
historical type switches the status view to All. Historical GSIN stays separate from
current UNSPSC. Missing facts never match a selected filter.

Source filters run over each bounded authenticated Convex page before its slim rows
are returned; changing a source filter invalidates the pagination cursor. Snapshot
readers use the same predicate. Neither route downloads all taxonomy terms or full
notice bodies for filtering. The commodity input takes a known code; the complete
searchable hierarchy remains available in Zoer Taxonomy.

Publication retains official industry/region fields, current group membership,
historical IDs, observed GSIN terms, and tab coverage/text. The mirrored compact
profiles in Zoer and this repository must match. Publish a fresh source snapshot
and import it; a frontend deploy alone cannot recover omitted metadata.

Current type groups are not guessed from BPS/acronym variants. The collector uses
exact source labels or verified source-filter membership. Its enrichment action can
backfill these facts without browsing. Unknown mappings remain unknown until a
confirmed source refresh collects them.

Zoer discovers visible enabled public left-hand tabs, records available/visited/
failing tabs and preserves sanitized text from unlabelled sections such as Process
Rules. Disabled separators are skipped; no response is submitted. A tab with further
grid pages remains explicitly incomplete. Older or partial captures and changed
listings remain retryable; complete unchanged captures and existing files are reused.
Source coverage and per-tab text are shown in the portal notice once published.

Local verification: app and Convex TypeScript checks; source-filter AND/hierarchy/
unknown/historical separation assertions; procurement Convex/incremental/maintenance
checks; export/integrity tests. The pre-existing persistent operator test refuses
installed Convex 1.49.0 because its reviewed transport requires 1.42.1; normal CLI
transport remains available. No operator guard was weakened.

Deployment coordination: a November 10 dry-run against industrious-cricket-610
found uncommitted Teams meeting additions from another active chat already deployed.
Do not deploy the older backend tree over it: first consolidate that work on main.

## Verified data activation

The source publication `20261110T072046Z-93a8b25f4b47` is now served as
`20261110T072046Z-93a8b25f4b47-bcbid-filters-20261110` on
`industrious-cricket-610`. Its inventory hash is
`a70b5baa346af06486f609c55dabdd1039eb1179043964b43c5400ae2b6bdc16`.
All 6,418 incremental operations completed, with zero archives/deletes; the
post-import state is `updating: false` and its independent serving receipt is
`ready`. Counts are 3,770 opportunities, 21,877 awards, 3,008 document rows,
91 evidence rows and 89,972 taxonomy terms. Notice 235592 has all six public tabs,
the full 36,932-character Process Rules and five downloaded files in this export.
Publication reused 1,806 blobs and uploaded three new content-addressed blobs.

The verified target export at
`$HOME/societyer-backups/bcbid-five-filters-20261110/export-target` is the next
incremental baseline; keep it and the encrypted pre-import database backup.
Operator transport was tested successfully from a private isolated runtime with
the reviewed Convex 1.42.1 package. The normal application dependency remains
unchanged. DDC North build and 13 browser checks passed; First Form build is
prepared separately. Frontend/backend code deployment remains pending the Teams
coordination described above. Do not confuse the completed data activation with
that pending code rollout.

The historical continuation is running under
`workflow_run_938a1331-3b46-4c60-b356-f4a0c0b59848`; it advanced from 616 listings /
605 details to at least 627 listings / 620 details, with six completed ranges and
eleven remaining. It uses the existing saved browser and checkpoint. Its newer
rows are beyond this publication's snapshot and need a subsequent publication.

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

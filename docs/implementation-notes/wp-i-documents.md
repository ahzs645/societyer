# WP-I: documents, sources and import review

Implements the Documents / Sources / Imports audit (`findings/ui-documents.md`,
D-02…D-21 except D-01, D-05 and D-11) and schema finding A8 (document version
groups and duplicates). D-01 (PDF preview security) was already fixed in
`DocumentWorkbench.tsx`; its byte-signature guard is kept. D-05 (record-table
filter) and D-11 (Milkdown editor) belong to WP-A.

## What was built, by finding

| Finding | Change |
| --- | --- |
| D-02 originals | `src/lib/documentOpen.ts`: preview and "Open file" try, in order, a saved original restored from a backup (by version, `document:<id>`, then SHA-256), the latest uploaded version, a legacy storage file, then the external link. The preview classifies bytes by signature: PDF (blob iframe only after `%PDF-`), DOCX (docx-preview), XLSX (converted to plain tables by `src/lib/xlsxPreview.ts`, JSZip + DOMParser, text only), PNG/JPEG/GIF, TXT/CSV. Legacy `.doc/.xls/.ppt/.msg` say why they cannot render and show the text extracted at import. On the PGAIR backup the DOCX, DOC and PDF from the audit now preview from the saved original ("Showing the saved original"). |
| D-03 integrity | The detail page shows source, path, size and SHA-256, and "Saved on this device · SHA-256 matches" after hashing the restored bytes against the recorded hash. |
| D-04 hidden documents | `shared/documentCategories.ts`: open category model. Known categories match in any spelling (`financial-statement` = `Financial Statement` = `FinancialStatement`); unknown ones keep their label; only Societyer bookkeeping rows (Import Session/Candidate, Org History Source/Item) are internal. `documents:list` and `documents:reviewQueues` scan `by_society` instead of an allow-list. New documents and imported documents store the canonical key. The Documents page facet is built from the data with counts. PGAIR: 4,264 documents listed (was 3,233), including 987 "Recovered source review", 7 "Membership source review", the "Audit" note and 88 financial statements (52 + 36 lowercase). |
| D-06 destructive actions | Delete session confirms with counts from `importSessions:removalImpact` (staged records by status, already-applied records, documents created from the session, linked gaps). `removeSession` now tags those documents `import-session-removed`, replaces the dangling `importSessionId` in their content with `importSessionRemoved {id, name, removedAtISO}`, and unlinks representation gaps. Bulk approve/reject confirm with counts, high-priority and restricted counts; "approve import-ready insurance" confirms too. |
| D-07 queue | `importSessions:reviewQueue`: one queue over every session's candidates with status/kind/target/session/priority/source/search filters, facets that count the other active filters, progress (`x of N reviewed`), priority or session ordering, 50-row pages. UI `src/features/importReview/ImportReviewQueue.tsx`: keyboard `j/k` (or arrows) move, `a` approve, `r` reject, `u` back to pending, `e` edit, `n` skip, `o`/Enter open source; decisions are optimistic, the next row slides into focus and focus stays on the queue listbox. Filters are in the URL (`status`, `kind`, `target`, `sessionId`, `risk`, `origin`, `q`, `sort`, `page`); `source` stays the existing session-source filter used by Integrations links. |
| D-08 risk | `shared/importReviewRisk.ts` derives priority from legal weight of the record kind/target, missing facts per kind (meeting date, outcome, fiscal period, amounts, policy number, person, effective/adoption date, source date, readable text), restricted content the source itself states (sensitivity field, confidential/payroll/SIN/bank wording in title or path) and duplicate files staged more than once. The uniform stored `needs review` / `restricted` keyword flags are ignored; other stored flags are shown in words. |
| D-09 layout | Queue rows put Approve/Reject first (no horizontal scroll); a detail pane holds the decision buttons. Session names use `shared/importSessionLabels.ts` (`distinguishSessionNames`): the words after the prefix shared with sibling sessions, with two words of context ("…PGAIR mentioned 74"), full name in `title`. |
| D-10 provenance | The detail pane shows target, session, source system and id, file, locator (folder path, section, page), source date, SHA-256, a link to the source and to the created document, applied targets, extracted text and notes (`importSessions:getRecord` for the full record). Per-session panel shows the WP-C representation-gap summary (`representationGaps:summary.byImportSession` now also carries `open` and `infoTypes`). |
| D-12 status | `shared/documentReviewStatus.ts`: one vocabulary (`none`, `needs_review`, `in_review`, `needs_signature`, `approved`, `blocked`); `NeedsReview` and friends normalize; writers store the normalized key. Evidence statuses (`NeedsReview`, `Linked`, `Verified`, `Rejected`) share labels/tones. "Work in progress" no longer repeats "Recent" or "Action required". |
| D-13 content | `shared/documentProvenance.ts` reads the historical content shapes (top-level `sha256`, `source.sha256`, `originalSHA256`, `localPath`, `source.path`, "Original folder path:" notes…) and `readableFields` turns content JSON into labelled fields, lists, groups and small tables (e.g. roster sheets). The detail page has "Source and content", "Versions and duplicates" and "What this document feeds" (`documents:evidenceFor`: evidence rows with targets, linked meetings). Metadata-only documents no longer show an empty preview box. |
| D-14 / A8 | Schema (all optional): `documents.versionGroupKey`, `supersedesDocumentId`, `duplicateOfDocumentId`, `sourceVersionStatus` (`draft|final|approved|signed|revised`). `shared/documentVersioning.ts`: exact duplicates by SHA-256 (empty-file hash ignored), by source id (case-insensitive, e.g. both `google-drive:1Y8Z…` spellings) or an explicit mark; likely versions by file name with version words removed (dates kept, generic names ignored) or an explicit key; source status read from the name ("Final draft" is a draft). Functions `documents:versionsFor`, `markDuplicate` (cycle-safe), `clearDuplicate`, `setVersionInfo`, `mergeDuplicates` (combine tags/source ids, fill missing file fields, re-point meeting materials and source evidence, archive copies with a duplicate link; nothing deleted). Import contract: document candidates and sources may carry `versionGroupKey`, `sourceVersionStatus`, `supersedesExternalId`, `duplicateOfExternalId`; ids resolve to documents by source id; status is detected from the name when absent. PGAIR: 1,034 documents in duplicate sets, 1,061 in version groups. |
| D-15 columns | Document metadata gains Review status, Source date, Source, Version and Linked records fields and a "Review and provenance" view (default on the Documents page). Restored workspaces get them through the idempotent metadata seed, triggered once from the page for people with settings:write. Title cell hides a file name equal to the title, shows the source path and duplicate/version markers; raw source-id tags are hidden. |
| D-16 / D-21 performance | `documents:browse` returns a projection without `content`/`sourcePayloadJson`, with latest version, evidence and material counts and groups computed once (no per-row queries); the "Open" lookup happens on click. Local runtime (root causes of the 23 s load): hydration merged persisted rows into the seed with a per-row array copy (quadratic), every query result was JSON round-tripped (re-scanning ~145 MB of OCR text), every `get` scanned all tables, and every mutation deep-cloned the touched tables. Now: map-based hydration and batch apply, a JSON-equivalent clone that shares strings, an id index per table array, shallow backups. Provenance and queue projections are memoized per row and content string. |
| D-17 phone | Imports: queue filters in two columns, session list replaced by a select, Paperless scan cards collapsed, queue list and detail stacked. Documents: single-line scrollable facet rows, two-line titles. No page-level horizontal scroll at 390 px. |
| D-18 copy | The Documents import card states the real pending count across sessions; the Imports page leads with the review queue and moves the Paperless cards into "Stage records from Paperless-ngx"; apply toasts say what was created ("4 document records created", or that nothing was waiting). |
| D-19 transposed pages | `ImportCandidatesNotice` on Policies, Bylaws history, Financials, Meeting evidence and Finance imports: pending candidates and approved-but-unapplied candidates link to the filtered queue; when the register is empty, source documents of the category link to Documents (`documents:categoryCounts`). |
| D-20 evidence registers | Records archive: status filter chips with counts, per-row status select, confirmed "mark shown verified/linked", and evidence citing a staged import candidate links to the canonical document (the candidate's applied target, else the document with the same source id; `evidenceRegisters:overview` adds `sourceDocumentKind`/`canonicalDocumentId`). |
| WP-C badge | `UnsupportedDetailsBadge` on the document detail header. |

## Measurements (restored PGAIR backup, local runtime, cold load, same machine)

| Page | Before | After |
| --- | --- | --- |
| `/app/documents` first table row | 25.4 s, 446 MB heap (audit: ~23 s, 441 MB) | 6.7 s, 397 MB |
| `/app/imports` first queue row (one session before; all 6,544 candidates after) | 14.4 s, 382 MB | 5.8 s, 392 MB |
| Approve one candidate → next item focused | 1–4 s (audit) | 0.2–0.25 s |
| Reject → next item | — | 0.19 s |

Measured with `scratchpad/wpi/measure.mjs` (copy of the restored profile,
warm dev server, GC before reading `usedJSHeapSize`). The machine is shared by
several agents: the "before" run had a load average of ~16, the "after" run
~5, so part of the time difference is load. A CPU profile of the same
navigation shows the structural gain independent of load: hydration merge
(2.4 s + 0.7 s), JSON row clones (2.2 s) and table scans in `get` (0.4 s)
dropped to under 0.3 s together. The first "after" run measured 552 MB:
memoized excerpts were substring views pinning every OCR text; excerpts are
now copied (`detachString`).

## Assumptions and decisions

- Duplicates by source id use ids of the form `system:id` (Drive, Paperless,
  OneDrive…); bare tags are ignored. Identical bytes cannot be "un-duplicated";
  a person can only merge them or keep both. Likely versions can be separated
  ("Not a version of these") by giving the document its own version key.
- Merging archives copies instead of deleting them, so documentVersions and
  saved originals of a copy stay reachable.
- Detected `sourceVersionStatus` is shown with an asterisk until a person sets
  it; imports store the status the file name states.
- Review-queue bulk actions act on the rows shown (≤ 50), not on every match,
  to keep each confirmation exact.
- Queue priority: high = score ≥ 5 (legal record with missing facts or
  restricted content), medium 3–4, low ≤ 2.
- The deleted-session provenance note lives in the document content JSON; no
  new document field.
- `documents:list` keeps returning full rows (Privacy and meeting exports read
  `content`); the Documents page uses `documents:browse`.
- Hosted Convex: browse/queue still read whole rows (Convex counts document
  bytes); for very large workspaces a content side table would be needed.
  PGAIR runs in the local runtime where this is in memory.

## Gates

- `npm run test:document-categories` (`scripts/check-document-categories.ts`):
  normalization, internal detection, facets/options, review vocabulary,
  provenance shapes, readable fields, JSON-equivalent clone, portable list /
  browse (no content), queues, normalized writes.
- `npm run test:document-versions` (`scripts/check-document-versions.ts`):
  status words, name keys, duplicate/version grouping, risk, session labels,
  browse markers, versionsFor, mark/clear/set/merge, import version fields and
  supersedes resolution, cross-session queue (progress, facets, priority,
  filters, getRecord), removal impact and session-delete cleanup.
- Playwright `tests/interface-document-review.spec.ts` (synthetic bundles,
  demo harness): queue across sessions with keyboard decisions, focus and
  progress, bulk/delete confirmations naming counts; duplicates, versions,
  normalized category and merge on documents created from imports.

## Interfaces for other packages

- `documents:browse`, `documents:versionsFor`, `documents:evidenceFor`,
  `documents:categoryCounts`, `documents:markDuplicate`, `clearDuplicate`,
  `setVersionInfo`, `mergeDuplicates`.
- `importSessions:reviewQueue`, `getRecord`, `removalImpact`, `pendingByTarget`.
  The later three-pane AI-intake review screen can reuse `deriveReviewRisk`,
  `distinguishSessionNames`, `ImportReviewQueue`'s keyboard model and the
  provenance fields.
- `shared/documentCategories.ts`, `documentReviewStatus.ts`,
  `documentVersioning.ts`, `documentProvenance.ts`, `importReviewRisk.ts`,
  `importSessionLabels.ts` (pure).
- `<ImportCandidatesNotice noun targets kinds documentCategory emptyRegister />`
  for any register page fed by imports.
- `shared/portable/localRowStore.ts` exports `jsonClone`.

## Known issues outside this package

- `tests/interface-operations.spec.ts` "inventory creation and staged import
  parsing" already failed on the integration branch (it clicks the disabled
  "Create session" button with invalid JSON). The button now stays enabled and
  explains invalid JSON, mixed organizations and the ownership check; the
  spec's second step still expects a bundle without declared ownership to be
  staged without ticking the ownership confirmation, which this package keeps
  as a safeguard. The operations package should tick the checkbox in the spec.
- `npm run test:interface-route-coverage` still reports the people package's
  `/app/people-directory/:id` and `/app/people-history` (no new routes here).

## Deferred

- Insurance "renewal overdue" badges on superseded historic policies (listed in
  D-19's evidence) are not changed here: `Insurance.tsx` is owned by the
  operations package.
- Grouping the source + documentCandidate pair of one file into a single queue
  decision (audit recommendation) — the queue flags same-file candidates
  ("same file staged N×") but decisions stay per candidate.
- Search type labels in the command palette (D-14 mention) belong to the
  search/palette owner.

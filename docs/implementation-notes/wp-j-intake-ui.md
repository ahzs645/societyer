# WP-J: AI-led intake — in-app experience

Builds the user-facing intake process on top of WP-D's pipeline and
`intake:*` functions (audit §6, intake design §4.4): an intake runs page, a
three-pane review screen, promotion into native records with field-level
provenance, a reusable "View source" affordance, and links from Coverage &
gaps and Import sessions. Findings addressed: ID-07 (review UI) and the
promotion step WP-D deferred (ID-05 provenance rows, stage 11), plus the
desktop side of ID-08 (legacy formats on the desktop).

## What was built

### Intake runs — `/app/intake` (`src/pages/IntakeRuns.tsx`)

- Administration nav → **AI intake** (route identity, en/fr labels, read
  permission `settings:read`, route coverage entries).
- Sources: **Choose files** (multi-file input), **Choose folder** (File System
  Access `showDirectoryPicker`, falling back to a `webkitdirectory` input), and
  on the desktop app a native folder pick through the Electron bridge
  (`pickIntakeFolder` / `readIntakeFile`). Before a run, the selection shows
  files, size, extensions and what the junk filter will do (to extract /
  catalogue only / junk / excluded).
- Run: the row is created first (status `running`) and the shared pipeline runs
  in a **web worker** (`src/features/intake/intake.worker.ts`): junk filter →
  DOCX (jszip), PDF (pdf.js legacy build in fake-worker mode), XLSX, MSG
  (msgreader with a TextDecoder `iconv-lite` stand-in), plain text; legacy
  `.doc/.xls` through LibreOffice when the desktop bridge offers
  `convertLegacyDocument` → clusters → classification → field extraction →
  span verification → entity resolution → reconciliation and coverage. A
  progress card shows each stage with counts (files, removed as junk,
  extracted/catalogued, clusters/copies, classified/restricted, fields
  extracted, saved) and per-file errors; Cancel terminates the worker.
- Runtimes: **local / desktop** — field extraction in the worker, either the
  deterministic engine or the AI provider configured on the device (provider,
  model and base URL default from the workspace AI settings; the key is kept in
  the OS keychain through the desktop bridge or for the browser tab only;
  confirmation names the host, redaction kinds and budget; restricted files
  are never sent). **Hosted** — the worker stops after classification
  (`fieldExtraction: false`), the run is staged, then
  `intakeActions:extractRun` extracts fields server-side with the workspace
  provider (deterministic fallback) and `intake:reconcileRun` recomputes
  reconciliation, record gaps and coverage.
- Original bytes are cached on the device by SHA-256
  (`src/features/intake/originalsCache.ts`, IndexedDB) for the viewer; a
  button forgets them.
- Runs table: status, files, documents promoted, **reviewed native coverage**
  (promoted fields ÷ extracted facts) with the extraction-time estimate, record
  gaps; **Details** drawer with dispositions, classes, every file with its
  reason and restricted flag, the processing log (what was sent to which
  provider, redaction counts) and the run's record gaps.

### Review — `/app/intake/:runId/review` (`src/pages/IntakeReview.tsx`)

- **Queue (left):** grouped by risk tier (high/medium/low from legal weight,
  motions, unverified quotes, low-confidence fields) then by version cluster
  (canonical copy with drafts/format copies under it). Arrow keys move within
  the list; **J/K** documents, **N/P** fields, **A** accept, **E** edit, **R**
  reject, **C** can't represent, **B** bulk accept, **?** help. Filter: to
  review / all.
- **Source viewer (centre, `SourceViewer.tsx`):** Original (DOCX via
  docx-preview fitted to the pane; PDF via pdf.js page canvas + text layer
  with page navigation and zoom), Text/Grid (extracted blocks with real tables
  and A1 sheet grids), Versions (whitespace-insensitive word diff against
  another member of the cluster). Selecting a field highlights its locator's
  quote and scrolls to it; the quote is matched inside the locator's cell or
  block text first, so a name in a motion is not confused with the same name in
  the attendance list; bullets and split PDF text items are tolerated.
- **Native form (right, `FieldPanel.tsx`):** every field with value, confidence
  chip (relative to its bulk threshold), status (stated / inferred /
  conflicting / not stated), verification icon and locator link; grouped
  Meeting, Quorum, Attendance, Motions, Action items, Sections. Per field:
  accept, **edit** (kind-aware editors; the original value and locators stay
  in the review row and the form shows the original struck through), reject,
  **can't represent** (modal with info type, reason, description and suggested
  native target; records a `representationGaps` row at once).
- **Bulk accept:** only fields that are `stated`, have a verified span, are not
  conflicting and meet τ (per class/field, `BULK_ACCEPT_THRESHOLDS`). Scopes:
  this document, one group or one item, the **version cluster**, the **body and
  year**, or the **class across the run** (server preview
  `intake:bulkAcceptPreview`). A sample of five with quotes is shown first; the
  toast offers **Undo** for 10 seconds (`intake:undoReviews`).
- **People tab:** names and role words grouped with people-directory
  candidates (office holders on the meeting date for "Chair", "Vice
  President"); **Link all occurrences** / **Accept as written everywhere**
  apply one decision to every occurrence in the run (`intake:linkNameAcrossRun`,
  undoable).
- **Gaps tab:** the run's record gaps for the document's body and year
  (cited-but-missing minutes, draft-only, no AGM minutes) and the
  organization's record-continuity gaps for that year, with **Upload missing**
  (starts a new run named after the gap), **Mark never held…** and **Accept
  gap…** (reason required; `continuity:markPeriod` `never_held` / `waived`).
- **Log tab:** this file's processing-log entries.
- **Record bar:** readiness chips for required fields (exact date, body),
  counts, **Promote…**, **Reject document** (confirm; reopenable).

### Promotion (`intake:promoteExtraction`, `shared/intake/promotion.ts`)

- The reviewed record keeps only accepted/edited values
  (`applyReviews`); list items whose key field (attendee name, motion text,
  action text, section title) was not accepted are dropped; an attendee whose
  category was not accepted is `unknown`, never assumed present.
- A one-meeting bundle (`documentMap` for the file and its cluster members +
  one `meetingMinutes` payload, accepted sections as agenda items with item
  numbers) is created, approved and applied **in the same transaction** through
  `createFromBundle` → `applyApprovedDocuments` → `applyApprovedMeetings`; the
  import session stays as an audit trail.
- Modes: automatic (create, or merge into the same date + body), **merge into a
  chosen meeting** (candidates from `intake:mergeCandidates`; a meeting without
  minutes gets a draft minutes row; approved minutes are refused), or **always
  a separate meeting** (`meetingIdentityKey`).
- One `fieldProvenance` row per promoted field that **landed**: meetings
  (scheduledAt, times, location, electronic, type), minutes (chair, recorder,
  times, quorum, next meeting, attendance rows, action items or action
  observations, sections, decisions), motions (text, mover, seconder, outcome,
  votes …), agenda items (item numbers). On a merge only values the native
  record actually holds are attributed (`landedValue`). Rows carry
  `sourceFieldPath` (new optional column) for deep links.
- Source documents: intake files are linked to the import's source documents
  (`intakeFiles.documentId`); the original bytes are then saved as a document
  version where the runtime stores files (desktop workspace folder, hosted
  storage, demo metadata). The browser-only local runtime has no file store, so
  originals stay in the device cache and the document keeps the extracted text.
- Gaps: reviewer "can't represent" gaps and the extractor's `unsupported`
  details are linked to the meeting (deduplicated per extraction).

### View source (`src/components/SourceProvenanceButton.tsx`)

`<SourceProvenanceButton table="meetings" id={meeting._id} />` renders nothing
without provenance; otherwise a badge opens a drawer listing every promoted
field (for a meeting also its minutes and motions) with the quoted span, page /
block / cell, "edited by reviewer", and links back to the review screen at that
field. Added to the meeting detail header next to the unsupported-details badge
(one import + one line). Restricted quotes and values are withheld unless the
viewer could read the restricted file.

### Links

- Import sessions header: **Start an AI intake run**.
- Coverage & gaps header: **AI intake runs**; Native coverage tab: **Native
  coverage per intake run** (documents promoted, fields with provenance,
  reviewed coverage, extractable coverage, system gaps, record gaps).

## New functions (all `intake:` domain → settings read/write at the gate)

| Function | Kind | Purpose |
| --- | --- | --- |
| `reviewFields` | mutation | batched decisions (≤1000); can't-represent inserts a representation gap (documents:write) |
| `undoReviews` | mutation | delete reviews (undo window); removes gaps they created while still open/unlinked |
| `bulkAcceptPreview` / `bulkAccept` | query / mutation | run-scoped bulk accept (cluster, body-year, class) |
| `mergeCandidates` | query | meetings on the extraction's date, same body first |
| `promoteExtraction` | mutation | stage + apply + provenance + gaps (requires meetings/minutes/motions/documents write) |
| `provenanceForExtraction` / `provenanceForRecords` | query | provenance by extraction / by records (meeting → minutes → motions) |
| `entityCandidates` / `linkNameAcrossRun` | query / mutation | people panel |
| `getFileExtract` | query | one file's extract (version diff) |
| `runSummaries` | query | per-run promoted/extracted facts and gap counts |
| `reconcileRun` | mutation | reconciliation, record gaps and coverage after server-side extraction |

Pure modules: `shared/intake/review.ts` (field model, decisions, bulk
eligibility, queue grouping, entity groups, native targets),
`shared/intake/promotion.ts` (bundle builder), `reconcileExtractions` moved
into `shared/intake/reconcile.ts` (re-exported by the pipeline). Schema change:
`fieldProvenance.sourceFieldPath` (optional). Pipeline option
`fieldExtraction: false`; `stageRunInWorkspace(..., { runId, status,
onProgress })`.

Desktop: `electron/intake.ts` + `electron/intakeFiles.ts`, IPC channels
`societyer:pickIntakeFolder`, `societyer:readIntakeFile`,
`societyer:convertLegacyDocument` (zod-validated, local renderer authority),
bridge methods on `SocietyerDesktopBridge`. Reads resolve real paths so a
symlinked directory inside the chosen folder cannot escape it (found by the
gate and fixed).

Build: `vite.config.ts` aliases `iconv-lite` to `src/lib/iconvLiteBrowser.ts`
(browser-only; Node and Convex are unaffected) and pre-bundles the pdf.js,
msgreader, ai-sdk and docx-preview entries so a dev re-optimization never
reloads the page mid-run. `intakeActions:extractRun` is listed as an offline
no-op in the static parity ledger (the local runtime extracts in the worker).

## Verification

- Gates: `npm run test:intake-review` (`scripts/check-intake-review.ts`:
  field model, thresholds, bulk eligibility rules, applyReviews, queue,
  entities, batched reviews + undo, run-wide bulk scopes, can't-represent gap
  lifecycle, merge candidates, promotion by merge / auto / new, provenance per
  table incl. agenda items and `sourceFieldPath`, landed-value rules, source
  document linking, unsupported-detail gaps, reconcileRun, run summaries,
  roles; `scripts/check-intake-desktop.ts`: folder listing, containment incl.
  symlinks, iconv shim, highlight matching, junk preview). Both run in
  `npm run test:intake-ai`.
- Playwright: `tests/interface-intake.spec.ts` (desktop project, synthetic
  fixtures in `tests/fixtures/intake/files`): upload 3 docs → run → review →
  bulk accept (sample of 5) → edit → promote → the meeting's View source lists
  the promoted fields and the edit. `interface-routes` passes for `/app/intake`
  and the missing-run review state on desktop and phone.
- Also passing: tsc -b, convex:typecheck, lint (0 errors), static-parity,
  authorization-policy, permissioned-mutation, workspace-access,
  portable-manifest, portable-conformance-matrix (0 divergent),
  interface-route-coverage, platform-polish, representation-gaps, continuity,
  import-core, test:intake-ai.
- Browser (local runtime, port 4410), screenshots `scratchpad/shots/impl-wpj-*.png`:
  synthetic run and review (01–11, 40–46 incl. keyboard, can't represent,
  run-wide bulk scope, people, system-gap backlog, phone width); restored PGAIR
  backup with seven real originals + two junk files (20–39): 9 files → 2 junk,
  6 extracted, 1 legacy `.doc` catalogued (no LibreOffice in the browser), 2
  version clusters (DRAFT DOCX ↔ approved PDF); PDF and DOCX highlights,
  version diff, people candidates from the real directory, gaps, and a merge
  into the existing 2021-06-08 Operations meeting (the promote dialog listed
  both duplicate meetings the audit found on that date) with View source on the
  meeting. Real files stayed in the scratchpad; nothing real is committed.

## Assumptions and decisions

- **Only reviewed values are promoted.** Unreviewed fields are not written;
  the promote dialog says how many. Bulk accept is the fast path.
- **Thresholds (τ).** Defaults in `BULK_ACCEPT_THRESHOLDS` sit just above the
  deterministic engine's heuristic confidences (0.75–0.8) so only directly
  quoted values pass (date 0.9, motions 0.85, names/categories 0.8, affiliations
  0.9). Calibration from the golden set is deferred (below).
- **Promotion goes through import sessions** rather than writing tables
  directly, so meeting identity (date + body), committees, motion syncing,
  attendance screening, source versions and adoption rules stay in one place;
  the session is left as the audit trail.
- **Merging fills blanks** (existing import behaviour); provenance is written
  only for values that landed. Approved minutes are never merged into.
- **Key handling.** In a browser the device-local AI key lives only in
  `sessionStorage` for the tab; on the desktop in the OS keychain. It is never
  written to the workspace. The hosted path uses the workspace AI settings
  (secret vault) through the existing action.
- **Originals.** Cached per device by content hash. Hosted reviewers on
  another device see the text view unless the original was saved as a
  document version during an earlier promotion.
- **Existence check.** The review page decides "run not found" from
  `intake:listRuns`, because the action policy rejects unknown ids before a
  handler can return null.

## Deferred

- **τ calibration** per class/field from the golden set (ECE-based); needs a
  larger labelled set (design §4.5). Defaults are documented above.
- **Promotion of non-minutes classes** (agendas/packages, policies, financial
  statements …): WP-D has no extractors for them yet; the review UI lists their
  fields if extractions exist, but promotion is minutes-only and says so.
- **Live LLM call** from the browser/desktop: wiring (`@ai-sdk/openai`,
  redaction, budget, logging via the shared engine) is in place but no provider
  key was available here, so only the deterministic path ran live.
- **Hosted end-to-end run**: `intakeActions:extractRun` + `intake:reconcileRun`
  are typechecked and the reconcile handler is covered by the gate on the
  portable runtime; no hosted Convex deployment was available to click through.
- **OCR** for scanned PDFs (pages without a text layer are catalogued with a
  reason).
- **Restricted documents for Directors:** reading restricted extract content
  needs settings:write (WP-D rule); such a document stays on "Loading…" in the
  centre/right panes for those roles instead of a dedicated message.
- `docx-preview` rendering of headers/footers/text boxes: highlights inside
  those fall back to the Text view (the viewer says so).

## For other work packages

- `<SourceProvenanceButton table="…" id={…} />` — drop on motion, minutes,
  agenda or person pages; `intake:provenanceForRecords({ societyId, targets })`
  for custom displays.
- `fieldProvenance.sourceFieldPath` links a native field to the reviewed
  extraction field (`/app/intake/<runId>/review?e=<extractionId>&f=<path>`).
- `shared/intake/review.ts` and `shared/intake/promotion.ts` are pure and
  reusable (e.g. a CLI promotion or other classes' promoters).
- Desktop bridge: `pickIntakeFolder`, `readIntakeFile`, `convertLegacyDocument`.
- Meetings package: the meeting page shows `sourceMeetingRecord.header`
  location/date in preference to `meetings.location`, so a reviewer's edited
  location is native but not what the sidebar displays.

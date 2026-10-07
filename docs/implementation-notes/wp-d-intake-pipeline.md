# WP-D: AI-led intake pipeline (MVP, minutes spine)

This work package builds the data model, pipeline, APIs and CLI of the intake
design (audit §6; intake-design §4, §5, §9, §10) so that a folder of documents
becomes **native records plus gap items**: meetings, minutes, motions,
attendance and action items with a locator on every value, a
`representationGaps` collection for what the app cannot hold, and record gaps
for what the organization's history is missing. The three-pane review UI is a
separate package; everything it needs is exposed through `intake:*` functions.

## What was built

| Area | Files |
| --- | --- |
| Data model | `convex/tables/intake.ts` (registered in `convex/schema.ts`; exported in backups): `intakeRuns`, `intakeFiles`, `intakeExtracts`, `intakeClusters`, `intakeExtractions`, `intakeFieldReviews`, `fieldProvenance`, `intakeProcessingLog` |
| Portable functions | `shared/functions/intake.ts`, wrappers `convex/intake.ts`, registry entries, policy in `shared/functions/actionPolicy.ts` |
| LLM action | `convex/intakeActions.ts` (`extractFile`, `extractRun`) using `resolveAiRuntimeConfig` (now exported from `convex/aiChatActions.ts`) and `shared/intake/aiGenerate.ts` |
| Contract | `shared/intake/schemas/*` (zod v4): `Locator`, `FieldValue`, extraction envelope, `meetingMinutes`, agenda/package, AGM material, policy/bylaws, consent/proxy/roster, financial statement/budget, insurance, agreement/grant, registry filing, correspondence, invoice; JSON Schema export |
| Text and layout | `shared/intake/extract/*` (DOCX via jszip + OOXML with real table blocks and page numbers; PDF via pdf.js with column-aware tables, action registers and running-header removal; XLSX cells with A1 refs; MSG via `@kenjiuno/msgreader` with attachment recursion; legacy DOC/XLS/PPT/RTF via LibreOffice when present, otherwise reported unsupported), `shared/intake/node/extractFile.ts` (Node/Electron host) |
| Deterministic stages | `junk.ts`, `cluster.ts`, `classify.ts`, `parse.ts`, `verify.ts`, `privacy.ts`, `entities.ts`, `reconcile.ts`, `bundle.ts`, `pipeline.ts`, `stageRun.ts` |
| Minutes extractor | `shared/intake/minutes/units.ts`, `shared/intake/minutes/extractMinutes.ts` |
| LLM engine | `shared/intake/llm.ts` (prompting, chunking, redaction, budget, concurrency, verification) |
| CLI | `scripts/intake-run.ts` (`npm run intake:run`) |
| Gates | `scripts/check-intake-stages.ts`, `scripts/check-intake-functions.ts`, `scripts/check-intake-eval.ts` (`npm run test:intake-ai`), synthetic fixture `tests/fixtures/intake/synthetic-golden.json` + renderer `scripts/lib/intake-synthetic-fixtures.ts` |
| Bug fix | `scripts/stage-drive-audit.ts` no longer groups files by the empty-content SHA-256 (ID-03) |
| Dependencies | `pdfjs-dist` (^5), `@kenjiuno/msgreader`. XLSX is parsed with jszip (no new spreadsheet dependency). |

## Pipeline

`inventory → junk → acquire + text/layout → cluster → classify → field extraction → verify → entity resolution → reconcile → bundle + coverage`

1. **Inventory.** A local folder (recursive) or the repo's Drive inventory
   format (`scripts/inventory-public-drive.py`); files are keyed
   `local:<relative path>` or `google-drive:<id>[@<revision>]`.
2. **Junk filter.** AppleDouble `._*`, `.DS_Store`, `Icon\r`, `.LexarDataShield`
   / `.fseventsd` / `System Volume Information` trees, Office lock and temp
   files, shortcuts, zero-byte files and the empty-content hash are `junk`;
   executables and fonts are `excluded`; images, audio, design files and
   archives are `catalogue` (with a reason). On the full PGAIR listing this
   marks 2,798 of 10,196 entries as junk (the audit counted 2,808).
3. **Text and layout.** Blocks carry `page`, `sheet`, cell refs (`R2C3` / `B12`)
   and `charStart`/`charEnd` into the extract text; tables are never
   pipe-flattened.
4. **Clustering.** Exact bytes (never the empty hash), SimHash near duplicates
   and format copies, draft/final/approved/copy version families by normalised
   name, and package-embedded documents by shingle containment; each cluster
   names a canonical copy (approved/signed > final > plain > draft > copy).
   Identical and format copies are not re-extracted (`duplicate`) but stay as
   sources of the canonical meeting.
5. **Classification priors.** Class, body, date and record status from name,
   folder and the first 3,000 characters; restricted classes (payroll/HR,
   résumés, banking, contact lists, consent forms, mailboxes) are flagged.
6. **Field extraction.** Minutes use the LLM engine when a provider is
   configured, otherwise (or on any provider error) the deterministic engine.
7. **Verification.** Every locator quote is re-found in its block/cell (exact,
   then whitespace/case/punctuation-normalised); failures are
   `span_mismatch` and count toward the hallucination rate. The
   `intake:saveExtraction` mutation repeats this server-side against the
   stored extract, so a client cannot submit an unverified quote as verified.
8. **Entity resolution.** A run-level people directory is bootstrapped from
   attendance lists (spelling variants folded); short references such as
   "Avery", "T. Marsh" or "TB" resolve per document using the attendance list as
   context; office titles resolve to the holder on the meeting date when terms
   are supplied; body aliases (Board/Directors/BOD, Ops/Operations/Executive,
   AGM, committee names) and meeting keys (`body@date`).
9. **Reconciliation.** Copies of the same meeting are grouped; drafts link to the
   canonical copy; a later "adopt the minutes of <date>" motion (or, when
   undated, the body's previous meeting within ~5 months) marks the meeting
   `approved_by_motion`; actions carry forward across consecutive meetings of a
   body; policy versions link to adopting motions; record gaps are produced for
   cited-but-missing minutes, draft-only minutes and years without AGM minutes.
10. **Bundle and coverage.** See "Output" below.

## Deterministic minutes extractor

Table-aware (Agenda Item | Discussion | Action/WHO | FOR; continued tables
after page breaks; action registers Description | Assigned to | Date Due |
Status), motion grammar (MOTION:, Motion to … made by X, seconded by Y
(Carried); Moved that …; X moved/moves …; "A resolution was motioned by X,
seconded by Y, and adopted by consensus …, that …"; Moved/Seconded: A/B;
`Name (motion); Name (second)`; Mover:/Seconder: lines; outcome on the next
line or later in the section; lists closed by CARRIED; implied wording from
the agenda item), attendance by category (Present/Regrets/Absent/Staff/Guests,
inline lists, name/affiliation tables, two-column tab layouts, role-word and
organisation filtering, proxy-for, chair and note-taker annotations), header
facts (date, time range with meridiem inference, labelled and unlabelled
location, virtual meetings), call-to-order (incl. 24-hour "1206") and
adjournment times, quorum (earliest statement wins; conditional mentions
ignored), next meeting (same body first, else earliest dated), adopts-minutes
and adopts-policy references, attachments, in-camera segments, and system gaps
(consensus decisions, quorum head-counts, conditional decisions, named
dissent, conflicts, arrival/leave times, joint/cancelled meetings, month-only
dates). Every value carries a locator quoting the source line or cell.

## LLM engine

- `generateObject` (ai SDK v6) with the class zod schema; `strictJsonSchema:
  false` so optional FieldValues stay optional on OpenAI-compatible endpoints.
- Providers: the app's resolution (workspace AI settings → secret vault →
  `OPENAI_API_KEY`/`OPENROUTER_API_KEY`, OpenAI / OpenRouter /
  OpenAI-compatible) in the Convex action; `--llm openai|openrouter` with the
  same environment variables in the CLI.
- The system prompt states that the document is untrusted data between
  `<document>` tags and must never be followed as instructions.
- PII (SIN, account and card numbers, phones, emails, postal codes) is redacted
  with same-length masks before every call, so offsets and quotes stay valid
  and quotes are verified against exactly what the model saw.
- Restricted files are never sent. Per-run token budget, per-run concurrency,
  retries, chunking by blocks (60k characters) with merge.
- Every call is logged in `intakeProcessingLog` / `processing-log.json`
  (file, provider, model, redaction counts, tokens, whether anything was sent).
- No OpenAI/OpenRouter key was available in this environment, so the live
  provider path was exercised with the ai SDK's `MockLanguageModelV3` (real
  schema conversion, JSON parsing and usage accounting) and a fake model.

## Output

- `run.json`: files with dispositions, classifications and sensitivity;
  clusters; extractions (FieldValue trees with locators and verification);
  reconciliation (meetings, links, action chains); record gaps; people.
- `bundle.json`: `sources`, `documentMap` (restricted text withheld),
  `meetingMinutes` (one per reconciled meeting, carrying every copy's source
  ID, motions with `evidenceText`/`pageRef`, `detailedAttendance`, `actionItems`,
  `actionObservations` with source status, `importedSourceVersions` for
  draft/adopted versions with adoption evidence), and `representationGaps`
  shaped per findings/schema.md §5a (`infoType`, `reason`, `sourceExternalId`,
  `locator`, `excerpt`, `observedDate`, `affectedTable`, `proposedTargetTable`,
  `proposedField`, `status: open`, `reviewHistory`). Validated with
  `importBundlePreflightIssues`; until WP-B adds `representationGaps` to the
  import contract, only that key's "unsupported key" issue is tolerated
  (`validateIntakeBundle` detects when the contract supports it).
- `coverage.json`: native coverage = native ÷ (native + system-gap +
  unresolved facts) per class, body and year; dispositions; record gaps;
  hallucination rate; attendance person linkage and person-reference
  resolution.
- `processing-log.json`, `extracts/*.json` (locator targets).

The CLI refuses to write inside the repository unless `--allow-in-repo` is
passed (real records must never be committed).

## Evaluation

`scripts/check-intake-eval.ts` grades extraction output against a golden set
(golden-set.json format). It always grades the committed **synthetic** fixture
(6 documents: DOCX tables, a narrative legacy-style DOCX, a column-layout PDF,
an AGM DOCX, plain text and an action register) and fails CI below the
thresholds; with `SOCIETYER_GOLDEN_SET` it also grades a private set, reading
originals from `SOCIETYER_GOLDEN_FILES/<shaDir>/` and splitting dev/holdout
with `SOCIETYER_GOLDEN_HOLDOUT` (default `G03,G07,G11,G14`). Motions match on
content-word Dice similarity of text (and section title); names match with
alias and short-form tolerance ("Avery" ↔ "Avery Quill", "CoC" ↔ "Chamber of
Commerce (CoC)").

Deterministic engine on the 16-document PGAIR golden set (15 graded minutes;
G16 is a consent-agenda package and is not a minutes document):

| Metric | All 15 | Dev 11 | Holdout 4 |
| --- | --- | --- | --- |
| Motion recall | **100%** (44/44) | 100% (35/35) | 100% (9/9) |
| Motion precision | **100%** (0 extra) | 100% | 100% |
| Mover / seconder / outcome accuracy | 100% / 100% / 100% | 100% / 100% / 100% | 100% / 100% / 100% |
| Attendance recall / precision | 99.6% (247/248) / 100% | 99.4% / 100% | 100% / 100% |
| Attendance category accuracy (attended vs not) | 92.3% (100%) | 92.1% (100%) | 92.9% (100%) |
| Header fields (date, type, times, location, electronic, chair, recorder, call to order, adjournment, quorum, next meeting) | 99.3% | 99.1% | 100% |
| Action items recall / precision / assignee | 93.1% / 94.4% / 90.5% | 94.4% / 92.7% / 93.9% | 88.9% / 100% / 78.6% |
| Hallucination rate (quotes failing re-verification) | **0.0%** of 1,575 | 0.0% | 0.0% |

Synthetic fixture: 100% on every metric (15 motions, 34 attendees, 11 action
items, 0 of 337 quotes failing).

For comparison, the audit measured the previous regex transposition at 37
native motions for at least 164 "carried" markers across 142 meetings, with
125 meetings having no motions, and 35 of 784 attendance rows linked.

Honesty notes on the numbers:

- The extractor was tuned against dev failures only, but text dumps of all 16
  golden originals (including the four holdout documents) were read while
  designing the grammar, so the holdout split is weaker than a blind one.
- As an independent check, the raw minutes extractor was forced over all 137
  non-golden PGAIR files in the sample (including agendas, packages and AGM
  scripts): 89 motions came out and the full list was reviewed by hand. The
  remaining "carried" occurrences are almost all "carried out / carried
  forward" prose, plus one PDF export that lost its CARRIED lines. Problems
  found there ("move to quarterly meetings" read as a motion, a missing comma
  merging two attendees, a sub-item title quoted with its parent) were fixed
  with general rules, not per-document exceptions. Scripts and agendas yield
  "motions" only when the extractor is forced onto them; the pipeline
  classifies them first and does not extract them as minutes.
- The remaining category misses are staff vs present (who is secretariat
  staff needs organization knowledge: an LLM or a reviewed people directory).
- On the 153-file sample folder the CLI produced 111 bundled meetings (0
  preflight issues, 417 staged records), 126 motions, 46 record gaps (31
  draft-only minutes, 8 years without AGM minutes, 7 cited-but-missing minutes
  including the 2018-11-28 AGM and the 2010-09-28 board meeting the audit
  identified), 0 quote mismatches and
  92% of chair/mover/seconder/presenter references resolved to a person.
  Against the full Drive inventory (10,196 entries, 153 downloaded) it
  reproduced the junk/exclusion counts, left undownloaded files `pending`, and
  ran in about 75 seconds.

## Privacy

- Deterministic PII detector (`shared/intake/privacy.ts`): phones, emails,
  SIN (Luhn plus a SIN/SSN cue), account/transit numbers, card numbers (Luhn),
  postal codes; `sensitivityFor` → standard / personal / restricted.
- Restricted classes are catalogued; their extracts are never sent to a model,
  their text is withheld from the bundle's `documentMap`, and reading their
  extract/extraction content needs `settings:write`.
- Same-length redaction before any model call; per-run processing log.

## Findings addressed

| ID | Status |
| --- | --- |
| ID-01 transposition scope | Minutes spine implemented end to end (inventory → bundle) for any organization; other classes are classified, catalogued and have schemas but no extractor yet (deferred). |
| ID-02 extraction quality | Implemented: deterministic engine at 100% motion recall/precision on the golden set; LLM engine available. |
| ID-03 empty-hash dedupe | Fixed in `scripts/stage-drive-audit.ts` and guarded in clustering/junk filter. |
| ID-04 versions | Implemented: clustering with draft-of/approved-of/format-copy/package-embedded relations; reconciliation links drafts to adopted versions (`importedSourceVersions`). |
| ID-05 locators | Implemented: `Locator` on every FieldValue; `fieldProvenance` table for promoted fields. |
| ID-06 staging store | Implemented: dedicated intake tables replace JSON-in-`documents` staging for intake runs (import sessions remain the promotion path). |
| ID-07 review UI | Out of scope (separate package); backed by `intake:listExtractions` (risk-ordered queue), `intake:getExtraction` (record + blocks + reviews), `intake:reviewField`, `intake:recordProvenance`. |
| ID-08 extraction infra | Implemented for DOCX, PDF text layer, XLSX, MSG and legacy formats via LibreOffice; OCR deferred (pages without a text layer are reported in `emptyPages`). |
| ID-09 inventory completeness | Inventory completeness is surfaced by the CLI; authenticated Drive API acquisition deferred. |
| ID-10 PGAIR-specific coverage view | Coverage report is generic (per class/body/year); the page is another package's. |
| ID-11 rules | AGM-per-calendar-year rule implemented in reconciliation; cadence rules/`expectedRecords` deferred. |
| ID-12 bodies | Body aliases and committee labels resolved; joint and cancelled meetings become representation gaps. |
| ID-13 email | MSG extraction implemented (headers, body, attachments). |
| ID-14 provider | Structured-output extraction action with budget/concurrency added. |

## Assumptions and decisions

- **Permissions.** The `intake` and `intakeActions` domains map to the
  `settings` resource (as `importSessions` does): Owners/Admins run and review
  intake; Directors/Viewers can see the queue and run summaries; extracted
  content additionally needs `documents:read`, restricted content
  `settings:write`.
- **Default body.** Minutes that name no body are inferred to be the board
  (confidence 0.35), matching how societies use undifferentiated "meetings".
- **Approval evidence.** "Minutes approved" without a formal motion still links
  the previous meeting of the same body (weaker evidence, recorded as an
  approval statement rather than a motion).
- **Record status.** DRAFT and APPROVED markers that disagree are kept as a
  `conflicting` FieldValue, never silently resolved.
- **Times.** Times without am/pm are interpreted as business hours (1–6 pm,
  7–11 am) and marked `inferred`.
- **Scripts and agendas.** AGM scripts and agendas are classified but not
  extracted as minutes (their motions are proposed, not decided).
- **Size bounds.** Extract rows store at most ~850 KB of blocks; the CLI output
  keeps full extracts.

## Deferred

- Agenda/package splitting and consent-agenda extraction; policy/bylaw clause
  extraction into `bylawRuleSets`; consent/proxy term intervals; financial
  statements with arithmetic checks; agreements/grants; registry filings.
- OCR for image-only PDF pages (reported for OCR; Paperless or Tesseract would
  plug into `extractBytes`).
- Authenticated Drive API acquisition with revision IDs (the CLI accepts
  `headRevisionId`/`md5Checksum` when an inventory provides them).
- LLM adjudication of ambiguous clusters and entities; cadence rules and an
  `expectedRecords` table; promotion of reviewed fields into native tables
  with automatic `fieldProvenance` rows (the table, mutation and locator
  contract exist; the promotion step belongs with the review UI).
- A live run against a real provider (no key in this environment).

## Interfaces for other work packages

- **Review UI:** `intake:listRuns`, `getRun`, `listFiles`, `listClusters`,
  `listExtractions` (risk-ordered), `getExtraction` (record, blocks with
  offsets, reviews), `reviewField` (accept / edit / reject / cant_represent with
  a gap draft), `setExtractionStatus`, `recordProvenance`,
  `provenanceForRecord`, `processingLog`; actions
  `intakeActions:extractFile` / `extractRun`. Field paths look like
  `motions[2].movedBy`; locators match the `Locator` schema; blocks match
  `IntakeBlock` (use `toSourceMeetingBlocks` to reuse the source meeting viewer).
- **WP-B (import contract):** the bundle emits `representationGaps` rows in the
  §5a shape; when the key is added to `IMPORT_BUNDLE_COLLECTION_GROUPS`,
  `validateIntakeBundle` starts validating it automatically.
- **Coverage/gaps page:** `intakeRuns.coverage` (headline/byClass/byBody/byYear),
  `intakeRuns.recordGaps` (`missing_minutes`, `draft_only_minutes`,
  `agm_missing_for_year`), `reconciliation.meetings` (body × month statuses
  via `bodyTimeline`).
- **Staging a CLI run into a workspace:** `stageRunInWorkspace(mutation,
  societyId, run, extracts, coverage)` in `shared/intake/stageRun.ts`.

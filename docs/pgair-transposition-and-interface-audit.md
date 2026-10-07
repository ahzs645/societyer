# PGAIR transposition and interface audit

Audit date: 2026-10-06. Branch: `claude/clever-babbage-mu46rq`.

> **Follow-up:** the findings below have since been implemented and re-tested. See [pgair-implementation-status.md](pgair-implementation-status.md) for what was built, the re-transposition results and what remains open.

This is a review of the PGAIR example transposition, a full interface test pass, and a design for AI-led intake. It is analysis only: no application code was changed. Personal names from the source records are deliberately left out of this public document. The detailed per-area reports and the golden set are kept outside git because they quote personal names. See [Detailed reports](#detailed-reports).

**Terminology.** *Transposed* means a source fact landed in a **native** object or field that a user can see, filter and edit in the app: a meeting with its body, date and times; a motion with mover, seconder and outcome; attendance linked to a person; a task with an owner; a role term; a policy version. Text that is only kept in discussion, the source meeting record, notes or `sourceEvidence` is **evidence-only**, not transposed.

## Method

Nine agents worked in parallel against this checkout.

| Track | What was done |
| --- | --- |
| Fidelity | 22 originals (26 files, 2008–2023) graded field by field against the restored workspace; corpus-wide scripts over all 142 meetings; provenance of the transposition traced through the scripts |
| Schema | Every information type in the sources mapped to schema, import contract and UI input, with file:line citations from the current code |
| Intake design | The full source Drive folder inventoried with `scripts/inventory-public-drive.py`; existing intake, AI and import code studied; AI-led pipeline designed; first-pass record-gap analysis run |
| UI: meetings and minutes | PGAIR backup restored into the local IndexedDB runtime; 11 meetings checked against their originals |
| UI: people, tasks, committees | PGAIR backup |
| UI: documents, sources, imports | PGAIR backup |
| UI: governance and compliance | Demo runtime, 40+ routes, create→edit→reload→delete flows, phone viewport |
| UI: finance, operations, settings | Demo runtime, about 50 routes, 390 and 320 px viewports |
| Automated suites | Lint, typecheck, interface checks, the Playwright interface suite, and the intake, meeting and PGAIR scripts |

Caveats:

- All UI testing ran on the Vite dev server (React StrictMode) on a 4-CPU machine shared by the agents. Absolute load times are inflated, but the relative slowness and the crashes held up when re-checked with the machine idle.
- The source-folder listing came from public HTML. 13 folders returned exactly 50 entries, so their counts are lower bounds.

## Bottom line

1. **Was the transposition done poorly? Yes.** It was produced by regex rules, not AI extraction: `scripts/stage-drive-audit.ts` runs `convex/paperlessHelpers.ts`, a parser written for another organization's OCR output, and then `shared/sourceMinutesTransposition.ts` re-cuts sections. None of the 130 import sessions used the AI transposition pipeline (no `transpositionPlanId`). Part of the data (attendance, tasks, person occurrences, committees, and the source-record-v3 layer) came from scripts that are not in the repo, so it cannot be reproduced.
2. **Can it be done better? Yes, and mostly without new schema.** Most losses are method failures. The app already has fields for chair, call-to-order and adjournment times, next meeting, location, electronic participation, detailed attendance, AGM business, motion outcome, seconder and "adopts minutes", task owner and due date. The PGAIR import filled almost none of them (0 of 142 meetings for most).
3. **Is the system missing things? Yes, in specific places.** There are 18 data-model gaps, 11 interface gaps and 14 import-only losses. The most important are below.
   - Person links on motions, attendance, tasks and committees.
   - Organizational members with appointed representatives.
   - Governing body and committee as a first-class meeting attribute.
   - Per-body quorum.
   - Document version and duplicate grouping.
   - Agreements and correspondence objects.
   - Field-level source locators.
   - A structured record of what could not be represented.
   - Rules that state what records *should* exist, so that gaps can be detected.
4. **Can PGAIR's full documentation be transposed?** Not with the current pipeline. Only 2.1% of the substantive files feed native records today. A plan for the whole corpus, mapped by document class, is in [Full-corpus transposition plan](#full-corpus-transposition-plan-worked-example-pgair).
5. **AI-led intake.** The design below produces native records plus explicit gap items. LLMs are used only for classification, schema-constrained extraction, entity adjudication and semantic linking. Everything else stays deterministic and verifiable.

## 1. Transposition quality

### Corpus coverage

| Measure | Value |
| --- | --- |
| Files in the source folder | 10,196 (1,320 folders) |
| Junk (`._*` AppleDouble, `.LexarDataShield`, `Icon`, …) | 2,808 |
| Substantive files | 7,388 |
| Files feeding native meetings/minutes | 153 (2.1%) |
| Minutes files never transposed | 204 of 334 |
| Classes never transposed | 109 director consent forms, 124 policy/bylaw files, 47 financial statements, 264 agreements, all 2023–2025 Board/AGM minutes, 47 of 48 AQMP minutes |
| Empty native registers | directors, members, role holders, policies, filings, grants, bylaw rules, committee members |

### Field fidelity (22 graded originals plus corpus-wide checks)

| Area | Result |
| --- | --- |
| Motions | 37 captured vs at least 122 in the sources (164 "carried" markers); recall about 30%. 125 of 142 meetings have no motion. **0 of 37 have an outcome**; 0 correct movers; all 3 special resolutions in the sample lost; motion text runs on into the next agenda item. |
| Attendance | 48% of attendee strings are roles, organizations or fragments ("Vice President", "Public Member", "Members"). 28 meetings list "Members" as an attendee. About 25% recall of correctly-statused present attendees. One 2021 Board meeting shows six present directors as absent; a 2008 meeting shows 0 present against 15 in the source. 35 of 784 attendance rows are linked to a person. |
| Header facts | Location, electronic participation, start time, chair, recorder, adjournment and next meeting: **0 of 142**. The values were parsed into the source record but never promoted. |
| Quorum | The staging script forces `not_recorded`: 0 of the 40 meetings whose minutes state quorum show it. |
| Times | Every meeting is stored at the 12:00 UTC placeholder, which displays as 4–5 AM in BC. |
| Titles and types | 84 of 142 titles are raw filenames. 23 Executive meetings are typed Board. Section titles keep `\| ` table-pipe artifacts. |
| Duplicates and merges | Matching is on exact title and date, so draft, approved, `.doc`/`.pdf` and "copy" variants became separate meetings: 142 meetings fall on 109 dates, and 28 dates are duplicated, with 58 duplicate tasks. AGM and Board meetings held the same evening were merged twice, and one of those merges also pulled in an agenda from the following year. |
| Action items | About 386 items in "Action / WHO / FOR" table columns produced 0 owned tasks. The 351 "historical action" tasks are all To do, assigned to the workspace owner, with no due date. |
| Scaling | The failure rates are systematic. Running the same method over 3–10k files would reproduce them at the same rates. |

### Confirmed defects behind the numbers

These two were verified directly in code and data during this audit.

- **Every imported motion reads as undecided.** The parser emits the outcome `"Passed"`. `statusFromEmbeddedOutcome` (`shared/functions/minutes.ts:196-205`) only recognises carried, defeated, tabled, deferred and withdrawn, so anything else becomes status `Moved` with no outcome.
- **Motions merged into existing minutes never reach the motions table.** `shared/functions/importSessionHelpers/importSessionMergeAndApply.ts:133` writes `minutesPatch.motions` (the retired embedded field) and never calls `syncMotionsForMinutes`. In the PGAIR data, one set of minutes has 8 embedded motions and 0 `motionIds`.

Also found:

- `scripts/stage-drive-audit.ts:20` treats empty or failed downloads (the empty-content SHA-256) as duplicates of each other. Five unrelated files collapsed this way.
- `src/pages/SourceModelCoverage.tsx:20` is hard-coded to PGAIR record-ID prefixes.

## 2. Method or system? Attribution of the failures

| Failure class | Extraction method | Schema can't represent | Import drops it | UI can't edit it |
| --- | --- | --- | --- | --- |
| Motions missing, run-on, no mover | ● | | | |
| Motion outcome lost | ● (emits "Passed") | | ● (no synonym map) | |
| Merged motions invisible | | | ● | |
| Roles/orgs as attendees | ● | | | ● (no "not a person" fix on the meeting) |
| Attendance not linked to people | ● | ● (no `personId` on detailed attendance) | | ● (JSON/pipe editor) |
| Header facts empty | ● | | | ● (no Edit on meeting detail) |
| Quorum forced unknown | ● (staging script) | ● (single quorum rule per society) | | |
| Executive typed Board | ● | ● (body is not first-class) | ● (no committee key in minutes import) | ● (fixed type list) |
| Draft/approved/copy duplicates | ● | ● (no version group) | ● (title+date identity) | ● (no merge) |
| Action items not tasks | ● | ● (done Boolean, no assignee person) | ● (unknown→false) | ● (task form has no Meeting field) |
| Organization members / representatives | | ● | ● (no bundle key) | ● |
| Policies, consents, filings, agreements | ● (never routed) | ● (agreements, correspondence) | ● (several missing bundle keys) | |
| Unsupported details lost | | ● (no gap record) | ● (kept in JSON strings) | ● (PGAIR-only coverage page) |

## 3. What is missing from the system

### A. Missing from the data model

| # | Gap | Suggested shape | Where |
| --- | --- | --- | --- |
| A1 | Person link for motion mover/seconder, detailed attendance, task assignee, committee members, conflicts | `movedByPersonId`, `secondedByPersonId`, `personId`, `assigneePersonId` → `peopleDirectory`; `conflicts.directorId` optional | `convex/tables/meetingWorkflow.ts:74-79`, `meetings.ts:106-114`, `policies.ts:34,179`, `people.ts:137-147` |
| A2 | Organization as member, with representative seat and term | `members.memberKind` + `organizationName`; `organizationSeats.memberId`, observation `personId/termStart/termEnd` | `people.ts:16-31`, `reviewEvidence.ts:4` |
| A3 | Per-body quorum (general, board, each committee) | `bylawRuleSets.bodyQuorumRules[]`, `committees.quorumRule` | `policies.ts:76-131`, `people.ts:121-135` |
| A4 | Committee kind, parent body, effective-dated mandate/terms of reference | `kind`, `parentBody`, `mandateVersions[{effectiveFrom, documentId, cadenceRule, quorumRule}]` | `people.ts:121-135` |
| A5 | Agreements and contracts | new `agreements` table: parties, term, value, signatories, deliverables, renewals | new `convex/tables/agreements.ts` |
| A6 | Correspondence (email, letter) | new `correspondence` table plus `.msg`/`.eml` parsing | `convex/tables/communications.ts` |
| A7 | Programs and projects | `programs` table; `programCode` becomes `programId` in budgets and grants | new |
| A8 | Document version group, supersedes, duplicate-of, source status | `versionGroupKey`, `supersedesDocumentId`, `duplicateOfDocumentId`, `sourceVersionStatus` | `documents.ts:8-35`, `policies.ts:5-27` |
| A9 | Agenda item number, requested action, clock time, consent flag | `itemNumber`, `requestedAction`, `scheduledTimeText`, `consent` | `meetingWorkflow.ts:23-41` |
| A10 | Consent-agenda outcome "received" | add `received` | `shared/evidenceReview.ts`, `MeetingEvidenceCard.tsx:11` |
| A11 | Named abstainers, dissenters, dissent reports (the bylaws retain dissenting reports) | `abstainedBy[]`, `opposedBy[]`, `dissentDocumentId` | `meetingWorkflow.ts:104-107` |
| A12 | Action status beyond done/not done | shared `status` enum with `actionObservationValidator` | `meetings.ts:144-152,236-243` |
| A13 | Meeting date precision and local times | `scheduledAtPrecision`, `localStartText`, `localEndText`, `timeZone` | `meetings.ts:11` |
| A14 | Representation-gap record (system gaps) | `representationGaps` table, see section 4 | new |
| A15 | Governance expectations (cadence, terms, filings) | `governanceExpectations` table, see section 4 | `convex/tables/compliance.ts` |
| A16 | Several scheduled next meetings | `nextMeetings[{at, bodyKey, location}]` | `meetings.ts:246-248` |
| A17 | Signing-authority amount tiers | `tiers[{minCents, maxCents, signaturesRequired, roles[]}]` | `people.ts:102-119` |
| A18 | Meetings of external bodies attended | `hostBody: "external"`, `externalOrganization` | `meetings.ts:5-47` |

Also needed: meeting states `cancelled` and "evidenced, minutes missing", plus a model for a fiscal-year-end change.

### B. Missing from the interface (the schema supports it, but there is no form)

| # | Gap | Where |
| --- | --- | --- |
| B1 | Society-facing editor for organization members and their representatives (today only in Legal Operations) | `src/pages/LegalOperations.tsx:82-89`, `Members.tsx` |
| B2 | Seat and proxy forms use raw IDs and are append-only | `src/components/MembershipEvidenceCard.tsx:16-18` |
| B3 | Consent items use raw minutes and document-version IDs | `MeetingEvidenceCard.tsx:11` |
| B4 | Detailed attendance is edited as JSON or pipe-separated text | `MeetingDetailSupport.tsx:147-149` |
| B5 | Attendance records can't be edited from the meeting page | `MeetingDetail.tsx`, `EvidenceRegisters.tsx:197` |
| B6 | Task form has no Meeting field (`tasks.meetingId` exists) | `src/features/tasks` |
| B7 | No input for financial statements "presented at" a meeting | `src/pages/Financials.tsx` |
| B8 | Meeting type list fixed to Board/Committee/AGM/SGM | `MeetingFormFields.tsx:318` |
| B9 | No structured editors for per-body resolution types and membership rule versions | `BylawRules.tsx` |
| B10 | Committee members link only to directors; no joined/left dates | `CommitteeDetail.tsx` |
| B11 | Coverage page is PGAIR-specific | `SourceModelCoverage.tsx:20` |

Found by the UI testers (details in section 7):

- the meeting detail page has no Edit action;
- duplicate people and duplicate meetings can't be merged;
- a "not a person" correction does not update the meeting's attendee count;
- the rich-text editors don't load, so discussion and motion text can't be edited.

### C. Import-only loss (the schema and UI support it, the import contract drops it)

| # | Dropped | Where |
| --- | --- | --- |
| C1 | Motion outcome synonyms (passed, approved, adopted, "carried unanimously", "no objection") | `shared/functions/minutes.ts:184-205` |
| C2 | Motions merged into existing minutes | `importSessionMergeAndApply.ts:133` |
| C3 | `motions.adoptsMinutesId` ("adopt the minutes of …") | `importSessionNormalize.ts:58-78`, `importSessions.ts:497,590` |
| C4 | `decidedBy`, `sectionIndex`/`sectionTitle`, `resolutionType` on the motion-record path | `importSessions.ts:497-505` |
| C5 | Meeting body / `committeeId` | `importSessionNormalize.ts:80-119`, `importSessions.ts:559`, `inferMeetingType` in `importSessionRecordKinds.ts:262` |
| C6 | Agenda presenter, time allotted, depth (titles only) | `importSessionMergeAndApply.ts:1728-1765` |
| C7 | Section `motionId`, `linkedTaskIds`, `publicVisible`, `depth` | `importSessionNormalize.ts:170-184` |
| C8 | Unknown action status becomes `false`; missing attendance status becomes `present` | `importSessionNormalize.ts:158,200` |
| C9 | Policy adoption links | `importSessionMergeAndApply.ts:854-875` |
| C10 | Grant requirements, use of funds, timeline, key facts, contacts | `importSessionMergeAndApply.ts:509-539` |
| C11 | No bundle key for committees, committee members, members, directors, tasks, goals, commitments, funding sources, grant reports, meeting materials, organization seats, conflicts, proxies, bylaw rule sets, budgets | `importSessionRecordKinds.ts:25-90`, `importBundlePreflight.ts:4-24` |
| C12 | Financial statements "presented at" meeting | `importSessionMergeAndApply.ts:453-468` |
| C13 | Motion `voteSummary`, `pageRef`, `evidenceText` (only in `draftTranscript` JSON) | `importSessions.ts:615-624` |
| C14 | Meeting status forced to "Held", including for scripts and agendas | `importSessions.ts:570` |

## 4. Identifying gaps

Gap identification should be a first-class output of intake, in two senses.

### 4a. System gaps: what the app cannot represent

Today the only channel is an untyped `sourceEvidence` row with a `targetTable`, no `targetId`, and notes. PGAIR has 3,591 of them. A gap can't be counted, triaged, linked to the record it affects, or closed.

Proposal: a `representationGaps` table.

- **Fields:** `infoType` from a controlled list; `reason` (`no_schema_field`, `no_import_key`, `import_dropped`, `no_ui_input`, `identity_unresolved`, `ambiguous_source`); source document plus a structured `locator` (page, section, sheet, cell, line range, sha256); `excerpt`; `affectedTable`/`affectedId`; proposed target table, field and value; `status` (`open`, `kept_as_text`, `resolved_native`, `schema_change_requested`, `wont_fix`).
- **Fed by:** extraction `unsupported[]` output, preflight losses (preflight should *emit* rows rather than only print issues), normalizer discards, and reviewer "can't represent" clicks.
- **Surfaced as:**
  - a generic Gaps page, replacing `SourceModelCoverage.tsx`;
  - an "N unsupported details" badge on meeting, motion, person, committee and document pages;
  - a per-import-session summary;
  - an aggregated product backlog grouped by suggested target.

PGAIR candidates already visible:

- consensus-then-vote decisions and dissenting reports;
- conditional decisions ratified later by email;
- quorum gained part-way through a meeting;
- organization-seat representatives serving as directors;
- signing-authority tiers;
- a fiscal-year-end change;
- joint "AGM & Board" meetings;
- cancelled meetings;
- annual meeting schedules that should create expected-meeting rows.

### 4b. Record gaps: what the organization's own history is missing

Existing pieces can't express expectations:

- `committees.cadence` is a display label;
- `commitments` and `deadlines` only roll forward;
- `annualCycle` evaluates one year at a time and reads the empty members/directors registers;
- `bylawRuleSets` has no board or committee cadence and no term rules;
- nothing generates expected filings.

Proposal:

- **`governanceExpectations` table:**
  - which body it applies to and what kind of record (meeting, AGM, annual filing, financial statement, role term, policy review, insurance term, funder report);
  - a frequency or term rule;
  - effective dates;
  - the authority document and its locator.
- **`continuityGaps(societyId, from, to)` query:** expands each rule into expected periods and matches them against native records. Each period gets one status: `satisfied`, `record_missing`, `source_only`, `cancelled`, `never_held` or `not_applicable`.
- **Where it shows:** a body × month/year "record continuity" heat-map; dashboard rules for AGM held, annual report filed, minutes approved and director consent on file. "Evidence missing" is always reported separately from "not done".
- **Cross-reference resolver:** each extraction's `references[]` (prior minutes, reports, attachments, policies, agreements) is matched against native records. Anything unmatched becomes a record gap that links back to the sentence that cites it.

First-pass record gaps for PGAIR, computed from the inventory and the workspace:

1. **No AGM records for 2017 or 2018** (no minutes, agenda, notice or script). The bylaws require an AGM every calendar year. The 2019 AGM adopts minutes of a November 2018 meeting that are not in the folder.
2. **No minutes for any body in calendar 2018.** 2017 Operations has an October agenda but no October–December minutes.
3. **A 2010 Board meeting adopts the minutes of a September 2010 meeting**, but no file or folder exists for that date.
4. **51 meeting folders have an agenda, package or notes but no minutes.** Two of them are labelled "cancelled", which needs a cancelled state rather than a gap.
5. **Draft-only minutes:** the 2014, 2021, 2022 and 2023 AGM minutes exist only as drafts, and 33 meetings in total exist only as drafts. Approval can only be inferred from the next meeting's "adopt minutes" motion.
6. **Annual-report filing evidence** exists only for 2016 and 2024 (plus two undated confirmations). 2009–2015 and 2017–2023 have none in the folder. This is "evidence missing", not "not filed".
7. **Financial statements are absent for six years.** The fiscal year end changed from July 31 to December 31, and no AGM approval of the transition was found.
8. **Directors before 2019 appear only in minutes**, with no consent or appointment record, and no term intervals exist anywhere.
9. **Bylaw versions and versioned policies have no linked adoption motion.** This covers 5 bylaw versions, plus the signing authority and terms-of-reference documents.
10. **34 minutes reference "attached", "as circulated" or appendix items** that are not linked to any document.

## 5. Full-corpus transposition plan (worked example: PGAIR)

| Class (files) | Native targets | Estimated native facts | Blocked today because |
| --- | --- | --- | --- |
| Minutes and meeting notes (411, about 300 unique) | meetings, minutes, agenda items, motions, person-linked attendance, tasks, committees | ~300 meetings, ~1,200 motions, ~3,500 attendance, ~1,000 actions | Regex extraction; no action carry-forward; tasks lack source assignee and status history |
| Agendas and packages (388) | agendas, meeting materials, "meeting held, minutes missing" | ~200 meetings evidenced | No package splitter; no "minutes missing" state |
| AGM material (112) | AGM runs, notices, elections (proposed), linked financial statements | 17 fiscal years | AGM records are not built from imports |
| Director consents, proxies (144) and rosters (121) | role assignments, role holders, seats, proxies, people | ~110 terms, ~35 proxies | No directors/members import kinds; role intervals never derived |
| Bylaws, constitution, policies (124, about 25 versions) | policies (versions), bylaw amendments, bylaw rule sets, adopting motion | 5 bylaw versions, ~20 policies | Policy import unused; no clause-to-rule extraction; no adoption link |
| Registry filings (6 plus `.msg` confirmations) | filings, deadlines | ~17 annual reports expected | No `.msg` extraction |
| Financial statements and budgets (150) | financial statement imports, budget snapshots | 24+ versions | Fiscal-year-end change has no model; ledger posting intentionally gated |
| Invoices, receipts, bank (306) | transaction candidates (restricted) | ~250 | Import kind unused; many scans |
| Insurance (68) | insurance policies | 23 terms | Works today (staged) |
| Agreements (264) and grants (151) | grants (extended), new agreements, deadlines, commitments | ~60 agreements, ~40 grants | Grant promotion copies only core fields; no agreements object |
| Plans and workplans (266) | goals, commitments | ~30 | No import kind |
| Correspondence (177) and `.msg` (104) | evidence plus extracted decisions and commitments | low | `.msg` not extracted |
| Reports, presentations, reference (~1,300) | document library, meeting-material links | catalogue | Fine as a catalogue |
| Media, fonts, design (2,000+) | catalogue or exclude | — | Out of scope |
| Junk (2,808) | exclude | — | — |

Suggested order:

1. Governance spine: bodies, people, minutes, motions, director terms.
2. Constating documents: bylaws, policies, filings.
3. Finance: financial statements, budgets, insurance.
4. Agreements and grants.
5. Catalogue the rest.

## 6. AI-led intake design

**Principle.** Every source fact becomes exactly one of:

1. a native field value with a source locator;
2. a system gap;
3. a deliberate out-of-scope or junk disposition.

Record gaps are computed separately from rules and cross-references. The headline metric is **native coverage = native facts ÷ (native + system-gap + unresolved facts)**, per class, body and year. It is not "documents read".

### Stages

| # | Stage | Engine |
| --- | --- | --- |
| 0 | **Acquire**: Drive API listing with revision IDs and checksums; export Google-native files; store binaries | Deterministic |
| 1 | **Junk filter**: AppleDouble, OS files, zero-byte and empty-hash files, fonts, caches | Deterministic |
| 2 | **Text and layout extraction**: DOCX blocks with real tables (no pipe-flattening), PDF text with page numbers, OCR fallback, XLSX cells, MSG body and attachments, DOC via LibreOffice | Deterministic (OCR model) |
| 3 | **Dedupe and version clustering**: exact hash (excluding empty), near-duplicate text, filename normalisation; LLM tiebreak for draft/approved/copy | Deterministic first, LLM for ambiguous clusters |
| 4 | **Classify**: class, body, date and precision, record status | Small LLM with path/filename priors |
| 5 | **Extract**: schema-constrained JSON per class, with a locator and confidence on every field | LLM (larger model for minutes, bylaws, financial statements) |
| 6 | **Validate**: re-find each quoted span at its locator; type, date, money and arithmetic checks | Deterministic |
| 7 | **Entity resolution**: people (including "Vice President" resolved to the office holder on that date), organizations, bodies, meetings | Deterministic blocking, then LLM adjudication, then the human queue |
| 8 | **Reconcile**: draft vs approved (approved wins when a later "adopt minutes" motion exists); action carry-forward; role intervals; policy version → adopting motion; financial statement version → AGM approval | Deterministic joins plus LLM semantic matching |
| 9 | **Gap generation**: system gaps from `unsupported[]` and promotion losses; record gaps from the rule engine | Deterministic, with LLM-written explanations |
| 10 | **Review queue** ordered by legal weight × (1 − confidence) × conflict | Deterministic |
| 11 | **Promote**: idempotent writes through the existing `applyApproved*` handlers, with a `fieldProvenance` row per field | Deterministic |

Source text is never treated as instructions.

### Output contract (abbreviated)

```jsonc
"Locator":    { "fileId": "google-drive:<id>@<revision>", "kind": "block|page_text|cell|email_header|filename|path",
                "blockIndex": 0, "page": 0, "sheet": "", "cell": "B12", "charStart": 0, "charEnd": 0, "quote": "≤400 chars, re-verified" },
"FieldValue": { "value": "…", "status": "stated|inferred|not_stated|illegible|conflicting", "confidence": 0.0, "locators": [] },
"Extraction": { "fileId": "", "docClass": "", "schemaVersion": "", "model": "",
                "record": {},                       // per-class schema of FieldValues
                "unsupported": [ { "description": "", "locators": [], "suggestedTarget": "motions.dissentingReport",
                                   "category": "no_field|no_table|no_relationship|no_ui_edit|lossy_normalization" } ],
                "references":  [ { "kind": "prior_minutes|report|attachment|policy|agreement|filing|person_role", "text": "", "date": "", "locators": [] } ] }
```

The meeting-minutes record covers:

- **header:** `body`, `meetingType`, `date`, start and end times, `location`, `electronic`, `recordStatus`, `chair`, `recorder`;
- **attendance:** name as written, role, affiliation, and a category (present, regrets, absent, staff, guest, proxy-for);
- **quorum:** what the minutes state, the count, and checkpoints;
- **sections:** number, title, presenter, report references;
- **motions:** text, mover, seconder, outcome, votes, by-consensus flag, which minutes or policy it adopts, conditional flag, section reference;
- **action items:** text, assignee as written, due date, status as written, carried-from reference;
- **next meeting and attachments referenced.**

There are equivalent schemas for agendas and packages, AGM material, bylaws and policies (with clause-to-rule extraction into `bylawRuleSets`), consents and proxies, financial statements and budgets (with cell locators), insurance, agreements and grants, registry filings, correspondence (evidence-only by default), and invoices.

### Review UI

A three-pane review screen at `/app/intake/:runId/review`:

- **Left:** a queue grouped by risk tier and by version cluster.
- **Centre:** a source viewer (DOCX render, PDF page with text layer, XLSX grid) that highlights the locator span; version clusters can be shown as a diff.
- **Right:** the native target form with a confidence chip, status and locator link on every field.

Actions:

- **Per field:** accept, edit (the original and its locator are kept), reject, or "can't represent", which files a system gap.
- **Bulk accept:** applies to fields that are `stated`, have a verified span, have no conflict, and have confidence ≥ τ. τ is calibrated per class and field on the golden set. Bulk accept shows a sampled preview and an undo window.
- **Entity panel:** each identity decision is accepted once and applied everywhere it occurs.
- **Gap panel:** for the current body and year, with the actions "upload missing file", "mark never held, with reason" and "accept gap".

### Evaluation

- **Golden set:** a 16-document golden set was built during this audit, with expected native records, 44 motions with mover, seconder and outcome, and 72 tasks with owner and due date. It should grow to about 120 documents across all classes. It names real people, so it is kept outside this public repository.
- **Metrics:**
  - classification macro-F1;
  - per-field precision and recall;
  - **motion recall ≥ 0.95**;
  - attendance-to-person link precision;
  - hallucination rate (quotes failing re-verification) < 0.5%;
  - confidence calibration;
  - clustering pairwise F1;
  - record-gap precision;
  - reviewer minutes per document.
- **Gate:** the evaluation runs on every prompt, schema or model change (`scripts/check-intake-eval.ts`).

### Privacy

- **Restricted classes are catalogued only by default:** contact lists, payroll and HR, bank statements, `.msg` mailboxes, and director consent forms with home addresses.
- **Before any model call:** account numbers and SINs are redacted, and restricted extracts go to a zero-retention endpoint or a local model.
- **Contact values** are stored only in `personContactPoints`.
- **A per-run processing log** records which files went to which provider.

### Cost and time for this corpus (estimates; verify prices before budgeting)

| Item | Estimate |
| --- | --- |
| Text volume | About 11M tokens. About 1.9k files need full extraction. |
| Model cost, small model | About $15–25 |
| Model cost, frontier model | About $100–200, or $40–60 if only the hard 15% is escalated |
| Unattended runtime | About 1.5–2 hours |
| Human review | About 15–25 reviewer-hours. This is the real cost. |

### What is missing in code today

1. `convex/tables/intake.ts`: `intakeRuns`, `intakeFiles`, `intakeExtracts`, `intakeClusters`, `intakeExtractions`, `intakeFieldReviews`, `intakeGaps`, `fieldProvenance`. These replace the use of `documents` rows as JSON staging (6,544 "Import Candidate" documents in PGAIR).
2. `shared/intake/schemas/*.ts`: zod schemas per class, shared `Locator` and `FieldValue`, and a JSON-schema export for offline agents.
3. An extraction worker (server and Electron): DOCX with tables as blocks, PDF plus OCR, XLSX cells, MSG, DOC. `SourceMeetingBlock` gains page, cell and character offsets. The repo has no PDF, DOCX, XLSX or MSG extraction today, and AI attachments are capped at 32 KiB of text.
4. `convex/intakeActions.ts`: batch classify and extract with structured output, concurrency limits, a budget, and provider privacy per sensitivity. `convex/aiChatActions.ts` is chat-only.
5. `shared/intake/reconcile.ts`: clustering (with the empty-hash fix), draft→approved linking, action carry-forward, role intervals, policy→motion links.
6. New import kinds: directors/members, committees and committee members, tasks with source assignee and status history, agreements, written resolutions, proxies, expected meetings. Grant promotion extended.
7. `shared/expectedEvents.ts` with an `expectedRecords` table, cadence fields on `bylawRuleSets` and `committees`, and meeting states `cancelled` and "evidenced, minutes missing".
8. UI: `IntakeReview.tsx` (three-pane) and `CoverageGaps.tsx` (heat-map, record gaps, system-gap backlog, native coverage).

### Roadmap

- **MVP, about 4–6 weeks: minutes spine.**
  - Drive API acquisition; DOCX and PDF blocks; junk filter and clustering.
  - LLM classification and minutes/agenda extraction with locators.
  - People and body resolution.
  - Three-pane review with per-field accept; promotion of meetings, motions, attendance and tasks.
  - Record gaps for AGM-per-year, body-month timelines and "adopt minutes of X" cross-references.
  - Golden set of 40 minutes.
  - **Target:** PGAIR at ≥ 90% of motions native, ≥ 80% of attendance person-linked, and every 2008–2025 minutes file either transposed or reported as a gap.
- **Phase 2, about 4 more weeks: constating documents and roles.** Bylaw and policy versions with rule extraction; consents and proxies into term intervals; filings and MSG; expected-records engine with a BC society rule pack; dashboard rules.
- **Phase 3, about 4 more weeks: finance, insurance and agreements**, with arithmetic validation and approval reconciliation.
- **Phase 4: full pipeline.**
  - Near-duplicate clustering and package splitting.
  - The system-gap backlog feeding product planning automatically.
  - Calibrated bulk-accept thresholds.
  - Local inference for restricted classes.
  - Revision-aware re-intake from Drive.
  - Rule packs for other jurisdictions.

## 7. Interface test results

### Blockers and high severity

| Area | Finding | Location |
| --- | --- | --- |
| Security | Document "PDF preview" decides by filename, fetches the URL, wraps the response in a same-origin `blob:` URL and frames it without a sandbox. For a Drive link the response is Drive's HTML viewer, so its scripts run in the app origin and can read local storage. Fix: verify the content type and `%PDF-` magic bytes, force `application/pdf` on the blob, sandbox the iframe. (Verified in code.) | `src/pages/DocumentWorkbench.tsx:407-455` |
| Editing | Rich-text editors never load (`MilkdownError: Context "nodes" not found`): minutes discussion, motion text, meeting notes, task descriptions, document comments and import notes render empty and can't be edited. Stored text is preserved. Seen on the dev server; production not checked. | `src/components/MarkdownEditorImpl.tsx:609-720` (suspected mount/unmount race) |
| People | `/app/members` hangs and crashes the tab on the PGAIR workspace (renders a review panel for each of 119 seats) | `MembershipEvidenceCard.tsx:13` |
| Imports | No review queue: 6,544 candidates are split across 130 sessions of about 50. There is no cross-session progress, next-item or keyboard flow, and identical truncated session names. Every candidate is flagged both restricted and needs-review. | `src/pages/ImportSessions.tsx` |
| Documents | 1,031 rows never appear in the Documents list (categories outside a hard-coded list, including 987 "Recovered source review") | `shared/functions/documents.ts:24-44` |
| Documents | The detail page ignores restored original files (preview and "Open file" go to Drive); the list's Open uses the restored file | `DocumentWorkbench.tsx` |
| Tables | The toolbar Filter can't build a filter on any record table: picking a field closes the popover | `RecordTableFilterPopover.tsx:71-79`, `Select.tsx:349` |
| Destructive actions | One-click with no confirmation: delete import session, approve/reject visible, complete task, delete grant. Deleting a grant also deletes its reports and ledger transactions. | `ImportSessions.tsx`, `Grants.tsx:463-471`, `shared/functions/grants.ts:410-434` |
| Accounting | Backfill posts unmapped expenses to the first expense account, and posts 2025 transactions after the 2026 opening balances | `shared/functions/accounting.ts:998-1031` |
| Bylaws | Bylaw amendments can't be created: Title only appears once a draft is selected, so "Save as draft" always fails | `BylawDiff.tsx:139,255-379` |
| People | Re-linking a person occurrence deletes its history event (7 already lost in the data); duplicate check needs exact name and birth date and finds none of 13+ obvious pairs; no merge or delete for people | People directory |
| Tasks | 351 historical source actions count as open To do tasks for the owner; no filter to hide them | Tasks page |

### Medium (selection)

**Meetings**

- The detail page has no Edit action. Corrected date and location don't replace the source header text.
- Every meeting shows 12:00 UTC.
- No review-status filter and no merge for 33 duplicate meetings.
- Deleting a section leaves its agenda item behind.
- Escape discards unsaved drawer edits.
- Approval accepts dates that contradict the approving meeting.
- The PDF export of the full source record collapses to one character per line after page 3.
- The Word export enlarges the logo and turns the DRAFT watermark into body text.
- Duplicate React key on every minutes view (`MeetingDetail.tsx:2412-2413`).

**Attendance and people**

- Role words count as attendees ("8 present" for a 4-person meeting), and marking them "Organization / heading" doesn't update the meeting.
- Directory search fails on surnames.
- A test person from another workspace appears in the PGAIR directory.
- "Add to society as Director" doesn't reach the Directors register.

**Validation gaps**

- A motion saves as Carried with 1 for, 10 against and −2 abstaining.
- Recording a bylaw resolution marks it passed regardless of the votes (`shared/functions/bylawAmendments.ts:137`).
- Bylaw rules accept a notice minimum greater than the maximum, and quorum 0.
- Blank directors, members, grants, insurance policies, documents, users and outbox emails save. Users have no email or uniqueness check.
- Fiscal periods can be created without a year and can overlap.
- Budget lines accept duplicate categories and negative amounts.

**Compliance logic**

- Obligations flags "No-AGM annual report overdue" despite a held AGM, because it never reads meetings (`compliance/facts.ts:51`).
- The generated AGM deadline skips the overdue year (`corporationSettings.ts:130`).
- Annual cycle shows a late filing as "Ready" and counts it in two years.
- Date-only deadlines are compared in UTC, so they show overdue the evening before they're due in BC (`Deadlines.tsx:291`).

**Other**

- Transparency publishing always fails with "Record not found".
- Seeded role holders can't be edited (title vs code mismatch).
- Registry import and staging return HTTP 500; Paperless scan shows a raw null error; corporate-history remove buttons do nothing.
- Detail pages for missing records spin forever.
- Global search covers only deadlines, documents and people.
- Uploaded files can't be opened.
- French is mostly untranslated.
- Two routes have no access rules (`/app/people-history`, `/app/source-model-coverage`).

**Performance** (dev server, PGAIR data)

- Meetings list about 11 s cold with the machine idle (about 500 MB heap).
- Documents and Imports about 23 s cold (441 MB heap).
- Meeting open 6–8 s.

**Phone**

- No page scrolls horizontally at 390 or 320 px.
- Clipped tables on Elections, Obligations, Policies, Deadlines, Minute book and Users.
- The Imports page is about 26,800 px tall, with session names wrapped one letter per line.
- Meeting tabs become unlabeled icons.
- Many controls are below a comfortable touch-target size.

## 8. Automated suites

| Check | Result |
| --- | --- |
| `npm run lint` | Pass (0 errors, 324 warnings). Hooks are called after early returns in `Communications.tsx:366-382` and `ImportSessions.tsx:323`, but the rule is only a warning. |
| `tsc --noEmit`, `convex:typecheck` | Pass |
| `test:interface-checks` | **Fail**: 3 routes are missing from the route-coverage manifest (`/app/people-history`, `/app/source-model-coverage`, `/app/people-directory/:id`). The other sub-checks pass. |
| Playwright interface suite (desktop + phone, 440 tests) | 423 pass, 17 fail. 12 are stale tests (renamed export label, disabled Create-session for invalid JSON, duplicate "List" button), 4 are environment (camera spec overrides the browser path), and 1 is a real bug: on phone `/app/members`, the first Ctrl+K focuses a table cell (`RecordTable.tsx:296-316`). |
| Intake, meeting and PGAIR scripts (17) | Pass. They use synthetic fixtures, so they say nothing about real-transposition fidelity. |
| `test:meeting-history-ui` | Pass |

## 9. Recommended next steps

1. **Quick fixes:**
   - the PDF-preview iframe hardening;
   - motion outcome synonyms and merge→`syncMotionsForMinutes`;
   - the empty-hash dedupe guard;
   - confirmations on destructive actions;
   - the record-table filter popover;
   - the Members page render cost;
   - the rich-text editor initialisation;
   - access rules and test-manifest entries for the 3 new routes.
2. **Don't extend the regex transposers.** Build the minutes-spine MVP: schema-constrained extraction with locators, validation, entity resolution, and three-pane review.
3. **Add first-class gap tracking:** `representationGaps`, `governanceExpectations` and continuity checks, plus a generic Coverage & Gaps page.
4. **Close the highest-value model gaps first:** person links (A1), meeting body and committee (A4, C5), organizational members and representatives (A2, B1), document version groups (A8), per-body quorum (A3).
5. **Re-run PGAIR through the new pipeline and grade it against the golden set** before the other document classes.

## Detailed reports

The nine per-area reports (with repro steps, record IDs and file:line citations), the golden set (`golden-set.json`, expected native records for 16 PGAIR documents), the corpus inventory and the extraction scripts were produced alongside this summary. They quote personal names and private Drive identifiers, so they are kept outside this public repository and were delivered to the requester directly.

# WP-L: intake extractors for every document class

WP-D built the intake pipeline with a strong deterministic minutes extractor;
every other class was only classified and catalogued. WP-L adds deterministic
extractors (and LLM guidance for the same classes) for agendas, packages, AGM
material, bylaws, policies, consents, proxies, rosters, statements, budgets,
insurance, agreements, grants, registry filings, correspondence and invoices,
and stages what they find into the WP-B bundle's native collections, with
representation gaps for what has no field and record gaps for what is missing.

The extraction envelope and `FieldValue` contract are unchanged; every schema
change is an additive optional field.

## What was built

| Area | Files |
| --- | --- |
| Shared extractor toolkit (lines, locators, labels, money, sub-extracts) | `shared/intake/extractors/toolkit.ts` |
| Package splitter (embedded documents by block range) | `shared/intake/extractors/packageSplit.ts` |
| Class extractors | `shared/intake/extractors/{agenda,agm,policy,roster,financial,insurance,agreement,filing,correspondence,invoice}.ts`, dispatch in `extractors/index.ts` |
| Class schemas (additive fields) | `shared/intake/schemas/classes.ts` |
| Cross-document stages | `shared/intake/classStages.ts` (organization name, embedded minutes, fiscal-year-end changes, policy adoption links, agenda-evidenced meetings, class record gaps) |
| Bundle staging for every class | `shared/intake/bundleClasses.ts`, wired into `shared/intake/bundle.ts` |
| Pipeline | `shared/intake/pipeline.ts` extracts every class; `stageRun.ts` skips derived records |
| Classifier | `shared/intake/classify.ts` (rules rewritten; `EXTRACTION_CLASSES`, `PROVIDER_EXCLUDED_CLASSES`) |
| LLM guidance | `shared/intake/llm.ts` (`CLASS_GUIDANCE`, prompt version 2) |
| Server action | `convex/intakeActions.ts` (deterministic fallback per class; `extractRun` targets every class) |
| `.eml` headers | `shared/intake/extract/index.ts` (From/To/Cc/Date/Subject become `email_header` blocks) |
| Evaluation | `shared/intake/evalClasses.ts`, `scripts/check-intake-class-eval.ts`, `tests/fixtures/intake/synthetic-classes.json`, `scripts/lib/intake-synthetic-fixtures.ts` (XLSX builder, page breaks) |

## Class → native records

| Class | Extracted | Staged as |
| --- | --- | --- |
| agenda / meetingPackage | items (number, time, presenter, requested action, consent flag), consent items, proposed resolutions, next meetings, embedded documents (split by block range), references to prior minutes | `meetingMaterials` + enrichment of the matching minutes (agenda items, consent items `received`); when no minutes exist: `meetingMinutes` with `meetingStatus: Held` and a "minutes missing" note; embedded minutes become their own meeting's record |
| agmMaterial | notice date and method, meeting date/time/location, scripted and noticed resolutions (always proposed), election slate, statements presented | same as agendas; slate → `agmDetails.directorAppointments` with status `nominated`; notice delivery → representation gap |
| bylaws | version, adopted/effective dates, clause outline, typed rules (quorum per body, notice min/max, AGM cadence, proxies, director count/term, electronic meetings, special-resolution threshold, fiscal year end, signing tiers) | `policies` (Draft) + `bylawRuleSets` (Draft) + gaps for rules with no field |
| policy / terms of reference | number, version, adopted/review dates, governed body, clauses, committee quorum, signing tiers | `policies` (Draft, Superseded for older versions in a family, `adoptedAtMeeting` when a motion is found); ToR → `committees.quorumRule` |
| directorConsent / proxy / roster | people with role, organization, consent, signed/term dates, proxy holder and meeting; never addresses or contacts | `directors` (terms derived across consents, rosters and filings), `organizationSeats` observations, `proxies` |
| financialStatement / budget | period, statement type, version label, lines with cell locators and column, totals with arithmetic check, fiscal-year-end, title conflicts | `financialStatementImports`, `budgetSnapshots` (fiscal-year label when only a year is printed) |
| insurance | insurer, broker, insured, policy number, term, coverages/limits/deductibles, premium/fees, kind, document type | `insurancePolicies` with status `Lapsed` (term ended) or `NeedsReview`, never `Active` |
| agreement | parties, term, amount, payment schedule, deliverables, reporting requirements, signatories, number | representation gap (no agreements table) + `deadlines` for reporting dates |
| grant | funder, program, purpose, stage, amounts, schedule, reporting requirements | `grants` + `deadlines` |
| registryFiling | type, filed date, period/AGM date, incorporation number, fee, confirmation, directors listed | `filings` (Filed only with a filed date and a registry confirmation) + director observations |
| correspondence | display-name headers, date, subject, decisions/commitments, attachments | `sourceEvidence` (restricted); contact data → gap |
| invoice | vendor, number, dates, bill-to, direction, subtotal/GST/total, lines | `transactionCandidates` (restricted) |

## Record gaps added

`meeting_without_minutes`, `unresolved_reference` (prior minutes or meetings a
document cites that no record satisfies), `annual_report_evidence_missing`,
`policy_without_adoption`, `fiscal_year_end_change`. The run's reconciliation
also carries `evidencedMeetings`, `policyAdoptions` and `fiscalYearEndChanges`.

## Evaluation

`npm run test:intake-class-eval` (also part of `test:intake-ai`):

1. Unit checks: classifier rules, fiscal-year labels, provider exclusion,
   package splitting.
2. A synthetic fixture with 23 documents covering every class in DOCX, PDF
   (multi-page packages), XLSX and e-mail. It reports per-class classification,
   field accuracy, span re-verification and PII leaks. The gate requires at
   least 90% field accuracy per class, 100% classification, 0 hallucinated
   quotes and 0 leaks. Current result: 167/167 checks pass (100%) and 0 of
   468 quotes are hallucinated.
3. End to end: the fixture folder runs through the pipeline and the bundle. The
   gate asserts that preflight passes and that every native collection is
   present. It also asserts the review rules: a meeting shown only by an agenda
   is staged as held with minutes missing, consent items are received, a policy
   links to the motion that adopted it, expired insurance is `Lapsed`, a filing
   is Filed only with evidence, and no contact data appears anywhere in the
   bundle.
4. A private golden set read from `SOCIETYER_GOLDEN_SET_CLASSES`, with
   optional `SOCIETYER_GOLDEN_CLASS_FILES`. It holds real originals and stays
   outside git. It contains 42 hand-labelled documents, 2 to 4 per class, plus
   class labels for all 235 files of the local sample.

Results on the private set:

| | before WP-L | first pass | after fixes |
| --- | --- | --- | --- |
| Field accuracy, dev (29 docs, tuned on) | no extractor | 91.4% (138/151) | 100% (151/151) |
| Field accuracy, holdout (13 docs, never tuned on) | no extractor | 92.4% (61/66) | 92.4% (61/66) |
| Hallucinated quotes | — | 0 of 3,501 | 0 |
| PII leaks (addresses, e-mails, account numbers) | — | 1 | 0 |
| Classification, 235 sample files | 85.1% (200/235) | — | 99.6% (234/235) |

The holdout still misses three things. A certificate's policy number appears
only as `Policy #` beside the insurer. One agreement lists its deliverables
under a "… will:" heading. One funder report gives its period as
"Period: April 1st 2020 to …". The one classification miss is a service
proposal from a contractor, which is classified as a grant.

The holdout documents were used neither to write the expectations nor to tune
after the first pass. Some of them were among the downloads used while the
extractors were first written.

Per-class native coverage on the local sample (235 files, `scripts/intake-run.ts`,
deterministic):

| Class | files before/after | transposed before/after | native facts before/after |
| --- | --- | --- | --- |
| agenda | 6/10 | 2/10 | 0/456 |
| meetingPackage | 3/12 | 1/12 | 0/1,475 |
| agmMaterial | 6/6 | 1/6 | 0/208 |
| bylaws | 4/4 | 0/3 | 0/272 |
| policy | 5/6 | 0/6 | 0/66 |
| directorConsent | 4/3 | 0/2 | 0/13 |
| proxy | 1/1 | 0/1 | 0/9 |
| roster | 0/3 | 0/2 | 0/1,155 |
| financialStatement | 8/7 | 0/7 | 0/1,321 |
| budget | 4/5 | 0/5 | 0/1,845 |
| insurance | 6/6 | 0/5 | 0/114 |
| grant | 0/3 | 0/3 | 0/36 |
| agreement | 3/4 | 0/0 (gap) | 0/0 (40 gap facts) |
| registryFiling | 3/9 | 0/8 | 0/82 |
| correspondence | 8/7 | 0/4 | 0/28 |
| invoice | 7/5 | 0/4 | 0/32 |
| meetingMinutes | 149/137 | 149/137 | 9,691/8,815 |
| **all files** | 232 | **153 → 215** | **9,691 → 15,927** |

Before WP-L, "minutes" included 12 agendas and packages that were misclassified
as minutes. After it, their minutes are derived as embedded documents of the
package, so motions rose from 126 to 136 and meetings from 113 to 119. Other
numbers on the sample: the bundle has 791 staged records with 0 preflight
issues, 0 hallucinated quotes, 86 record gaps and 69 representation gaps.
There are 14 unresolved facts, all in correspondence files that carry
no stated decision, so they reach no evidence record. Agreements are counted as gap facts by design.

## Privacy

- Five classes are never sent to a model provider, whatever the file's
  sensitivity scan says: consents, proxies, rosters, invoices and
  correspondence (`PROVIDER_EXCLUDED_CLASSES`). The pipeline, `extractWithLlm`
  and the server action all apply this rule.
- Extractors never output home addresses, e-mail addresses or phone numbers.
  E-mail header quotes cite only the display name. In correspondence, subjects
  and decision quotes stop before an account, card or contact number, and the
  stored value is masked.
- For personal files and the excluded classes, the `documentMap.extractedText`
  in the bundle has contact data masked, and the masking keeps the text length.
  Restricted files still withhold their text entirely, as before.

## Assumptions and decisions

- Agreements have no native table, so each one becomes a single
  `agreement.contract` representation gap with its reporting dates staged as
  `deadlines`. Funding agreements, award letters and requests are classified as
  `grant` and staged in `grants`.
- Signing tiers, AGM cadence, director count and term, proxy limits and fiscal
  year end have no `bylawRuleSets` field, so they become representation gaps
  that cite their clause.
- Policies and rule sets are staged as `Draft`. A version followed by a newer
  dated version in the same family is `Superseded`. Only a reviewer makes a
  policy `Active`.
- A meeting evidenced only by an agenda or package is staged as held, with an
  explicit note that the minutes are missing, and it raises a
  `meeting_without_minutes` gap. Several agendas for the same meeting (a
  business agenda and a consent agenda) enrich one staged meeting.
- Minutes embedded in a package are derived as `<package>#part-<block>` with
  `parentFileKey`. They count toward the package file in coverage and are not
  saved through `intake:saveExtraction`, because the package's extraction
  carries them in `embeddedDocuments`.
- A standing proxy or alternate seat becomes an `organizationSeats`
  observation. A meeting proxy with a date becomes `proxies`. A member
  organization can be the grantor of a proxy.
- When an agenda names no body, it is assumed to be the board's, at confidence
  0.4, the same fallback the minutes extractor uses.
- A budget's period is the fiscal year named in its title, not the "as of"
  date of the opening balance it carries forward.
- When only a "Policy #" appears, the insurer and policy number are left for
  review rather than guessed.

## Deferred

- OCR: scanned PDFs (no text layer) are still catalogued, not extracted.
- Three holdout misses (listed above) and the service-proposal versus grant
  ambiguity.
- A native agreements table, and fields for the rules that are now gaps.
- In-app review of the new record kinds belongs to WP-J. The staged payloads
  already use WP-B's bundle keys.

## Interfaces for other work packages

- **WP-J (review UI):** every change is additive. New optional schema fields
  are listed in `shared/intake/schemas/classes.ts`, marked `additive (WP-L)`.
  `IntakeExtractionResult.parentFileKey` marks derived embedded minutes.
  `reconciliation` gains `evidencedMeetings`, `policyAdoptions` and
  `fiscalYearEndChanges`, and `RecordGap.kind` gains the five kinds listed
  above (with optional `evidence[]`). `IntakeRunResult.organizationName` and
  `BundleBuild.transposedFiles` / `collectionCounts` are new. The
  `email_header` blocks now also come from `.eml` files (method
  `eml-headers`).
- **Server:** `intakeActions:extractRun` processes every class in
  `EXTRACTION_CLASSES`, and `extractFile` falls back to `extractForClass`.
  No Convex function was added or removed.
- **LLM:** `CLASS_GUIDANCE[docClass]` is appended to the user prompt, and the
  prompt version is `intake-llm-prompt/2`.

# Document transposition coverage review

Reviewed against this checkout on 2026-09-21. The initial code review was followed by a first source batch: the supplied bylaws DOCX, signing-authority delegation DOCX, incorporation certificate scan and three-page Code of Conduct PDF. This is a sample conversion, not a completeness claim for the folder.

## Current contract

The bundled document-intake references are dated 2026-04-20 and are incomplete relative to the application. The authoritative bundle parser is `shared/functions/importSessionHelpers/importSessionRecordKinds.ts` (`recordsFromBundle`): **59 distinct record kinds, 75 accepted collection names including aliases**. `organizationIdentifiers` and `taxRegistrations` are separate additive collections; most other aliases use `??`, which means only the first supplied collection is read.

The runtime accepts structured organization addresses, registrations and identifiers; policies; workflow packages; minute-book items; role holders; rights classes/transfers; assets; legal templates and related lifecycle records; and bylaw amendments in addition to the older governance/finance/document targets. Do not label these unsupported on the basis of the dated intake catalog.

`shared/importBundlePreflight.ts` checks collection names and shapes, competing aliases, and fields/items discarded by staging normalization. Its companion test compares accepted names with the parser source to expose catalog drift. Passing this check establishes staging compatibility only; it does not certify source accuracy, required legal review, or full promotion into native tables.

## Concrete gaps

| Gap | Code evidence | Consequence / recommended scope |
| --- | --- | --- |
| Grant promotion is narrower than the grant model | `convex/tables/grants.ts` contains requirements, opportunity URL/type, priority, fit score, key facts, use-of-funds lines, timeline events and next steps; the `grant` handler in `shared/functions/importSessionHelpers/importSessionMergeAndApply.ts` copies core identity, amounts, dates and provenance only. | These richer values can survive in a staged payload but will not populate the grant record. Extend promotion with typed field validation and reference resolution, then add a preservation test. |
| Several existing application domains lack bundle targets | `recordsFromBundle` has no collections for members, committees, tasks/goals, conflicts, inspection requests, auditor appointments, proxies or written resolutions. | Preserve source evidence and a review queue first. Add explicit candidate kinds and promotion handlers when real folder documents establish demand; do not invent legal register state. |
| Missing quorum evidence becomes a negative assertion | `normalizeMeetingMinutesPayload` uses `Boolean(minutes?.quorumMet)`; `normalizeMinutesActionItem` similarly coerces `done`. | Absent quorum becomes false, while the string `"false"` becomes true. Use explicit boolean validation and an unknown/not-recorded state before promoting historical minutes. This is not fixed by the collection preflight. |
| Source evidence lacks structured per-field locations | The `sourceEvidence` schema in `convex/tables/meetingWorkflow.ts` has a source document, excerpt, summary and target reference, but no field path, page, sheet/cell, extraction version or source revision/hash fields. | Store these details in the intake manifest and retained evidence sidecars now. Add a typed evidence-locator model before claiming field-level traceability inside the app. |
| Staged documents are metadata, not downloaded attachments | `applyApprovedDocumentsPortable` in `shared/functions/importSessions.ts` builds external document metadata; source `localPath` and hash are retained in content but do not upload file bytes. | A review backup must label unavailable attachments explicitly. Export/download originals separately and connect them through the actual storage adapter if an archival backup with files is required. |
| No existing Drive/subagent extraction coordinator | Repository search found no Drive folder crawler or subagent orchestration. `createFromBundlePortable` retains only `specialistReports.qualityDuplicates.summary` as session quality summary. | Add inventory/export, per-document work units, specialist output contracts, reconciliation and coverage reporting around the existing pending-review importer. Preserve detailed specialist reports outside the summary field. |
| Native promotion checks are uneven | `importPromotionIssues` in `shared/functions/importSessionHelpers/importSessionValidation.ts` returns immediately for record kinds outside its explicit list, including core grants, finance, filings and insurance. | Staging approval alone does not validate all schema/business constraints. Expand per-kind required-field and reference checks with focused examples from the source documents. |

## Practical pipeline

1. Inventory the folder recursively using stable Drive IDs, paths, revisions, MIME types and fetch/export outcomes. Keep inaccessible, unsupported and empty files visible in the ledger.
2. Export Google-native documents to appropriate readable formats and retain source links; keep original binaries and checksums when available.
3. Give specialists disjoint document batches with the same current bundle contract. Ask each to distinguish supported records, unsupported fields, contradictions, duplicate candidates and extraction failures, with source locators.
4. Reconcile identity and duplicate candidates centrally before merging. Keep competing factual claims and explicitly unknown values; never use majority vote to fabricate certainty.
5. Run preflight, stage through `createFromBundlePortable` in an isolated workspace with every record Pending, and export the supported local workspace snapshot. Restore it into a second isolated workspace and verify organization identity and candidate counts.
6. Deliver the restorable review backup, inventory/coverage ledger, full evidence sidecars and unsupported-field queue together. Applying or publishing candidates remains a separate review action.

The new offline builder is documented in `docs/document-intake-backups.md`. It must not be described as a completed conversion of the requested folder until actual source files have been inventoried and extracted.

## Source-confirmed representation needs

The four governance/policy sources yielded 27 review candidates. The incorporation scan was rendered and visually read: it names Prince George Air Improvement Roundtable Society, number S-54087, incorporated August 20, 2008 in British Columbia. This historical certificate does not establish current registry standing. The remaining candidates include a bylaws minute-book entry, policy drafts retaining the source text, clause-level facts and review evidence.

- **Organization membership and representation:** bylaws Part 2 permits organizations to appoint a natural-person representative and includes annual AGM renewal and sector eligibility. Part 5 makes the representative a director upon delivery of consent. Importing the list of eligible organizations as actual current members/directors would fabricate appointments.
- **Decision process and dissent:** Parts 4, 6 and 10 establish consensus, a majority-vote fallback for substantive disagreement, and retention of dissenting reports with minutes or the air-quality management plan. A carried/defeated result alone cannot capture this process.
- **Contextual quorum and proxies:** general and director meetings have separate 60% rules, exceptions and adjustment conditions. Proxy receipt/revocation uses business days and organization authorization. The source itself has a cross-reference discrepancy: Part 4 points to Part 14 for proxies while the supplied proxy section is Part 12. Review must preserve this discrepancy.
- **Expenditure authority matrix:** the delegation policy separates approval authority from invoice-signing authority and requires one signature up to $5,000, two for $5,001–$9,999, and two for $10,000 and above. Roles differ by tier. Exact dollar labels leave cent-level boundary handling ambiguous; currency is not explicitly named. Its July 13, 2022 “Last Updated” label was not substituted for an effective date.
- **Orientation and acknowledgement:** Code of Conduct section 1(a) requires multiple orientation steps, review/sign-off, and custody of per-person records by the AQ Coordinator. No completed orientation or signed acknowledgement is established by the policy itself.

These needs are retained as unsupported-detail evidence in the specialist results. They should guide app changes; none has been converted into active rules, live authorizations or completed compliance events.

# WP-E: governance and compliance

This package implements the ui-governance audit findings G-01 to G-30, plus
ui-people P16 and P20. Three items belong to other packages:

- G-04 (motion vote validation) is WP-B's.
- The shared date/timezone helper from G-08 is WP-A's.
- The shared-table part of G-30 is WP-A's.

Where a page I touched compared dates, I used the existing
`calendarDateKey()` from `src/lib/calendarDates.ts`. I did not build a second
helper.

## New shared modules (interfaces other packages can use)

| Module | Purpose |
| --- | --- |
| `shared/agmEvidence.ts` | The single source of truth for AGM evidence. It exports:<br>• `isAgmMeeting` and `isHeldMeeting`.<br>• `heldAgmDates` and `deriveAgmFacts(organization, meetings, today)`. The latter returns the latest AGM date, every evidenced AGM year, and `operatingSinceDate`.<br>• `annualReportForAgm(filings, agmDate, {nextAgmDate, dueDays, claimed})`. It attributes one filing to one AGM and flags late filing.<br>• `noAgmAnnualReportForYear`.<br>• `nextBcSocietyAgmDeadline`.<br>Statutory anchors: BC Societies Act ss.71 and 73. |
| `shared/bylawGovernance.ts` | Exports `voteCountProblems`, `evaluateSpecialResolution` (exact 2/3 by integer arithmetic), `bylawRuleProblems`, `bylawRuleContextFor`, `bylawRuleEffectiveDateProblem` and `SPECIAL_RESOLUTION_CITATION`. |
| `shared/registerValidation.ts` | Exports `directorProblems`, `memberProblems`, `directorTermLapsed`, `isCalendarDate` and `isPlausibleEmail`. |
| `shared/orgHubOptions.ts` (additions) | `normalizeOptionValue(set, value)` maps a label to its code; for example "Vice President" becomes `vice_president`. `officerTitleLabel(code)` does the reverse for documents. A new `privacy_officer` officer title was added. |
| `shared/annualFilings.ts` (addition) | `annualFilingYear(periodLabel)`. For example, `FY2025-2026` returns `2026` and `2025 AGM` returns `2025`. |
| `shared/entitySetup.ts` (addition) | `isValidFiscalYearEnd()`. `validateEntitySetup` now rejects an impossible fiscal year end. |
| `src/lib/serverConnection.ts` | Exports `serverActionsUnavailable()`, `serverConnectionMessage(action)` and `serverActionErrorMessage(action, error, fallback)`. Use these for any server-only button in local or demo runtimes. |
| `src/lib/publicationCategories.ts` | Human labels for transparency categories. |

New Convex and portable functions are registered in `shared/functions/registry.ts`:

- `constating:update`
- `elections:removeQuestion`

New optional arguments:

- `bylawRules:upsertActive` takes `allowBackdated`.
- `bylawAmendments:markResolutionPassed` takes `resolutionDateISO`. It now
  returns `{ passed, summary, ... }`.

There are no schema changes.

## Assumptions and legal anchors

- **Special resolution (G-05).** A bylaw alteration needs a special resolution
  (BC Societies Act s.17(1)). That means at least two-thirds of the votes cast
  (s.1(1) "special resolution"), or the higher majority in the society's bylaw
  rules.
  - A configured threshold below 2/3 never lowers the statutory minimum.
  - Abstentions are not votes cast.
  - A vote below the threshold is recorded as a `resolution_failed` history
    event. The amendment stays in consultation and is never marked passed.
  - The resolution date defaults to the linked meeting's date, otherwise
    today. It is no longer the time of the click.
- **Bylaw rules (G-06).** For BC societies, notice must be at least 7 days and
  at most 60 days (ss.77-78). Quorum is at least 3 (s.82). The special
  resolution threshold is at least 2/3.
  - These checks are enforced in the portable mutation.
  - A new rule version must take effect after the version it replaces (s.17,
    bylaw changes are prospective).
  - A historical rule version needs explicit confirmation (`allowBackdated`).
  - The AGM workflow evaluates a meeting under the rules in force on the
    meeting date (`bylawRules:getForDate`).
- **AGM evidence (G-02, G-03, G-12).** A meeting counts as a held AGM when its
  type is AGM and either:
  - its status is Held, Completed, Closed, Minuted, Approved or Adjourned; or
  - it is past and not Draft, Scheduled or Cancelled.

  Draft rows are not evidence. The AGM deadline uses the following rules:
  - When AGM history is supplied, it is cycle-aware.
  - For BC societies, the AGM stays due until December 31 of a year in which
    no AGM is evidenced.
  - Corporations keep the overdue planned date.
  - The next annual report is due 30 days after the next AGM once the last
    report's date has passed.
  - Without AGM history, the legacy behaviour applies (existing tests are
    unchanged).
- **Imported workspaces (P20).** A workspace may still be marked
  preparing or pre-incorporation while held AGMs exist. It is then treated as
  `formationStatus: "unverified"`, with `formationInferredFromRecords`.
  Obligations are computed provisionally, with the existing "unverified"
  caveat and a banner that links to the profile. The earliest held meeting
  serves as `operatingSinceDate` when no incorporation date is recorded.
- **Demo fixtures** are synthetic and were made consistent:
  - The 2025 annual report is now filed on time (Jul 8, 2025 for the
    Jun 19, 2025 AGM).
  - Seeded role-holder titles are option codes.
  - The demo election has two anonymous ballots, with "Voted" eligibility and
    2025 audit dates.
  - The activity text no longer claims that a policy was published.
- **Promote from governance registers (G-21)** copies the record into the
  register. It does not verify it, so an Observed assignment stays Observed.
  - An unsourced promotion is labelled as such in the director notes.
  - Active duplicates are refused.
  - The confirmation names any existing holder of the same position.
- **Deletes that cascade:**
  - Deleting a commitment removes its open preparation tasks (G-18).
  - Deleting a policy removes its open review and signature tasks and its
    unpublished transparency drafts (G-19).
  - Completed tasks and published items are kept.
- **P16.** Roster observations never become directors automatically. "Add as
  director" only pre-fills the director drawer. The user reviews and saves it,
  and the entry is noted as coming from the source observation.

## Per-finding status

| ID | Status |
| --- | --- |
| G-01 | Done. A Title field shows for a new draft, the server requires a title, errors are shown. |
| G-02 | Done. Obligations read held AGM meetings, every AGM year suppresses that year's no-AGM fallback, the garbled banner is rewritten, dismissed items are no longer counted. |
| G-03 | Done. The AGM deadline is cycle-aware, deadlines generate with register categories and a basis note. |
| G-04 | Not mine (WP-B). The shared `voteCountProblems` in `shared/bylawGovernance.ts` can be reused. |
| G-05 | Done (see above). |
| G-06 | Done. Validation runs both server-side and inline; versions are prospective; Reset asks for confirmation; the header shows the real next version; custom types with no name or a 150% threshold are rejected, not dropped; the label reads "> 50% (simple majority)"; the threshold preview no longer shows a spurious integer-range warning. |
| G-07 | Done. Name, email and date checks run in create/update; the drawer has Delete with a confirmation and a lapsed-term flag; blank rows can no longer be created. |
| G-08 | Shared helper not mine (WP-A). Pages I touched use `calendarDateKey` and date-only display. Remaining: the `asOfDate` default in `facts.ts` and the Deadlines page. |
| G-09 | Done. Root cause: the edit path spread the stored row, including `entityId`, which `requireFunctionAction` resolved as a record reference. The page now sends only publication fields. A title is required, deleted documents are handled, and categories are labelled. |
| G-10 | Done. The seed uses codes, server and editor normalize legacy labels, nothing is listed twice, blank holders are rejected, errors are toasted. |
| G-11 | Done. Packet is shown only where the corporation catalog applies, and it is wrapped in try/catch. |
| G-12 | Done. Annual cycle filings are attributed to one AGM, late filings are flagged, the no-AGM report applies for a past year, financial presentation is tied to this cycle's AGM, the AGM workflow shows the annual report state, notice coverage and Undo. |
| G-13 | Done. Import registry, Stage BC Registry and Scan Paperless are disabled with a "needs a server connection" explanation, and errors are mapped. |
| G-14 | Done. Rows keep `_id`; names and events can be edited (`constating:update`); confirmations and validation added. |
| G-15 | Done. The core-document check uses profile links and minutes records; badges and gaps agree; dates are human-readable; a title is required. |
| G-16 | Done. Accurate reason for not voting; Close and Publish confirm; duplicate or single-option questions are rejected; questions can be removed; app date format; consistent fixture. |
| G-17 | Done. Derived Overdue, kind labels (metadata options now include the stored codes), no duplicate kind, no trailing colon, period required, read-only drawer for filed rows, fee and date checks. |
| G-18 | Done. |
| G-19 | Done. Also: lifecycle labels, status labels, duplicate jurisdiction codes hidden. |
| G-20 | Done. |
| G-21 | Done. |
| G-22 | Done. The demo selection is persisted under its own localStorage key. |
| G-23 | Done. Confirmations added for annual filings delete, org-history deletes, obligation Dismiss, AGM step (it already confirmed; Undo added) and bylaw rules Reset. |
| G-24 | Done. Consent and evidence deep links, the AGM timing link goes to compliance settings, filing rows are clickable (`/app/filings?filing=<id>`). |
| G-25 | Done. The JSON import reports what was and was not imported; blank saves explain what is missing; budget totals are reconciled; the disabled extract button explains why. |
| G-26 | Done. |
| G-27 | Done. Periods such as `FY2025-2026` link; dates are formatted; uses the app Select. Edit already exists through a row click. |
| G-28 | Partly done. Routine-label notice, upcoming-only agenda chooser and the subtitle are done. Not done: the empty Motions tab / AGM "Motions 0" (the demo has no first-class motions for the 2025 AGM; this belongs to the WP-B motion migration), and the duplicate-key warning for `static_minutes_agm` (not reproduced in my runs). |
| G-29 | Done. Significant-individual steps, formation annual/log records and certificates validate, and their registers say when they do not apply. |
| G-30 | Page-specific parts done. The Obligations, Policies and Minute-book tables become cards on phones; the Elections table scrolls; the Obligations source column wraps. Deadlines and Filings use the shared RecordTable, which is WP-A's. |
| P16 | Done (explanation plus pre-fill). |
| P20 | Done (provisional obligations from AGM records, plus a "Set up" deadline badge). |

## Gates

- **New gates:**
  - `npm run test:compliance-agm-evidence` (`scripts/check-compliance-agm-evidence.ts`)
  - `npm run test:bylaw-governance` (`scripts/check-bylaw-governance.ts`)
  - `npm run test:governance-forms` (`scripts/check-governance-forms.ts`)
- **Existing gates re-run and passing:**
  - compliance-obligations, corporation-settings, packet-operative-data, role-holder-history, member-history, election-lifecycle, annual-filings, research-legal-boundaries, static-corporation-obligations
  - portable-manifest, static-parity, authorization-policy, permissioned-mutation, workspace-access
  - stage2-tenancy (inventory regenerated)
- **Interface specs updated for intentional changes:**
  - `tests/interface-election-lifecycle.spec.ts`: Close and Publish now confirm.
  - `tests/interface-filing-ledger-handoffs.spec.ts`: the native select became the app Select.

## Notes for the orchestrator

- `shared/functions/portable-manifest.json` and `scripts/stage2/function-inventory.json`
  were regenerated for the two new functions. Regenerate both after the merge.
- `stage2-tenancy-report.md` was stale upstream. I did not commit a regenerated
  copy, to avoid a large unrelated diff.
- `convex/recordTableMetadataDefinitions.ts`: the filing kind options gained the
  stored kind codes. Metadata re-seeding propagates them.
- `src/components/Layout.tsx`: one small additive change to the sidebar
  deadline badge.
- `src/pages/Documents.tsx`: supports `?intent=new&category=&title=`.
- `src/pages/Directors.tsx`: supports `?intent=consent`.

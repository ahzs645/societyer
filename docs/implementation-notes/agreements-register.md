# Agreements register (schema finding A5)

Before this package, contracts, funding agreements, leases and MOUs had no
native home. The intake pipeline turned each one into a whole-record
`agreement.contract` representation gap, plus loose deadlines for its
reporting dates. On the PGAIR re-transposition, 104 contracts sat in the
review queue as system gaps. This package adds a first-class agreements
register and moves agreements from intake and imports into it.

## What was built

### Data model (all optional, back-compatible)

`convex/tables/agreements.ts` is registered in `convex/schema.ts`.
`agreements` has these field groups:

| Group | Fields |
| --- | --- |
| Identity | `title`, `kind` (service, funding, lease, consulting, MOU, partnership, employment, licence, data_sharing, other), `status` (draft, negotiating, active, expired, terminated, superseded, unknown), `agreementNumber`, `summary` |
| Parties | `parties[] {name, role: us/counterparty/funder/guarantor/other, organizationName?, directoryPersonId?, contact?, notes?}`, `ourSignatories[]` and `counterpartySignatories[]` `{name, title?, directoryPersonId?, signedAtISO?}`, `signedDate` |
| Term | `effectiveDate`, `endDate`, `autoRenew`, `renewalTermMonths`, `renewalNoticeDays`, `terminationNoticeDays`, `terminationTerms`, `renewalDecision {decision, decidedAtISO?, notes?, motionId?}`, `terminatedAtISO`, `terminationReason` |
| Money | `valueCents`, `currency`, `paymentTerms`, `paymentSchedule[] {label, dueDate?, amountCents?, status?}` |
| Obligations | `deliverables[] {id, text, dueDate?, owner?, ownerPersonId?, status, completedAtISO?, notes?}`, `reportingObligations[] {id, text, dueDate?, recurrence: once/monthly/quarterly/semiannual/annual, recipient?, status, submittedAtISO?, notes?}` |
| Documents | `signedDocumentId`, `signedDocumentVersionId`, `documentIds[]`, `sourceDocumentIds[]` |
| Version chain | `renewalOfId`, `supersedesId`, `supersededById` |
| Links | `linkedGrantId`, `linkedServiceProviderId`, `linkedCommitteeId`, `approvedAtMeetingId`, `approvalMotionId`, `approvalNote` |
| Provenance | `sourceExternalIds`, `intakeRunId`, `intakeExtractionId`, `representationGapIds`, `importedFrom`, `confidence`, `reviewStatus` (NeedsReview, Verified, Rejected), `notes` |

Enumerations are stored as strings and validated in the handlers, so a
backup that carries a later value still restores. `deadlines` gains the
optional `agreementId` and `sourceKey` fields and a `by_agreement` index.

### Rules (`shared/agreements.ts`, pure)

- **Validation** (`validateAgreementInput`, field-keyed and shared by the form and the server):
  - A title is required.
  - Kind, status, party roles, deliverable statuses, recurrences and renewal decisions must come from their lists.
  - Dates must be real days, and the end date is on or after the effective date. Partial edits are checked against the stored dates.
  - The value is whole cents and zero or more. Day counts are whole numbers from 0 to 3,650. The currency is a three-letter code.
  - There must be at least one counterparty or funder. This applies on create and whenever the parties are edited. Imports and conversions may stage a draft without one; the draft says so in its notes.
- **Status is never assumed.** `deriveAgreementStatus` only turns `active` or `unknown` into `expired` once a non-renewing term has ended. Nothing becomes `active` without a person, or a source that says it was signed and in force.
- **Term and renewal.**
  - `currentTermEnd` rolls an auto-renewing term forward by `renewalTermMonths`, or 12 months when that is not set.
  - The notice date is the term end minus `renewalNoticeDays`.
  - "Renewal due" is the notice date when there is one, otherwise the term end.
- **Obligations** (`agreementObligations`). An agreement implies these deadlines:
  - each deliverable's and report's due date (recurring reports map to Monthly, Quarterly or Annual deadlines);
  - the renewal-notice date, until a renewal decision is recorded;
  - the end of the term.

  A closed agreement implies none. A draft implies only future dates, so converting old contracts does not fill the deadline list with history.
- **Signing authority** (`signingAuthorityCheck`, using the WP-B A17 tiers):
  - The check uses the tiers in force on the signing date (or the effective date). The strictest tier that covers the value applies.
  - It flags too few signatories, signatories who are not on the signing-authority register, a role the tier names that no signatory holds, and a missing authorizing motion or meeting when the tier calls for board approval.
  - It returns `ok`, `warning`, `no_value` or `no_tiers`.
- **Continuity gaps** (`agreementGaps`) come in two kinds:
  - `agreement_renewal`: the term ends within 90 days (or within the notice period, if that is longer), or ended in the last 180 days, and no renewal decision is recorded.
  - `funder_report`: a report is past due and not submitted or waived.

  Rejected and unreviewed (`NeedsReview`) records are skipped, because their dates are not confirmed.
- **Intake mapping** (`agreementPayloadFromExtraction`). The bundle, intake promotion and the conversion all use it. It works as follows:
  - The kind comes from the extractor's kind and the title.
  - A party that matches the workspace name, or its acronym, is `us`.
  - The status is `expired` only for a signed agreement whose term has ended; otherwise it is `draft`.
  - Every payload is `NeedsReview`.

### Functions, permissions and registry

- **Portable functions** (`shared/functions/agreements.ts`, wrappers in `convex/agreements.ts`, lazy domain in the registry):
  - Queries: `list` (projected with effective status, counterparties, term end, renewal due, expiring flag, open and overdue obligations, signing check), `get` (labels for links, documents, deadlines, version chain; `null` when missing, listed in `DETAIL_RECORD_QUERIES`), `forRecord` (grant, service provider, committee, meeting, motion, document), `summary`, `conversionPreview`.
  - Mutations: `create`, `update` (with a `clear` list), `terminate` (date and reason required), `renew` (mode `renew` or `supersede`), `setRenewalDecision`, `setObligationStatus` (arg `rowKey`, because an `*Id` argument would be resolved as a record), `remove`, `syncObligations`, `convertGaps`.
- **Deadline sync.** Every write calls `syncAgreementDeadlines`:
  - Open generated deadlines are updated or removed.
  - Completed ones are kept as history.
  - A deliverable or report marked submitted, accepted or waived completes its deadline.
  - A recurring deadline that spawns its next occurrence keeps `agreementId` and `sourceKey` (one additive line in `shared/functions/deadlines.ts`).
- **Permissions.** There is a new resource domain, `agreements:read` / `agreements:write` (`actionPolicy` group `agreements`):
  - Owner and Admin can read and write.
  - Director and Viewer can read (`ALL_READ`).
  - Member has no access.
  - The static mirror's permission list includes the new permissions.
  - Converting gaps also needs `documents:write`.
- **Other surfaces:**
  - Exports: both `EXPORTABLE_TABLES` lists, the static export list and the seed wipe list.
  - The stage-2 function inventory and the authorization surface artifact.
  - The portable manifest is regenerated.
  - Global search: kind `agreement` (title, number, kind, party names), shown in the palette as "Agreement".

### Interface

- **Module and navigation.**
  - Module `agreements` ("Agreements register", Finance category, enabled by default). Its module-access policy is defined.
  - Navigation: Finance group, `/app/agreements`, French label "Ententes".
  - Routes: `/app/agreements` and `/app/agreements/:id`, with read permission `agreements:read`, both in the interface route manifest (demo fixture `static_agreement_lease`).
  - Command palette: "Add agreement" opens `?intent=add`.
- **Register** (`src/pages/Agreements.tsx`):
  - Summary tiles: active, expiring in 90 days (and how many have no decision), overdue obligations, signing warnings, needs review.
  - Quick filters (all, active, expiring, needs review, signing warnings), kept in `?filter=`.
  - A metadata-driven RecordTable (object `agreement`) with columns for status, counterparty, kind, term, value, renewal due (with the decision or a relative date), signing authority and review. Saved views: "All agreements", "Active agreements", "Needs review".
  - A conversion banner whenever convertible gaps or extractions exist.
- **Detail** (`src/pages/AgreementDetail.tsx`):
  - Header actions: status, review and confidential badges, `UnsupportedDetailsBadge`, `SourceProvenanceButton` ("View source"), Mark reviewed, Edit, Renew, Replace, Terminate, Delete.
  - A signing-authority warning banner.
  - Cards:
    - Parties and signatories.
    - Term and renewal, with a renewal-decision picker.
    - Money, with the payment schedule.
    - Deliverables and reporting, with per-row status pickers and the generated deadlines ("Update deadlines").
    - Documents: signed copy, related and source documents, and "Open in intake review".
    - Links and approval.
    - Versions and history (the chain plus its origin).
    - Summary and notes.
- **Drawer** (`src/features/agreements/AgreementFormDrawer.tsx`):
  - Covers every field, with party, signatory, deliverable and report rows.
  - Signatories can be linked to the people directory.
  - Pickers for grant, service provider, committee, signed copy, approving meeting and the authorizing motion (which lists that meeting's motions).
  - Inline validation through the shared validator; Save is disabled while errors remain.
- **Dialogs:**
  - Renew and Replace: title, dates, value and "carry open obligations".
  - Terminate: date and reason required.
  - Replace, Terminate and Delete each ask for confirmation and name what is lost (open deadlines, chain links, gaps that reopen).
- **Other places:**
  - Dashboard card "Agreements expiring in 90 days".
  - Coverage & gaps, Record gaps tab: an "Agreement renewals and reports" section.
  - The continuity dashboard check `CONTINUITY-AGREEMENT-OBLIGATIONS`.
  - The grant page lists its funding agreements (`LinkedAgreementsCard`, reusable for providers and committees).
- **Phone:** stacked cards, form rows collapse to one column, quick filters wrap, and nothing scrolls horizontally (checked at 390 px).

### Import and intake

- **Bundle key `agreements`** (record kind `agreement`). The payload contract is documented at the top of `shared/functions/importSessionHelpers/importAgreementApply.ts`.
  - It accepts parties as objects or names, `counterparty` and `funder` shortcuts, signatories as names, and deliverables and reports as strings.
  - References resolve by name or date inside the workspace:
    - `grantTitle`, or a grant built from the same source document;
    - `serviceProviderName` and `committeeName`;
    - `approvedAtMeetingDate` with a body, and `approvalMotionText`;
    - `renewalOfExternalId` or `renewalOfTitle`, and `supersedesExternalId` or `supersedesTitle`;
    - `signed`, which makes the first source document the signed copy.
  - Unresolved names and contradictory values (end before start, a negative value) are left blank with a note rather than rejected.
  - Promotion blockers: no title and no source, or a date that is not an exact day.
  - A record whose source is already held by an agreement updates that agreement instead of duplicating it. An unreviewed draft takes the incoming values; a reviewed agreement only gains fields it is missing.
  - Wiring is one line each in the record-kind list, `recordsFromBundle`, target table, mutation-domain map, handler lookup and promotion issues, plus the preflight group.
- **Intake.**
  - `bundleClasses.ts` stages each agreement extraction, and each signed funding agreement classified as a grant (stage `agreement` or kind agreement/contract/MOU), as a native draft agreement. The funding agreement is also the grant's record, and the two are linked through their shared source.
  - Agreement deadlines now come from the agreement, not from separate rows.
  - The agreement extractor no longer emits the whole-record `agreement.contract` detail. Legacy extractions that still carry it are filtered in `bundle.ts` and in class promotion.
  - Promotion (`promotionClasses.ts`) maps the agreement class onto the `agreements` table, with native field names for provenance (lists map to `reportingObligations[i].dueDate` and similar).
  - Intake review now names agreements in its staging errors.
- **Conversion: "Convert agreement gaps to agreements"** (`agreements:convertGaps` and `conversionPreview`; a banner on the register).
  - Sources:
    - every open, kept-as-text or schema-change-requested `agreement` and `agreement.contract` representation gap;
    - every unreviewed intake extraction of an agreement, or of a signed funding agreement.
  - What each draft gets:
    - It is a draft agreement (`NeedsReview`; never active).
    - It links its source documents (from the gap, the intake file's document, or documents carrying the file's source id), its intake run and extraction, and the grant built from the same source.
    - It gets "View source" provenance rows (decision `unreviewed`) for the extracted values.
    - Its gaps are marked `resolved_native`.
  - Copies and versions that the intake run clustered together fold into one draft that lists every file. A cluster member with a different stated term stays a separate agreement.
  - The conversion is idempotent and batched. Deleting a converted agreement reopens its gaps.

## Verification

- **Gates.**
  - New: `npm run test:agreements` (`scripts/check-agreements.ts`) covers:
    - validation, status derivation, renewal dates and obligation generation;
    - signing tiers and continuity gaps;
    - intake mapping and staging;
    - permissions (Viewer read-only, Member denied, foreign links rejected);
    - the portable lifecycle and its deadlines (create, update, setObligationStatus, setRenewalDecision, renew, supersede, terminate, remove);
    - summary, continuity and global search;
    - import, apply and re-import with links resolved;
    - conversion (preview, dry run, folding, grant link, provenance, View source, idempotence, delete reopening the gap).
  - Updated: `check-import-bundle-preflight` and `check-representation-gaps` (`agreements` is a supported key now) and the synthetic intake fixture (no `agreement.contract` gap expected).
  - Passing:
    - `tsc -b`, `convex:typecheck`, lint (0 errors);
    - `test:static-parity`, `test:authorization-policy`, `test:permissioned-mutation`, `test:workspace-access`, `test:interface-route-coverage`, `test:portable-manifest`, `test:portable-conformance-matrix` (0 divergent; the agreements functions are exercised on the seeded workspace);
    - `test:intake-ai`, `test:intake-pipeline`, `test:representation-gaps`, `test:continuity`, `test:import-core`, `test:global-search`, `test:record-validation`.
- **Playwright** (`npm run test:agreements-ui`, `tests/agreements.spec.ts`, local runtime): 3 tests pass.
  - Create, edit, renew and terminate, including inline errors for a negative value, end before effective and a missing counterparty.
  - List quick filters, the dashboard card, and the phone layout with no horizontal overflow on the list and the detail page.
  - The not-found page.
- **Demo** (local runtime, synthetic data).
  - The portable seed adds signing tiers and three agreements: a lease expiring in about 75 days, an ended funding agreement linked to the gaming grant, and a print services agreement being negotiated.
  - The static demo fixtures add three agreements, signing tiers and two lease deadlines.
  - Screenshots: `scratchpad/shots/agreements-*.png` (list, detail, signing warning, drawer validation, renew dialog, dashboard card, coverage section, grant link, phone list, detail and drawer).
- **PGAIR** (restored retransposed review backup in a private profile, real data kept out of the repo):
  - The register showed the conversion banner. One click converted the 109 source extractions (104 contracts plus 5 signed funding agreements) into **78 draft agreements**: 18 drafts fold in the other 31 files, which are copies or versions.
  - Status: 57 draft and 21 expired (signed with a term that has ended). None is active, and all 78 are Needs review.
  - Kinds: 46 service, 13 funding, 16 other, 2 licence, 1 MOU.
  - Coverage of the drafts: 32 have a counterparty, 36 a term, 37 a value, 24 reporting obligations, 24 deliverables, 14 a linked source document and 4 a linked grant. All 78 have View source provenance and an intake-review link.
  - It took about 3 s in the browser. Nothing appears as overdue or expiring until a person reviews the drafts.
  - The backup carries no `agreement` representation gaps, so only the extraction path ran on real data; the gap path is covered by the gate.
  - Screenshots: `agreements-pgair-*.png`.

## Assumptions and decisions

- **Unconfirmed dates are not obligations.**
  - Imported and converted records are `NeedsReview` drafts.
  - They imply only future deadlines.
  - Their past due dates do not count as overdue and do not create continuity gaps until a person reviews them.
- **"Expired" is the only status derived from dates.** "Active" needs a person, or a source status of signed / in force (import `status: "signed"` maps to active; an intake extraction never yields active).
- **Renew vs. replace.**
  - A renewal is a new term of the same agreement: the old version runs to its end, gets the decision "renew", and its successor is found through `renewalOfId`.
  - A replacement supersedes now: the old version becomes `superseded` (and `supersededById` is set).
  - Both start as drafts that carry the parties, links and open obligations.
- **Board approval.** A tier needs board approval when one of its roles mentions "Board" or its notes say board approval or resolution. A linked authorizing motion or approving meeting satisfies it.
- **Tier choice.** Signing tiers are stored per person (A17). The strictest tier that covers the amount among the rows in force governs.
- **Unknown signature side.** A signature block whose side is unknown is listed under our signatories for review, because an organization's archive mostly holds its own signed copy.
- **Folding copies.** Folding intake cluster members into one draft assumes the intake clustering (sha256, simhash, name stem) groups copies and versions of one document. A member whose stated term differs from the others stays a separate agreement; members are not auto-chained as renewals.
- **Terminating a draft.** Terminating before the effective date is allowed for drafts and negotiations (cancelled before it began), but not for active agreements.
- **Expectation kinds.** `agreement_renewal` is added to the expectation-kind vocabulary next to the existing `funder_report`. Both are evaluated from the agreements register itself. A stored expectation of either kind has no period matcher.

## Deferred

- The private class golden set (`SOCIETYER_GOLDEN_SET_CLASSES`) may still expect an `agreement.contract` unsupported detail for agreement documents; update its expectations outside git.
- Agreement fields are not yet editable inline in the RecordTable (columns are read-only projections); edits go through the drawer.
- `LinkedAgreementsCard` is only on the grant page; drop it into the service-provider and committee pages (`table="serviceProviders"` / `"committees"`).
- Extraction quality for agreements is unchanged here (owned by the extraction work package): titles such as "Agreement #: …" and parties missed in 47 of 78 drafts. The intake mapping only strips a leading "Title:" or "Re:".

## Interfaces for other work packages

- `shared/agreements.ts`: `validateAgreementInput`, `deriveAgreementStatus`, `currentTermEnd`, `renewalNoticeDate`, `agreementObligations`, `signingAuthorityCheck`, `agreementGaps`, `agreementPayloadFromExtraction`, `inferAgreementKind`, plus the vocabularies and labels.
- `syncAgreementDeadlines(ctx, agreementRow)` in `shared/functions/agreements.ts`. Call it after writing an agreement outside these handlers.
- Bundle key `agreements` (contract above). Intake bundles emit it for agreement and funding-agreement documents.
- `<LinkedAgreementsCard table recordId />` and `<AgreementsExpiringCard societyId />`.
- `deadlines.agreementId` / `sourceKey`: generated deadlines carry them. A deadline linked by a person (without `sourceKey`) is never touched by the sync.
- The `shared/functions/portable-manifest.json` and `scripts/stage2/function-inventory.json` regenerations will conflict at merge; regenerate them with `node scripts/portable-manifest.mjs` and `npx tsx scripts/stage2/function-inventory.ts --write`.

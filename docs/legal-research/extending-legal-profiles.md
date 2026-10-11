# Extending Societyer's legal profiles

## The contract

A governance profile describes a reviewed governing Act. A privacy profile describes the possible or established application of privacy law to activities and information. Neither is a substitute for the workspace's permission model, its actual legal register, or the organization's governing documents.

The current system supports four reviewed governance profiles. Additional entities can be recorded with neutral terminology while their law remains in review. An unknown Act must not acquire a nearby province's business-company rules as a fallback.

| Layer | Code | Responsibility |
| --- | --- | --- |
| Identity | `shared/organizationDomain.ts` | Entity kind, Act, home jurisdiction and member-based/company distinction |
| Profile contract | `shared/legalGovernanceTypes.ts` | Director, annual business, filing, notice, resolution and record fields |
| Profile registry | `shared/legalGovernanceProfiles.ts` | Explicit aliases, duplicate rejection, contradictory identity rejection and reviewed-profile resolution |
| Governance sources | `shared/legalSources.ts`, `shared/societyLegalProfile.ts`, `shared/corporateLegalSources.ts`, `shared/governanceSupplementalSources.ts`, `shared/legalCalendarSources.ts` | Stable source IDs, section, citation, official URL, consolidation currency, review date, summary and caveat |
| Privacy | `shared/privacyRuleProfiles.ts` | Explicit activity facts, multiple applicable/possible laws, access clocks and incident retention |
| Annual evidence | `shared/agmEvidence.ts`, `shared/annualGovernanceEvidence.ts`, `shared/corporationSettings.ts` | Actual completion, attributed cycle, filing period and Act-specific deadlines |
| Voting evidence | `shared/shareholderElectorate.ts`, `shared/functions/electionElectorate.ts`, `shared/writtenResolutionEvidence.ts` | Register identities, share/class rights, record-date review and immutable voting/consent evidence |
| Portable actions | `shared/functions/` | Authenticated and tenant-scoped handlers shared by hosted/local runtimes |
| Convex transport | `convex/`, `convex/tables/` | Argument/return validators, additive schema fields and authorized wrappers |
| Display adapters | `src/lib/regulatoryCitations.ts`, `src/lib/jurisdictionGuideTracks.ts`, `src/lib/governancePageGuidance.ts` | Entity/activity-scoped source guidance and optional review state |
| Research trace | `docs/legal-research/coverage.json` | Question, source, answer and implementation-boundary mapping |

## Add a governance Act

1. **Answer the legal questions first.** Read the current primary legislation, regulations and relevant official registry instructions. Record the actual consolidation date displayed, the retrieval date, commencement annotations, exceptions and any failed retrieval. Distinguish public/distributing, non-offering, member-funded and regulated-subtype conditions. Do not turn a bill or an enacted but uncommenced section into a current rule.
2. **Define unambiguous identity.** Add exact Act aliases to a new profile. Check `homeJurisdictionCode` and entity kind. Keep nonprofit corporations and cooperatives out of the business-company path unless their own profile and electorate model are implemented. Use `confidence: 'review_required'` while incomplete; the executable resolver only returns `verified_core` profiles.
3. **Add source records with stable IDs.** Each source needs the instrument, section/subsection, full display citation, official URL, `reviewedOn`, status and an accurate summary. `consolidatedThrough` is optional when the publisher's currency could not be verified. Source IDs are references, not claims that a paraphrase is a literal quotation. A source update should preserve old identifiers or provide a deliberate compatibility mapping.
4. **Populate the typed rule fields.** Specify director minima and residency separately; first/subsequent annual-business timing; registry filing anchor; notice day or calendar-month basis; quorum and proxy conditions; written-resolution denominator and unanimity; and record-specific retention/access. Add explicit conditional/review behaviour for any field the Act does not settle alone. Current required properties make omitted core research visible to TypeScript.
5. **Register and scope consumers.** Extend `LEGAL_GOVERNANCE_PROFILES`, the profile lookup and display mappings. Update annual-deadline logic where the new Act uses a genuinely different anchor. Guide JSON supplies catalogue entries and references; shared profile/source adapters populate operative guidance. The older compliance-obligation schedule packs in `src/lib/compliance/rulePacks` remain a compatibility layer: update their anchors and source mappings together with the profile, and add cross-layer regression cases whenever a numeric rule changes.
6. **Add integration and negative tests.** Test the correct entity and at least one neighbouring jurisdiction, one nonprofit/cooperative entity, an unknown Act and a contradictory identity. Test missing facts and the exception branch. Verify that unsupported identity produces a review state instead of a favourable compliance result.

For an external registry built with `createLegalProfileRegistry`, a newly registered profile can be inspected without being activated in the global executable list. The current default no-Act corporation fallback recognizes only the three reviewed company jurisdictions. An extension should add explicit Act aliases before deciding whether any additional legacy fallback is justified.

## Preserve evidence semantics

### Annual business and filing

`agmMonth` and `agmDay` are planning preferences. A meeting in `Scheduled`, `Draft`, `Cancelled` or an unknown past state is not held evidence. Use a held/completed status or explicit actual date, preserving imported source details. An annual year by itself does not establish a meeting. The shared adapter retains a BC society registrar-authorized postponed meeting's covered year without counting it again in the following year.

Each annual registry filing must identify its own year or exact taxation period. New `reportingYear` and `reportingPeriodEnd` fields are optional for compatibility. Ambiguous labels such as `FY2025-2026` do not establish an AGM/anniversary cycle. An Ontario return needs the actual taxation period where known; two distinct periods in one calendar year require review rather than choosing one silently. Filing date, due date and reporting period are distinct facts.

Calendar arithmetic has two deliberate functions. `addCalendarMonths` uses the corresponding calendar date, clamping only where that date is absent. `addFiscalFilingMonths` preserves month-end for the relevant fiscal-filing convention. Do not apply fiscal month-end arithmetic to CBCA AGM timing, notice windows or an internal review schedule. Notice periods stated as months before a meeting are calculated backwards from the meeting date.

Keep old unsatisfied cycles open until matching evidence closes them. A newer receipt or the passage of a year does not prove old filing completion. Missing evidence means an evidence gap, not proof that the organization failed to file. Preserve the actual completion date and original boundary; assess lateness only after the applicable legal calendar has been established. Extra-provincial/branch filings and contradictory explicit jurisdictions cannot close the home Act's cycle.

### Statutory calendar review

The date engine deliberately does not guess a holiday or office-opening calendar. `DeadlineAssessment.nominalDueDate` preserves the unadjusted rule calculation; `calendarReviewStatus` identifies whether an exact review was supplied. At or after an unreviewed open boundary, `status` is `review_required`. A filing or annual-business completion remains factually complete while `timingReviewRequired` can be true; `late` is then unknown rather than falsely true.

`AnnualDeadlineCalendarReview` is the extension input. It requires the exact `profileId`, `obligation` (`annual_meeting` or `annual_return`), `cycleYear`, `nominalDueDate`, `reviewedDueDate`, `reviewedOn`, affirmative `verified`, nonempty `evidenceRef`, and `calendarBasis`. Review evidence for another cycle, Act, obligation or raw boundary is not reusable. Invalid, future-dated or contradictory reviews fail closed. An annual expiry review cannot move the boundary earlier; notice calculations use their own before-meeting rules and must not reuse this after-event contract.

The current UI exposes the review requirement; it does not create reviewed calendar evidence. An extension that captures this evidence must persist the reviewer, source/holiday/office basis and applicable channel with authorization and an audit history. Do not turn a checkbox, a user's planned deadline or a generic Monday–Friday helper into legal verification. BC, federal and Ontario interpretation sources live in `shared/legalCalendarSources.ts`; a new jurisdiction needs its own source and review contract. Compatibility schedule packs label their status as nominal arithmetic and do not claim the stricter kernel's reviewed legal outcome.

### Written resolutions and elections

An eligible person, legal shareholder, authorized representative and logged-in user are different concepts. Use stable member/director/role-holder/register IDs. A display name or shared email cannot establish identity, ownership, proxy or representative authority. Validate same-tenant source documents and active authorized accounts.

Freeze the electorate and applicable approval rule when circulation or voting opens. Review the current or historical share ledger, share classes, votes per share, record date and representative authority. The current evidence paths have a finite snapshot limit and fail closed when complete eligibility cannot be established; a new scaling path must retain full coverage rather than truncating the register. Historical member/director circulation is deliberately restricted where the current register cannot reconstruct the past electorate.

Store the actual consent time separately from the authenticated officer's recording time. Reject future consent, consent before circulation, duplicate identities and mismatched stored weights. Passage derives from chronological evidence crossing the required threshold. Retain the statutory-majority crossing separately where a higher articles/USA threshold creates a distinct notice-clock question. Additional recorded evidence can change the chronological assessment, so dependent notice evidence must be rechecked.

Do not treat a valid member/shareholder resolution as proof of complete annual business, a valid auditor waiver, a class vote or a registry filing. Those are separate legal acts and may have different electorates. Ontario non-signer notice requires recipient coverage, actual delivery evidence and a reviewed business-day calendar/deadline; a generic Monday–Friday addition is insufficient.

### Documents and retention

Preparation-only annual packets capture the selected Act, source editions and clauses at generation. They must remain `needs_review`, with no inferred legal signer roster. Prevent signing/finalization until a dedicated reviewed execution path establishes the necessary authority and annual business. Keep hosted and static/local generation paths consistent.

Core corporate records cannot inherit a generic seven-year destruction schedule. A record requirement contains its own retention and access explanation, conditional applicability and sources. Existing document retention settings are organization-specific data and require review; do not silently rewrite historical dates or authorize disposal merely because a default period elapsed. Litigation holds, privacy limits, tax rules and regulated-sector retention can interact with corporate law.

Legal inspection rights are assessed outside the application permission grant. A shareholder's statutory inspection right does not grant them an administrator role or access to all director/beneficial-owner records. Conversely, the absence of a login does not extinguish a legal inspection request. Keep those decisions and audit trails separate.

## Add or update privacy law

Use explicit facts in `PrivacyAssessmentFacts`: operating jurisdictions, commercial activity, federal-work status, commercial cross-border handling, Québec enterprise status, Alberta nonprofit class, sector-specific context and review time. Do not infer these from incorporation, the registered office or a federal company number.

`resolvePrivacyProfile` distinguishes applicable and possible laws. Missing, contradictory or sector-specific facts retain review questions. More than one law can apply. Update the structured access-day unit, complaint/officer/security duties and incident-record rules; then use the same data in `privacyPolicyTemplate`, record templates, resources and UI. Proposed legislation remains educational metadata until commencement is verified.

Preserve authored policy text and existing review tasks. Idempotent setup should identify generated drafts by its stable key rather than overwrite a similarly named user document. A policy draft does not itself prove the organization's operational programme is implemented.

## Schema, review and release

All fields introduced here are additive and optional where legacy rows already exist. Convex mutations validate the inputs; portable handlers validate evidence, ownership and authority; the local runtime uses the same handlers. New operations belong in the portable registry and manifest. Regenerate the manifest only when its scanned endpoint inventory changes, then run its drift check.

For an organization adopting the new rules, review its explicit Act and public/member-funded/subtype status, Canadian-residency evidence where applicable, active directors, governing documents and share/member register. Assess privacy from actual activities. Resolve legacy written approvals and filings using original documents and covered periods. No bulk migration should infer missing consent or filing evidence.

The PR workflow runs `npm run test:legal`, `npm run test:portable-manifest` and `npm run build`. Add a source/date and applicability fixture whenever the law changes, plus a native-schema test for any evidence or authorization change. Browser tests supplement these gates; successful static rendering must never be reported as successful browser interaction.

Run `npm run research:coverage` after intentionally changing the question reports or source mappings, then inspect the diff. The two `*-source-bindings.json` files explicitly connect society/privacy and meeting/record questions to precise existing runtime source IDs; corporate reports identify their IDs in the answer text. An empty binding is deliberate where an authority is research, reform-watch or resource guidance without a corresponding runtime citation. Keep that authority's official URL in the answer rather than assigning an unrelated source ID. The coverage gate enforces the brief's 102 IDs, stable answer anchors, valid runtime bindings, existing implementation paths and primary-source references. A passing gate establishes coverage integrity; source currency and legal interpretation still require the documented human review.

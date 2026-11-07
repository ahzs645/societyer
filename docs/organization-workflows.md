# Organization workflows: implementation and reviewer guide

This change demonstrates how Societyer can serve a business corporation, a society, and a nonprofit corporation without treating legal form, charity registration, tax treatment, and application access as one classification.

The existing organization and governance records remain the source of legal identity. A shared adapter interprets those records, an action assessment explains available workflows, and the write handlers enforce the relevant conditions. Charity registration has its own dated, revisioned evidence. An organization's legal form does not establish a tax exemption or permission to issue an official donation receipt.

## What changes for the user

| Area | Result |
| --- | --- |
| Organization profile | Explains legal identity, available records, software coverage, information still needed, and the current user's permission separately. |
| Company ownership | Share-class, transfer and dividend actions require a consistent business-corporation identity. Society membership classes continue to use their existing shared rights ledger. |
| Nonprofit and society records | Member workflows can be available even when there is no reviewed Act-specific automation. The screen identifies that coverage as records only. |
| Charity registration | The profile records pending, registered, inactive, or unestablished status as new revisions, with dates, retained sources, reviewer and change history. |
| Donations | Any organization can record a contribution acknowledgement. It has no eligible tax-receipt amount and makes no official tax-receipt claim. |
| Official donation receipts | A supported cash gift can be prepared only after registration and gift checks. The numbered preparation becomes issued only when an authorized user reviews and retains its signed copy. |
| Guided invoice tax decisions | Reviewed registration facts are checked against the guide's answers at the applicable supply date. A society label or default `isCharity: false` does not establish nonprofit tax treatment. |
| Setup and filing preparation | A pending application remains in progress. T3010 prefill uses reviewed registration evidence for the fiscal-period end, and still calls for a full-period review. |

## Reviewer walkthrough

Use an isolated test workspace and clearly synthetic documents. The automated browser suite creates its own synthetic societies and actual PDF file bytes; it does not send receipts or register anything with a government service.

### 1. Compare the organization models

Open **Organization profile → Features and next steps for your Act** in a business-corporation workspace and an ordinary society workspace.

For a business corporation, the company share record workflow applies. For a society, the member workflow applies. New and edited company share actions are also checked by the backend, so directly calling an action cannot bypass the distinction in navigation. History-preserving corrections, such as canceling an earlier dividend or voiding an earlier transfer, remain available after identity changes. A cooperative's ownership model remains separately identified and does not automatically acquire business-company share automation.

Missing or conflicting legal identity produces a reason and a next step. An internally consistent recorded identity is described as recorded; this label does not verify incorporation evidence. Existing formation workflows still assess their own evidence.

### 2. Record a registration application, then its decision

In an ordinary society workspace:

1. Open **Organization profile → Charity registration and evidence → Record registration update**.
2. Choose **Application pending**, add a reference, and save. The pending status survives reload and does not enable official receipt preparation.
3. Upload the registration decision to Documents, or retain the source text in a document. An empty document or an external link alone is not sufficient evidence.
4. Record a new revision with **Registration recorded**, the full CRA charity number, registered name and address, effective start date, and supporting document.
5. Review the source and check the evidence-review confirmation. The application captures the reviewed source fingerprint. Save the revision.
6. Expand registration history: the pending application remains visible alongside the reviewed revision.

For an inactive registration, retain its original start date, inclusive final effective date, and reason. An inactive registration can supply historical tax facts for dates within its recorded period, but cannot authorize a new official receipt through this workflow.

Two editors cannot silently overwrite one another. Each save supplies the revision that was current when editing began. A stale save must reload and review the latest revision. Every reviewed revision requires a fresh evidence-review confirmation; an earlier checkbox is never carried forward as a new review.

### 3. Follow a gift through acknowledgement and signature

1. Open **Donations and receipts → New donation record**.
2. Record a **Donation acknowledgement** with the donor, gift amount, gift date and place of issue. This works before charity registration is established.
3. Once reviewed registration evidence supports the date, use **Prepare official receipt** on that acknowledgement.
4. Confirm the supported gift conditions: a voluntary cash gift in CAD, no advantage to the donor or an associated person, and reviewed donor identity and eligibility. The backend checks dates, amounts, evidence and the organization's recorded conflicts.
5. Download **PDF for signature**. The record is a preparation with a reserved number, not a completed signed issue.
6. Sign the paper receipt, upload its signed PDF or image as a retained document, and select **Record signed issue**.
7. Select the signed copy, identify the authorized signatory, review that copy against the preparation, and confirm the signatory's authority. The selected file fingerprint is captured at review and checked again when recording issue.
8. Download the retained **Signed copy**. Reloading the workspace preserves the original acknowledgement and the separate official receipt.

The printed issue date must match the signed date. If that date changes, void the preparation and prepare a replacement. Corrections retain the earlier number, void reason, and replacement relationship. An existing acknowledgement is never relabeled as an official receipt.

The application records the operator's review of the signature and authority; it does not recognize handwriting or verify signing authority automatically. This first official route does not support noncash gifts, donor advantages, foreign currency, electronic signatures, or exceptional retrospective issuance.

### 4. Check the tax guide's response to changed facts

Open an invoice's guided tax assessment. A reviewed charity registration provides charity supplier facts for the supply date. A positive legacy charity claim without reviewed evidence needs resolution; choosing ordinary-business or NPO answers cannot silently contradict that claim.

Save a draft assessment, then record a new registration revision. The older assessment must be reviewed again before guided publication. Any revision, including a notes-only revision, deliberately invalidates the old confirmation. Replacing a supporting source also requires a new reviewed revision before an action that relies on it.

The existing manual and legacy tax-rate paths remain available with their unassessed status. This change does not automatically determine NPO income-tax status, make all supplies of a charity exempt, or replace the existing supply-specific tax rules.

In this version, publishing a guided decision that relies on charity evidence also requires `documents:read` and access to each linked source. The server checks the source without returning its contents to the invoice editor. A future finance role that can rely on approved facts without access to their source documents needs an explicit delegated-approval policy; this PR keeps the existing source-access boundary.

## Structure

| Module | Responsibility |
| --- | --- |
| `shared/organization/normalize.ts` | Adapt existing legal-form, jurisdiction and Act fields without writing defaults into missing historical data. Report conflicting declarations. |
| `shared/organization/resolveContext.ts` | Resolve the governance model, reviewed core profile, preparation coverage and relevant classification issues. Expose shared backend guards. |
| `shared/organization/assessWorkflow.ts` | Assess applicability, software coverage and information readiness for a named workflow, with reasons and next steps. |
| `shared/receipting/registration.ts` | Select a consistent registration revision chain, check evidence completeness and assess dates. |
| `shared/functions/receiptRegistration.ts` | Authorize registration reads and append-only revisions; compare expected revisions and reviewed source fingerprints. |
| `shared/functions/receiptEvidence.ts` | Capture retained evidence, enforce source ownership and access, allocate serials, and validate gift links. |
| `shared/functions/receiptRetention.ts` | Protect evidence documents and versions after registration review or signed issue, including after voiding a receipt. |
| `shared/functions/receipts.ts` | Authorize acknowledgements, official preparations, signed issuance, idempotent retries, voids and replacements. |
| `shared/tax/organizationFacts.ts` | Compare dated organization facts with guided tax answers and version confirmations. |
| `shared/functions/organizationTaxFacts.ts` | Load authorized organization facts and produce a restricted projection for invoice editors. |
| `src/components/OrganizationRegistrationProfile.tsx` | Profile assessment, dated evidence editor and revision history. |
| `src/pages/Receipts.tsx` | Acknowledgement, preparation, paper-signature and retained-copy workflows. |

Each workflow assessment returns `applicability`, `coverage`, `readiness`, `reasons`, evidence identifiers and rule references where relevant. User authorization remains a separate check. A profile card does not grant access and is not an authorization token. Write handlers reload the relevant facts at the time of the action.

The same portable handlers run in hosted Convex and the local runtime. Hosted wrappers retain validators and authorization, and the portable registry includes the new operations. No schema deployment or production data migration is performed by opening this PR.

The local compatibility dispatcher accepts only declared public writes of the requested invocation kind. Invented CRUD names and invoking a mutation as an action cannot fall through to generic writes that bypass the receipt or evidence handlers. Declared legacy upload and document functions remain available.

## Storage and API changes

`organizationTaxRegistrations` is a new organization-scoped revision table. This implementation supports `CA-CRA-CHARITY` as its first registration type. A revision records status, effective dates, registered details, retained evidence snapshots, operator identity and timestamps. The schema leaves historical receipt fields optional; existing receipts are not rewritten into the new official workflow.

This first implementation assesses one registration period and its corrections at a time. An end-date revision can close the same period, and overlapping revisions can correct its dates. If a later, separate registration period would classify a date covered by earlier reviewed evidence as unregistered, the assessment instead requires a historical-period review. That conflict blocks business/NPO guided tax confirmation and publication and official receipting for the affected date. Dates inside the latest reviewed period remain assessable, subject to the other evidence and gift checks. Changing the latest status to unknown or pending also retains a review requirement when positive registration claims appear earlier in the history. Reversing an erroneous historical registration claim and managing multiple registration periods require separately reviewed workflows; issued snapshots retain their original facts.

`donationReceiptSequences` stores an organization's monotonically increasing numeric receipt sequence. Prepared and voided numbers remain consumed. Before allocating another number, the handler checks unassessed imported numbers and marks only their sequence-assessment metadata. It never changes their original number, content or document kind.

New receipt fields include explicit document kind and issue state, issuer and gift-assessment snapshots, source acknowledgement, gift identity, signed-copy snapshot, request fingerprint, and replacement links. A receipt and its linked acknowledgement represent one gift for downstream donation totals. Voided and unsigned official preparations are not independently counted as newly received gifts.

The new operations are:

- `receipts:registrationHistory`: dated revision history and an organization-side assessment.
- `receipts:evidenceForReview`: authorized fingerprints and source metadata, or a review issue, without document bodies.
- `receipts:recordRegistration`: a new revision using the expected current revision and reviewed fingerprints.
- `receipts:issue`: explicitly create an acknowledgement or prepare an official receipt.
- `receipts:finalizeOfficial`: record signed issue against the selected proof fingerprint.

Callers of `receipts:issue` must now supply `documentKind` and `idempotencyKey`. This is an intentional API contract change: a supplied charity number no longer implies that the caller wants or is entitled to an official receipt. Repeating the same request key and payload returns its original result; reusing that key for different content is rejected. `receipts:remove` rejects numbered records and directs callers to void them.

Registration revisions and sequence counters are included in hosted and local workspace exports. The legacy charity profile fields are retained as claims for compatibility; they do not become evidence merely because they were populated before this change.

## Evidence and history guarantees

- A reviewed registration pins the selected source revision or source content fingerprint. Later uploads do not silently replace that review.
- An issued receipt pins the issuer details, applicable registration revision, gift assessment, and selected signed file version or retained native blob. Later profile changes do not alter those snapshots.
- Source edits and file metadata changes that would rewrite retained proof are rejected before writes. Documents can retain descriptive metadata and be archived, and a new version can be uploaded without rewriting the historic version.
- Tenant ownership, document access and action permission remain enforced. The invoice editor receives only the registration facts needed for the guide, not registration documents, account details, reviewer identity or internal notes.
- Gift links survive void and replacement chains. One linked gift cannot acquire two active official preparations or receipts by replacing an acknowledgement or omitting its earlier source link.
- A stale review, conflicting revision chain, unsupported file provider, or oversized history produces a review requirement instead of a truncated eligibility decision.

Current explicit bounds are 200 registration revisions, 20 sources per review, 200 versions in an evidence-document review, and 5,000 unassessed imported receipt numbers. Retention checks allow up to 200 signed-copy references per document or blob and 200 retained parent documents per blob. The current receipt register view is also limited to 5,000 records and directs larger registers to export and review. These bounds are deliberate limits of this first implementation, not silent record deletion. Larger histories need a reviewed migration or paginated workflow.

## Validation

Run the new focused contract suite:

```sh
npm run test:organization-workflows
```

It checks organization-specific action enforcement, receipt and evidence behavior in the portable runtimes, hosted Convex receipt contracts, evidence retention, tax facts, and local write-dispatch integrity. Related existing suites cover governance vocabulary, setup, company ownership, invoice calculations, tax guidance and filing preparation.

Run the browser walkthroughs:

```sh
npx playwright install --with-deps chromium
npm run test:organization-workflows-ui
npm run test:tax-guidance-ui
```

The new organization workflow suite covers desktop and phone, pending-to-reviewed registration history, a real synthetic PDF download, acknowledgement-to-official preparation, signed-copy retention, reload persistence and horizontal overflow. It uses the existing local IndexedDB runtime and does not require a production backend. The dedicated suite is excluded from the default static-preview test harness.

The new **Organization workflows** GitHub Actions job runs the focused contracts and browser walkthroughs. Existing **Organization and tax guidance** and **Legal governance and evidence** jobs continue to check related behavior, application types, hosted types and the production build. The PR's validation section records which checks actually ran and any environment or baseline limitations.

## Deliberately left for later work

This establishes a reusable separation of identity, registration, workflow readiness and permission. It does not add new country or Act rule packs, determine all statutory member-funded or public-benefit exceptions, implement cooperative or partnership ownership automation, establish beneficial ownership requirements, or automate charity applications and government filings. Those should be separate workflows with their own supported scope, source dates, facts and evidence.

References used for the distinctions and the supported receipt fields:

- [CRA: Registered charities and nonprofit organizations](https://www.canada.ca/en/revenue-agency/services/charities-giving/about-registered-charities/what-difference-between-a-registered-charity-a-non-profit-organization.html)
- [CRA: Issuing complete and accurate donation receipts](https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/checklists-charities/issuing-complete-accurate-donation-receipts.html)
- [BC Societies Act](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01)

These references define the scope to review; a software coverage label is not a certification that every requirement has been satisfied.

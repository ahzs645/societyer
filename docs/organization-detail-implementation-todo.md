# Organization Detail Implementation TODO

Source: OrgHub-derived organization detail inventory, reviewed against Societyer on 2026-04-21.

Purpose: track the first implementation pass for broader organization detail support beyond the current BC-society profile model.

## Implementation Pass Completed

- Added first-class statutory dossier fields to `societies`.
- Added `organizationAddresses`, `organizationRegistrations`, `organizationIdentifiers`, `policies`, `workflowPackages`, and `minuteBookItems`.
- Added Convex CRUD/overview functions and generated API bindings.
- Added app pages for Organization details, Minute book, Policy registry, and Workflow packages.
- Wired the new pages into routes, sidebar navigation, command palette, and i18n labels.
- Extended tasks with responsible users and links to filings, workflows, documents, and event IDs, including link-type filters.
- Added governance-register promotion from reviewed board-role evidence into the current director register.
- Added legacy address seeding from the existing society profile strings into structured address rows.
- Added import-session promotion support for organization addresses, registrations, identifiers/tax registrations, policies, workflow packages, and minute-book items.
- Tightened signature mutations so signing and revocation require an acting workspace user, with admin-only signing/revocation on behalf of another user.
- Added import promotion gates for duplicate detection, required-field validation, review-confidence blocking, and review notes before promotion for organization detail records.
- Added minute-book completeness checks for core documents, signatures, filings, unresolved resolutions, paper-book archive evidence, package gaps, policy review gaps, and meetings without minutes.
- Connected policy rows to lifecycle signals across PIPA training, transparency publications, document versions, workflows, tasks, review dates, and required signer tasks.
- Added workflow package lifecycle signals and actions for signer state, payment state, generated follow-up tasks, linked filings, and filed status.
- Added idempotent auto-backfill plus manual re-run from legacy society address strings and existing legal document categories/tags into structured organization address and minute-book records.
- Added richer task editing for linked filing/workflow/document/event fields and completion notes.
- Added `npm run test:org-details` as a focused smoke check for the new schema, promotion paths, lifecycle actions, and pages.

Remaining refinement areas: deeper duplicate review UX inside import sessions, more precise minute-book jurisdiction checklists, and end-to-end browser tests after a seeded legal-record fixture exists.

## What To Implement First

### 1. Organization Dossier / Statutory Profile

- [ ] Decide whether to extend `societies` directly or add a companion table such as `organizationDossiers`.
- [ ] Add first-class fields for:
  - `entityType`
  - `actFormedUnder`
  - `officialEmail`
  - `numbered`
  - `distributing`
  - `soliciting` / `publicBenefit`
  - `archived` / `status`
  - `removedAt`
  - `continuanceDate`
  - `amalgamationDate`
  - `naicsCode` optional
  - `niceClassification` optional
- [ ] Update the Society profile UI to expose the fields that should be editable or reviewable by admins.
- [ ] Preserve the current BC-society defaults and avoid breaking existing seeded demo data.

Current state: `societies` already covers name, incorporation number/date, fiscal year end, jurisdiction, charity/member-funded flags, registered/mailing addresses, purposes, and canonical document refs in `convex/schema.ts:5` and `src/pages/Society.tsx:131`, but it is BC-society shaped rather than a full registry dossier.

### 2. Structured Addresses + Registration Records

- [ ] Add an `organizationAddresses` table or equivalent companion model.
- [ ] Support structured address fields:
  - `type`
  - `status`
  - `effectiveFrom`
  - `effectiveTo`
  - `street`
  - `unit`
  - `city`
  - `provinceState`
  - `postalCode`
  - `country`
- [ ] Decide how existing string fields `registeredOfficeAddress` and `mailingAddress` migrate into structured address rows.
- [ ] Add an `organizationRegistrations` table for extra-provincial and external registrations.
- [ ] Support registration fields:
  - `jurisdiction`
  - `assumedName`
  - `registrationNumber`
  - `registrationDate`
  - `activityCommencementDate`
  - `deRegistrationDate`
  - `nuansNumber`
  - `officialEmail`
  - `representativeIds`
- [ ] Add UI for current and historical address/registration review.

### 3. Tax / Registry Account Metadata

- [ ] Add a restricted `organizationIdentifiers` or `taxRegistrations` table.
- [ ] Support identifier fields:
  - `kind`
  - `number`
  - `jurisdiction`
  - `foreignJurisdiction`
  - `registeredAt`
  - `status`
  - `sourceDocumentIds`
- [ ] Define which identifiers are safe to display broadly and which require restricted access.
- [ ] Route unverified or document-derived numbers through import review and source evidence before promotion.
- [ ] Store credentials and keys only in the existing access-custody vault.
- [ ] Do not import raw secrets, passwords, recovery keys, registry keys, API keys, or certificate bodies through AI/import JSON.

Current state: `secretVaultItems` is already the right model for company keys, registry keys, API keys, passwords, and recovery codes in `convex/schema.ts:2077` and `convex/secrets.ts:137`.

### 4. Governance Roles Beyond Directors

- [ ] Keep the current `directors` register as the legal/current director register.
- [ ] Add or promote a unified governance-role view for:
  - officers
  - incorporators
  - authorized representatives
  - attorneys for service
  - signing authorities
  - committee roles
  - historical appointments/resignations
- [ ] Use existing `boardRoleAssignments`, `boardRoleChanges`, and `signingAuthorities` as evidence/history where possible.
- [ ] Add a promotion flow from reviewed evidence into current legal registers.
- [ ] Clearly distinguish observed/imported evidence from current legal state.

Current state: Societyer already has `directors`, `boardRoleAssignments`, `boardRoleChanges`, and `signingAuthorities` in `convex/schema.ts:925`, `convex/schema.ts:942`, and `convex/schema.ts:989`. The missing piece is a unified UI and promotion flow from evidence into legal/current registers.

### 5. Minute Book / Records Binder

- [ ] Add a legal record spine or "minute book" screen that links:
  - documents
  - meetings
  - minutes
  - resolutions
  - filings
  - signatures
  - policies
  - effective dates
  - archived status
  - source evidence
- [ ] Decide whether this is a new table, a derived view over existing records, or both.
- [ ] Support document grouping by legal record type and lifecycle status.
- [ ] Support source-backed review before records are treated as canonical.
- [ ] Expose missing-record checks for common minute-book requirements.

Current state: `documents` already supports title, category, file metadata, tags, archive flags, source IDs, and import metadata in `convex/schema.ts:1426`, but there is no canonical minute-book screen tying those records into a legal binder.

### 6. Policy + Template Registry

- [ ] Make policies first-class instead of relying only on document tags/publications.
- [ ] Add a policy/template registry model with:
  - `policyName`
  - `policyNumber`
  - `owner`
  - `effectiveDate`
  - `reviewDate`
  - `ceasedDate`
  - `docxDocumentId`
  - `pdfDocumentId`
  - `html`
  - `requiredSigners`
  - `signatureRequired`
  - `jurisdictions`
  - `entityTypes`
- [ ] Connect policies to Documents, PIPA training, workflows, and transparency.
- [ ] Track review cycles and ceased/superseded policies.
- [ ] Decide how workflow templates and reusable policy templates relate.

### 7. Workflow Legal Package Metadata

- [ ] Extend workflows/runs or add a `workflowPackages` table.
- [ ] Support package/event fields:
  - `eventType`
  - `effectiveDate`
  - `status`
  - `package`
  - `parts`
  - `notes`
  - `supportingDocumentIds`
  - `priceItems`
  - `transactionId`
  - `signerRoster`
  - `signerEmails`
  - `signingPackageIds`
  - `stripeCheckoutSessionId`
- [ ] Keep workflow telemetry separate from legal evidence records.
- [ ] Link packages to documents, signatures, filings, tasks, and billing records where appropriate.
- [ ] Add UI for package/effective-date/signer lifecycle review.

Current state: workflows track recipe, provider, trigger, node config, and run output in `convex/workflows.ts:479`, but not legal package/effective-date/signer lifecycle.

### 8. Action Items With Real Links

- [ ] Extend `tasks` with:
  - `responsibleUserIds`
  - `filingId`
  - `workflowId`
  - `documentId`
  - `eventId`
  - `completionNote`
  - `completedByUserId`
- [ ] Add task generation from compliance events only where the source event is reviewed enough.
- [ ] Preserve simple manual tasks while enabling linked compliance follow-through.
- [ ] Add UI filters for linked filings, workflows, documents, and organization events.

Current state: tasks currently have title, description, status, priority, assignee string, due date, committee/meeting/goal links, and tags in `convex/tasks.ts:31`. That is useful, but too generic for compliance follow-through.

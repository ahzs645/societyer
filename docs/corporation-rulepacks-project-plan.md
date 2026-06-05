# Corporation Rule Packs Project Plan

Purpose: make Societyer support Canadian federal corporations and provincial/extra-provincial registrations without breaking the existing BC society app.

This plan combines two reference patterns:

- OpenFisca-style law modeling: versioned rule packs, parameters, citations, effective dates, fixtures, and tests.
- Captable/Open Cap Format-style equity modeling: stakeholders, securities/classes, transactions, documents, signatures, and auditability.

## Guiding Decisions

- Keep the physical `societies` table and `societyId` foreign keys during the first implementation phase. Treat them as workspace identifiers, not proof that the entity is legally a BC society.
- Add an app-level `Organization` / `LegalEntity` facade before renaming storage. A schema/table rename would touch nearly every page, query, static adapter, import path, generated Convex type, and local snapshot.
- Keep `jurisdictionGuidePacks` as human-readable legal guide content. Add a separate executable `complianceRulePacks` layer for calculations, obligations, filing defaults, validations, and document packet requirements.
- Model share ownership as a ledger first. Current holdings should be derived or periodically materialized from transactions, not manually edited as disconnected rows.
- Start with federal CBCA corporations plus Ontario/BC modules because those match the current guide packs and the user research call.
- Do not automate registry logins or government filing submission in the MVP. First produce correct obligations, document packets, evidence checklists, and registry-account tracking.

## Current Repo Leverage

The repo already has most of the primitives needed for this work:

- `convex/schema.ts`: `societies` has generic organization fields including `jurisdictionCode`, `entityType`, `actFormedUnder`, lifecycle dates, identifiers, privacy settings, and module flags.
- `organizationAddresses`, `organizationRegistrations`, and `organizationIdentifiers`: already support structured registration and registry/account metadata.
- `roleHolders`: already generic enough for directors, officers, incorporators, authorized representatives, attorneys for service, controllers, members, and shareholders.
- `rightsClasses` and `rightsholdingTransfers`: already close to the share-class and transaction-ledger shape.
- `legalTemplates`, `legalPrecedents`, `legalPrecedentRuns`, and `generatedLegalDocuments`: already provide the beginning of a document-generation/workflow layer.
- `jurisdictionGuidePacks`: already includes `CA-BC`, `CA-FED-CBCA`, and `CA-ON-OBCA`.
- `localDexieRowStore`: generic record envelopes mean new logical tables can be added without immediately redesigning local-first storage.

## Glossary And Canonical Values

- Organization: the user-facing legal entity/workspace facade. It can be a society, corporation, branch, or extra-provincial registration group while storage still uses `societies`.
- Society: a BC Societies Act workspace. Canonical entity type: `society`; initial jurisdiction module: `CA-BC`.
- Corporation: a business corporation workspace. Canonical entity type: `corporation__business_`; initial jurisdiction modules: `CA-FED-CBCA` and `CA-ON-OBCA`.
- Registration: a home, extra-provincial, business-name, branch, licence, or deregistration record stored in `organizationRegistrations`.
- Stakeholder: a person or entity in `roleHolders`, including directors, officers, shareholders, controllers, authorized filers, incorporators, and attorneys for service.
- Rights class: a membership/right/share class in `rightsClasses`. Corporation share classes use `classType = "share"`.
- Holding: the current derived position for a stakeholder in a rights class.
- Transfer: a ledger event in `rightsholdingTransfers`, including issuance, transfer, redemption, cancellation, conversion, or adjustment.
- Obligation: an executable compliance result computed from rule packs and facts, persisted only when accepted as a task, filing, or workflow decision in the first phase.
- Filing: an internal tracking row in `filings` for a government or tax submission, with jurisdiction-aware default portal/checklist metadata.
- Workspace key: `societyId` remains the storage foreign key in the first phase, even when the workspace is a corporation.

## Reference Architecture

### OpenFisca Pattern To Adapt

OpenFisca country packages separate:

- entities
- variables
- parameters
- reforms / overrides
- situation examples
- tests

Societyer should adapt that into TypeScript/JSON:

- `complianceRulePacks`: jurisdiction/entity applicability, obligation rules, validation rules, filing defaults, document packet rules.
- `complianceParameters`: date windows, thresholds, recurrence rules, required evidence kinds, fee metadata where relevant.
- `complianceFacts`: normalized facts extracted from the organization workspace.
- `complianceResults`: derived obligations and warnings with rule ids, facts used, source citations, effective dates, and confidence/review state.
- `complianceFixtures`: test workspaces for CBCA corporation, Ontario corporation, federal plus Ontario extra-provincial registration, BC society, and federal plus BC extra-provincial registration.

### Captable / OCF Pattern To Adapt

Captable's useful split is:

- company / issuer
- stakeholders
- share classes / securities
- transactions
- convertible instruments / options / SAFEs
- documents and e-signatures
- access/sharing/auditability

Societyer should not copy Captable's full product. Instead, adapt the domain model:

- `Organization` maps to issuer/company.
- `RoleHolder` maps to stakeholder/person/entity.
- `RightsClass` maps to stock/share/membership class.
- `RightsholdingTransfer` maps to transaction events.
- Add `RightsHolding` as a current-position materialized table or derived view.
- Existing documents/signatures/minute-book items become the legal evidence layer for each transaction.
- Keep advanced startup finance instruments out of the first MVP unless they are needed by a real corporation user.

## Target Domain Model

### Organization

Compatibility layer over `societies`.

Fields already present or near-present:

- legal name
- incorporation number
- incorporation date
- fiscal year end
- home jurisdiction
- entity type
- act formed under
- status
- official email
- registered office
- mailing address
- lifecycle dates
- public/private module flags

Needed additions or aliases:

- `homeJurisdictionCode`
- `primaryRegistrationId`
- `organizationKind` display helper
- `anniversaryDate`
- `corporationKeyVaultItemId` or equivalent restricted secret-vault link

### Registration

Use `organizationRegistrations`.

Registration rows should distinguish:

- `home`
- `extra_provincial`
- `business_name`
- `branch`
- `licence`
- `deregistered`

Needed fields or normalized conventions:

- `registrationType`
- `registryPortalKey`
- `profileReportDocumentId`
- `companyKeyVaultItemId`
- `annualReturnDueDate`
- `lastAnnualReturnFiledDate`

### Role Holder

Use `roleHolders` as the unified legal-person register.

Role types for corporation MVP:

- `director`
- `officer`
- `incorporator`
- `shareholder`
- `controller`
- `authorized_representative`
- `attorney_for_service`

Keep `directors` as a legacy/current director view until the UI is migrated.

### Equity / Rights

Use and extend:

- `rightsClasses`
- `rightsholdingTransfers`

Add either a derived selector or first-class table:

- `rightsHoldings`

Minimum fields:

- `societyId`
- `rightsClassId`
- `holderRoleHolderId`
- `quantity`
- `status`
- `lastTransactionId`
- `sourceDocumentIds`
- `updatedAtISO`

The ledger event types should include:

- `issuance`
- `transfer`
- `redemption`
- `cancellation`
- `conversion`
- `adjustment`

### Compliance Obligation

Add a derived or persisted obligation model for:

- federal annual return
- ISC review/update
- Ontario initial return
- Ontario notice of change
- Ontario annual return
- BC society annual report
- BC extra-provincial annual report
- registered office change
- director/officer/controller change

The first version can compute obligations in memory from rule packs and existing records. Persist only when an obligation becomes a task, filing, or workflow.

## Proposed File Layout

```text
src/lib/compliance/
  complianceRuleSchema.ts
  complianceRulePackRegistry.ts
  complianceEngine.ts
  complianceFacts.ts
  complianceObligations.ts
  complianceRulePacks/
    ca-fed-cbca.json
    ca-on-obca.json
    ca-bc-societies.json
    ca-bc-extra-provincial-company.json
    README.md

scripts/
  validate-compliance-rule-packs.ts
  check-compliance-obligations.ts
  check-corporation-equity-ledger.ts

shared/
  jurisdictionWorkspace.ts
  organizationDomain.ts

convex/
  organizationWorkspace.ts
  compliance.ts
  equity.ts
```

## Compliance Rule Pack Shape

```ts
type ComplianceRulePack = {
  schemaVersion: "1.0.0";
  packId: string;
  jurisdictionCode: string;
  title: string;
  status: "draft" | "reviewed" | "accepted" | "deprecated";
  version: string;
  reviewedAt: string;
  appliesTo: {
    entityTypes: string[];
    homeJurisdiction?: boolean;
    extraProvincial?: boolean;
    registrationTypes?: string[];
    conditions?: RuleCondition[];
  };
  sources: {
    guidePackId?: string;
    guideRuleIds: string[];
    verifiedAt: string;
  };
  parameters: ComplianceParameter[];
  obligations: ComplianceObligationRule[];
  validations: FieldValidationRule[];
  filingTemplates: FilingTemplateRule[];
};
```

Each executable result should include:

- `packId`
- `ruleId` or `obligationKey`
- `sourceGuideRuleIds`
- `factsUsed`
- `computedDueDate`
- `severity`
- `explanation`
- `effectiveFrom`
- `verifiedAt`

## Implementation Phases

### Phase 0: Project Setup

- [ ] Add this project plan to the repo.
- [ ] Add a lightweight glossary: organization, society, corporation, registration, stakeholder, rights class, holding, transfer, obligation, filing.
- [ ] Decide the canonical entity-type values for:
  - BC society
  - federal CBCA corporation
  - Ontario OBCA corporation
  - extra-provincial corporation
- [ ] Confirm that `societyId` remains a workspace key for the first project phase.

### Phase 1: Organization Facade

- [ ] Add `shared/organizationDomain.ts`.
- [ ] Export helpers:
  - `organizationLabel(workspace)`
  - `organizationEntityType(workspace)`
  - `homeJurisdictionCode(workspace)`
  - `isCorporation(workspace)`
  - `isSociety(workspace)`
  - `isFederalCbca(workspace)`
- [ ] Add `useOrganizationWorkspace` as an alias over `useSociety`.
- [ ] Keep `useSociety` in place for old screens.
- [ ] Update creation/edit copy where user-facing text says "society" but means "organization".

Deliverable: new code can stop importing society-specific assumptions without a storage migration.

### Phase 2: Jurisdiction Module Contract

- [ ] Expand `shared/jurisdictionWorkspace.ts` from display copy into a module contract.
- [ ] Add module config for:
  - `CA-BC` society
  - `CA-FED-CBCA` corporation
  - `CA-ON-OBCA` corporation
  - `CA-BC-EXTRAPROV-COMPANY` if BC extra-provincial support needs a separate module key
- [ ] Include:
  - entity labels
  - registry portal labels
  - filing portal URLs
  - director/officer labels
  - bylaw/default rule labels
  - enabled modules
  - supported registration types
  - compliance pack ids
- [ ] Stop silently defaulting unresolved jurisdictions to BC outside workspace creation.

Deliverable: BC-specific UI behavior can be gated by module config.

### Phase 3: Compliance Rule Pack Foundation

- [ ] Add `src/lib/compliance/complianceRuleSchema.ts`.
- [ ] Add `src/lib/compliance/complianceRulePackRegistry.ts`.
- [ ] Add `src/lib/compliance/complianceEngine.ts`.
- [ ] Add validation script `scripts/validate-compliance-rule-packs.ts`.
- [ ] Add smoke script `scripts/check-compliance-obligations.ts`.
- [ ] Add `npm` scripts:
  - `test:compliance-rules`
  - optionally include it in `npm run build` later after the format stabilizes.

Deliverable: executable compliance packs can be validated and evaluated against fixture facts.

### Phase 4: Federal CBCA Pack MVP

- [ ] Add `ca-fed-cbca.json`.
- [ ] Include obligations:
  - annual return
  - ISC annual review/update
  - director change review
  - registered office change review
  - corporation key custody review
- [ ] Add fixture workspaces:
  - newly incorporated federal corporation
  - overdue annual return
  - annual return filed
  - ISC change detected
- [ ] Ensure each rule references existing guide pack rule ids or has a source gap explicitly marked.

Deliverable: a federal corporation workspace can produce a useful compliance checklist without direct government automation.

### Phase 5: Ontario and BC Modules

- [ ] Add `ca-on-obca.json`.
- [ ] Model Ontario as both home jurisdiction and extra-provincial registration support where practical.
- [ ] Include:
  - initial return
  - annual return
  - notice of change
  - company key custody
  - profile report evidence
- [ ] Add `ca-bc-societies.json` or bridge from current BC society logic.
- [ ] Add BC extra-provincial company pack if needed for federal corporations operating in BC.

Deliverable: users can attach Ontario/BC registrations to a federal corporation and see separate obligations.

### Phase 6: Filings Generalization

- [ ] Replace `filingDefaults(kind)` in `convex/filings.ts` with jurisdiction/entity-aware defaults.
- [ ] Pass `societyId` or `{ jurisdictionCode, entityType, registrationId, filingKind }` into default resolution.
- [ ] Update `src/pages/Filings.tsx` so BC Registry connector actions appear only for BC-supported modules.
- [ ] Add filing kinds for:
  - `federal_annual_return`
  - `federal_isc_update`
  - `ontario_initial_return`
  - `ontario_notice_of_change`
  - `ontario_annual_return`
  - `bc_society_annual_report`
  - `bc_extra_provincial_annual_report`

Deliverable: filing UX no longer assumes every registry action is BC Societies Online.

### Phase 7: Directors and Role Holders

- [ ] Move BC director-residency/minimum checks out of `Directors.tsx`.
- [ ] Add jurisdiction-aware director display rules.
- [ ] Add a role-holder-backed corporation people view:
  - directors
  - officers
  - shareholders
  - controllers
  - authorized filers
- [ ] Preserve existing directors page behavior for BC society workspaces.

Deliverable: corporation users can track directors/officers/controllers without inheriting BC society rules.

### Phase 8: Captable / Equity Ledger MVP

- [ ] Add `convex/equity.ts` or equivalent functions around existing rights tables.
- [ ] Add CRUD for share classes through `rightsClasses` where `classType = "share"`.
- [ ] Add ledger events through `rightsholdingTransfers`.
- [ ] Add derived current holdings:
  - selector/view first
  - persisted `rightsHoldings` later if needed
- [ ] Add a "Share register" page or corporation-only tab.
- [ ] Link each transaction to:
  - generated document
  - minute-book item
  - signer records
  - source evidence
- [ ] Add script test for:
  - issuance
  - transfer
  - cancellation
  - no negative holdings
  - no transfer more than holder balance

Deliverable: one-person corporations and simple holding-company ownership chains can be represented better than a spreadsheet.

### Phase 9: Document Packet Workflows

- [ ] Add document packet definitions to compliance packs or a sibling template-pack layer.
- [ ] First document packets:
  - organize corporation / initial resolutions
  - appoint director
  - appoint officer
  - issue shares
  - annual resolutions
  - ISC register update
  - extra-provincial registration evidence packet
- [ ] Use existing `legalTemplates`, `legalPrecedents`, `legalPrecedentRuns`, and `generatedLegalDocuments`.
- [ ] Keep generated DOCX/editable documents as primary outputs, PDFs as final/archive outputs.

Deliverable: compliance findings can create minute-book-ready work, not just reminders.

### Phase 10: Local-First and Snapshot Validation

- [ ] Bump local workspace snapshot schema version only when new data starts being exported.
- [ ] Add snapshot migration for old BC society workspaces:
  - add default jurisdiction/entity fields
  - seed home registration row if missing
  - keep old address strings as fallback
- [ ] Add Dexie round-trip test for:
  - BC society snapshot
  - federal corporation snapshot
  - federal plus Ontario extra-provincial snapshot
  - equity ledger snapshot
- [ ] Defer Convex CRDT/sync-engine changes until the domain shape stabilizes.

Deliverable: offline/local mode remains trustworthy as the corporation model grows.

## MVP Definition

The MVP is complete when a user can:

1. Create a federal CBCA corporation workspace.
2. Add directors, officers, shareholders, and controllers.
3. Add share classes and issue shares.
4. See current share holdings derived from transactions.
5. Add Ontario extra-provincial registration.
6. See federal annual return and ISC obligations.
7. See Ontario registration obligations.
8. Generate or stage minute-book work for share issuance and annual maintenance.
9. Export/import the local workspace without losing corporation data.
10. Run rule-pack and equity-ledger test scripts successfully.

## Non-MVP

- Direct government filing submission.
- Registry session scraping as product behavior.
- Full accounting/tax filing.
- Options, SAFEs, convertible notes, and complex venture instruments.
- Full table rename from `societies` to `organizations`.
- Replacing Convex/Dexie storage architecture.

## Test Plan

- `npm run test:jurisdiction-guides`: existing source-backed guide validation.
- `npm run test:compliance-rules`: new compliance pack validation and obligation fixtures.
- `npm run test:org-details`: existing organization-detail smoke.
- `npm run test:corporation-equity`: new share-class/transaction/current-holding checks.
- Playwright flows:
  - create federal corporation
  - add share class
  - issue shares
  - add Ontario registration
  - view generated obligations
  - create filing/evidence checklist

## Suggested Work Breakdown

### PR 1: Organization Facade

- Add `shared/organizationDomain.ts`.
- Add `useOrganizationWorkspace` compatibility hook.
- Add tests for helpers.
- No schema changes.

### PR 2: Jurisdiction Module Contract

- Expand `shared/jurisdictionWorkspace.ts`.
- Update Directors, Filings, and Bylaw Rules copy/config reads where low-risk.
- No new rule engine yet.

### PR 3: Compliance Rule Pack Skeleton

- Add compliance schema, registry, validation script, and empty/draft packs.
- Add fixtures and script tests.

### PR 4: Federal CBCA Obligations

- Implement annual return and ISC obligations.
- Surface results on a compliance/checklist page or existing deadlines/filings area.

### PR 5: Filings Generalization

- Make filing defaults jurisdiction-aware.
- Add federal and Ontario filing kinds.

### PR 6: Corporation People

- Add role-holder-backed views for officers/shareholders/controllers.
- Keep current directors screen intact.

### PR 7: Share Register MVP

- Add share class and transfer helpers.
- Add current-holdings derivation.
- Add share register UI.

### PR 8: Document Packets

- Wire share issuance and annual maintenance into legal template/workflow records.

## Open Questions

- Should `rightsHoldings` be persisted immediately, or should current holdings remain derived until performance requires materialization?
- Should compliance obligations be persisted as first-class rows, or generated into tasks/filings only when the user accepts them?
- Should Ontario extra-provincial support use `CA-ON-OBCA` or a separate `CA-ON-EXTRAPROV-CORP` module code?
- How much of OCF should be supported: only stock classes and stock issuance, or also stock plans, options, convertibles, and valuations?
- Who can mark a legal/compliance rule pack as `reviewed` or `accepted`?

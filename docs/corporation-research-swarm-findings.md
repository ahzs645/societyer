# Corporation Research Swarm Findings

Date: 2026-06-05

Purpose: synthesize the research swarm into implementation guidance for expanding Societyer from a BC society-first app into an organization compliance platform for Canadian federal corporations, provincial corporations, extra-provincial registrations, and BC societies.

This is product and engineering research, not legal advice. Rule packs should stay `draft` until reviewed against current official sources and, ideally, by a qualified legal reviewer.

## Executive Recommendation

Keep the current storage compatibility strategy: do not rename `societies` or `societyId` yet. Instead, strengthen the existing organization facade and compliance rule-pack layer.

The next implementation step should not be a broad feature build. It should be a rule/data model upgrade that can distinguish:

- a home jurisdiction obligation, such as a federal CBCA annual return;
- an extra-provincial registration obligation, such as Ontario CIA initial return for a federal corporation carrying on business in Ontario;
- an entity subtype obligation, such as BC society, BC company, Ontario corporation, benefit company, or foreign licensed corporation;
- an operational reminder from a legal obligation.

The current rule-pack foundation is useful, but it is too shallow for this distinction because applicability is currently based mainly on `jurisdictionCode + entityType`.

## Existing Repo Fit

Useful existing files:

- `docs/corporation-rulepacks-project-plan.md`
- `shared/organizationDomain.ts`
- `shared/jurisdictionWorkspace.ts`
- `src/lib/compliance/rulePackSchema.ts`
- `src/lib/compliance/engine.ts`
- `src/lib/compliance/facts.ts`
- `src/lib/compliance/rulePacks/ca-fed-cbca.json`
- `src/lib/compliance/rulePacks/ca-on-obca.json`
- `src/lib/compliance/rulePacks/ca-bc.json`
- `src/lib/compliance/rulePacks/ca-bc-extra-provincial-company.json`

The repo already has the right high-level plan:

- keep `societyId` as a workspace key;
- use `Organization` / `LegalEntity` as the public facade;
- keep human-readable jurisdiction guide packs separate from executable compliance rule packs;
- build equity/share ownership as a ledger;
- avoid registry-login automation in the MVP.

## Main Data Model Change

Add richer applicability facts before expanding packs further.

Recommended `ComplianceFacts` additions:

```ts
type ComplianceContextKind = "home" | "extra_provincial" | "branch" | "business_name";

type ComplianceFacts = {
  jurisdictionCode: string;
  entityType: string;
  entitySubtype?: string;
  homeJurisdictionCode?: string;
  contextKind: ComplianceContextKind;
  registrationType?: string;
  corporationClass?: string;
  status?: string;
  incorporationDate?: string;
  anniversaryDate?: string;
  fiscalYearEnd?: string;
  registrationDate?: string;
  commencedBusinessDate?: string;
  annualMeetingDate?: string;
  eventDates?: Record<string, string | undefined>;
};
```

Recommended rule-pack additions:

```ts
type AppliesTo = {
  entityTypes: string[];
  entitySubtypes?: string[];
  contextKinds?: ComplianceContextKind[];
  homeJurisdictionCodes?: string[];
  registrationTypes?: string[];
  corporationClasses?: string[];
  conditions?: RuleCondition[];
};
```

This lets the app model examples like:

- federal home corporation: `jurisdictionCode = CA-FED-CBCA`, `contextKind = home`;
- federal corporation registered in Ontario: `jurisdictionCode = CA-ON-OBCA`, `homeJurisdictionCode = CA-FED-CBCA`, `contextKind = extra_provincial`, `corporationClass = class_2`;
- Ontario home corporation: `jurisdictionCode = CA-ON-OBCA`, `contextKind = home`;
- BC society: `jurisdictionCode = CA-BC`, `entityType = society`, `contextKind = home`;
- BC extra-provincial company: `jurisdictionCode = CA-BC`, `entityType = corporation__business_`, `contextKind = extra_provincial`.

## Federal CBCA Pack Gaps

The current `ca-fed-cbca.json` pack has the right starting obligations, but should be expanded or corrected around these areas.

Add explicit rules for:

- annual return due within 60 days after the corporation anniversary;
- ISC filing at the same time as annual return;
- ISC change filing within 15 days of a change recorded in the ISC register;
- initial ISC filing on incorporation, and within 30 days after amalgamation or continuance;
- Form 6 director changes within 15 days;
- Form 3 registered office changes within 15 days;
- annual shareholder meeting timing;
- financial statements sent to shareholders at least 21 days before annual meeting;
- records/minute-book evidence checklist.

Add federal data fields:

- corporation number;
- business number;
- corporation key custody state;
- registered office;
- records location;
- director count/range;
- director residency / eligibility evidence;
- share classes;
- share/securities register;
- ISC register;
- annual return confirmation/evidence.

Official source anchors:

- Corporations Canada says every federal corporation must file an annual return every year, and CBCA annual return/ISC filing requires full access or corporation key access: https://ised-isde.canada.ca/site/corporations-canada/en/keep-your-corporation-good-shape/annual-return
- Corporations Canada lists required corporate records, including articles, by-laws, shareholder minutes/resolutions, filed notices, share register, securities register, director minutes, accounting records, and ISC register: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/corporate-records-and-other-corporate-obligations
- Corporations Canada says ISC information must be filed annually with the annual return, within 15 days of ISC changes, and on incorporation/amalgamation/continuance timelines: https://ised-isde.canada.ca/site/corporations-canada/en/individuals-significant-control/individuals-significant-control-file-your-information

## Ontario Pack Gaps

The current `ca-on-obca.json` mixes home Ontario corporation obligations and Ontario registry obligations. Split rules by context.

Home Ontario corporation:

- initial return within 60 days after incorporation/amalgamation/continuation;
- notice of change within 15 days after changes to registered/head office, directors, five most senior officers, or other filed CIA information;
- annual return within 6 months after taxation year-end;
- beneficial ownership information review, if confirmed in scope.

Federal corporation registered in Ontario:

- model as extra-provincial Class 2;
- no extra-provincial licence appears required for Class 1/Class 2, but CIA filings still apply;
- initial return within 60 days after beginning business in Ontario;
- notice of change within 15 days after changes to CIA-filed information;
- do not apply Ontario annual return to federal extra-provincial corporations unless legally validated.

Add Ontario registration fields:

- Ontario corporation number, where applicable;
- federal corporation number, where applicable;
- company key custody state;
- official email;
- NAICS code;
- Ontario principal place of business;
- date business commenced in Ontario;
- date business ceased in Ontario;
- directors;
- five most senior officers;
- chief officer/manager in Ontario, if any;
- authorizing individual.

Official source anchors:

- Ontario initial return / notice of change for extra-provincial corporations: https://forms.mgcs.gov.on.ca/en/dataset/on00231
- Ontario Business Registry: https://www.ontario.ca/page/ontario-business-registry
- Corporations Canada provincial registration guidance: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/provincial-registration-federal-business-corporations

## BC Pack Gaps

BC needs at least three distinct paths, not one generic BC pack:

- BC society under the Societies Act;
- BC company under the Business Corporations Act;
- BC extra-provincial company / extra-provincial non-share corporation.

BC society:

- annual report due within 30 days after AGM;
- no-AGM fallback report due by January 31 of the following calendar year, unless registrar extension path applies;
- at least 3 directors;
- at least 1 director ordinarily resident in BC;
- member register, director register, constitution, bylaws, minutes/resolutions, financial statements, accounting records.

BC company:

- annual report due within 2 months after recognition/incorporation anniversary;
- at least 1 director, or 3 for public companies;
- shareholders and central securities register rather than members;
- notice of articles, articles, incorporation agreement, director register, shareholder/director minutes/resolutions, financial statements.

BC extra-provincial:

- separate annual report / profile evidence rules;
- separate attorney/agent and local registration facts;
- do not reuse BC society source guide ids for BC company rules.

Official source anchors:

- BC Societies Act annual report section 73: https://www.bclaws.gov.bc.ca/civix/document/id/consol42/consol42/15018_01
- BC Societies Act director number/residency section 40: https://www.bclaws.gov.bc.ca/civix/document/id/consol42/consol42/15018_01
- BC Business Corporations Act annual report section 51: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_02

## Rule Schema Recommendation

Keep the current JSON approach, but add these properties:

```ts
type ComplianceRule = {
  ruleId: string;
  status: "draft" | "reviewed" | "accepted" | "deprecated";
  title: string;
  summary: string;
  obligationKey: string;
  obligationType:
    | "filing"
    | "recordkeeping"
    | "meeting"
    | "ownership_transparency"
    | "registry_access"
    | "tax_reminder"
    | "operational_review";
  legalForce: "required" | "conditional" | "recommended" | "operational";
  appliesTo: AppliesTo;
  schedule: ComplianceObligationSchedule;
  authority: {
    sourceIds: string[];
    displayCitation: string;
  };
  creates?: {
    filingKind?: string;
    requiredEvidence?: string[];
    checklist?: string[];
    suggestedDocumentPackets?: string[];
  };
  caveat?: string;
};
```

Also add source metadata as first-class data:

```ts
type ComplianceSource = {
  sourceId: string;
  title: string;
  url: string;
  sourceKind: "statute" | "regulation" | "government_guidance" | "form" | "policy";
  citation?: string;
  retrievedAt: string;
  effectiveFrom?: string;
  effectiveTo?: string;
};
```

## First Implementation Backlog

1. Update `ComplianceFacts` and rule-pack schema with `contextKind`, `homeJurisdictionCode`, `registrationType`, `corporationClass`, and `appliesTo`.
2. Update `complianceFactsForOrganization` so home facts and registration facts carry different context.
3. Update `filterApplicableCompliancePacks` and rule evaluation to use rule-level applicability, not just pack-level jurisdiction/entity filters.
4. Split Ontario rules into home corporation rules and federal-extra-provincial Ontario rules.
5. Add source metadata objects instead of only display citations.
6. Add federal CBCA rules for ISC change, director change, registered office change, and shareholder meeting/financial statement workflows.
7. Add BC company pack separate from BC society pack.
8. Correct `ca-bc-extra-provincial-company.json` so it references BC Business Corporations Act / registry sources, not BC society guide ids.
9. Add fixture tests:
   - federal corporation incorporated July 12: annual return due within 60 days after July 12 anniversary;
   - federal corporation with ISC change: filing due within 15 days;
   - federal corporation with Ontario registration started March 1: Ontario initial return due 60 days after March 1;
   - Ontario home corporation with fiscal year end December 31: Ontario annual return due within 6 months;
   - BC society AGM May 15: annual report due within 30 days;
   - BC society no AGM in 2026: annual report due January 31, 2027;
   - BC company recognized March 1: annual report due within 2 months after March 1 anniversary.
10. Add contributor docs for writing jurisdiction packs, including official-source requirements and legal-review state.

## Product Boundary

For the MVP, do not automate government login or filing submission. The safer scope is:

- compute obligations;
- build filing packets/checklists;
- track registry-account and key custody;
- store evidence and confirmation numbers;
- generate minute-book documents;
- keep local-first data export/import trustworthy.

Government connector automation can remain a local-only advanced tool until trust, security, and legal boundaries are clearer.

## Remaining Work Backlog - 2026-06-06

This section updates the original backlog after the BC + federal rule-engine implementation pass. The engine, pack split, source metadata, obligation UI, and filing traceability are now largely in place. The remaining work is about trust controls, data capture, evidence workflows, and carrying jurisdiction context through the rest of the product.

### 1. Legal/source Review and Rule Acceptance

Goal: make rule trust explicit before expanding more executable legal content.

Codebase gaps:

- `src/lib/compliance/rulePackSchema.ts` has rule statuses, but status does not yet require review or approval metadata.
- `scripts/validate-compliance-rule-packs.ts` validates source IDs, but does not enforce reviewer/approver evidence for `reviewed` or `accepted` rules.
- `src/pages/ComplianceObligations.tsx` shows sources, but should also surface rule status so users can distinguish draft guidance from reviewed/accepted rules.

Implementation tasks:

1. Add optional review metadata to rule schema: `reviewedBy`, `reviewedAt`, `reviewNotes`, `acceptedBy`, `acceptedAt`, `approvalReference`.
2. Update validation so:
   - `draft` can omit approval metadata;
   - `reviewed` requires source-review metadata;
   - `accepted` requires explicit approval metadata;
   - every executable rule still requires source metadata and `appliesTo`.
3. Show rule status in obligation rows and treat `draft` rules as guidance, not approved compliance advice.
4. Add contributor docs explaining who can move a rule from `draft` to `reviewed` to `accepted`.

Acceptance criteria:

- Validation fails for `accepted` rules without approval metadata.
- Compliance obligations visibly show draft/reviewed/accepted status.
- Rule packs remain usable, but unaccepted rules are not silently presented as approved obligations.

Suggested tests:

- `npm run test:compliance-rules`
- Add validator fixtures for missing source metadata, missing applicability, reviewed-without-reviewer, and accepted-without-approver.

Official-source review queue:

- CBCA annual return: active CBCA business corporations file within 60 days after incorporation/amalgamation/continuance anniversary. Source: https://ised-isde.canada.ca/site/corporations-canada/en/annual-return-business-corporations
- CBCA annual filing policy/status exclusions. Source: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/policy-filing-annual-returns-canada-business-corporations-act
- CBCA ISC filing: annual filing with annual return, changes within 15 days, initial filing on incorporation or within 30 days after amalgamation/continuance. Source: https://ised-isde.canada.ca/site/corporations-canada/en/individuals-significant-control/individuals-significant-control-file-your-information
- CBCA director change notice within 15 days. Source: https://laws-lois.justice.gc.ca/eng/acts/C-44/section-113.html
- CBCA registered office and director address change guidance. Source: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/next-steps-following-incorporation-your-business
- BC company annual report within 2 months after recognition anniversary. Source: https://www.bclaws.gov.bc.ca/civix/document/id/lc/statreg/02057_02
- BC extraprovincial company annual report within 2 months after BC registration anniversary. Source: https://www.bclaws.gov.bc.ca/civix/document/id/consol21/consol21/02057_12

Keep as `draft` until legal review:

- CBCA financial-statement filing for distributing corporations and securities-law exceptions.
- BC extraprovincial "carrying on business" registration trigger.
- BC extraprovincial change notices where the statute uses non-fixed timing such as "promptly".

### 2. Data Capture UI for Compliance Facts

Goal: expose the facts the engine already supports so users do not need seed scripts or hidden fields to trigger corporation obligations.

Codebase gaps:

- `src/lib/compliance/facts.ts` reads event dates such as `iscChangeDate`, `directorChangeDate`, `registeredOfficeChangeDate`, and `noAgmCalendarYearEnd`, but these are not first-class schema/UI fields.
- `convex/schema.ts` has some corporation-oriented fields on `societies`, including `homeJurisdictionCode`, `primaryRegistrationId`, `anniversaryDate`, and `corporationKeyVaultItemId`, but not all rule facts are persisted.
- `src/pages/OrganizationDetails.tsx` does not yet save all compliance fact fields.

Implementation tasks:

1. Add schema and mutation support for:
   - `entitySubtype`
   - `corporationClass`
   - `anniversaryDate`
   - `corporationKeyVaultItemId`
   - `iscChangeDate`
   - `directorChangeDate`
   - `registeredOfficeChangeDate`
   - `noAgmCalendarYearEnd`
2. Add a focused "Compliance facts" panel to organization details rather than overloading the basic profile.
3. Add field-level copy making clear that event dates are legal trigger facts, not filing confirmations.
4. Link missing-fact notices from Compliance Obligations to the relevant field location.

Acceptance criteria:

- A federal corporation user can enter facts that trigger ISC, director-change, registered-office-change, and annual-return obligations through normal UI.
- A BC society user can enter the no-AGM fallback fact through normal UI.
- Current computed-rule fixtures can be reproduced from stored workspace data.

Suggested tests:

- `npm run test:organization-domain`
- `npm run test:compliance-rules`
- Add a mutation-backed fixture that persists event dates and then computes obligations.

### 3. Federal Evidence Workflows

Goal: turn CBCA evidence requirements from rule-pack text into usable checklist/document-packet workflows.

Codebase gaps:

- `shared/corporationDocumentPackets.ts` has generic annual, ISC, share issuance, and extra-provincial packet concepts, but ISC is not split into initial filing, change filing, and annual confirmation evidence.
- `convex/legalOperations.ts` stages corporation document packets with `sourceRegistrationId`, but should also preserve `jurisdictionCode` and `contextKind`.

Implementation tasks:

1. Add dedicated packet/checklist keys:
   - `federal-initial-isc-filing`
   - `federal-isc-change-filing`
   - `federal-annual-return-evidence`
   - `financial-statement-delivery`
   - `corporate-records-review`
2. Link CBCA rules to packet keys where a rule has evidence requirements.
3. Ensure staged packets preserve `ruleId`, `obligationKey`, `filingId`, `jurisdictionCode`, `contextKind`, and `sourceRegistrationId`.
4. Add evidence items for corporation number, business number, corporation key custody, registered office, records location, directors/officers, share classes, securities/share register, ISC register, annual-return confirmation, and financial-statement delivery.

Acceptance criteria:

- Each major CBCA obligation has a packet/checklist path.
- Evidence requirements shown in Compliance Obligations match packet sections.
- Staged packets retain home vs registration context.

Suggested tests:

- `npm run test:corporation-mvp`
- `tsx scripts/check-corporation-document-packets.ts`
- Add a fixture for ISC change -> obligation -> packet -> evidence linkage.

Official-source anchors:

- CBCA corporate records obligations: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/corporate-records-and-other-corporate-obligations
- CBCA ISC register and filing obligations: https://ised-isde.canada.ca/site/corporations-canada/en/individuals-significant-control
- CBCA annual shareholder meeting timing: https://laws-lois.justice.gc.ca/eng/acts/C-44/section-133.html
- CBCA financial statements at annual meeting: https://laws-lois.justice.gc.ca/eng/acts/C-44/section-155.html
- CBCA copies to Director for distributing corporations: https://laws-lois.justice.gc.ca/eng/acts/C-44/section-160.html

### 4. BC Company Polish

Goal: make BC company support feel first-class, separate from BC societies and BC extra-provincial registrations.

Codebase gaps:

- `src/lib/compliance/rulePacks/ca-bc-company.json` exists, but BC company evidence and packet workflows are still thinner than federal workflows.
- `shared/corporationDocumentPackets.ts` should include `CA-BC` where company and extra-provincial packet support applies.
- Existing share/rights storage can support central securities register concepts, but BC company workflow copy and fixtures need to point users there.

Implementation tasks:

1. Add BC company packet/checklist content for:
   - notice of articles
   - articles
   - incorporation agreement
   - central securities register
   - director register
   - shareholder/director resolutions and minutes
   - annual report confirmation evidence
2. Add `CA-BC` to relevant corporation packet jurisdictions.
3. Add deeper BC company fixtures and source-backed evidence requirements.
4. Keep BC society and BC company language separate in UI copy.

Acceptance criteria:

- BC company workspaces receive BC company obligations only.
- BC society workspaces do not receive BC company records obligations.
- BC company records review links to a relevant packet/checklist.
- Federal CBCA workspaces with BC extra-provincial registration still receive separate BC registration obligations.

Suggested tests:

- `npm run test:compliance-rules`
- `npm run test:corporation-mvp`
- Add BC company records/evidence fixture and society/company cross-regression.

Official-source anchors:

- BC Business Corporations Act, annual report section 51 and records sections 42-44: https://www.bclaws.gov.bc.ca/civix/document/id/lc/statreg/02057_02
- BC transparency register guidance, including central securities register and articles as key evidence: https://www2.gov.bc.ca/gov/content/employment-business/business/bc-companies/transparency-register/transparency-register

### 5. Registration Selection UX

Goal: replace raw `sourceRegistrationId` text entry with a registration picker tied to organization registration rows.

Codebase gaps:

- `src/pages/Filings.tsx` currently exposes `sourceRegistrationId` as a text input for extra-provincial filings.
- `convex/organizationDetails.ts` already returns organization registrations, so the data source is available.

Implementation tasks:

1. Query `api.organizationDetails.overview` in `FilingsPage`.
2. When `contextKind === "extra_provincial"`, show a dropdown of active extra-provincial registrations.
3. Auto-fill `jurisdictionCode` from the selected registration.
4. Display registration labels using jurisdiction, registration number, assumed name, and status.
5. Keep raw `sourceRegistrationId` hidden or read-only.

Acceptance criteria:

- Extra-provincial filing creation requires or strongly prompts a selected registration.
- Selecting a registration sets both `sourceRegistrationId` and `jurisdictionCode`.
- Home filings do not show the registration picker.
- Compliance-created filings continue to link correctly.

Suggested tests:

- Extend `scripts/check-static-corporation-obligations.ts`.
- Add regression checks for federal home filings with no `sourceRegistrationId` and BC extra-provincial filings with a registration ID.

### 6. More Product Surfaces

Goal: carry home vs registration context beyond Compliance Obligations and Filings.

Codebase gaps:

- `convex/dashboard.ts` filing summaries omit `jurisdictionCode`, `contextKind`, and `sourceRegistrationId`.
- `src/pages/Dashboard.tsx` still has BC-society-specific compliance copy in places.
- `src/pages/Timeline.tsx` filing events omit jurisdiction/context and use older local filing labels.
- `src/pages/MinuteBook.tsx` and `convex/minuteBook.ts` show filing kind/status/due date but do not badge home vs extra-provincial context.

Implementation tasks:

1. Dashboard: group or badge filings/obligations by home vs extra-provincial context.
2. Timeline/annual cycle: show jurisdiction and context on filing milestones.
3. Minute book/evidence overview: show context for filings and packets.
4. Notifications: include jurisdiction/context where filing labels could be ambiguous.
5. Prefer `filingKindDefinition(kind, jurisdictionCode)` over local hard-coded filing labels.

Acceptance criteria:

- Dashboard does not flatten federal home and BC extra-provincial obligations into one generic "annual report".
- Minute-book bundle shows whether a filing belongs to the home jurisdiction or a registration.
- Reminder text includes jurisdiction when ambiguity exists.

Suggested tests:

- `npm run test:local-snapshots`
- Add a dashboard/timeline fixture for a federal home corporation with BC extra-provincial registration.

### 7. Recommended MVP Sequence

1. Enforce rule approval/source status.
2. Replace filing registration text input with a registration picker.
3. Add first-class data capture fields for currently executable rules.
4. Expand federal evidence packets.
5. Add BC company packet/checklist polish.
6. Carry jurisdiction/context labels into dashboard, timeline, minute book, and notifications.

This sequence keeps the legal trust boundary clear before adding more obligations, then improves the highest-friction user path: linking filings and evidence to actual registration rows.

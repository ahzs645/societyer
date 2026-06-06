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


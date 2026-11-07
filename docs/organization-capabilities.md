# Organization features by Act: audit and extension plan

Audit date: 2026-11-07. This is an audit of product behavior and registered rule coverage, not a new review of legislation. Statutory content shown by the new overview comes from the existing source-linked legal profiles.

## Current separation

Societyer already has separate layers for legal identity, governance rules, preparation documents, setup progress and route visibility. A legal form is more specific than a single business/nonprofit switch. For example, a nonprofit corporation is not automatically a BC society, and a business corporation registered federally does not use the BC company profile.

| Entity and governing Act | Core governance profile | Incorporation preparation | Principal records shown |
| --- | --- | --- | --- |
| BC society, Societies Act | Reviewed core | Ordinary/member-funded preparation, subject to classification checks | Members, directors, constitution/bylaws, member and board decisions |
| BC business company, BC Business Corporations Act | Reviewed core | Ordinary private company preparation; specialist subtypes require review | Securities/ownership, directors, articles, shareholder and board decisions |
| Federal business corporation, CBCA | Reviewed core | Private corporation preparation | Securities/ownership, directors, articles, shareholder and board decisions |
| Ontario business corporation, OBCA | Reviewed core | Incorporation remains under review; an individually reviewed annual-resolutions draft is registered | Securities/ownership, directors, articles, shareholder and board decisions |
| Other Canadian nonprofit corporations, cooperatives and other catalogue Acts | Records only unless a matching reviewed profile is added | Review required unless a matching pathway is added | General records, with the governing structure reviewed for that entity |
| Other countries, unknown jurisdictions or conflicting identity | No inferred Canadian core | Review required | General records; no borrowed provincial or federal rule profile |

“Reviewed core” describes the repository's coverage. It is not a finding that an organization complies, that every subtype is supported, or that the law was rechecked on this audit date. Public/distributing/public-benefit facts can require additional review. Existing operational rules continue to be resolved by their own shared and backend functions.

### Existing implementation

- `shared/incorporationActs.ts` defines the Canadian Act/structure catalogue, including records-only setup options.
- `shared/organizationDomain.ts` provides entity kind and jurisdiction normalization. Nonprofit corporations and cooperatives are not classified as share corporations merely because their name or Act contains “corporation”.
- `shared/legalGovernanceProfiles.ts`, `shared/societyLegalProfile.ts` and `shared/corporateLegalProfiles.ts` resolve the reviewed core rules and record requirements.
- `shared/entityRuleScope.ts` prevents BC-society-specific rules from being shown solely because an organization is in BC.
- `shared/pathways/registry.ts` independently checks jurisdiction, entity type, Act, subtype and supported preparation routes. Ontario's incorporation status and individually reviewed draft exception are distinct.
- `shared/organizationSetup/` already derives the next setup step from records and evidence. The new overview does not introduce another completion checklist.
- `src/lib/routeIdentity.ts` and `src/components/EntityKindGate.tsx` distinguish member and share-oriented surfaces. Route availability is a product feature, not proof of legal eligibility.

## Improvement in this change

`shared/organizationCapabilities.ts` projects the existing registries into one read-only overview. `src/components/OrganizationCapabilities.tsx` displays it in Organization Setup after the next-step card and before the setup phases. Its collapsed heading exposes whether a review is needed; expanded content shows:

1. The recorded entity, home jurisdiction and Act.
2. Separate core-governance and incorporation-preparation coverage.
3. Member/share/general record features and links to their existing screens.
4. The core profile's record categories, preserving conditional/recommended classifications and caveats without claiming completion.
5. Review or preparation actions, the annual cycle where relevant, and a separate tax-registration/item-assessment step.

Missing legal identity remains a visible review state even where existing legacy data has a historical BC rule fallback. Public or distributing status does not get an ordinary/private preparation label. A profile review date is explicitly distinguished from a law's effective date. No authorization, statutory deadline, filing adapter, tax rule or document eligibility gate is changed by this overview.

The tax step points to Organization settings. Incorporation, nonprofit status, registered-charity status, tax-account registration and the treatment of a particular sale remain separate facts. This component does not infer tax exemption or tax rates from the organization kind.

## Next extension work

### Prioritize reviewed coverage by actual demand

Federal nonprofit corporations, Ontario nonprofit corporations, cooperatives and specialist BC company forms need their own reviewed governance/preparation coverage before claiming parity with the four core profiles. Ontario incorporation also remains a separate preparation gap even though core OBCA governance exists. Existing records-only onboarding is a useful starting point for those organizations.

### Expand by explicit rule registration

For another Act, structure or country, register identity choices and a sourced governance profile separately from preparation routes. Include effective dates where the source gives them, review dates, applicability conditions, record requirements, jurisdiction matching and examples that must remain review-required. Register document packets only after reviewing their eligibility and preparation steps. Add a pathway only when its scope is explicit; broad country/province aliases should never silently choose a business Act for a nonprofit or cooperative.

The current incorporation-choice catalogue is Canadian. An international expansion still needs country selection, supported subnational jurisdictions, local identifiers/address forms, locale/currency handling and locally reviewed filing flows. The capability projection can display an unrecognized jurisdiction safely; that does not make international setup or compliance support complete.

Tax jurisdiction packs are a separate extension surface. Legal home jurisdiction does not establish a transaction's place of supply. A new tax pack needs its own effective dates, authorities, item/supply classifications, registration conditions, regional interactions, exemptions and explicit unknown/review results. Do not use this overview to select a tax rate.

### Verify operational parity before widening labels

For each newly supported profile, exercise director/role validation, record access, voting and resolutions, meetings, annual deadlines, reports and document eligibility in both shared/local and Convex paths. Check public/regulated/specialist overlays separately. UI labels should expand only after those paths agree; a registered preparation pathway alone is not evidence of full operational coverage.

## Focused verification

Run `node --import tsx scripts/check-organization-capabilities.ts` for the new projection. It checks society/business record separation, the four core profiles, Ontario's preparation exception, specialist/public review gates, nonprofit/cooperative and international fallbacks, incomplete/conflicting identity and separate tax guidance. This invocation also avoids the CLI IPC pipe required by `tsx` in restricted environments.

Existing neighboring checks remain `npm run test:organization-setup-steps` and `npm run test:organization-domain`. Full frontend typecheck/build and browser verification are independent integration gates; do not treat the projection check as a substitute.

# Societyer research brief for incorporation and company integrations

Prepared 4 October 2026 for the Societyer owner to give to another AI researcher. This is a research assignment, not a completed legal or technical assessment. The recipient should be able to use it without access to our conversation or code.

Societyer manages organization records, documents, governance, and workspace users. We want reliable setup support for BC societies and Canadian corporations, including organizations that have not incorporated yet. We also want to assess company Microsoft 365 document storage alongside Cloudflare R2 and choose a consistent sign-in approach.

## Prompt for the receiving AI

Act as a research assistant for a Canadian organization-management application. Read this brief and research the current official requirements. Start with BC society incorporation, BC business company incorporation, and federal CBCA business incorporation. Establish which filings can be completed online, whether paper or mail routes currently exist, exactly what documents and information are required, and which official templates we may use. Then address the governance, Microsoft 365 storage, authentication, and access-control questions below.

Use current government or vendor primary sources. Cite the exact supporting page or statutory section for each material conclusion. Record the date you accessed it and distinguish publication dates, legal effective dates, and your retrieval date. Our previous environment could not access government websites, so do not treat its preparation checklists or source dates as a fresh verification. If a source is unavailable or unclear, report the unresolved question instead of guessing.

Return a prioritized research report, evidence table, document/template inventory, and recommended implementation changes. Separate verified requirements, proposed product choices, and matters requiring legal or company-administrator review. Do research only; do not submit filings, alter accounts, contact people, or request passwords or secret keys.

## Research priorities

1. Verify the three primary incorporation processes and their current online versus paper/mail routes.
2. Identify the actual incorporation documents and reusable official forms or model documents we lack.
3. Establish corporation governance rules separately from BC society rules.
4. Map federal incorporation versus provincial and extra-provincial registration; assess Ontario next.
5. Evaluate SharePoint Online as a document-storage provider alongside R2.
6. Compare Clerk with Microsoft sign-in against the existing Better Auth Microsoft SSO option.
7. Define a consistent workspace permission policy and the remaining enforcement work.

If time is limited, complete priorities 1–3 first and clearly identify the deferred work. All provinces and territories are an expansion question; BC and federal CBCA are the primary incorporation scope.

## Current product context

These are implementation findings from the current workspace, not proof of a live deployment or independently verified statutory compliance.

- Setup now distinguishes BC society, BC business corporation, federal CBCA, and an existing Ontario business-corporation track. Manual entry for other existing organizations remains available; that does not establish reviewed legal coverage for those entities.
- A preparation stage records a pending home registration rather than an active incorporation. Creating a Societyer workspace does not incorporate an entity.
- Preparation checklists and downloadable text worksheets exist for BC society, BC company, and federal CBCA. They collect information and link to registry sources; they are not government applications or complete articles, bylaws, or incorporation agreements.
- Existing governance draft packets are available. Cross-mode generation is blocked, so a society cannot generate a corporation packet and vice versa. The existence of a draft does not establish its suitability for a particular statute or company.
- BC company displays, registry links, onboarding tasks, and legal-guide selection have been separated from BC society equivalents. Corporation meeting/voting fallback values remain unreviewed operational defaults. Adopting the BC society reset is blocked; company-specific rules can be configured.
- Admins can inspect users and the declared role policy by module. Owner, Admin, Director, Member, and Viewer are Societyer roles. Some existing server actions check membership or a broader role threshold instead of the declared permission matrix. Module switches hide features; they are not authorization controls. Individual module overrides are not implemented.
- The agreed identity model is Clerk for sign-in and profiles, with Societyer retaining workspace roles and invitations. Better Auth with single-tenant Microsoft Entra sign-in is also implemented as an alternative auth mode. These are alternatives for user sessions, not a requirement to sign users into both systems.
- Current document-storage paths include S3-compatible RustFS for document versions and local/native paths. R2 is an option to assess; SharePoint storage integration is not established by connecting a research plugin.
- The owner supplied `https://1stform.sharepoint.com/_layouts/15/sharepoint.aspx/discover`. This identifies a SharePoint hostname, not verified company ownership, an Entra tenant UUID, licensing, administrator rights, or a selected document library.
- Prior legal evidence dates in the repository include 14 April, 2 June, and 5 June 2026. Current registry channels, forms, fees, and mail availability were not reverified during the recent work because official-site requests were blocked.

## Incorporation processes and required documents

Research each route separately. Do not apply business corporation rules to a society, or assume that federal business incorporation covers federal not-for-profit corporations or registered charities.

### BC society

- Verify eligibility, name approval, application workflow, required account and signing authority, and whether Societies Online is the current service.
- Identify the required constitution contents, bylaws options, and applicable differences for member-funded societies.
- Verify incorporator and director requirements, minimum numbers, eligibility, consent, residency, and delivery/mailing address requirements. Cite actual provisions rather than repeating the application's defaults.
- Confirm exactly what is entered into the portal, uploaded, signed, submitted, or retained internally.
- Establish whether an alternative paper, mail, in-person, or assisted route is available. If available, identify the official form, signature rules, current destination, payment method, and processing time. If unavailable, cite that conclusion.
- Distinguish incorporation from CRA charitable registration and any separate tax/account registrations.

### BC business corporation

- Verify named versus numbered companies, name approval validity, incorporator requirements, and the current incorporation service. Check whether older Corporate Online links have moved or changed.
- Identify the incorporation agreement, company articles, incorporation application, and notice of articles. Explain which are filed and which are kept in the records book.
- Specify required share-class information, rights/restrictions, subscribers, initial directors, consents, and registered/records office addresses. Identify decisions requiring tailored legal drafting.
- Separate ordinary private companies from public, benefit, unlimited-liability, or other special subtypes. Identify subtype differences rather than assuming the ordinary-company workflow applies.
- Verify online and any paper/assisted routes, fees, name charges, expedited options, signing methods, and processing times.
- Identify certificate/confirmation outputs, initial share issuance and governance steps, securities and transparency records, and related CRA registrations.

### Federal CBCA business corporation

- Verify named versus numbered corporations, current name-search/approval requirements, account access, and the incorporation workflow.
- Identify the articles, registered-office and first-director information, incorporator/signature requirements, director eligibility and residency rules, and any industry-specific exceptions.
- Verify individuals-with-significant-control information required at incorporation, exemptions, public versus private fields, and subsequent register/filing obligations.
- Confirm the current online service, any paper/mail route, official form numbers and versions, fees, processing times, and delivery instructions.
- Distinguish federal incorporation from provincial registrations where the company operates, including BC and Ontario. Check whether any registration can be coordinated through the incorporation workflow.
- Identify immediate post-incorporation records, organizational resolutions, bylaws, share issuances, tax accounts, and registry access/key custody.

For each route, deliver a step-by-step process with prerequisites, inputs, signatures, official submission channel, expected outputs, and completion evidence. Report government fees separately from optional provider/professional charges. Do not assume that a fee, form, or mail address is unchanged because it appears in an older article.

## Templates and legal governance rules

Create a template inventory with the document's name, entity/statute, official source, version date, purpose, required fields, signing requirements, filing versus retention status, reuse conditions, and whether customization or legal review is needed.

Prioritize BC society constitution/model bylaws, BC company incorporation agreement/articles, federal articles and model bylaws, director consents, and initial organizational resolutions. Distinguish blank government forms, official model text, sample precedents, internal preparation worksheets, and legally operative documents. If a public page exists but reuse rights are unclear, state that uncertainty. Do not invent clauses and label them official.

For each entity, verify meeting notice, quorum, ordinary/special/written resolutions, proxy/electronic participation, director decisions, AGM and financial-statement timing, annual reports/returns, change notices, and ownership/control registers. State which rule is statutory, a statutory default, configurable in articles/bylaws, or subtype-dependent. Identify conflicts with Societyer's inherited society-like fallback settings.

Keep home-jurisdiction obligations separate from extra-provincial obligations. Recommend dated rule records containing entity/subtype, jurisdiction, registration context, trigger, deadline calculation, exceptions, statutory citation, effective dates, and evidence to retain. A reminder is not automatically a legal obligation.

## Microsoft 365 document storage and R2

Determine what an authorized company administrator must verify about the `1stform` directory: tenant UUID and ownership, SharePoint licences, relevant sites/libraries, application registration and consent rights, retention policies, and guest access. Public hostname inspection cannot resolve private tenant configuration.

Research a per-workspace storage-provider design using SharePoint Online/Microsoft Graph or R2. Start with one authoritative home for each document; assess any replication or migration separately.

- Compare application versus delegated Graph access, resource-specific permissions such as Sites.Selected and any applicable newer selected scopes, the separate grant/consent steps, and available certificate/workload identity options. Do not assume the SSO token grants document access.
- Define workspace-to-site/library mapping, document and version identifiers, upload/download flows, large-file upload sessions, metadata, rename/move behavior, concurrency, and retry/throttling handling.
- Examine the interaction between Societyer permissions and SharePoint/library permissions, guest users, sharing links, workspace offboarding, and cross-workspace isolation. Consider a client company storing documents in its own tenant versus our company tenant.
- Verify current limits, version history, retention/legal-hold behavior, deleted-document recovery, audit events, webhooks/delta synchronization, and licence-dependent features.
- Compare costs, S3 compatibility, egress, backups, exports, migration, encryption, and any available immutability/retention features in R2. Verify features instead of assuming S3 compatibility includes every S3 capability.

Return an architecture recommendation and a small proof-of-concept plan: connect one approved library, upload/download a versioned document, deny another workspace, exercise revocation, and export document metadata and content.

## Authentication and workspace authorization

Preserve the user's choice: Clerk owns sign-in and personal profiles; Societyer owns workspace membership, invitations, status, and roles. Compare Clerk Microsoft social login and enterprise SSO with Better Auth's Microsoft provider, including current plan costs, Entra application setup, guest accounts, tenant restrictions, Conditional Access, MFA, and provisioning/deprovisioning behavior.

Verify issuer/subject identity binding across frontend, Convex, REST gateway, API keys/workflows, and local desktop mode. Research Entra email-claim semantics and account migration without automatically linking accounts by matching email. Separate Microsoft sign-in consent from Graph storage consent. Recommend one hosted user-session provider per deployment.

For authorization, propose one explicit role/action policy across modules and compare it with actual endpoint enforcement if repository access is available. Explain why Viewer currently has broader read grants than Member, whether that is intended, how document-specific grants interact, and whether individual module overrides are necessary. Cover user listing/inspection, invitations, role/status edits, removal, disabled accounts, and the last active Owner. Define effective access as a combination of membership, role/action policy, record rules, and external storage permissions; a UI feature switch is not a security boundary.

## Official source starting points

These links are discovery starting points, not fresh verification. Follow official redirects and find the current authoritative page or consolidated statute before using a claim.

- BC business incorporation guidance: https://www2.gov.bc.ca/gov/content/employment-business/business/managing-a-business/permits-licences/businesses-incorporated-companies/incorporated-companies
- BC Registry Services: https://www.bcregistry.gov.bc.ca/
- BC Societies Online: https://www.bcregistry.ca/societies/
- BC Corporate Online legacy starting point: https://www.corporateonline.gov.bc.ca/
- BC Business Corporations Act: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00
- BC Societies Act: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01
- BC Societies Regulation and model bylaws: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/216_2015
- Corporations Canada incorporation guidance: https://ised-isde.canada.ca/site/corporations-canada/en/business-corporations/how-incorporate-business
- Canada Business Corporations Act: https://laws-lois.justice.gc.ca/eng/acts/C-44/FullText.html
- Corporations Canada significant control guidance: https://ised-isde.canada.ca/site/corporations-canada/en/individuals-significant-control
- Ontario Business Registry: https://www.ontario.ca/page/ontario-business-registry
- CRA business registration guidance: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/registering-your-business.html
- Microsoft Graph selected permissions: https://learn.microsoft.com/en-us/graph/permissions-selected-overview
- Microsoft Graph SharePoint resources: https://learn.microsoft.com/en-us/graph/api/resources/sharepoint
- Microsoft Graph file resources: https://learn.microsoft.com/en-us/graph/api/resources/driveitem
- Microsoft identity platform: https://learn.microsoft.com/en-us/entra/identity-platform/
- SharePoint limits: https://learn.microsoft.com/en-us/office365/servicedescriptions/sharepoint-online-service-description/sharepoint-online-limits
- Clerk documentation: https://clerk.com/docs
- Better Auth Microsoft provider: https://www.better-auth.com/docs/authentication/microsoft
- Cloudflare R2 documentation: https://developers.cloudflare.com/r2/

## Expected research deliverables

1. A concise recommendation explaining which incorporation paths and integrations to support first, and what remains unresolved.
2. A comparison of BC society, BC company, and federal CBCA workflows, including verified online/paper channels, requirements, fees, timings, and outputs.
3. A source-backed inventory of incorporation forms and templates, with links and reuse/customization limits.
4. A governance rules comparison and proposed corrections to inherited defaults, with applicability and effective dates.
5. A SharePoint-versus-R2 architecture and cost/permission comparison, plus required company-administrator inputs.
6. An authentication recommendation that preserves Societyer workspace roles, and a list of authorization discrepancies needing implementation work.
7. An evidence table and prioritized implementation backlog. For each backlog item, include the affected area, reason, dependency, acceptance criteria, and suggested verification.

Use this evidence-table structure, expanding it as necessary:

| Topic and entity | Finding | Exact source and section | Accessed date | Effective date or version | Confidence and unresolved issue | Product implication |
|---|---|---|---|---|---|---|
| Example topic | Verified fact or explicitly marked proposal | Official URL plus section/page | Research date | Applicable date or unknown | Verified, conflicting, or unavailable | Required change or no change |

For missing evidence, give the precise question an administrator, registry, or qualified legal reviewer must answer. Do not fill unknowns with another jurisdiction's rule. Include short quotations supporting important legal deadlines and filing-channel conclusions.

## Repository material if code access is available

The research is usable without these files. If reviewing the implementation, request the relevant files rather than assuming the deployed application matches them. Older research notes are leads to recheck, not authoritative law.

- `docs/corporation-research-swarm-findings.md`
- `shared/organizationDomain.ts` and `shared/jurisdictionWorkspace.ts`
- `shared/incorporationPreparation.ts` and `shared/incorporationWorksheet.ts`
- `src/lib/jurisdictionGuidePacks/` and `src/lib/compliance/rulePacks/`
- `shared/functions/bylawRules.ts` and `src/pages/BylawRules.tsx`
- `shared/functions/permissions.ts`, `shared/functions/access.ts`, and `src/lib/moduleAccess.ts`
- `docs/clerk-setup.md`, `docs/microsoft-sso-setup.md`, and `docs/security-and-auth-posture.md`
- `server/clerk-auth.ts`, `server/microsoft-sso.ts`, and `convex/auth.config.ts`
- `src/lib/documentStorage.ts`, `convex/documentVersions.ts`, and the relevant storage/provider adapters

Success means we can replace unverified preparation guidance with current source-backed instructions, identify the legal documents still needed, and make concrete storage/authentication decisions without confusing workspace setup with incorporation or sign-in with document access.

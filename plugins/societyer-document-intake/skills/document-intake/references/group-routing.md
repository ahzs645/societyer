# Societyer Document Intake Groups

This file defines decision/routing groups for document intake. These are plugin reference documents, not Societyer UI pages. Keep group metadata separate from exact field lists:

- Use this file to decide where a document belongs, what source cues matter, and what safety rules apply.
- Use `page-field-support.md` to explain page-by-page UI support.
- Use `transposition-catalog.json` as the source of truth for exact payload fields and bundle keys.

## Lookup Order

1. Classify the source document into one or more groups using source signals.
2. Check the group's native record kinds and excluded targets.
3. Use `transposition-catalog.json.recordKinds` for exact fields.
4. If no native record kind fits, stage `documentCandidate`, `sourceEvidence`, or a manual follow-up task instead of inventing a target.

## Groups

### identity_and_profile

Use for governing profile facts: society name, incorporation number/date, registered office, mailing address, purposes, charity/member-funded status, privacy officer, public contact details, and board cadence.

- Routes: `/app/society`, `/app/org-history`, `/app/documents`
- Native record kinds: `source`, `fact`, `event`, `documentCandidate`, `sourceEvidence`
- Source signals: incorporation, constitution, purposes, registered office, mailing address, privacy officer, society profile, charity number
- Privacy default: `standard`
- Do not transpose directly to: legal society profile fields unless a human asks for manual/API entry
- Review notes: Stage profile evidence as org-history/source evidence. Human review should update `/app/society`.

### governance

Use for meetings, minutes, motions, board roles, officer roles, resignations, appointments, signing authorities, attendance, quorum, and governance evidence.

- Routes: `/app/meetings`, `/app/meetings/:id`, `/app/org-history`, `/app/governance-registers`, `/app/meeting-evidence`, `/app/directors`
- Native record kinds: `meetingMinutes`, `motion`, `meetingAttendance`, `motionEvidence`, `boardRoleAssignment`, `boardRoleChange`, `signingAuthority`, `source`, `event`, `boardTerm`
- Source signals: minutes, AGM, SGM, board meeting, motion, moved by, seconded by, carried, defeated, quorum, director, officer, appointed, elected, resigned, removed, signing authority
- Privacy default: `standard`
- Do not transpose directly to: legal director register, elections, proxies, written resolutions
- Review notes: Promote legal director register changes manually after source review. Do not infer ballots or signatures from OCR.

### compliance

Use for statutory filings, annual reports, registry packets, CRA/payroll/GST obligations, and due-date evidence.

- Routes: `/app/filings`, `/app/deadlines`, `/app/filings/prefill`, `/app/documents`
- Native record kinds: `filing`, `deadline`, `documentCandidate`, `sourceEvidence`
- Source signals: annual report, BC Registry, registrar, Societies Online, Form 10, bylaw amendment, change of directors, change of address, T3010, T2, T4, GST, payroll remittance, due date, filing deadline
- Privacy default: `standard`
- Do not transpose directly to: filing pre-fill forms, bylaw rules, legal register updates
- Review notes: Create filing/deadline candidates with evidence documents. Marking filed needs confirmation and evidence review.

### records_and_archive

Use for source documents, retention, records locations, archives, accessions, custody agreements, inspection support, and provenance.

- Routes: `/app/documents`, `/app/records-archive`, `/app/inspections`, `/app/retention`, `/app/imports`
- Native record kinds: `documentCandidate`, `source`, `sourceEvidence`, `recordsLocation`, `archiveAccession`
- Source signals: records location, registered office records, archives, archival agreement, accession, custody, box, binder, storage location, inspection, retention, source file
- Privacy default: `standard`
- Do not transpose directly to: inspection request logs or retention archive actions
- Review notes: Metadata can be staged broadly. Inspection requests, deletion flags, and archive actions stay manual.

### finance

Use for financial statements, budgets, treasurer reports, transaction candidates, bank/credit-card evidence, restricted funds, remuneration, and reconciliation support.

- Routes: `/app/financials`, `/app/finance-imports`, `/app/treasurer`, `/app/reconciliation`, `/app/documents`
- Native record kinds: `financialStatement`, `financialStatementImport`, `budgetSnapshot`, `treasurerReport`, `transactionCandidate`, `documentCandidate`, `sourceEvidence`
- Source signals: income statement, balance sheet, trial balance, financial statement, financial report, budget, forecast, variance, treasurer report, bank statement, invoice, receipt, cheque, deposit, payment, e-transfer
- Privacy default: `restricted`
- Do not transpose directly to: donation receipts, payroll filings, membership billing plans, public transparency
- Review notes: Keep raw banking/payroll/tax OCR restricted. Transactions should enter reconciliation as candidates only.

### grants

Use for grant opportunities, applications, funding agreements, award letters, reporting obligations, restricted-purpose funds, grant transactions, and grant support documents.

- Routes: `/app/grants`, `/public/:slug/grant-apply`, `/app/documents`, `/app/deadlines`
- Native record kinds: `grant`, `deadline`, `documentCandidate`, `sourceEvidence`
- Source signals: grant, funding, proposal, subsidy, award, funder, program, reporting deadline, Canada Summer Jobs, restricted purpose, use of funds
- Privacy default: `standard`
- Do not transpose directly to: public grant applications, communications campaigns, financial transactions unless finance evidence is explicit
- Review notes: Current section apply fills core grant fields only. Requirements, contacts, answer library, and timeline details need manual enrichment.

### people

Use for member, volunteer, employee, privacy training, screening, and people-related intake documents.

- Routes: `/app/members`, `/app/volunteers`, `/app/employees`, `/app/pipa-training`, `/public/:slug/volunteer-apply`
- Native record kinds: `volunteer`, `employee`, `pipaTraining`, `documentCandidate`, `sourceEvidence`
- Source signals: member, membership, volunteer, application, orientation, screening, criminal record, privacy training, PIPA, CASL, employee, employment contract, contractor, WorkSafeBC
- Privacy default: `restricted`
- Do not transpose directly to: legal member register, volunteer screening results, payroll/T4/TD1/ROE, public pages
- Review notes: Member register changes are manual. Screening results and payroll/tax documents require restricted handling.

### access_and_secrets

Use for credential custody, recovery keys, passwords, certificates, account ownership, service access, registry credentials, and rotation/review evidence.

- Routes: `/app/access-custody`, `/app/documents`, `/app/audit`
- Native record kinds: `secretVaultItem`, `sourceEvidence`, `documentCandidate`
- Source signals: password, recovery key, API key, certificate, credential, account, username, registry key, vault, custodian, backup custodian, rotation, access review
- Privacy default: `restricted`
- Do not transpose directly to: raw secret storage fields, public transparency, notes with secret values
- Review notes: Only create metadata references. Never place raw secret values in AI output or import JSON.

### public_transparency

Use for public-facing publications, resource links, public summaries, public contact details, public board/bylaws/financial disclosures, and published documents.

- Routes: `/app/transparency`, `/public/:slug`, `/app/documents`
- Native record kinds: `publication`, `documentCandidate`, `sourceEvidence`
- Source signals: publish, public, annual report, bylaws, policy, notice, resource, transparency, public summary, website
- Privacy default: `standard`
- Do not transpose directly to: published status without review, restricted finance/HR/member data
- Review notes: Publications should default to draft/in-review. Human approval is required before making content public.

### manual_only

Use when a document discusses a supported page but the import pipeline should not create final records directly.

- Routes: `/app/conflicts`, `/app/elections`, `/app/proxies`, `/app/receipts`, `/app/court-orders`, `/app/written-resolutions`, `/app/bylaw-rules`, `/app/workflows`, `/app/communications`, `/app/membership`, `/app/auditors`, `/app/proposals`, `/app/tasks`, `/app/goals`
- Native record kinds: `documentCandidate`, `sourceEvidence`
- Source signals: conflict disclosure, ballot, vote, proxy, charitable receipt, court order, written resolution, bylaw interpretation, workflow, campaign, membership plan, auditor appointment, member proposal
- Privacy default: `restricted`
- Do not transpose directly to: final legal/compliance state, votes, receipts, court-order status, active bylaw rules, workflow automation
- Review notes: Stage evidence and explain the unsupported fields. Create a manual follow-up task only when requested.


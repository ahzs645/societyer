# Payroll calculation and records implementation

Scope added by the user's pasted proposal, alongside the semester planner. The pasted analysis is reference material: verify its financial/legal claims against official sources. Implement original code from public rules; do not copy AGPL engines or invent licensed-provider API contracts. Initial native deductions coverage is ordinary B.C. employment, 2026 January/July editions, including regular/bonus and Option 1/2. Unsupported years, provinces and employment policies must produce explicit blockers, never plausible default deductions.

## Ownership and modules

- Register repairs: document_renderers owns existing businessRegisters pure/backend/schema/types/PayrollDrawers/payroll wrapper. CPP2, identity, safe edits/imports, classification bases and remittance calendars are additive.
- Earnings/costs: layout_schema owns `shared/payrollEarnings.ts` and tests. Source-backed B.C. daily/weekly overtime, holiday, vacation/sick, minimum wage/timing/final pay, employer full costs, mileage and payment-classification/disclosure helpers.
- Deductions: verification owns `shared/payrollDeductions.ts`, reviewed effective-dated `shared/payrollRates/*`, source snapshots and tests. CRA formulas, provenance, rounding, caps, TD1, extra tax, annualization and eligibility.
- New backend: document_workflows owns `convex/tables/payrollCalculation.ts`, `convex/payrollCalculation.ts`, `shared/functions/payrollCalculation.ts`, adapters and tests. Root owns schema/registry/policy/export integration.
- Calculator UI: designer_ui owns `src/pages/PayrollCalculator.tsx`, new `src/features/payrollCalculation/*` except reporting components. Existing Payroll.tsx links coordinated with layout_schema.
- Statements/filing: report_documents owns `shared/payrollReporting.ts`, reporting components/helper and tests. Root owns integration and overall end-to-end verification.

## Pure calculation boundary

Earnings exposes `calculateBcEarnings` and classified bases `{cashCents,taxableCents,pensionableCents,insurableCents,vacationableCents,ehtCents,workSafeCents}`; detailed earnings lines carry date/hours/rate/code and their classifications. Deduction input/output comes from `shared/payrollDeductions.ts`; backend adapter maps classified earnings to it. Earnings and deductions owners coordinate exact exported interfaces directly and send them to backend/UI/reporting owners.

Stored amounts are integer cents; internal arithmetic retains precision and uses prescribed rounding. Final net is cash remuneration minus employee CPP/CPP2/EI/tax/other deductions. Taxable noncash benefits and nontaxable cash reimbursements remain distinct. Legacy register `grossCents` remains taxable employment gross, with additive `nonCashTaxableCents`/`nonTaxableCashCents` for reconciliation. Employee withholding is not an additional employer expense. Employer CPP/CPP2/EI, vacation accrual not already paid/included, WorkSafe, EHT, benefits and pension are separate full-cost components.

Employee province of employment is distinct from residential address. YTD/opening balances belong to this legal employer and payment year. December work paid in January selects January's payment-year deduction rules; earnings rules use the work date. Validate effective CPP exemptions/elections and actual 26/27-period calendar. Never substitute 2026 rates for a 2027 calculation. Missing historical data needed for holiday/sick/vacation calculations must be explicit.

## Persistent model

New table export `payrollCalculationTables`, with society indexes and bounded read paths:

1. `payrollEmployerProfiles`: employer pay schedule/remitter references; actual approved EI multiplier; EHT class plus qualification evidence and locations; WCB net classification rate/yearly assessable limit; employer benefits/pension/ledger mappings. Existing payrollSettings remains authoritative for registered RP/provider/remitter details; do not create conflicting copies.
2. `payrollEmployeeProfiles`: employeeId, effectiveFrom/optional end, provinceOfEmployment, wage/salary schedule/history, TD1 claim/extra withholding and declaration reference, CPP status/election dates, earning/benefit/deduction assumptions, optional authenticated portalUserId. Scope employee and user refs. Do not store plaintext SIN or bank credentials.
3. `payrollEarningCodes`: reviewable cash/taxable/pensionable/insurable/vacationable/EHT/WCB classifications; payment kind (regular/bonus/benefit/reimbursement/etc). Record evidence for special classification. An honorarium label alone cannot select T4A.
4. `payrollWorkDays`: owned employee/date, daily hours/work/leave and classification details; preserve enough history for complete weeks and 30-day eligibility/average calculations. Paid sick is a day balance; partial absence consumes a day. Posted work references cannot silently be edited/repaid.
5. `payrollOpeningBalances`: owned employee/year/legal employer, coveredThroughDate, earnings/bases/hours/contributions/tax/vacation and source provenance; explicit same-employer confirmation. Distinguish amounts already represented by imported pay runs from missing historical totals for year-end.
6. `payrollCalculations`: immutable finalized input/result/rules/source fingerprints, periodStart/end/payDate, runType, draft/approved/finalized/reversed state, actor timestamps, idempotency, payRunId/journal IDs and explicit correction/reversal references. Input/result limits use UTF-8 bytes. No sensitive identifiers in snapshots. Store exact engine results and the official rate edition, method, sources and explanations.
7. `payrollTd1Declarations`: optional authenticated electronic declarations. If implemented, only the explicitly linked employee portalUserId can submit, with required current form content/certification, version, server timestamp and immutable submission. Employer-recorded TD1 evidence remains a separate supported path and cannot pretend to be employee certification.

## Public API (`payrollCalculation`)

Use authorized wrappers plus portable handlers. Exact same hosted/local permissions. UI query results exclude secrets and unnecessary private contact data.

- `workspace({societyId,collection,cursor?,employeeId?,id?,year?,from?,to?})`: one bounded list per invocation or direct owned calculation/detail get. Collections employer/profiles/codes/work/openings/calculations/calculation. Can extend planning-only employee picker as a separate collection with employees:read.
- `saveEmployerSettings({societyId,fields})`.
- `saveProfile({societyId,id?,employeeId,fields})`, `saveEarningCode({societyId,id?,fields})`, `saveWorkDay({societyId,id?,employeeId,fields})`, `saveOpeningBalance({societyId,id?,employeeId,fields})`.
- `preview({societyId,input})`: derive from current owned records and server rules, return typed result/warnings/blockers. A query or mutation is acceptable if bounded; no external provider calls from either.
- `saveDraft({societyId,id?,input})`: server recomputes; never accepts a trusted client calculation result.
- `approve({societyId,id,expectedVersion?})`: review the concrete immutable input/result; disallow blockers and stale source/YTD fingerprints.
- `finalize({societyId,id,idempotencyKey,postToLedger?})`: permission check + source freshness + idempotency, atomically finalize and create one detailed payRun. Approval required. Preserve all employee lines. A finalized run cannot be modified/deleted through legacy manual endpoints.
- `reverse({societyId,id,date,reason,idempotencyKey})`: retained dated balanced mirror entries/relationships, closed-period and YTD safeguards; never delete historical finalized snapshots. Replacement/off-cycle runs explicitly link the original calculation.
- `recordPayment({societyId,id,employeeId?,transactionId,date,reference,idempotencyKey,postToLedger?})`: explicitly record an existing bank payment, with owned transaction/account validation and a separate settlement journal. It never sends money.
- `exportContext({societyId,year,cursor?})`: bounded filing metadata/readiness and one page of annual records/ROE sources, progressing through recorded runs and opening balances with real continuation cursors. Represented runs are counted once. Filing schema/submission year is distinct from earnings year.

Backend owner may refine/add endpoints, immediately notifying root/UI. Each paginated function runs at most ONE native `.paginate`. Reads are bounded/indexed; never use a silently truncated aggregate. For YTD, either maintain atomic employee/year balances or use complete bounded source queries with explicit overflow errors and reliable stale checks. Provider-imported records must be included exactly once.

The implemented source collections also include owned account, fund, grant and transaction pickers. Recurring employee funding allocations must total exactly 10,000 basis points and conserve cents per cost component. Electronic TD1 self-service is optional and has not been activated; employer-recorded declaration evidence is supported.

Federal/provincial tax splits remain optional where CRA specifies combined withholding without an allocation. Additional requested TD1 tax is separate from those components and included once in combined tax. Future cumulative calculations requiring an unknown historical split block until the real figures are supplied.

## Approval, records and accounting

Native calculations are draft until reviewed/approved/finalized; these actions do not initiate deposits or external filings. Finalization retains exact calculations and can post a balanced accrual journal using mapped wage/benefit expense, net pay payable, source deductions, employer contributions and other liabilities. Do not deduct employee tax twice from employer cost or count benefits/vacation twice. Actual cash/payment links stay explicit and preserve provenance. If books currency differs, require an explicit supported FX quote or clearly block posting instead of inventing one.

Ordinary reversals must preserve historical cash/accrual records and YTD year attribution; cross-year corrections that need amended returns require explicit handling rather than rewriting the original year. Keep the calculator/provider adapter replaceable; only implement a licensed outbound integration when its actual public contract is verified. Provider result import/reconciliation is a real supported flow independent of credentials.

## Statements and filing exports

Reporting accepts a normalized immutable statement DTO (employee/employer, period/payDate, detailed earnings/classifications, gross/cash/benefits, CPP/CPP2/EI/federal/provincial tax, other deductions/net, employer full costs, YTD, exact rules/provenance). Reporting owner defines/export this DTO and backend/UI map to it. Use existing branded native PDF pipeline with searchable text and real page numbers.

T4/T4A/T619 XML and ROE extract exports must follow the actual published CRA/Service Canada schema, with a chosen submission schema version distinct from earnings year. Preserve CPP2 box16A; historical insurable earnings and hours for ROE. Validate SIN/BN/account identifiers and mandatory fields. Authorized users supply sensitive filing identifiers transiently or from authorized secure vault; do not persist them in ordinary snapshots, URLs, logs or localStorage. Missing required fields prevents a filing-ready export. CSV/reconciliation export and draft metadata remain available. Actual external submission is outside these export actions.

## Verification acceptance

Cover register note-only detailed edit, missing/split tax fields, CPP2 and distinct provider identities; weekends/public holidays/threshold2 remittance; authoritative July transition; CPP/EI/CPP2 crossings and 27 pays; TD1 multi-employer; bonuses/noncash benefits; overtime full-week interaction; partial sick days; 5-year vacation; final pay timing; December earnings/January payment-year switch; correct employer EHT/WCB/vacation/mileage; same-employer opening/YTD; approval/finalization retries and frozen records; dated reversal/closed books; balanced actual journals; real PDF and schema-validated XML. No live messages, payments or filings during qualification.

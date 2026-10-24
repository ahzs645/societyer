# Payroll calculations and semester planning

Semester cost planning is available at `/app/financials/planning`. Native payroll is available at `/app/payroll/calculator`; the existing `/app/payroll` register remains the home for provider imports, remittances, slips and records of employment.

## Semester forecasts

Create an editable semester or custom period with allocation, opening balance and reserve. Reusable costs can recur weekly, every two weeks, monthly, quarterly, every six months or annually. The cash view follows payment dates; the allocated view spreads costs over the days covered. Insurance and subscription imports retain their source relationship. An insurance record without a currency requires an explicit selection before import.

Staff forecasts use reviewed compensation, vacation, employer contribution and benefit assumptions. They are estimates rather than statutory payroll calculations. Pending assumptions and excluded currencies remain visible. A linked spending budget shows actual posted bank outflows separately from the forecast. Exports include CSV, a workbook and branded PDF graphs.

## Native payroll coverage

The native deduction engine implements ordinary employment in British Columbia using the January and July 2026 CRA T4127 editions, selected by payment date. Earnings use the work date. Unsupported deduction years, provinces or employment policies block finalization. Commission payroll, Quebec transfers, specialized industries, averaging agreements and collective-agreement substitutions require a reviewed extension before use. A new year's rates must be added and verified; the engine does not reuse a previous year's rates silently.

The calculation boundary keeps cash, taxable, pensionable, insurable, vacationable, employer health tax and WorkSafeBC amounts distinct. In particular, a noncash taxable benefit can increase deductions without increasing the cash paid. Employee deductions reduce net pay; they are not a second employer expense.

Employer setup records the actual pay calendar, EI multiplier and its evidence, WorkSafeBC classification/net rate/assessable cap, EHT treatment and evidence, employer benefits/pension and ledger mappings. A nonprofit label alone does not establish an EHT exemption. Employee profiles record effective wage history, province of employment, confirmed TD1 evidence, CPP/EI treatment and expense allocations. Employer-entered TD1 evidence is not an employee-certified electronic TD1 submission.

Review whether employer cost assumptions actually apply uniformly. Employee profiles can retain their own documented EI coverage/multiplier, benefits and pension amounts, including explicit zeroes. Qualifying nonprofit EHT locations require their own evidence, attributed opening remuneration and employee reporting-location evidence. The review reconciles each location's remuneration and liability change; funds and grant cost centres do not become qualifying EHT locations automatically.

Opening balances must belong to the same legal employer. They identify which existing imported runs they already represent so those runs are not counted twice. Unknown historical federal/provincial splits remain unknown; a calculation that needs those splits must wait for the actual figures. An unrelated prior employer's CPP/EI deductions cannot be treated as this employer's year-to-date deductions.

Daily work records support daily/weekly overtime and the preceding wage history needed for statutory holiday and sick pay. Review complete weeks, rest periods and missing history before approving. Partial-day statutory sick leave consumes one day of the statutory bank. Vacation paid on each cheque requires the employee's written agreement; fifth-year reconciliation uses actual wages and vacation already paid.

Holiday and sick-pay history reuses retained native daily earnings and known current-period earnings, excluding overtime from the average. It does not require entering those wages again. Older imported or unsupported daily classifications still require reviewed actual amounts; neither missing history nor a reversed source is treated as a confirmed zero.

The **Vacation time** tab keeps time entitlement separate from money. Save a reviewed employment-anniversary period with the actual weekly schedule, prior time used and any documented carryover or additional contractual entitlement. Dated requests move through approval and actual use, retaining their history and remaining balance. Future periods show planned entitlement; unused overdue time stays visible. Paying vacation on each cheque does not remove the right to take time off. A linked salary vacation record supplies paid-leave coverage without creating an extra salary payment.

Use an explicit accrued-vacation payout to pay an hourly employee's saved vacation liability. Review whether the amount accompanies actual vacation leave or is an unused-vacation cashout, and supply actual insurable leave time when applicable. The server checks the retained liability and releases it once. Salary vacation also releases the previously accrued portion of the salary payment; neither path treats that old liability as a new expense.

## Review, records and accounting

Drafts are recalculated on the server. Approval and finalization verify the source records and year-to-date balances again. A finalized calculation retains its input, result, rules, source fingerprint and detailed employee lines. It cannot be changed through the manual register editor. Corrections retain the original record and explicit relationships rather than silently rewriting it. Unpaid finalized runs can be reversed with a dated correction; a run with recorded payments requires a reviewed repayment or cancellation workflow before reversal and is blocked by the current interface.

Recording a payment links an existing bank transaction; it does not send a deposit. Ledger posting requires owned, valid account mappings and compatible book currency. Posted accruals and payments have separate entries, and reversal dates respect closed accounting periods. Funding allocations conserve cents across the selected funds, programs or grants. Retained payment facts cannot be changed by rematching, splitting, reclassifying or editing their bank account currency/type. Provider refreshes preserve existing source identities and local relationships, retain omitted historical rows, and reject conflicting settled payment facts.

Native year-to-date calculation reads are bounded to 100 source runs and 4 MB for the payment year and required preceding wage-history window. A larger source set produces an explicit blocker instead of an incomplete calculation. Filing exports page through all annual records independently of that calculation bound.

Provider imports retain provider/run identity, run type and correction references. CSV preview distinguishes missing values from confirmed zeroes and combined income tax from separate federal and provincial tax. CPP2 has separate employee and employer fields, including T4 box 16A. A note-only edit preserves existing employee lines.

## Statements and filing exports

Pay statements use the shared branded native PDF pipeline with searchable amounts, detailed earnings/deductions, year-to-date figures and rule provenance. Filing exports use retained official CRA T4/T4A/T619 and Service Canada ROE schemas. The submission schema edition is a separate choice from the earnings year. Missing required identifiers or reporting fields blocks a filing-ready file. Sensitive identifiers are supplied for the export and are not added to ordinary payroll snapshots.

Exporting a file does not submit it. Payment release, CRA remittance and external filing remain explicit actions through the society's bank or filing service.

## Rules and provider evaluation

The calculation stages are original code behind a replaceable adapter. No code from the AGPL projects named in the supplied proposal has been adopted.

| Option | Verified public scope | Implementation decision |
| --- | --- | --- |
| [CRA T4127](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul.html) | Official deduction formulas and versioned numeric tables; July 2026 changes B.C. withholding. | Native supported rules retain edition/source provenance and verification fixtures. |
| [CPTL](https://metca.com/products/cptl/) | Licensed calculation library/REST service, including CPP2; the vendor describes a Swagger specification and authorized API key. | The replaceable boundary supports future adoption. No licensed key or verified usable endpoint contract was supplied, so there is no invented live integration. |
| [Payworks](https://anypoint.mulesoft.com/exchange/portals/payworks-0/6f344111-e38f-41ec-a3b6-25455816329d/ca-pw-api-payroll-exp/) | Published payroll-entry and pay-statement integration portal. | Provider register import/reconciliation works independently; live API activation requires the provider's account and contract. |
| [PaymentEvolution](https://paymentevolution.com/products/developers) | Commercial developer integration offering. | Retain provider identity and reconciliation; do not guess private request formats. |

Official source snapshots and schema hashes are retained with the implementation. Review and publish a new rule edition when the responsible authority changes its rules; reproducibility depends on preserving the editions used by finalized records.

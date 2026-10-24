# Payroll and semester planning verification map

User-facing workflow and supported rule scope: [Payroll calculation guide](payroll-calculation-guide.md), [operations guide](payroll-operations-guide.md), and [official operational sources](payroll-operations-sources.md).

| Requested capability | Implementation | Focused verification |
| --- | --- | --- |
| Semester allocation, reserves and custom dates | Cost-planning period records and editable semester presets | `check-cost-planning.ts`, `check-cost-planning-backend.ts`, `cost-planning.spec.ts` |
| Reusable monthly costs and annual renewals | Calendar recurrence, insurance/subscription source imports, cash and allocated forecasts | Same planner suite, including leap/EOM dates and exact cents |
| Staff planning and payroll setup | Reviewed staff assumptions, payroll readiness and setup links | Planner backend and browser scenarios |
| Forecast graphs, actual budget outflows and exports | Separate posted-bank actuals; CSV/workbook/branded graph PDFs | Planner browser scenarios inspect actual PDF text and vector graphics |
| Existing employee lines preserved on edits | Explicit replacement/removal; omitted lines retain detail | `check-payroll-register.ts`, `check-business-registers.ts` |
| CPP2 employee/employer and T4 box 16A | Additive register, import, totals, remittance, statement and XML fields | Register, deductions and reporting suites |
| CSV tax mapping and missing values | Combined/split/additional tax, preview and explicit zero confirmation | Register focused suite |
| Provider identities and corrections | Provider run/employee identity, run types and explicit correction links | Register focused suite |
| CRA/B.C. working-day deadlines | Reviewed holiday calendar and accelerated threshold 1/2 windows | Register focused suite |
| Effective wage and minimum-wage history | Dated employee profiles and work-date earnings rules | Earnings suite and native calculation workflow |
| Overtime, statutory holidays and sick leave | Full-week work context and complete preceding wage history | `check-payroll-earnings.ts` |
| Consecutive native payroll and holiday history | Frozen daily wages plus current-period earnings; no duplicate manual history or reversed-source reuse | `check-payroll-wage-history.ts`, `check-payroll-native-history.ts`; eligible holiday and unknown-source fixtures |
| Vacation and five-year reconciliation | Accrue/pay-each-cheque modes and wage-history reconciliation | Earnings suite |
| Vacation time entitlement and actual leave | Reviewed anniversary periods, opening history, dated requests/status history and exact-minute balances, separate from vacation pay | `check-payroll-leave.ts`, `payroll-leave.spec.ts`; salary vacation regressions in earnings/native calculation suites |
| Pay-period and final-pay timing | B.C. period length, pay deadline and exact termination timestamps | Earnings suite and native draft blockers |
| CPP/CPP2/EI, TD1, 26/27 pays and bonuses | Replaceable native CRA deduction adapter, January/July 2026 editions | `check-payroll-deductions.ts`, retained official source hashes |
| Province of employment and same-employer YTD | Distinct employment province; confirmed openings with represented-run provenance | Native backend and browser scenarios |
| Cash versus taxable benefits/reimbursements | Independently classified earning codes and explicit net reconciliation | Earnings, deductions, register and statement suites |
| Full employer cost, WorkSafeBC and EHT | Actual documented rates, yearly caps, nonprofit/location evidence, benefits/pension/accrual components | Earnings suite and posted-journal checks |
| Different employee benefits and EI coverage | Reviewed employee overrides with explicit zeroes or confirmed uniform employer assumptions | Native backend/source-field checks |
| Qualifying nonprofit EHT locations | Persisted qualification/opening/employee attribution and per-location liability reconciliation | Native backend and `payroll-eht.spec.ts` |
| Fund/program/grant allocations | Exact component allocations in profiles, previews and accounting entries | Earnings allocation tests and native lifecycle checks |
| Mileage, honoraria and remuneration disclosure | Visible supporting tools, actual paid-period data and support CSVs | Earnings suite and payroll browser tools scenario |
| Reviewable immutable payroll | Server recalculation, approval, source freshness, idempotent finalization, retained reversals | Native backend, browser and isolated Convex qualification |
| Payment destination and ledger | Explicit existing-bank payment links; balanced accrual/settlement entries | Native backend and isolated Convex qualification |
| Retained payment source history | Bank fact/account guards and stable provider account/transaction upserts | `check-payroll-payment-guards.ts`, `check-financial-provider-refresh.ts`; memory, indexed local and registered Convex wrapper checks |
| Branded pay statements | Normalized identifier-free snapshots and shared searchable native PDF pipeline | Payroll reporting and real browser PDF checks |
| T4/T4A/T619 and ROE XML | Retained official schemas, separate submission edition, transient identity inputs | Payroll reporting suite validates generated files against official XSDs |
| Manual rule editions | Structured rates/brackets/caps, evidence, immutable review/publication/revisions, actual native selection and frozen provenance | `check-payroll-rules.ts`, `payroll-rules.spec.ts` |
| Completed TD1 imports | Local fillable/flattened PDF and scan extraction, explicit signature/date/field review, independent federal/BC settings and dated immutable declarations | `check-payroll-td1.ts`, `check-payroll-td1-settings.ts`, `payroll-td1.spec.ts` |
| Modular payroll views | Typed module registry, scoped order/visibility/favorites/expanded preferences and retained deep links | View registry and TD1/workspace browser checks |
| Guided ROE operations | Reviewed trigger/deadline, checklist, linked XML generation, actual issuance acknowledgment, amendments and protected follow-ups | `check-payroll-roe-workflow.ts`, `payroll-roe-workflow.spec.ts` |
| Remittance preparation and settlement | Exact CRA obligations, approved frozen plans, export/submission distinct from payment, partial actual settlements and balanced ledger | `check-payroll-remittance.ts`, `payroll-remittance.spec.ts` |
| Local/hosted authorization and portability | Shared handlers, authorized public wrappers, registry and export coverage | Authorization policy, portable manifest, static parity, desktop types and isolated Convex qualification |

Tests exercise the reviewed supported scope. Unsupported native deduction years, provinces and special employment policies produce blockers. Native calculation source limits fail explicitly; filing sources paginate through the complete year. Unpaid finalized runs support retained dated reversals; paid runs require a reviewed repayment or cancellation workflow and cannot currently be reversed. Licensed API access, bank deposits and external filing are not activated by building or exporting payroll records. Employer-entered TD1 evidence does not purport to be an employee-certified electronic TD1 declaration.

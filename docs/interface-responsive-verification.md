# Interface and data propagation verification

This qualification follows user actions through the interface, shared portable handlers, saved records, reactive query updates, reloads and exported documents. It uses synthetic organizations, employees, customers, invoices and bank entries. It does not send payments or external filings.

## Browser coverage

The repeatable configurations use Chromium with a desktop viewport of 1440 × 1000, a 390 × 844 touch phone viewport and a 360 × 800 narrow touch viewport. The cross-module payroll test additionally runs at its configured desktop size and 390 × 844. Phone projects enable mobile and touch emulation; these are browser tests, not physical-device or native mobile-app tests.

| Area | Repeatable command | Checks |
| --- | --- | --- |
| Shared navigation | `npm run test:responsive-shell` | All fourteen payroll sections, connected finance pages, mobile More navigation, contained page widths and console errors |
| Payroll, TD1 and rules | `npm run test:responsive-payroll` | Setup, reviewed imports, rules selection, source evidence, touch table scrolling, saved payroll lifecycle and PDF output |
| ROE | `npm run test:responsive-roe` | Case facts, generated XML digest, issuance in the same register, follow-ups, amendments, reloads and protected versus ordinary deadline controls |
| Remittances | `npm run test:responsive-remittance` | Plans, approval, exact destinations, partial settlements, remaining-only exports, legacy register/bank readbacks, reloads and permissions |
| Semester planning and reports | `npm run test:responsive-finance` | Recurring costs and staff assumptions, cash versus allocated totals, source edits, saved report filters, graphs, drill-downs and exports |
| Invoices | `npm run test:responsive-invoices` | Customer, catalogue rate, price list, invoice, linked bank payment, receipt, PDF and ledger readbacks |
| Cross-module payroll data | `npm run test:payroll-propagation` | Actual source changes, stale approval rejection, recalculation, finalization, retained rule/declaration provenance, register, ledger and PDF consistency |

Run the complete set with `npm run test:responsive`. Each configuration starts an isolated local IndexedDB workspace and uses one browser worker. The tests save screenshots and failure traces in the configuration's output directory. They inspect nested page and form widths as well as the document width, because clipping at an outer container can otherwise hide a mobile overflow defect.

## What should propagate

Changes to reviewed TD1 settings, published rule selection, work inputs and planning assumptions must update their current dependent previews and views. Saving and reloading must preserve the underlying records, references and monetary amounts. A changed payroll source must prevent approval of a stale preview until the calculation is refreshed.

Finalized payroll, issued ROEs and actual payment evidence retain their historical facts. A subsequent source change must not rewrite the earlier calculation, statement or payment. That intentional immutability is checked alongside propagation of live data. See [the detailed payroll data-flow evidence](payroll-data-propagation-verification.md).

The phone test checks include real touch activation and scrolling, form submission, nested drawers, source evidence, reloads and downloads. The tests check local browser persistence through the same shared handlers used by the other runtimes. Separate portable-runtime and isolated Convex qualifications cover server-side validation, authorization, exact money and source protections; the browser tests do not imply a production deployment or live bank integration.

## Corrections found during the checks

- Constrained payroll grids and long TD1/rule evidence so outer page clipping cannot hide content wider than the phone.
- Made payroll, remittance, planner and report tables use a single horizontal scroll surface. Touch tests now pan to the rightmost columns; programmatic browser scrolling alone is insufficient evidence.
- Corrected coarse-pointer control sizes and wrapping for long action labels.
- Preserved readable report chart labels at phone widths and readable planning-table columns inside their scroll containers.
- Corrected invoice preview heading wrapping and payment layout so the bank destination and payment actions remain readable and reachable.
- Gave filing source and editor components distinct React keys so React retains the correct component identity.

The data-flow qualification independently checks a synthetic 2% EI rule and TD1 additional withholding changes of $25.50, $50 and $75. The first change affects a draft, the next blocks stale approval until recalculation, and the final change leaves the finalized $50 withholding snapshot and its $142.78 net-pay PDF intact. Its register and journal reconcile to the same source record. These hypothetical rates are test data, not an official tax-rate publication.

## Qualification results — 2026-10-23

| Area | Qualified workflow/viewport pairs |
| --- | ---: |
| Shared navigation and page containment | 3 |
| Core payroll, TD1 and rules | 21 |
| ROE and protected deadline interactions | 9 |
| Remittance preparation, correction and settlement | 9 |
| Semester planning and report editing | 6 |
| Customer/catalogue/invoice/payment/PDF chain | 3 |
| Cross-module payroll data propagation | 2 |
| **Total** | **53** |

Four additional final phone geometry/swipe/drawer regressions and a strengthened narrow-phone invoice containment check passed. The affected ROE phone-card and planner fixed-drawer assertions were rerun against their intended layouts. The total describes qualified scenario/viewport pairs across the dedicated and focused runs, not one monolithic test invocation.

`npm run build`, `npm run desktop:typecheck` and `git diff --check` completed successfully after the interface changes. The production build retains the existing large-chunk advisory. Detailed source-to-output assertions and artifacts are indexed in [payroll data propagation](payroll-data-propagation-verification.md) and [ROE responsive verification](payroll-responsive-roe-verification.md); the invoice artifact index is `/workspace/scratch/invoice-responsive/README.md`.

This is representative workflow qualification in Chromium and the local IndexedDB browser runtime. It is not an exhaustive certification of every application route, currency, repair workflow, physical phone, browser engine or packaged desktop application. The screenshots and touch events support the stated viewport coverage; they do not imply physical iOS/Safari testing or cross-device synchronization testing.

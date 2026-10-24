# Payroll data propagation verification

## Story and boundaries

An employer reviews TD1 declarations and publishes a rule edition in the interface. Those saved sources feed native payroll calculation. Approval checks that its source data is still current; finalization freezes the reviewed result and creates the payroll register record and balanced accrual journal. The downloaded branded pay statement uses that frozen result after reload and later settings changes.

The dedicated browser qualification is `tests/payroll-propagation.spec.ts`, using `playwright.payroll-propagation.config.ts` on port 4213. Its projects cover desktop Chromium at **1500 × 1100** and touch-enabled mobile Chromium at **390 × 844**. Both use fresh synthetic workspaces and the actual local IndexedDB runtime. The test seeds prerequisite employees, accounts, work history and opening balances through normal portable mutations; rule editing/publication, TD1 changes, preview, save, approval and finalization use the interface.

## Independent money fixture

The employee earns **$200.00** for eight hours at $25.00. The explicitly synthetic rule edition changes employee EI to **2%**, with consistent annual caps; it is not an official CRA rate publication. CPP uses the reviewed ordinary BC 2026 rules and 24 actual pay dates. Employer EI uses 1.4 times employee EI, with 4% vacation accrual, zero reviewed additional benefits and zero WorkSafe/EHT cost for this fixture.

| Source or result | First reviewed draft | Recalculated and finalized |
| --- | ---: | ---: |
| Cash earnings | $200.00 | $200.00 |
| Employee CPP | $3.22 | $3.22 |
| Employee EI | $4.00 | $4.00 |
| Reviewed additional TD1 withholding | $25.50 | $50.00 |
| Net pay | **$167.28** | **$142.78** |
| Full employer cost | **$216.82** | **$216.82** |

The employer-cost result independently reconciles $200.00 cash + $8.00 vacation accrual + $3.22 employer CPP + $5.60 employer EI. Posted journal debits and credits both equal **21,682 cents**. The net-pay liability is **14,278 cents**, and the Student support program dimension survives posting.

## Evidence asserted by the browser

1. The rule library interface saves, reviews and publishes the exact hypothetical 2% edition. A database query confirms its percentage, content hash and source URL.
2. The TD1 interface saves independent federal/BC reviewed declarations, including $25.50 extra federal withholding. A database query confirms the declarations and their effective dates.
3. Selecting that edition in native payroll produces the expected real monetary result and stores its rule hash and source references in the draft.
4. Changing the effective federal TD1 to $50.00 through the interface makes approval of the earlier draft fail with **“Payroll source data changed after review.”** Its stored $167.28 result remains unchanged.
5. Editing and recalculating the same draft changes its source fingerprint and net pay to $142.78. Approval and finalization succeed only for that new snapshot.
6. The register points to the calculation and employee, preserves $50.00 additional withholding and $142.78 net pay, and the linked journal balances exactly.
7. A later effective TD1 change to $75.00 is saved as the current declaration. The finalized record retains its approved $50.00 withholding, result fingerprint, selected rule hash and $142.78 net pay after reload.
8. The actual downloaded PDF contains the frozen amounts, finalized status, synthetic branding/footer, selected edition identifier and the manually selected source URL. PDF text is parsed from the saved file bytes.
9. Both viewport projects exercise ordinary controls; the phone uses touch activation for primary actions. The finalized page remains within its viewport width. Screenshots and structured data-flow evidence are saved per project.

## Execution record

**Verified 2026-10-23:** `npx playwright test --config playwright.payroll-propagation.config.ts` completed with **2 passed (4.2m)**. Desktop completed in 2.3 minutes and the touch-phone project in 1.7 minutes. Each project performed the full independent source-change and finalization sequence.

| Boundary | Desktop | Touch phone | Evidence |
| --- | --- | --- | --- |
| UI actions → reviewed source mutations | Passed | Passed | Published rule and independently dated TD1 records queried from IndexedDB |
| Saved sources → native calculation | Passed | Passed | Exact CPP/EI/extra-tax/net amounts and selected content hash |
| Changed source → approval guard | Passed | Passed | Approval rejected; prior draft money/fingerprint preserved |
| Recalculation → approved/finalized snapshot | Passed | Passed | Same draft ID, new source fingerprint, finalized $142.78 net |
| Finalization → register and ledger | Passed | Passed | Linked employee/run, five journal lines, 21,682-cent balanced posting |
| Later settings/reload → frozen UI/PDF | Passed | Passed | Current extra tax $75; frozen extra tax $50; actual downloaded PDF retains approved money and provenance |
| Viewport and touch interaction | 1500px document / 1500px viewport | 390px document / 390px viewport; touch enabled | Working primary actions and workspace screenshots |
| JavaScript/unexpected external payroll requests | 0 / 0 | 0 / 0 | Recorded in each evidence JSON |

Artifacts from the completed run:

| Artifact | Desktop | Touch phone |
| --- | --- | --- |
| Structured data-flow evidence | [JSON](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-desktop/data-flow-evidence.json) | [JSON](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-touch-phone/data-flow-evidence.json) |
| Payroll workspace screenshot | [PNG](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-desktop/finalized-payroll.png) | [PNG](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-touch-phone/finalized-payroll.png) |
| Reviewed TD1 screenshot | [PNG](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-desktop/reviewed-td1.png) | [PNG](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-touch-phone/reviewed-td1.png) |
| Actual frozen branded statement | [PDF](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-desktop/propagated-frozen-pay-statement.pdf) | [PDF](/workspace/scratch/payroll-propagation-browser/payroll-propagation-review-9af55-ster-ledger-and-branded-PDF-touch-phone/propagated-frozen-pay-statement.pdf) |

Both PDFs contain six pages of statement details and calculation/source support. The assertions parse the actual downloaded bytes, including the selected manual edition identifier and its source URL.

The browser records JavaScript errors and external requests. The application's static Google font stylesheet/WOFF GET requests are identified separately; unexpected external payroll requests fail the test. No external payment, employee message or tax filing is part of this flow.

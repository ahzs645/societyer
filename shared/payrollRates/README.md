# CRA payroll source editions

These files are original downloads from Canada Revenue Agency pages, retrieved on 2026-10-23. `sources.json` records each URL, byte count and SHA-256. CSV bytes and guide HTML are retained unchanged. `.gitattributes` prevents line-ending conversion from invalidating those hashes. This implementation uses official public formulas and data; no third-party payroll engine code is included.

`reviewed-2026.json` contains the source-checked constants consumed offline by `payrollRateSetFor`. Federal and B.C. brackets match the archived CSVs. July Option 2 B.C. values are transcribed separately in `2026-07/bc-option2.json` from the July guide's Chapter 5 table, because July's general CSV contains Option 1's prorated values. The source check parses that HTML table independently.

Supported payment dates are January 1–December 31, 2026, for ordinary B.C. employment. January through June uses the January edition. July onward selects either Option 1's 6.14% withholding rate/basic reduction $805, or Option 2's 5.60% annual rate/basic reduction $690. Other years/provinces and unsupported employment policies fail explicitly. December work paid in a later year never inherits the prior year's deductions.

The engine retains exact rational rate ratios internally, truncates the regular CPP period exemption, rounds CPP/CPP2/EI and prescribed intermediate tax factors half-up, and separates regular/bonus/additional withholding. CPP2 remains a separate amount. A bonus paid separately receives no second regular CPP exemption. Annual ceilings and opening balances apply to the same legal employer only.

CPP age, CPT30 and CPP-disability payment-month eligibility follows the archived CRA start/stop guide. The helper returns derived eligibility/months and source references, excluding birth dates from the derived result. CPT30 revocation requires an election made in a prior calendar year; future receipts cannot rewrite an earlier payment.

The archived `vacation-pay.html` distinguishes vacation taken with pay from continuous vacation payments or unused-vacation compensation. CRA requires the bonus/irregular method for income tax and CPP on the latter; the earnings adapter retains that deduction treatment separately from the earning's vacation classification. A generic manual CPP exemption cannot override age, election or disability dates; other nonpensionable employment requires a separately reviewed policy.

Federal/provincial split data is retained only when known. CRA's flat 15% combined bonus withholding at annual taxable income of $5,000 or less does not publish a jurisdictional allocation; that split is `null`, with combined withholding still authoritative. Option 2 requires exact historical tax splits when prior tax exists, and additional TD1 withholding stays outside its cumulative balances.

Run `npx tsx scripts/check-payroll-deductions.ts` to verify all source hashes, official CSV/HTML constants, the CRA's published bonus example, payment-date editions, cumulative averaging, cap crossings, 27-pay exemptions, distinct benefit bases and effective CPP policies. These checks run offline and contact no payroll provider.

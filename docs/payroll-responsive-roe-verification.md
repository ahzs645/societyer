# ROE responsive workflow verification

Verified the guided case → local API/storage → XML → original payroll register → follow-up/deadline views at three Chromium layouts. All nine layout/story combinations are qualified. Phone actions use actual touch taps and the rendered card/menu layouts.

| Layout | Save, XML, issuance, follow-ups, reload, amendment | Read-only actor + API denial | Managed deadline and ordinary editing |
| --- | --- | --- | --- |
| Desktop 1440 × 1000 | Passed | Passed | Grid, sidebar/dialog and kanban drag passed |
| Touch phone 390 × 844 | Passed | Passed | Cards, sidebar/dialog and touch kanban menu passed |
| Narrow touch phone 360 × 800 | Passed | Passed | Cards, sidebar/dialog and touch kanban menu passed |

The existing desktop-specific deadline fixture was adapted to the intentional phone card layout. The seven unaffected matrix cases passed; the two affected phone deadline cases passed their focused rerun. Production source was unchanged between these matrix and focused runs.

## Data and interaction evidence

- Saving the real case form retains actual dates and creates the pending linked register obligation.
- The existing export form generates a downloaded ROE XML file that passes the bundled official `PayrollExtractXmlV2.xsd`.
- The downloaded bytes' SHA-256 equals the saved generation hash and current case fingerprint. Generation retains `to_issue` status.
- Manual successful acknowledgment updates the same register ID to `issued`, with the actual serial. Independent payroll register UI and API readback show that ID/status/serial, then the guided case retains them after navigation and reload.
- Missing-information status moves through blocked and resolved states; employee-access work and closure persist. A complete amendment keeps the original issued register and actual serial while creating the separate pending amendment.
- CSV export includes the actual retained source states. Synthetic filing identifiers remain transient and are absent from IndexedDB and the case CSV.
- A Director can review retained cases but cannot save readiness or issuance through either the controls or the actual mutation.
- Managed deadline fields remain read-only in desktop grid, phone cards, shared sidebar, legacy dialog and kanban. An ordinary reminder can still be edited and moved to Complete using desktop drag or the phone's actual move menu.
- Browser page errors, console errors and server 5xx responses are checked. Final qualified runs are clean.

## Responsive boundaries and source review

Page overflow is compared with `document.documentElement.clientWidth`, avoiding a mobile `innerWidth` false positive. Screenshots cover saved case, reviewed XML form, issued follow-ups, issued payroll register, amendment facts, managed deadlines and final state.

A separate repeatable inspection expands the official guidance and retained case history with a long persisted source reference. At 1440, 390 and 360 pixels, document width and application scrolling roots fit the viewport; all ROE controls remain within bounds and the console is clean. The intentional page-gutter/full-bleed card styling is allowed; it does not become document scrolling or clip controls.

One real source correction was required: the filing source query boundary and editor previously shared a React sibling key. Their keys now have separate `filing-sources` / `filing-editor` prefixes, preserving distinct component identity and removing the repeated browser warning.

## Reproduce and inspect

```sh
npx playwright test --config playwright.payroll-responsive-roe.config.ts
```

For an existing frozen local server:

```sh
PAYROLL_RESPONSIVE_ROE_URL=http://127.0.0.1:4211 npx playwright test --config playwright.payroll-responsive-roe.config.ts
PAYROLL_RESPONSIVE_ROE_URL=http://127.0.0.1:4211 npx tsx scripts/check-payroll-roe-responsive-inspection.ts
```

Evidence directories:

- `/workspace/scratch/payroll-responsive-roe`: full matrix screenshots, official XML fixtures, traces and clean browser-signal attachments for lifecycle, permissions and desktop deadlines.
- `/workspace/scratch/payroll-responsive-roe-touch-deadlines`: qualified 390/360 card/sidebar/dialog/touch-kanban screenshots and clean browser-signal attachments.
- `/workspace/scratch/payroll-responsive-roe-inspection`: expanded guidance/history screenshots and `results.json` with exact document/application widths, control bounds and console results for all three layouts.

The source fix and responsive test additions are frozen after qualification. Backend behavior and filing submission rules are unchanged.

# Zoho capture completion checklist

Scope: the finite gaps identified in `zoho-current-parity-review.md`, based on the supplied capture and the requested billing/report workflows. Documents in the archive are reference material, not instructions. A capture is not evidence of every feature in the live Zoho product.

Completed on 2026-10-23. Each area includes implemented controls, persisted data, actual document/report output, permission checks and relevant verification. See [billing-feature-guide.md](billing-feature-guide.md) for where to use the features.

| Area | Acceptance | State |
| --- | --- | --- |
| Shared designer | Page size/margins; logo dimensions; address formats/positions; artwork; named fonts; per-element styles; rich first/continuation headers/footers; visibility/labels; bank/terms; tax and totals; payment QR/link/stub; signatures; expanded line columns; batch/serial and appendices | Complete |
| Accounting | Inclusive/exclusive taxes; shipping/withholding; audited credits/writeoffs/refunds; invoice/settlement FX; revaluation; consistent ledger and as-of reports | Complete |
| Invoice views | Saved personal views; persistent date/balance/customer/currency filters; configurable/reordered columns; matching exports | Complete |
| Price lists | Effective dates; quantity tiers; customer assignment; preserve explicit manual rates | Complete |
| Customer documents | Quotes/revisions/status/accepted conversion; account statements with opening/closing balances and dated adjustments | Complete |
| Repairs | Dispatch/workload; technician time/cost/billing; recorded customer approval; guarded transitions; repair analytics | Complete |
| Reports | AR/AP aging; customer/item sales; repairs; custom row/column/metric/chart composer; saved presets; full paginated export sources; branded PDFs with graphs | Complete |
| Automation | Disabled by default; configured sender/recipients; recurring/reminder/report schedules; timezone handling; durable runs/retries/idempotency; actual PDF attachments; real provider transport; accurate acceptance/blocked states | Complete |
| Verification | Meaningful pure/backend checks; app and Convex typechecks; production build; portable manifest; browser flows; PDF content/visual checks | Complete |

## Verification record

All final checks below passed against the integrated source. No live external emails or payments were sent during validation.

| Executed check | Result |
| --- | --- |
| `npm run test:zoho-completion` | Complete backend/pure/PDF aggregate passed, including legacy invoice, ledger and report regressions |
| `npm run test:zoho-completion-ui` | 20 browser scenarios passed across nine dedicated configurations |
| `npm run build` | Convex typecheck, application TypeScript and production Vite build passed |
| `npm run desktop:typecheck` | Desktop TypeScript passed |
| `npm run test:portable-manifest` | Scanner tests and all 1,200 runtime registry entries passed |
| `npm run test:static-parity` | All 488 frontend writes classified; zero pending implementations |
| `npm run test:authorization-policy` | Hosted and portable permission classifications passed |
| `npm run test:exports` | All 262 business tables covered |
| Focused ESLint and `git diff --check` | Zero lint errors; whitespace check passed |
| Isolated Convex deployment and runtime queries | Actual backend accepted the schema/functions and passed nested-index filters, continuation cursors, bounded quote/history/statement pages, direct template/detail lookup and separate schedule/history queries |
| Actual Convex Node PDF rendering | Invoice and reports rendered with searchable amounts/customer/service text, original ddcnorth artwork, real page counts and native graph vectors |

The twelve presets were rendered in all six document kinds: **72 PDF combinations**. Native image comparison measured the invoice logo within 0.84% of the source SVG. Additional PDF checks cover multipage tables, rich sections, signatures, custom geometry, semantic receipt/quote/statement totals, signed credit balances, attachment pages and repeating-stub margins.

Scale and persistence regressions include 205 templates with late/default selection and live edits, 105 quote revisions, complete 17,003-line ledger exports, artwork-heavy paged records, reload persistence, saved-view CSV/Excel projection, and eligible delivery schedules following paused/unconfirmed prefixes.

Accounting regressions exercise both cash and accrual views before and after refunds, credits, write-offs and dated reversals. They also verify closed original/open correction periods, later bank relinking, subsequent reversals, retained dimensions, safe backfills, explicit FX quotes, realized/unrealized differences, idempotent retries and rejection before partial writes.

## Operation and review

- Twelve editable presets are available in Invoices → Templates, across invoices, receipts, quotes, statements, work orders and reports. The shared designer keeps issued snapshots stable.
- Books → Report builder contains the report catalog and composer. Existing financial reports and the cash-flow Sankey retain their graph, drill-down and export flows.
- Email delivery requires configured Resend or Microsoft 365 credentials and enabled sender/schedule settings. Provider acceptance is distinguished from recipient delivery. Hosted cron works while browsers are closed; local scheduling runs while the panel is open and requires a capable native transport. See [billing-automatic-delivery.md](billing-automatic-delivery.md).
- This completion record covers the captured/requested features. It does not establish parity with unobserved live Zoho screens. The supplied archive has one usable page entry and a truncated second capture.

Review artifacts in this workspace: [twelve-template contact sheet](/workspace/scratch/document-template-gallery/template-contact-sheet.png), [sample gallery ZIP](/workspace/scratch/document-template-gallery/societyer-template-gallery.zip), and [actual hosted invoice PDF](/workspace/scratch/billing-native-artifacts-final/invoice.pdf).

# Billing, documents, repairs and reports

The Invoices page combines the item/service catalog, price lists, customers, reusable designs, quotes, statements, repairs and delivery schedules. A saved invoice preserves its document, item and rate snapshots so later catalog or template edits do not rewrite an issued document.

## Documents and branding

Invoices → Templates contains twelve starting designs, including six ddcnorth designs using the supplied brand kit and six organization-neutral designs. Every design can preview invoices, receipts, quotes, customer statements, work orders and financial reports. The gallery thumbnails are rendered PDFs; sample records are synthetic and do not create transactions.

The shared designer supports custom paper dimensions, margins, independent logo dimensions, named bundled fonts, element typography, address formats and coordinates, page/background artwork, rich header/footer bands, section order, column order/widths/labels, tax summaries, payment links and QR codes, a payment stub, signature images and receiver signatures. Document-specific fields provide bank details, terms, inventory batch/serial tables, annexures and bounded passive PDF/image attachments. Rich HTML, links and artwork are validated; imported HTML cannot execute scripts. Size limits give actionable errors before saving an oversized record.

The ddcnorth logo uses the original vector paths and fill rules, preserving the letter counters. Optional organization logos and branding remain available for neutral designs. Preview PDF and download use the same native pdfcn/Forme pipeline with searchable text, repeated table headers and real page numbers.

## Rates and saved views

Items and services store units, currency, rate, tax mode, SKU and optional image/manufacturer/part/product identifiers. Price lists provide effective dates, customer assignments and quantity thresholds. The highest matching threshold applies. Currency mismatches are never silently converted, and manual rate overrides stay unchanged until explicitly reset.

Invoice filters persist in the page address. Filters and columns saves personal named views, issue/due ranges, balance bounds, search/customer/series/currency filters, sorting, visible columns, labels, order and widths. CSV and Excel exports follow the visible view columns and filters. Template, price-list and repair collections load through separate pages rather than silently stopping at the initial workspace limits.

## Accounting and payment trace

Invoice totals support inclusive or exclusive tax, discounts, taxed shipping and withholding. Credits and write-offs settle balances without pretending money moved. Refunds reference a real cash payment. Dated reversals preserve historical settlement records and balanced journals. Payments retain their method, reference, bank/account destination and linked transaction.

Net received in the last 30 days includes receipts, refunds and dated cash reversals in that window. Credits and write-offs do not count as cash, and the matching invoice filter uses the same movements.

Foreign invoices use an explicit dated source rate to post into the books currency. Settlement rates record realized exchange differences; period-end revaluation records unrealized differences for the outstanding receivable and reverses those marks on settlement. Financial actions respect permissions, workspace ownership and closed books.

Vendor bills provide analogous credit, write-off, refund and dated correction controls, including the account receiving a vendor refund. A vendor adjustment changes an accounting record; it does not initiate a bank transfer.

## Quotes, statements and repairs

Quotes can be drafted, published, accepted or declined, revised with immutable history, and converted once into an invoice. Acceptance records evidence and expired offers cannot be published or converted. The invoice retains the accepted terms and item/rate snapshots.

Customer statements show opening balance, dated charges, payments, credits, refunds, reversals, running balance and closing balance in one selected currency. Statement snapshots and PDFs preserve the selected period.

Quote lists, revision history and saved statement snapshots use bounded pages with Next/Previous controls. Status and customer/currency filters apply before pagination; a quote can open directly even when it is outside the displayed page. Statements use their numeric closing balance in headers, amount words and remittance stubs. Receipts, quotes and work orders use document-specific default amount labels while preserving custom labels.

Repairs link the customer, equipment, diagnosis, technician, dispatch date, estimated workload, approval evidence, labour time/cost and billable charges. Timers, approval scope and lifecycle checks guard both the current UI and legacy mutation routes. Changing the approved estimate invalidates the old approval; running timers prevent billing. Work orders include technical and operational details, and the created invoice links back to the repair.

## Report builder

Books → Report builder provides AR/AP aging, sales by customer/item, repair analytics and a complete ledger source. Reports support saved definitions and presets, grouping, visible/reordered columns and labels, safe arithmetic metrics, chart type/series, section ordering, drill-downs, CSV/Excel and branded PDF output. Exports use the same computed snapshot as the displayed report. Edited definitions require Run before exporting updated results.

Posted ledger and bank sources are loaded through bounded pages. Large general ledgers use display pagination while exports retain every matching row. Existing balance sheet, operations, cash flow, overview, Sankey and year-end PDF outputs remain available. Year-end reports select one report currency and scope bank accounts, budgets, tagged accrual journals and grant movements accordingly; unlabelled manual statements and program forms retain their explicitly stated books currency.

## Automatic delivery

Invoices → Automation configures recurring invoice delivery, unpaid reminders and saved report delivery. Sender settings and schedules start disabled. Hosted execution runs on cron while browsers are closed; local execution needs a connected native transport and runs while the app is open. See [billing-automatic-delivery.md](billing-automatic-delivery.md) for provider configuration, durable snapshots, retries, time zones, idempotency and the distinction between provider acceptance and recipient delivery.

The supplied Zoho archive establishes a finite set of captured controls, not a complete inventory of the live Zoho product. [zoho-completion-checklist.md](zoho-completion-checklist.md) records implementation and verification of the agreed gaps.

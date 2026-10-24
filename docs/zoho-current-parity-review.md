> Historical audit from before the completion work. The current implementation and executed checks are recorded in [zoho-completion-checklist.md](zoho-completion-checklist.md) and [billing-feature-guide.md](billing-feature-guide.md). The missing-feature tables below describe the earlier baseline.

# Current Zoho comparison after the template-gallery implementation

## Conclusion

Full Zoho Books feature or view parity has **not** been established or implemented. The earlier implementation completed the shared designer, gallery, linked billing/repair workflows, and branded financial exports described below. It did not reproduce every setting represented in the capture or all of Zoho Books.

The successful 48-PDF checks cover 12 Societyer presets across four document types. They validate those outputs, not coverage of all Zoho features or views. This review inspects the current source and the supplied captures; no implementation changes or new functional test runs were made for this audit.

## What the capture can establish

- The usable `zoho` HAR has 131 network entries and one recorded page entry. A page entry is not a complete inventory of client-side views.
- Successful API responses include the template editor, metadata, general preferences, feature flags, widgets, tax-return settings, and email-template data. Data preloaded by the application does not prove each related screen was visited or its entire behavior observed.
- The template editor response contains 263 top-level template properties. These include generated HTML, formatted values, identifiers, and capability flags as well as settings; they are not 263 separate visible controls.
- The second HAR, `zoho other`, is truncated. Only one complete network entry could be recovered, providing no additional verified finance-view coverage.
- There is no complete captured tour of Zoho's reporting, dashboards, sales/purchasing, automation, or all document-type screens. An exhaustive comparison of those views remains unverified.

No organization data, authentication headers, cookies, or raw HAR bodies are copied into this document.

## Implemented in Societyer

- Reusable items/services with SKU, units, rates, currencies, taxes, and explicit currency-specific price lists.
- Invoice/customer/payment/bank/accounting links and repair-to-invoice links; partial-payment receipts and repair work-order PDFs.
- Shared versioned document settings: Letter/A4, orientation/margins, logo variants/width/alignment, six typography groups, common labels/visibility, nine ordered/resizable item columns, section order, striped rows, first/continuation text bands, page numbers, and a signature line.
- Twelve visible templates, real PDF thumbnails/previews, search/type filters, editable copies, import/export, archive/restore, and invoice design snapshots.
- Balance sheet, operations, cash flow, general ledger, financial overview, Sankey, and five year-end outputs with branded PDFs and graphs where applicable.
- Existing report dates/frequency/basis/currency/dimension filters, drill-downs, Excel/CSV, and graph/table switching.

## Confirmed remaining captured document controls

These gaps compare current controls to settings represented in the template response. The presence of a field does not establish that it was enabled for every invoice or supported document type in the captured organization.

| Area | Current partial support | Still missing |
| --- | --- | --- |
| Page and geometry | Letter/A4, landscape, margins, logo width/alignment | Custom page width/height, independent logo height, adjustable first-page header height, page-number positioning |
| Address blocks | Saved billing/shipping strings and visibility | Address-format tokens, organization/customer/shipping block placement and XY offsets |
| Artwork and colors | Accent, logo variants, fixed alternate shading | Body/header/footer background images, opacity/position, independent background/border/header-text/alternating-row/totals/balance colors |
| Typography | Six section font groups and four bundled font choices | Independent styles for organization/customer names, item descriptions, column headers, balance, notes, terms and labels; broader named-font selection |
| Rich sections | Plain-text first/continuation header/footer and repeat controls | Rich HTML/image content, structured bank-details block and its position, dedicated terms-and-conditions block |
| Visibility and labels | Common labels and field switches | Separate organization name/address visibility; optional title, document number, bill-to and final total; editable document-number label; balance in header; configurable status stamps |
| Tax and totals | Per-line tax, grouped taxes, discount/paid/balance rows | Tax-summary table with taxable bases and tax amounts; inclusive/exclusive rate mode; shipping, credits-applied, write-off and withholding display rows; amount in words; base-currency parallel values |
| Payment blocks | Payment instructions and recorded payment provenance | Payment QR/link/stub, first-page stub controls, structured online-payment block |
| Signatures | One name/label and blank signature line | Signature images, additional/receiver signature blocks and independent positioning |
| Item fields and annexures | Number, SKU, item, description, quantity, unit, rate, tax, amount | Item pictures, manufacturer/part number/UPC/EAN/ISBN/custom-field columns, appendices/attachments, inventory batch/serial annex tables |

Examples of captured evidence: `page_width`, `page_height`, `address_positions`, `*_bg_image_opacity`, `custom_header_html`, `custom_footer_html_for_other_pages`, `is_tax_summary_required`, `rate_tax_incexc_preference`, `show_qr_code`, `is_payment_stub_required`, `is_additional_signature_required`, `show_amount_in_words`, and `advanced_inventory_tracking_annex`. Full field-name/type inventory: [zoho-invoice-template-field-inventory.json](zoho-invoice-template-field-inventory.json).

## Remaining native workflow and view gaps

These are current Societyer limitations in billing/finance, not claims that every corresponding Zoho screen was captured.

| Area | Gap |
| --- | --- |
| Invoice list | Named saved views, configurable columns, and broader persistent filter definitions |
| Report catalog | Dedicated receivables/payables aging, sales by item/customer, and repair analytics |
| Financial report designer | Custom report definitions, editable report-specific rows/columns/labels, financial metric/chart composition, saved report presets and scheduled delivery |
| Shared design across reports | Reports reuse page/branding/font/table-style/footer controls; invoice item-column and content-section ordering controls do not redesign semantic financial report contents |
| Price lists | Automatic customer assignment, effective dates and quantity tiers |
| Currency accounting | FX conversion/revaluation and automatic posting of foreign-currency invoices; the existing flow requires manual accounting at the exchange rate received |
| Delivery automation | Recurring schedules/draft creation exist, but automatic recurring delivery is pending; invoice/reminder actions draft messages in the Outbox for review and sending |
| Customer documents | Native estimates/quotes and customer account statements using the shared designer |
| Repairs | Technician dispatch, workload/time tracking, customer approval workflow, and repair analytics |
| Wider accounting suite | The capture's credits/write-off/withholding labels demonstrate document support, not an observed complete accounting workflow. A complete credits/refunds/settlement parity audit remains outstanding. |

Societyer already has a customizable main dashboard and generic saved record-table views. Those controls are not the native invoice-list view designer or a financial metric/report builder. Wave Estimates exists as a cached external-resource view, rather than native estimate authoring/conversion and shared PDF output. General workflow cron capabilities exist, but no financial-report-specific recipient/schedule/delivery flow was found.

## Existing practical limits

- General ledger display and exports: 2,000 lines, with an explicit truncation notice.
- Financial overview bank history: 5,000 transactions, with a source-limit notice.
- Template/price-list workspace reads: 200 of each; repair workspace reads: the latest 1,000 repairs.
- Some overview/year-end sources sum nominal amounts across currencies. Their PDFs disclose this; no FX conversion is performed. Currency-filtered books reports isolate the chosen currency.

## Suggested next work

1. Finish money-handling parity: inclusive/exclusive tax, a tax-summary table, currency conversion/posting, and explicitly modeled credits/write-offs/refunds where required.
2. Add customer statements and aging reports, then sales and repair analytics.
3. Wire saved views/column controls into native invoices and finish price-list assignment rules.
4. Complete the remaining document blocks/geometry and report-specific editing controls.
5. Add verified recurring delivery, reminders, report scheduling, and end-to-end tests for those automated flows.

## Current source evidence

- `shared/documentDesign.ts`, `shared/invoiceCommerce.ts`, `src/features/invoicing/DocumentDesignControls.tsx`.
- `src/features/invoicing/documentPresentation.ts`, `InvoicePdfDocument.tsx`, `documentPdfDecoration.ts`, `billingDocuments.ts`.
- `src/pages/Invoices.tsx`, `PriceListsPanel.tsx`, `CustomersPanel.tsx`, `RepairJobsPanel.tsx`, `SeriesPanel.tsx`.
- `src/features/financials/reports/ReportPdfDownload.tsx`, `BrandedReportPdfDocument.tsx`, `GeneralLedgerReport.tsx`.
- `src/features/financials/insights/useFinanceInsightsData.ts`, `financialOverviewDocument.ts`.
- `shared/invoiceLedger.ts`, `shared/functions/invoices.ts`, `src/features/financials/pages/YearEndReportsPage.tsx`.

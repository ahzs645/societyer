# Zoho invoice editor and Societyer finance audit

Checked against the supplied `Archive 2.zip` captures and the Societyer source on 2026-10-22.

**Historical baseline:** this comparison was recorded before the expanded implementation. The shared sectioned designer, receipt/work-order outputs, and branded report PDFs with graphs have since been implemented. See [current capabilities and verification](document-designer-and-report-exports.md). The tables below retain the original findings for source comparison.

For remaining gaps after the designer and 12-template gallery, see the [current parity review](zoho-current-parity-review.md).

## Result

Societyer has an invoice **data builder** and a smaller **template customizer**. It does **not** yet reproduce the full Zoho document designer. The earlier invoice work added branding and reusable rates, not all of Zoho's layout and report controls.

Financial report options and graphs already exist. Their exports and document branding are not uniform across pages. The pdfcn/Forme invoice renderer is currently specific to invoices.

The attached capture contains a successful response from `/api/v3/settings/templates/editpage` with 263 top-level template properties, including capability flags and structured settings. It does not contain a complete tour of Zoho's reports. This audit verifies the captured invoice controls and inventories Societyer's reporting capabilities; it does not claim full Zoho reporting parity. The public Zoho reports help page returned HTTP 403 during this check, so it was not used as evidence.

## Invoice designer controls in the capture

| Area | Societyer currently has | Confirmed gaps compared with captured template settings |
| --- | --- | --- |
| Template lifecycle | New, duplicate, customize, select a default; design snapshot per invoice | Full template export/import and a shared designer for other document types |
| Page | A4 or Letter, three fixed layout choices | Landscape orientation, editable margins, custom page dimensions, column/layout positioning |
| Brand and logo | Brand JSON import, exact outlined logo, primary/black/reversed colors, bundled brand fonts | Editable logo width/height and position, clear-space controls, background artwork and opacity |
| Fonts and colors | Brand typography, accent color and brand palette | Per-section font family/size/color; title, labels, descriptions, tables and totals independently styled |
| Header | Invoice number, title, issue/due dates, terms, PO/reference, organization details | Label editing, individual visibility controls, customizable address formats, alternate header content on continuation pages |
| Customer and shipping | Bill-to identity, address and email | Separate ship-to block, bill-to/ship-to label and placement controls |
| Item table | Reusable catalog lines, quantity/unit/rate, per-line tax, descriptions, line ordering | Editable column labels, column widths/order, column visibility, row numbering, alternate row styling, item pictures, SKU/MPN/UPC/EAN columns |
| Totals | Subtotal, invoice discount, tax groups, total, recorded payments and balance calculations | Independent labels/visibility/styles, credits/write-offs/withholding/shipping, amount in words, tax-summary table |
| Footer | Footer text, notes, payment instructions, tax registration | Editable page numbering/format/position, separate first-page/continuation footers, custom footer/header HTML, footer artwork |
| Other blocks | Payment destination is recorded in invoice payments | Payment stub, QR payment block, authorized/receiver signature blocks, annexures and inventory batch/serial annex tables |
| Preview and PDF | HTML preview, browser print, direct pdfcn/Forme PDF; long tables repeat their heading | A visual section/column editor and one exact-layout preview for every export renderer |

These are design controls, distinct from data entry. For example, entering a tax rate is implemented; choosing the tax column's width and label is not.

## Page-by-page billing and reporting inventory

| Page or view | Verified options and behavior | Current limitation |
| --- | --- | --- |
| Invoices list | Status tabs, needs-action view, search, sort, currency filter, selection, bulk mark-sent/reminder/void, Excel/CSV | No configurable Zoho-style list-column/view designer in this screen |
| Invoice data builder | Customer picker/create, dates/terms/reference, catalog selection, price list and currency, quantity/unit/rate/tax, discounts, memo, recurring setup, live preview and PDF | Template choice uses saved fixed designs; it is not the full document designer |
| Invoice detail | Record partial/full payments, method/reference/destination, link bank deposit, ledger entry, history, duplicate/void/restore, reminder, PDF | No branded standalone payment receipt or customer statement builder |
| Customers tab | Customer balances, last invoice, open invoices and new invoice | A roll-up, rather than a full customer statement/report page |
| Items & services | Item/service, description, SKU, unit, currency, rate, tax, category, active/inactive; reuse on invoices/repairs | Not a stock valuation or inventory accounting report |
| Price lists | Named currency-specific item rates; select while building an invoice | No automatic customer assignment, effective-date schedules or quantity-tier pricing |
| Repairs | Intake, equipment/serial, dates, notes, parts/labour, status history, linked invoice/balance | No technician dispatch, work-order document designer or repair analytics page |
| Templates tab | Brand import/preset, logo color, three layouts, accent, title, paper, footer, three visibility switches, default | Missing the advanced designer controls listed above |
| Financial overview (`/app/financials`) | Range presets, previous-period/prior-year comparisons, cash balance trend, inflow/outflow bars, budget actuals, top payees/categories, cash-flow Sankey, chart/table switches and transaction links | These charts use bank transaction data; no custom dashboard composition or shared invoice-brand PDF export |
| Balance sheet (`/app/financials/reports/balance-sheet`) | Period range, monthly/quarterly/yearly columns, cash/accrual basis, fund/program/tag/currency filters, working-capital graph, hierarchical rows, figure drill-down, Excel/CSV | No direct branded statement-and-chart PDF from the report download menu |
| Operations (`/app/financials/reports/operations`) | Same report controls; revenue/expense graph and period totals; drill-down and Excel/CSV | Same PDF/designer gap; this is the statement of operations, not an invoice sales-by-item/customer report |
| Cash flow (`/app/financials/reports/cash-flow`) | Same report controls; ending-cash graph and cash-in/out graph; drill-down and Excel/CSV | Same PDF/designer gap |
| General ledger (`/app/financials/reports/general-ledger`) | Period, basis, dimensions, currency and account filters; opening/running/closing balances for one account; entry/bank links; Excel/CSV | A transaction table, not a chart page; display/export capped at 2,000 lines with an explicit notice |
| Year-end (`/app/financials/year-end`) | Readiness, annual statement, restricted funds, organization revenue/expenses, program actuals/budget; Word/PDF/print and document preview | Uses a separate export pipeline; does not inherit invoice templates or automatically embed the interactive graphs |

An overdue invoice tab and customer balances are present, but dedicated receivables/payables aging reports, sales-by-item/customer reports, a custom financial report designer, and scheduled financial report delivery were not found in the inspected finance/report routes. This is not a claim that those functions are absent from every unrelated Societyer module.

## Why a report graph may be empty

The books reports read **posted journal entries**, with the selected basis, dates, currency and dimensions. Draft invoices and voided entries do not populate them. An invoice whose ledger posting is blocked also needs its accounting issue resolved first. The financial overview instead depends on bank transaction history. A chart with insufficient data can therefore be hidden or replaced by an empty-state message while its component is implemented.

## Logo correction

The source brand SVG uses even-odd filling for the compound paths in both `d` letters. Forme's SVG renderer fills these paths with the nonzero rule, which filled their counters. The PDF adapter now reverses nested contour winding while preserving the actual curve geometry and vector output. The source artwork and HTML logo are unchanged.

A new visual regression renders the source SVG and the PDF logo at the same resolution and compares pixels. Before the correction the foreground mismatch was about 14%; after correction it is below 1%, within a 2% allowance for differences between renderers' anti-aliasing. It is part of `npm run test:invoices`.

## Recommended implementation order

1. Replace the small template drawer with a sectioned designer covering Page, Branding, Header, Customer/Shipping, Items, Totals and Footer, with continuation-page preview. Persist a versioned layout schema rather than a growing set of unrelated switches.
2. Make labels, visibility, table widths, margins, typography, page numbers and first/continuation headers work in both HTML and PDF before adding more layouts.
3. Add a report document composition layer that consumes the actual filtered report result and includes its chart, table, basis, currency, dates and filters in one branded PDF. Reuse the same brand profile and logo rendering.
4. Add dedicated aging, sales and repair reports from their respective domain records. Keep them distinct from posted-ledger financial statements.
5. Reuse the document designer for estimates, work orders, customer statements and payment receipts; add saved reports/scheduling after the report schema and outputs are stable.

## Evidence

- Source-property inventory: `docs/zoho-invoice-template-field-inventory.json` (field names and types only; no captured account data).
- Current template controls: `src/features/invoicing/InvoiceTemplatesPanel.tsx` and `shared/invoiceCommerce.ts`.
- Report routes: `src/main.tsx` and `src/features/financials/pages/BooksReportsPage.tsx`.
- Report options: `src/features/financials/reports/ReportToolbar.tsx`, `reportFilters.ts` and `useReportState.ts`.
- Report charts: `src/features/financials/reports/ReportChartStrip.tsx`; overview charts: `src/features/financials/insights/FinancialInsights.tsx`.
- Statement downloads: `src/components/ReportTableDownload.tsx`; ledger downloads: `src/features/financials/reports/GeneralLedgerReport.tsx`.
- Year-end exports: `src/features/financials/pages/YearEndReportsPage.tsx`.
- PDF logo adapter: `shared/invoiceBranding.ts`, `shared/svgFillRule.ts`; visual check: `scripts/check-invoice-logo-fidelity.tsx`.

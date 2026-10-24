# Shared document designer and financial report PDFs

The **Templates** tab in Invoices now opens a sectioned document designer. It replaces the earlier small template customizer. Templates store a versioned layout, and existing invoices retain their own design snapshots.

## Ready-made template gallery

The Templates tab includes 12 visible starter designs: six ddcnorth styles and six designs that inherit your organization's branding. Browse invoices, receipts, quotes, customer statements, repair work orders, and financial reports with the type filters or search by name/style. The thumbnails are actual PDF renders. **Preview** opens a full-size, downloadable PDF with your organization's details and clearly marked sample customer/financial data; the document selector can preview any of the six document types.

Choose **Use this design** or **Customize template** to open an editable copy, then **Save template**. Browsing and previewing create no records and do not change the default template. Saved designs have their own live thumbnails and full-size PDF previews. Readers can browse and preview, while saving requires the existing write permission. Archived saved designs can be previewed and restored.

`npm run render:template-gallery` regenerates the 12 first-page image assets from the shared presets and sample data, and writes sample PDFs, larger previews, a contact sheet, and a ZIP to `/workspace/scratch/document-template-gallery`. `npm run test:template-gallery` validates the presets, clone isolation, and all four PDF document types for every design.

## Designer

Use **New template**, **Customize**, or **Use ddcnorth brand**. The designer includes:

- Letter/A4 paper, portrait/landscape orientation, and four independently editable margins in points.
- Brand JSON import, the corrected ddcnorth vector logo, logo variants, width/alignment, and accent color.
- Independent body, header, customer, table, totals, and footer font family, size, and color.
- Invoice, receipt, work-order, and report titles; customer/shipping/date/terms/reference/notes/tax-registration visibility and editable labels.
- Nine item columns: number, SKU, item, description, quantity, unit, rate, tax, and amount. Each has visibility, label, relative width, and order controls. Tables support alternate row shading and row padding.
- Content-section ordering, supporting-total visibility, first/continuation header and footer text, repeat settings, genuine page counts, and a signature block.
- Template duplication, JSON export/import, archiving/restoration, and a default for new invoices.

The live content preview updates while editing. **Preview PDF** generates the actual paginated document in an embedded viewer. **Multi-page sample** checks continuation behavior. The sample selector covers invoices, payment receipts, and work orders. Blank/invalid numeric typing stays in the field until corrected; invalid configurations cannot overwrite the saved template.

Margins, logo dimensions, and typography sizes use PDF points (72 points per inch). Column widths are relative shares of available page width. Oversized header/footer content produces an actionable fitting error rather than silently overlapping the document body.

Shipping data is entered under **Shipping details** in the invoice builder. SKU is editable per line and copied from the reusable catalog. Shipping, SKU, prices, and the design snapshot survive duplication and recurring issuance. Changing a saved template does not restyle previously issued invoices.

## Receipts and work orders

In invoice details, each eligible payment has a **Receipt** action. Its preview and PDF acknowledge that individual recorded payment, retain the invoice's saved design, and include the payment method, reference, destination, bank linkage, and invoice balance at export. Draft/void invoices and removed or nonpositive payments cannot produce receipts. Missing destinations say **Not recorded**.

Saved repairs have a **Work order** action, including before an invoice exists. Choose an active document template in the preview. The work order contains the customer, equipment/serial, intake and target dates, reported problem, repair status, parts/labour, work notes, and linked invoice where present. Both document types use the same HTML/PDF renderer and export permission as invoices.

## Branded financial PDFs

Balance sheet, operations, cash flow, and general ledger expose **PDF template**, **Include graphs** where applicable, and **Download branded PDF**. Excel/CSV and journal drill-downs remain available. The PDF uses the report result already displayed, with its date range, basis, currency, fund/program/tag context, warnings, and searchable rows.

Statement graphs use the same working-capital, revenue/expense/net, and cash-flow values as their interactive equivalents. Graphs are vectors, and a searchable data table accompanies each graph. Unknown cash history stays unknown. All periods and nested account rows are retained; wide period tables continue with their account column repeated. Long tables repeat column headings.

Books reports and the general ledger load every source page before calculating or exporting. The ledger displays 100 rows per page; CSV, Excel and PDF contain the complete matching result. The report catalog also loads source pages independently, with progress and cancellation, and never silently substitutes a partial export.

The financial overview has an **Overview PDF** for the selected date range, cash history, gross monthly flows, top payees/categories, and the independently scoped fiscal-year budget. The cash-flow diagram has **Diagram PDF**, including its current fund grouping, vector bands, native labels, every category, refund netting, and excluded-transfer count.

All five year-end views now offer the same branded PDF/template path: readiness, annual statement, restricted funds, organization revenue/expenses, and program actuals/budget. Existing Word and browser print layouts remain available. Each PDF identifies its actual data source and period; grant activity, bank trends, approved annual statements, and posted-journal reports have different scopes.

Annual and organization statements do not substitute all-history activity when the selected fiscal year is empty. The annual, organization and restricted-fund tabs have a **Report currency** selector that filters actual account, budget and grant sources. The same scoped result supplies the screen, spreadsheets, native PDF, Word and print layouts. Grant drilldowns contain only the returned currency's transaction IDs. Annual category sections identify bank sources; counterparty/grant sections identify posted accrual journals separately from the recorded financial-statement summary.

No currency conversion is introduced. Books, bank overview, graphs and year-end reports isolate the selected currency. Recorded annual summaries and program forms without their own currency use the workspace base currency; foreign selections exclude those recorded summaries and disclosures. Program prefills include base-currency grants and source transactions only. Bank and posted-ledger history load through complete, bounded source pages.

## Verification

- `npm run test:document-design`: schema validation, persistence/snapshots/recurrence, invoice accounting and PDF layout, logo fidelity, receipt/work-order PDFs, books report calculations, Sankey, branded statements/ledger, overview, and all year-end PDF contents.
- `npm run test:document-designer-ui`: local IndexedDB browser workflows for advanced design persistence, multipage PDF, work orders before billing, partial-payment receipts, report filters, graph/table toggle, journal drill-down, and spreadsheet/PDF downloads.
- `npm run test:invoice-commerce-ui`: existing reusable catalog/price-list/customer/repair/payment flow.
- `npx tsx scripts/check-year-end-report-scope.ts` and `npx playwright test --config playwright.year-end-currency.config.ts`: date/tenant/basis scope, CAD/USD source segregation, exact grant drilldowns, base-currency program prefills and actual PDF/Word downloads.
- `npm run test:static-parity`, `npm run test:portable-manifest`, `npm run convex:typecheck`, and `npm run build`.

The [earlier Zoho comparison](zoho-invoice-and-reports-audit.md) records the baseline capture and its wider controls. The supplied capture contains invoice-template settings, not a complete Zoho reporting tour. This implementation provides Societyer's shared sectioned designer and verified report exports; it does not claim every property in Zoho's internal template API is reproduced.

The expanded designer, billing workflows, accounting and report builder are described in [billing-feature-guide.md](billing-feature-guide.md). See [zoho-completion-checklist.md](zoho-completion-checklist.md) for the captured-gap acceptance record.

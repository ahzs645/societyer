# Invoice templates, reusable rates, and repairs

In **Invoices**, use **Items & services** to store products, parts, and labour with a code, description, billing unit, currency, tax, and rate. Add them from the catalog in the invoice or repair editor; a manual invoice line can also be saved to the catalog. Mark used items inactive to preserve their billing history.

Use **Price lists** to set named rates for catalog items in a currency. Select the currency and price list before adding items to an invoice. The list applies to newly added lines; saved invoice rates remain unchanged. A blank list entry falls back to the catalog only when currencies match. No exchange rate or currency conversion is implied. Invoice summaries and customer balances use the selected currency. Foreign currency invoices still use the existing accounting review flow; automatic foreign currency ledger posting is not added here.

Use **Apply ddcnorth** in the Templates designer to start from the bundled vector logo, midnight palette and Inter typography. **Import Brandkit profile** accepts `source/consumer-profile.json` from a Brandkit download. The portable profile preserves outlined logo lettering, multicolor artwork, and the supplied primary, black and reverse variants for all seven configured Brandkit brands. Older circle-symbol `brand.json` files and saved Societyer brand snapshots remain compatible. See [Brandkit imports](brandkit-imports.md) for the supported contract and font mapping.

The importer accepts passive vector geometry and rejects scripts, external assets and unsupported SVG features. Document text uses bundled fonts with an explicit fallback label; the profile does not download font files. The organization name, address, tax registration, and payment details continue to come from workspace records.

Use **Templates** to create and duplicate Classic, Modern, or Compact designs, change the accent color, title, footer, paper size, and visible fields, and choose a default. Each invoice stores its design, so changing a template does not alter issued invoices. Duplicates and recurring invoices retain the source design.

The Templates tab now includes a [shared sectioned document designer](document-designer-and-report-exports.md) for margins, typography, editable labels, field/column visibility, widths/order, headers/footers, page numbers and signatures. The same design powers invoices, payment receipts, repair work orders, and branded financial report PDFs with graphs. The [original audit](zoho-invoice-and-reports-audit.md) records the baseline Zoho comparison.

**Download PDF** in the invoice builder or invoice actions generates a searchable PDF locally with editable [pdfcn](https://www.pdfcn.dev/) components and the Forme WASM engine. Fonts and the renderer load on demand. Long tables repeat their header. Letter/A4 sizing, tax, discounts, payments, balance, notes, and template settings are supplied from Societyer's invoice records. The HTML preview and browser printing use the same settings and calculations; the PDF renderer has its own layout.

In **Repairs**, record the customer, equipment, serial number, reported problem, dates, work notes, parts, and labour. You can reuse an existing customer or create a saved customer during intake. Move through Received → Diagnosing → Awaiting approval / In progress → Ready for pickup → Completed. Create invoice copies the repair's charges and links its customer and currency. Retrying returns the existing active invoice. Once invoiced, billing changes are made on the invoice while repair notes and status remain editable. Void the invoice before cancelling a repair.

Payment records retain the method, reference, amount, date, destination account, and linked bank transaction. The invoice links to the repair, accounting entry, and bank transaction. The repair shows invoice status and balance. Bank deposits and destination accounts must match the invoice currency.

The new tables (`invoiceTemplates`, `invoicePriceLists`, `repairJobs`) and handlers run through the shared portable runtime on hosted Convex, browser storage, and desktop storage. They are included in workspace exports. Added fields on existing tables are optional. The new workspace views return up to 200 templates and price lists and the most recent 1,000 repairs.

Verification: `npm run test:invoices`, `npm run test:invoice-commerce-ui`, `npm run test:static-parity`, `npm run test:portable-manifest`, and `npm run build`.

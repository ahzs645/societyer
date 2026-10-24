These editable components were copied from the [pdfcn Forme registry](https://www.pdfcn.dev/docs/installation) on 2026-10-22 under the accompanying MIT license. The renderer versions are pinned in package-lock.json.

Societyer's invoice assembly is in `src/features/invoicing/InvoicePdfDocument.tsx`; it uses the same invoice totals and stored template configuration as the HTML preview. The native Forme table repeats its header across pages. `invoicePdf.ts` loads the renderer and bundled fonts only when a PDF is requested, then generates the file locally.

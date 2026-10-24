# Document template previews

These 12 images are first-page renders of the real PDF documents generated from
`shared/documentTemplatePresets.ts` and
`src/features/invoicing/documentTemplateSamples.ts`. They contain synthetic
organization/customer/financial data; the ddcnorth artwork comes from the
user-provided brand kit already bundled with the invoice renderer.

Run `npm run render:template-gallery` after changing a preset or its sample.
The renderer refreshes these 400px-wide thumbnails and writes searchable PDFs,
larger PNGs, a contact sheet, manifest, and ZIP under
`/workspace/scratch/document-template-gallery`.

The app loads the thumbnail images lazily. Opening a full-size preview renders
a fresh PDF with the current workspace identity and display currency.

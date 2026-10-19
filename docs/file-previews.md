# Shared file previews

Any feature can use `src/components/FilePreviewDialog.tsx`. It wraps Societyer's responsive modal/bottom sheet around the same `DocumentPreviewPane` renderer used by the document workbench. Procurement, meeting materials and source files, linked meeting documents, document lists and file history now use this shared dialog. Receipts, claims, financial statements, bank reconciliation and governing-document links use the same reusable action. Other features can use the pane directly when an inline preview fits better than a dialog.

```tsx
const loadBytes = useCallback(async (signal: AbortSignal) => {
  // Authorize the current user/workspace in the server request. Resolve this
  // file's storage adapter, fetch bytes, and verify its recorded checksum.
  return readAuthorizedFile(file.id, signal); // Promise<ArrayBuffer>
}, [file.id]);

{previewOpen && <FilePreviewDialog
  file={{ id: file.id, name: file.name, mimeType: file.mimeType,
    sha256: file.sha256, bytes: file.bytes }}
  loadBytes={loadBytes}
  onClose={() => setPreviewOpen(false)}
  onDownload={() => downloadOriginal(file)}
/>}
```

The component takes no Graph credentials or SharePoint-specific identifiers. Its caller supplies a stable, memoized loader with authorization and integrity checks. Procurement's adapter is `src/features/procurementReview/lib/documents.ts`; it requests only the selected file through the existing authenticated, workspace-scoped broker, checks the published size and SHA-256, and honors cancellation between parts and during fetch. Closing the dialog aborts its loader and revokes preview object URLs. Opening a preview does not create a new Convex file or a permanent download on the user's device.

Supported formats are PDF, DOCX, XLSX, PNG/JPEG/GIF, and text/CSV/Markdown/JSON/VTT/SRT. Recognized audio/video containers also have native inline playback when the browser supports their codec. Media container signatures are checked before a Blob URL is created. ZIP exports and older or unsupported codecs keep the original-download option. PDFs and raster images are identified from their bytes, not just their extension or MIME type. DOCX/XLSX use the existing local renderers; text and spreadsheet cells render as text. HTML and SVG are not framed as same-origin documents. Older Office formats show the existing unsupported-format fallback with access to the original. Nothing is submitted to Google Docs or an external Microsoft Office viewer.

Dialogs bound in-memory rendering to 25 MiB, both from known metadata before fetching and from loaded bytes before rendering. Larger originals remain downloadable. This prevents a large file preview from recreating the whole-catalog memory problem on phones. Adding range-based previews of very large PDFs would be a separate storage/renderer capability; the dialog's loader boundary can accommodate it later.

PDFs use the shared `PdfPreview` canvas/text-layer renderer, also used by intake source review. All pages sit in one vertical scroll. Placeholders are sized from each page's viewport, and an IntersectionObserver (one viewport of margin) draws the pages near the view, nearest first, with a selectable text layer. Canvases further away are released, within a 16 MP budget (`planPdfPages` in `src/components/previewViewport.ts`). A 120-page PDF on a 390 px phone holds 4–8 canvases (about 3–6 MP) wherever you scroll. The toolbar shows "Page n of m" for the page in view; typing a number jumps to that page. It does not depend on browser PDF plugins and cancels pending rendering when closed. Previews already hold the verified bytes in memory (the 25 MiB cap and SHA-256 check need the whole file), so "streaming" here means drawing pages as they are reached, not fetching byte ranges.

`PdfPreview` keeps its API. `pageNumber` scrolls to that page whenever it or `focusKey` changes. `onTextLayerReady(elements, text, { page, focus })` runs for every page's text layer as it is drawn or redrawn. `focus` is true once, for the requested page, so intake highlights every drawn page but scrolls only to the locator.

Word files render through docx-preview at their real page size, then `DocxPreview` scales the whole render with CSS `zoom` to fit the width, so a Letter page (816 px) fits a phone. Unlike a transform, `zoom` reflows the scroll box and keeps text selectable. PDF and Word share the same zoom controls (`PreviewZoom.tsx`): zoom out (down to 25% of fit-width), the level button (which resets to Fit), and zoom in (up to 400%). Two-finger pinch is handled by the viewer: it previews the zoom as a transform, then commits it and keeps the pinched point in place. One-finger drags scroll the document; the sheet's drag-to-dismiss starts only from the grabber or header. Canvases use at most 2× pixel ratio and 4 MP each.

## Platform actions and layout

- `DocumentPreviewButton` in `src/components/DocumentFilePreview.tsx` accepts an available document record. It mounts the selected viewer and resolves the latest uploaded version only after the click. `DocumentFilePreview` can also be rendered from menus or other selection state.
- `DocumentPreviewByIdButton` accepts only `documentId` for linked records such as receipts or governing documents. It fetches the document through `documents.get` on demand, rejects withheld/inaccessible records, then uses the same dialog. Rendering a list of these controls does not fetch every file or version.
- `src/lib/documentPreview.ts` resolves restored originals, current versions, legacy storage and external file links through the existing authorized adapters, supports cancellation, verifies recorded byte size/SHA-256, and bounds streamed response reads even when Content-Length is absent or wrong. A selected historical version uses `versionOnly` to prevent substitution of a newer parent original.
- Meeting source previews use the existing private, editor-only transfer broker and verified range reader. The 500 MB upload limit is unchanged; in-memory original previews are limited to 25 MiB. Larger transcripts retain their existing paged text reader, and recordings retain the Transcript tab's attached-recording player. Previewing a large source explains the limit before fetching it.
- All dialog previews use a single reading surface with reduced gutters. **Enter fullscreen / Exit fullscreen** in the header fills the app viewport, including phones, without requiring the browser Fullscreen API. Toggling keeps the viewer mounted so the PDF page and zoom stay selected. In the dialog the PDF/Word viewport is its own scroll box (both axes) under a fixed toolbar. Inline panes scroll as before, with a sticky toolbar. The header shows the file name on one line with a middle ellipsis ("Forestry Digital…Design.docx"), so the extension and the expand/close actions always stay visible. Hovering shows the full name; tapping the name toggles it in full. Closing or Escape ends the preview and restores focus; changing fullscreen does not dismiss it. The inline document workbench and intake source viewer include **Expand preview** to use the same dialog.
- General `Modal` consumers can opt in to `className`, `headerActions` and `fullscreen`; ordinary dialogs keep their existing behavior. Fullscreen disables sheet-drag dismissal and resize handles and preserves the normal focus trap/overlay stack.

The existing document workbench keeps its saved-original / latest-version / legacy-link resolution order through the extracted shared pane. This refactor does not change document access, permissions, file storage or version history.

## Verification

Run `npm run test:file-preview` for signature rejection, verified file reads, size/checksum failure, missing-file and cancellation checks. The check also covers zoom clamping/steps, canvas pixel caps, the PDF page window, page-number input and title splitting. The local-only `/scripts/fixtures/file-preview.html` page exercises the shared dialog with synthetic PDFs (2 and 120 pages), a Letter-size .docx with a long real-world file name, an inline 120-page pane, and mislabeled HTML. Use it to verify continuous scrolling, page jump, zoom/pinch, fit-width Word rendering, the title, close/reopen and the safe unsupported-file fallback. No tenant connection is used by this fixture.

The live DDC North procurement preview was tested with the actual two-page SharePoint PDF for notice `233770`, at phone width. Both pages, page text, fit-to-width and zoom rendered inside the interface. The original 56,534-byte download was separately checked against its published SHA-256. The seven-day production session was confirmed renewed, and reload/login-route checks stayed inside the app.


The platform rollout on 2026-10-18 was verified on production Pages deployment `d349bbac` (frontend commit `d77bae78`). The existing private meeting VTT source rendered inline through the transfer broker. A synthetic two-page PDF was uploaded through Documents, stored as a SharePoint version, and attached to the existing synthetic live-test meeting. Its list action, meeting Materials action, and version-history action all rendered through the shared viewer. Fullscreen at 390 × 844 filled the viewport; page 2 stayed selected after exiting fullscreen. Escape closed only the nested version preview and returned focus to its Preview button. Download original matched the source SHA-256 (`4198cbbdea7b295f25942216f7f39dd2f7149addd5d68eb226b4b16993b55db9`). The clearly named synthetic attachment remains in the live test workspace as a reusable sample.

Validation passed: full DDC North production build (including Convex and frontend type checks), file-preview regressions (including bounded streaming, historical-version routing and denied/missing targets), document-security checks, and the existing real-handler/Worker 500 MB meeting-source suite. Local viewer checks covered PDF paging/zoom/fullscreen/close, native WAV playback, mislabeled HTML rejection, and preventing a 500 MB source from starting its in-memory loader. Linked finance/governing-document actions are wired to the same ID-based adapter; no financial records were created for testing.

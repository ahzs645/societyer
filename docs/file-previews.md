# Shared file previews

Any feature can use `src/components/FilePreviewDialog.tsx`. It wraps Societyer's responsive modal/bottom sheet around the same `DocumentPreviewPane` renderer used by the document workbench. Procurement now uses this shared dialog. Other features can use the pane directly when an inline preview fits better than a dialog.

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

Supported formats are PDF, DOCX, XLSX, PNG/JPEG/GIF, and text/CSV/Markdown/JSON. PDFs and raster images are identified from their bytes, not just their extension or MIME type. DOCX/XLSX use the existing local renderers; text and spreadsheet cells render as text. HTML and SVG are not framed as same-origin documents. Older Office formats show the existing unsupported-format fallback with access to the original. Nothing is submitted to Google Docs or an external Microsoft Office viewer.

Dialogs bound in-memory rendering to 25 MiB, both from known metadata before fetching and from loaded bytes before rendering. Larger originals remain downloadable. This prevents a large file preview from recreating the whole-catalog memory problem on phones. Adding range-based previews of very large PDFs would be a separate storage/renderer capability; the dialog's loader boundary can accommodate it later.

The existing document workbench keeps its saved-original / latest-version / legacy-link resolution order through the extracted shared pane. This refactor does not change document access, permissions, file storage or version history.

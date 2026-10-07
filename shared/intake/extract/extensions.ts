/** File-extension rules for stage 2, without the extractors themselves, so UI
 * code can preview what a run will extract without loading DOCX/PDF/MSG parsers. */

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,6})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "tsv", "json", "html", "htm", "xml", "eml", "rtf"]);
export const EXTRACTABLE_EXTENSIONS = new Set(["docx", "docm", "dotx", "dotm", "pdf", "xlsx", "xlsm", "msg", "doc", "xls", "odt", "ods", "wpd", "pptx", "pptm", "potx", "ppsx", "ppt", "pps", "xps", "oxps", ...TEXT_EXTENSIONS]);
/** Images a run reads by OCR when they look like documents (see `isDocumentImage`). */
export const OCR_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "jfif", "png", "tif", "tiff", "bmp", "gif", "webp", "pbm", "pnm"]);

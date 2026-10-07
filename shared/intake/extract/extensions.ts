/** File-extension rules for stage 2, without the extractors themselves, so UI
 * code can preview what a run will extract without loading DOCX/PDF/MSG parsers. */

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,6})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export const TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "tsv", "json", "html", "htm", "xml", "eml", "rtf"]);
export const EXTRACTABLE_EXTENSIONS = new Set(["docx", "docm", "dotx", "pdf", "xlsx", "xlsm", "msg", "doc", "xls", "odt", "ods", "wpd", "pptx", "ppt", ...TEXT_EXTENSIONS]);

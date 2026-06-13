// Small HTML utility shared by every module that builds HTML strings —
// docx export, pdf export, markdown converter, minutes renderer, and the
// per-page renderers that compose body fragments inline (Receipts, BylawDiff,
// BylawsHistory, FilingPreFill, meetingPackExport).

export function escapeHtml(s: string | undefined | null): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

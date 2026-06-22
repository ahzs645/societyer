// HTML → PDF. The PDF is produced from the *same* docx-preview rendering shown
// in the on-screen preview and downloaded as Word — not a separate re-styling
// of the source HTML — so all three outputs match.
//
// On the web (and as a fallback) we render that HTML into a hidden iframe and
// call window.print(); the user picks "Save as PDF" and gets a vector,
// text-searchable PDF. On the desktop build, an Electron offscreen window
// converts the same HTML straight to a PDF file with no print dialog.

import { escapeHtml } from "./html";
import { buildWordDocxBlob } from "./docx";
import { renderDocxToPaginatedHtml, PRINT_PAGE_CSS } from "./docxPreview";
import { getDesktopBridge } from "./desktopBridge";

// Fallback styling, used only when the docx-preview render fails. Mirrors the
// docx export's look closely enough that a failed render still yields a usable
// PDF rather than nothing.
export const DOCUMENT_CSS = `
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 2pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 6pt; line-height: 1.35; }
  ul, ol { margin: 0 0 8pt 24pt; padding: 0; }
  li { margin: 0 0 2pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; }
  th, td { border: 1px solid #bbb; padding: 4pt 6pt; font-size: 10.5pt; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; }
  .motion { border-left: 3pt solid #3b5bdb; padding: 4pt 8pt; background: #f6f8ff; margin: 0 0 8pt; }
  .motion .outcome-carried,
  .outcome-carried { color: #0a8f4e; font-weight: 600; }
  .motion .outcome-defeated,
  .outcome-defeated { color: #c9264a; font-weight: 600; }
  .motion .outcome-tabled,
  .outcome-tabled { color: #a86400; font-weight: 600; }
  .meta { color: #666; font-size: 10pt; }
  .muted { color: #888; }
  @page { size: letter; margin: 0.65in; }
`;

// Layered on top of DOCUMENT_CSS only in the fallback print pipeline. Headings
// stay with the content that follows; motion blocks, table rows, and list items
// don't split across pages; long tables keep flowing but repeat their header.
export const PRINT_CSS = `
  @media print {
    body { margin: 0; }
    h1, h2, h3, h4 { page-break-after: avoid; break-after: avoid; }
    h1, h2, h3, h4, .motion, tr, li { page-break-inside: avoid; break-inside: avoid; }
    table { page-break-inside: auto; }
    thead { display: table-header-group; }
    a { color: inherit; text-decoration: underline; }
  }
`;

// Build the print document from the docx-preview rendering: docx-preview's own
// styles + the paginated `.docx-wrapper`, then our print overrides (after the
// content so they win the cascade). This is the same layout as the preview.
async function buildDocxPrintHtml({ title, bodyHtml }: { title: string; bodyHtml: string }): Promise<string> {
  const blob = await buildWordDocxBlob({ bodyHtml });
  const rendered = await renderDocxToPaginatedHtml(blob);
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body>${rendered}<style>${PRINT_PAGE_CSS}</style></body></html>`;
}

function buildHtmlFallbackDocument({ title, bodyHtml }: { title: string; bodyHtml: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>${DOCUMENT_CSS}${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Render an HTML document in a hidden iframe and trigger the browser's print
 * engine. The user picks "Save as PDF" from the print dialog and gets a vector,
 * text-searchable PDF.
 *
 * Resolves when the print dialog closes (or after a 60-second fallback, in case
 * `afterprint` never fires).
 */
function printHtmlDocument(html: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        iframe.contentWindow?.removeEventListener("afterprint", cleanup);
      } catch {
        // contentWindow can be detached at cleanup; ignore.
      }
      iframe.remove();
      resolve();
    };
    iframe.onload = () => {
      const cw = iframe.contentWindow;
      if (!cw) {
        cleanup();
        return;
      }
      cw.addEventListener("afterprint", cleanup);
      // Safari prints the parent window if the iframe isn't focused first.
      cw.focus();
      cw.print();
      // Fallback in case afterprint never fires (older browsers, dialog
      // dismissed instantly). 60s is well past any realistic Save-as-PDF flow.
      setTimeout(cleanup, 60_000);
    };
    iframe.srcdoc = html;
  });
}

/**
 * Export the minutes body as a PDF that matches the on-screen preview and the
 * Word download. Renders the actual .docx through docx-preview, then:
 *  - on desktop, hands the HTML to Electron to write a PDF file silently;
 *  - on the web (or if the desktop bridge/render fails), prints via the
 *    browser's "Save as PDF" dialog.
 *
 * `filename` is the suggested name. On the web the browser print dialog is
 * authoritative and the name can't be overridden for security reasons; on
 * desktop it's used for the written file.
 */
export async function exportPdfDownload({
  filename,
  title,
  bodyHtml,
}: {
  filename: string;
  title: string;
  bodyHtml: string;
}): Promise<void> {
  let html: string;
  try {
    html = await buildDocxPrintHtml({ title, bodyHtml });
  } catch (error) {
    console.error("docx-based PDF render failed; falling back to HTML print", error);
    html = buildHtmlFallbackDocument({ title, bodyHtml });
  }

  const bridge = getDesktopBridge();
  if (bridge?.printToPdf) {
    try {
      await bridge.printToPdf({ html, fileName: filename });
      return;
    } catch (error) {
      // Desktop conversion failed (e.g. write error) — fall through to the
      // browser print dialog so the user still gets their PDF.
      console.error("Desktop printToPdf failed; falling back to browser print", error);
    }
  }

  return printHtmlDocument(html);
}

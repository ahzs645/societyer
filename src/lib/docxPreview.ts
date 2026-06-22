// Shared docx-preview rendering helpers. Both the on-screen minutes preview
// (MinutesDocumentPreview) and the PDF export (lib/pdf) render the *actual*
// .docx bytes through docx-preview so what you see, what you download as Word,
// and what you export as PDF are all the same layout — not three separate
// re-stylings of the source HTML that can drift apart.

import { renderAsync } from "docx-preview";
import JSZip from "jszip";

// Letter page width at 96dpi (8.5in). Our exporter always emits a letter
// sectPr, so docx-preview renders pages at this width; callers scale the
// wrapper down to fit narrow columns rather than forcing a horizontal scroll.
export const PAGE_WIDTH_PX = 816;

export const RENDER_OPTIONS = {
  className: "docx",
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  experimental: true,
  // false → docx-preview uses URL.createObjectURL, which retypeImageBlobs /
  // inlineDocxImagesAsDataUrls (below) then re-binds with the correct MIME.
  useBase64URL: false,
  renderHeaders: true,
  renderFooters: true,
} as const;

// Slice docx-preview's single rendered section into letter-height pages.
//
// docx-preview gives us `.docx-wrapper > section.docx > article > <blocks>`,
// where the section carries the letter geometry (padding + min-height) but the
// article grows unbounded. We measure the section's content box, then walk the
// original blocks and redistribute them across freshly-cloned page sections,
// starting a new page whenever the next block would overflow. Tables taller
// than a page are split row-by-row with their header row repeated on each
// continuation page.
//
// Heights are read with offsetHeight (layout px, unaffected by the `--docx-scale`
// zoom we apply for fit-to-width), and the caller resets that zoom to 1 before
// calling so measurements are taken at natural size.
export function paginateRenderedDocx(render: HTMLElement): void {
  const wrapper = render.querySelector<HTMLElement>(".docx-wrapper");
  const source = wrapper?.querySelector<HTMLElement>("section.docx");
  const sourceArticle = source?.querySelector<HTMLElement>("article");
  if (!wrapper || !source || !sourceArticle) return;

  const styles = getComputedStyle(source);
  const padTop = parseFloat(styles.paddingTop) || 0;
  const padBottom = parseFloat(styles.paddingBottom) || 0;
  // min-height is the full letter page height; the printable content box is
  // that minus the top/bottom margins docx-preview applied as padding.
  const pageHeight = parseFloat(styles.minHeight) || 0;
  const contentHeight = pageHeight - padTop - padBottom;
  if (contentHeight <= 0) return;

  // Reuse the original section as the first page: pull its blocks out, then
  // empty its article *in place*. Keeping the section attached is essential —
  // a detached node reports offsetHeight 0, which would make every fit check
  // pass and collapse the whole document onto one orphaned page.
  const blocks = Array.from(sourceArticle.children) as HTMLElement[];
  sourceArticle.replaceChildren();

  let article: HTMLElement = sourceArticle;
  const startPage = (): void => {
    const page = source.cloneNode(false) as HTMLElement;
    article = document.createElement("article");
    page.appendChild(article);
    wrapper.appendChild(page);
  };

  const fits = (): boolean => article.offsetHeight <= contentHeight;

  // Move overflow rows of a too-tall table onto continuation pages, repeating
  // the header row. `table` is assumed to be the last (and overflowing) block
  // on the current page.
  const splitTable = (table: HTMLTableElement): void => {
    const headerRow = table.rows[0] ?? null;
    // Trim rows off the end until the table fits (always keep the header + one
    // data row so we make forward progress even if a single row is oversized).
    const overflow: HTMLTableRowElement[] = [];
    while (table.offsetHeight > contentHeight && table.rows.length > 2) {
      const last = table.rows[table.rows.length - 1];
      overflow.unshift(last);
      last.remove();
    }
    if (overflow.length === 0) return;

    startPage();
    const cont = table.cloneNode(false) as HTMLTableElement;
    if (headerRow) cont.appendChild(headerRow.cloneNode(true));
    article.appendChild(cont);
    for (const row of overflow) cont.appendChild(row);
    if (cont.offsetHeight > contentHeight && cont.rows.length > 2) splitTable(cont);
  };

  for (const block of blocks) {
    article.appendChild(block);
    if (fits()) continue;

    if (article.children.length === 1) {
      // Block overflows a page on its own. A table gets split row-by-row and
      // ends on a continuation page we can keep filling; anything else we leave
      // to overflow its own page (rather than drop content) and start fresh.
      if (block.tagName === "TABLE") splitTable(block as HTMLTableElement);
      else startPage();
      continue;
    }

    // Block doesn't fit alongside what's already on the page — push it to a
    // fresh page, then split it there if it's a table that still overflows.
    article.removeChild(block);
    startPage();
    article.appendChild(block);
    if (!fits() && block.tagName === "TABLE") splitTable(block as HTMLTableElement);
  }
}

// JSZip hands docx-preview blobs with type:"" — the resulting blob URLs work
// for raster images (the browser sniffs bytes) but not for SVG, because SVG can
// contain JavaScript and browsers refuse to display it without an explicit
// `image/svg+xml` MIME. We rebind each rendered <img> to a source we build
// ourselves from the OOXML archive, with the right MIME for its extension.
const MEDIA_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

// Returns the sorted `word/media/*` entries paired with the rendered <img>
// elements in document order — the pairing docx-preview itself relies on.
async function mediaEntriesFor(docxBlob: Blob): Promise<{ ext: string; bytes: Uint8Array }[]> {
  const zip = await JSZip.loadAsync(docxBlob);
  const mediaPaths = Object.keys(zip.files)
    .filter((n) => n.startsWith("word/media/"))
    .sort();
  return Promise.all(
    mediaPaths.map(async (path) => ({
      ext: path.slice(path.lastIndexOf(".") + 1).toLowerCase(),
      bytes: await zip.files[path].async("uint8array"),
    })),
  );
}

// Rebind rendered <img> blob: URLs to fresh blobs with the correct MIME. Used
// by the on-screen preview, where short-lived object URLs are ideal.
export async function retypeImageBlobs(target: HTMLElement, docxBlob: Blob): Promise<void> {
  const imgs = Array.from(target.querySelectorAll("img")).filter((img) =>
    img.src.startsWith("blob:"),
  );
  if (imgs.length === 0) return;
  const media = await mediaEntriesFor(docxBlob);
  for (let i = 0; i < imgs.length && i < media.length; i += 1) {
    const mime = MEDIA_MIME[media[i].ext] ?? "application/octet-stream";
    const previous = imgs[i].src;
    imgs[i].src = URL.createObjectURL(new Blob([media[i].bytes], { type: mime }));
    URL.revokeObjectURL(previous);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Rebind rendered <img> blob: URLs to self-contained data: URLs. Object URLs
// are origin-scoped and don't survive being serialized into a print iframe's
// srcdoc or an Electron offscreen window, so the PDF path inlines the bytes.
export async function inlineDocxImagesAsDataUrls(target: HTMLElement, docxBlob: Blob): Promise<void> {
  const imgs = Array.from(target.querySelectorAll("img")).filter((img) =>
    img.src.startsWith("blob:"),
  );
  if (imgs.length === 0) return;
  const media = await mediaEntriesFor(docxBlob);
  for (let i = 0; i < imgs.length && i < media.length; i += 1) {
    const mime = MEDIA_MIME[media[i].ext] ?? "application/octet-stream";
    const previous = imgs[i].src;
    imgs[i].src = `data:${mime};base64,${bytesToBase64(media[i].bytes)}`;
    if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
  }
}

// Print overrides layered after docx-preview's own styles. docx-preview styles
// each page section for *screen* display (gray canvas, drop shadow, gaps); for
// print/PDF we strip that chrome and force one physical sheet per page section.
export const PRINT_PAGE_CSS = `
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .docx-wrapper {
    background: #fff !important;
    padding: 0 !important;
    margin: 0 !important;
    display: block !important;
  }
  .docx-wrapper > section.docx {
    margin: 0 auto !important;
    box-shadow: none !important;
    break-after: page;
    page-break-after: always;
  }
  .docx-wrapper > section.docx:last-child {
    break-after: auto;
    page-break-after: auto;
  }
`;

// Render the .docx through docx-preview offscreen, inline its images, paginate
// it into letter pages, and return the resulting inner HTML (docx-preview's
// injected <style> tags + the paginated `.docx-wrapper`). This is the exact
// rendering shown in the preview, ready to be dropped into a print document.
export async function renderDocxToPaginatedHtml(docxBlob: Blob): Promise<string> {
  const container = document.createElement("div");
  // Offscreen but laid out: docx-preview's pagination reads offsetHeight, which
  // is 0 under display:none. visibility:hidden + a fixed letter width keeps the
  // geometry real while keeping the render invisible. --docx-scale must be 1 so
  // measurements are at natural size.
  container.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${PAGE_WIDTH_PX}px;visibility:hidden;pointer-events:none;`;
  container.style.setProperty("--docx-scale", "1");
  document.body.appendChild(container);

  try {
    await renderAsync(docxBlob, container, undefined, RENDER_OPTIONS);
    await inlineDocxImagesAsDataUrls(container, docxBlob);
    paginateRenderedDocx(container);
    return container.innerHTML;
  } finally {
    container.remove();
  }
}

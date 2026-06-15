import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { FileWarning, Loader2 } from "lucide-react";
import { buildWordDocxBlob } from "../../../lib/docx";

// Renders the *actual* .docx the user downloads. We build the same OOXML bytes
// exportWordDocx ships, then hand them to docx-preview, which lays them out as
// paginated, Word-like pages in the DOM. So the preview is literally the file —
// not a separately-styled HTML approximation that can drift from the export.
//
// docx-preview can't be 100% pixel-identical to Microsoft Word (line-breaking
// and pagination are the renderer's own approximation), but it shows real
// letter-size pages with page breaks, which is far closer than rendering the
// raw HTML.
//
// One gap: docx-preview only starts a new page on an *explicit* page break in
// the OOXML — it does not paginate on content overflow. Our exporter emits a
// single section with no hard breaks, so everything lands in one section that
// just grows past the letter min-height ("one long page"). After the render
// resolves we run `paginateRenderedDocx` to slice that tall section into real
// letter-height pages so the preview reads like the printed/exported document.

// Letter page width at 96dpi (8.5in). Our exporter always emits a letter
// sectPr, so docx-preview renders pages at this width; we scale the whole
// wrapper down to fit narrow columns rather than forcing a horizontal scroll.
const PAGE_WIDTH_PX = 816;

const RENDER_OPTIONS = {
  className: "docx",
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  experimental: true,
  useBase64URL: true,
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
function paginateRenderedDocx(render: HTMLElement): void {
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

export function MinutesDocumentPreview({ bodyHtml }: { bodyHtml: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Render the docx whenever the content changes.
  useEffect(() => {
    let cancelled = false;
    const target = renderRef.current;
    if (!target) return;
    setStatus("loading");
    target.innerHTML = "";
    // Measure at natural size: clear any leftover fit-to-width zoom from a prior
    // render so offsetHeight reads true layout px during pagination.
    target.style.setProperty("--docx-scale", "1");

    (async () => {
      try {
        const blob = await buildWordDocxBlob({ bodyHtml });
        if (cancelled || !renderRef.current) return;
        await renderAsync(blob, renderRef.current, undefined, RENDER_OPTIONS);
        if (cancelled || !renderRef.current) return;
        paginateRenderedDocx(renderRef.current);
        if (!cancelled) setStatus("ready");
      } catch (error) {
        console.error("Failed to render docx preview", error);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bodyHtml]);

  // Scale the rendered pages to fit the available column width. We measure the
  // viewport (not the page) so the zoom recomputes as the layout/window
  // changes, and never upscale past 1 so a wide column shows pages at natural
  // size.
  useEffect(() => {
    const viewport = viewportRef.current;
    const render = renderRef.current;
    if (!viewport || !render) return;

    const applyScale = () => {
      const styles = getComputedStyle(viewport);
      const padding =
        parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
      // clientWidth already excludes the scrollbar; subtract padding to get the
      // true content width the pages have to fit into.
      const available = viewport.clientWidth - padding;
      if (available <= 0) return;
      const scale = Math.min(1, available / PAGE_WIDTH_PX);
      render.style.setProperty("--docx-scale", String(scale));
    };

    applyScale();
    const observer = new ResizeObserver(applyScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [status]);

  return (
    <div className="minutes-docx-preview" ref={viewportRef}>
      {status === "loading" && (
        <div className="minutes-docx-preview__status">
          <Loader2 size={18} className="minutes-docx-preview__spinner" aria-hidden />
          <span>Rendering document…</span>
        </div>
      )}
      {status === "error" && (
        <div className="minutes-docx-preview__status">
          <FileWarning size={18} aria-hidden />
          <span>Couldn't render this document preview. The download still works.</span>
        </div>
      )}
      <div
        ref={renderRef}
        className="minutes-docx-preview__render"
        // Hidden until the first render resolves so users don't see a flash of
        // unscaled, full-width pages mid-render.
        style={{ visibility: status === "ready" ? "visible" : "hidden" }}
      />
    </div>
  );
}

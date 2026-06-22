import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { FileWarning, Loader2 } from "lucide-react";
import { buildWordDocxBlob } from "../../../lib/docx";
import {
  PAGE_WIDTH_PX,
  RENDER_OPTIONS,
  paginateRenderedDocx,
  retypeImageBlobs,
} from "../../../lib/docxPreview";

// Renders the *actual* .docx the user downloads. We build the same OOXML bytes
// exportWordDocx ships, then hand them to docx-preview, which lays them out as
// paginated, Word-like pages in the DOM. So the preview is literally the file —
// not a separately-styled HTML approximation that can drift from the export.
// The PDF export (lib/pdf) reuses the same docx-preview pipeline, so preview,
// Word, and PDF all share one rendering.
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

export function MinutesDocumentPreview({ bodyHtml }: { bodyHtml: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Render the docx whenever the content changes. To avoid flicker when the
  // user toggles options (public-copy mode, style, etc.), render into a hidden
  // sibling buffer first and only swap the rendered pages into the visible
  // container once everything (build → renderAsync → image retype → paginate)
  // is ready. The buffer is absolutely positioned + visibility:hidden so the
  // previous render stays in place during the build.
  useEffect(() => {
    let cancelled = false;
    const target = renderRef.current;
    const viewport = viewportRef.current;
    if (!target || !viewport) return;
    if (target.childElementCount === 0) setStatus("loading");

    const buffer = document.createElement("div");
    buffer.style.cssText =
      "position:absolute;inset:0;visibility:hidden;pointer-events:none;";
    // Pagination reads offsetHeight, so the buffer must be at scale 1 — the
    // visible target's --docx-scale (set by the fit-to-width effect) doesn't
    // matter here since the swap moves children, not styles.
    buffer.style.setProperty("--docx-scale", "1");
    viewport.appendChild(buffer);

    (async () => {
      try {
        const blob = await buildWordDocxBlob({ bodyHtml });
        if (cancelled) return;
        await renderAsync(blob, buffer, undefined, RENDER_OPTIONS);
        if (cancelled) return;
        await retypeImageBlobs(buffer, blob);
        paginateRenderedDocx(buffer);
        if (cancelled) return;
        target.replaceChildren(...Array.from(buffer.childNodes));
        setStatus("ready");
      } catch (error) {
        console.error("Failed to render docx preview", error);
        if (!cancelled) setStatus("error");
      } finally {
        buffer.remove();
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

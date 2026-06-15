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

    (async () => {
      try {
        const blob = await buildWordDocxBlob({ bodyHtml });
        if (cancelled || !renderRef.current) return;
        await renderAsync(blob, renderRef.current, undefined, RENDER_OPTIONS);
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

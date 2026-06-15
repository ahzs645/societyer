import { useEffect, useRef, useState } from "react";
import { DOCUMENT_CSS } from "../../../lib/pdf";

// Renders the exported minutes body HTML inside an isolated iframe using the
// *same* DOCUMENT_CSS the PDF pipeline applies, so the on-screen preview
// literally renders the document the user downloads — there is no separate,
// hand-maintained preview stylesheet to drift out of sync with the export.
//
// The iframe also gives us full style isolation: the app's theme tokens (and
// dark mode) can't bleed into the page, so we no longer need to force light
// tokens or re-declare .motion/.meta/.muted colors in SCSS.

// Layered on top of DOCUMENT_CSS for the on-screen frame only. DOCUMENT_CSS's
// `@page` margin governs the printed PDF; on screen we reproduce the same
// 0.65in page margin with body padding so spacing matches what prints.
const PREVIEW_FRAME_CSS = `
  html, body { margin: 0; background: #fff; }
  body { padding: 0.65in; box-sizing: border-box; }
`;

export function MinutesDocumentPreview({
  bodyHtml,
  className,
  title = "Minutes document preview",
}: {
  bodyHtml: string;
  className?: string;
  title?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(760);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8" /><style>${DOCUMENT_CSS}${PREVIEW_FRAME_CSS}</style></head><body>${bodyHtml}</body></html>`;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;

    const syncHeight = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      const next = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      if (next > 0) setHeight(next);
    };

    const handleLoad = () => {
      syncHeight();
      // Re-measure when the content reflows (late-loading letterhead images,
      // web fonts) so the iframe never clips or leaves a gap.
      const doc = frame.contentDocument;
      if (doc?.body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(syncHeight);
        observer.observe(doc.body);
      }
    };

    frame.addEventListener("load", handleLoad);
    // srcDoc is assigned before this effect runs, so the load event may have
    // already fired; measure immediately if the document is ready.
    if (frame.contentDocument?.readyState === "complete") handleLoad();

    return () => {
      frame.removeEventListener("load", handleLoad);
      observer?.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={frameRef}
      className={className ? `minutes-preview__page ${className}` : "minutes-preview__page"}
      title={title}
      srcDoc={srcDoc}
      style={{ height }}
    />
  );
}

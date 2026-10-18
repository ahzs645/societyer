/** Synthetic, local-only UI regression: the shared dialog needs no storage provider. */
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { FilePreviewDialog } from "../../src/components/FilePreviewDialog";
import "../../src/styles/index.scss";
let pdf: Promise<ArrayBuffer> | undefined;
function fixturePdf() {
  pdf ??= (async () => {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const index of [1, 2]) doc.addPage([612, 792]).drawText(`Shared preview fixture - page ${index}`, { x: 45, y: 720, size: 18, font });
    return (await doc.save()).buffer as ArrayBuffer;
  })();
  return pdf;
}
function Fixture() {
  const [kind, setKind] = useState<"pdf" | "html" | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    const bytes = kind === "html" ? new TextEncoder().encode('<html><script>alert("must not run")</script>not a PDF</html>').buffer : await fixturePdf();
    signal.throwIfAborted(); return bytes;
  }, [kind]);
  return <div className="page"><h1>Shared preview regression fixture</h1><button className="btn" onClick={() => setKind("pdf")}>Open synthetic PDF</button><button className="btn" onClick={() => setKind("html")}>Open mislabeled PDF</button>
    {kind && <FilePreviewDialog file={{ id: kind, name: `${kind}-fixture.pdf`, mimeType: "application/pdf" }} loadBytes={load} onClose={() => setKind(null)} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

/** Synthetic, local-only UI regression: the shared dialog needs no storage provider. */
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { FilePreviewDialog } from "../../src/components/FilePreviewDialog";
import "../../src/theme/palette.css";
import "../../src/theme/tokens.css";
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
  const [kind, setKind] = useState<"pdf" | "html" | "wav" | "large" | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    if (kind === "wav") {
      const bytes = new ArrayBuffer(44 + 1600); const view = new DataView(bytes);
      const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, 1600, true);
      return bytes;
    }
    if (kind === "large") throw new Error("Large preview must never request bytes");
    const bytes = kind === "html" ? new TextEncoder().encode('<html><script>alert("must not run")</script>not a PDF</html>').buffer : await fixturePdf();
    signal.throwIfAborted(); return bytes;
  }, [kind]);
  return <div className="page"><h1>Shared preview regression fixture</h1><button className="btn" onClick={() => setKind("pdf")}>Open synthetic PDF</button><button className="btn" onClick={() => setKind("html")}>Open mislabeled PDF</button><button className="btn" onClick={() => setKind("wav")}>Open synthetic audio</button><button className="btn" onClick={() => setKind("large")}>Open 500 MB source</button>
    {kind && <FilePreviewDialog file={{ id: kind, name: `${kind}-fixture.${kind === "wav" ? "wav" : "pdf"}`, mimeType: kind === "wav" ? "audio/wav" : "application/pdf", bytes: kind === "large" ? 500_000_000 : undefined }} loadBytes={load} onClose={() => setKind(null)} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

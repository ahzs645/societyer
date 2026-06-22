import { app, BrowserWindow, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  DesktopPrintToPdfInput,
  DesktopPrintToPdfResult,
} from "../src/lib/desktopBridge";
import { makeDesktopLogger } from "./observability.js";

const logger = makeDesktopLogger("print-pdf");

// Strip any directory components a caller might smuggle in and guarantee a
// .pdf extension. The renderer builds this name from the meeting title, but we
// never trust it to escape the downloads directory.
function safePdfName(fileName: string): string {
  const base = path.basename(fileName).replace(/[\\/:*?"<>|]+/g, "-").trim();
  const named = base.length > 0 ? base : "document.pdf";
  return /\.pdf$/i.test(named) ? named : `${named}.pdf`;
}

// Pick a non-clashing path in Downloads so re-exporting the same minutes
// doesn't silently overwrite an earlier copy.
async function uniquePath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let i = 0; i < 1000; i += 1) {
    const candidate = path.join(dir, i === 0 ? fileName : `${stem} (${i})${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

/**
 * Convert a self-contained HTML document to a PDF file with no print dialog.
 *
 * Renders the HTML in a hidden, script-disabled BrowserWindow and uses
 * Chromium's printToPDF to produce a vector, text-searchable PDF, then writes
 * it to the user's Downloads folder and opens it. The HTML is expected to carry
 * its own `@page` rules (we render with preferCSSPageSize), styles inline, and
 * images as data URLs.
 */
export async function printHtmlToPdf(
  input: DesktopPrintToPdfInput,
): Promise<DesktopPrintToPdfResult> {
  const tempDir = await fs.mkdtemp(path.join(app.getPath("temp"), "societyer-pdf-"));
  const htmlPath = path.join(tempDir, "document.html");
  await fs.writeFile(htmlPath, input.html, "utf8");

  // Hidden, isolated, no JS: the document is static HTML/CSS we generated, and
  // nothing in it should execute. A plain show:false window (not offscreen)
  // still lays out the DOM and is the reliable pattern for printToPDF.
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await win.loadFile(htmlPath);
    const pdf = await win.webContents.printToPDF({
      pageSize: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    const outPath = await uniquePath(app.getPath("downloads"), safePdfName(input.fileName));
    await fs.writeFile(outPath, pdf);
    void shell.openPath(outPath);
    return { path: outPath };
  } catch (error) {
    void logger.warn("printToPDF failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

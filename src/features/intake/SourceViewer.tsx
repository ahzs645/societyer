import { FilePreviewDialog } from "../../components/FilePreviewDialog";
import { verifyPreviewBytes } from "../../lib/filePreviewBytes";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { FileText, GitCompare, Lock } from "lucide-react";
import { api } from "@/lib/convexApi";
import { PdfPreview, type PdfTextLayerInfo } from "../../components/PdfPreview";
import { diffTokens, tokenize, type Chunk } from "../../lib/wordDiff";
import { getRestoredFile } from "../../lib/workspaceArchiveFiles";
import type { IntakeBlock } from "../../../shared/intake/blocks";
import type { Locator } from "../../../shared/intake/schemas/common";
import { getOriginal } from "./originalsCache";
import { clearHighlights, findQuote, highlightQuote, highlightSpans } from "./highlight";

export type ViewerLocator = Locator & { fieldPath?: string };
export type ClusterVersion = { fileId?: string; fileKey: string; name: string; relation: string; reason?: string };
type Mode = "original" | "text" | "diff";

function kindOf(name: string): "docx" | "pdf" | "xlsx" | "other" {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "docx" || ext === "docm" || ext === "dotx") return "docx";
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  return "other";
}

/** Original bytes: this device's intake cache, then files restored from a workspace backup. */
async function loadOriginalBlob(file: any): Promise<Blob | undefined> {
  const cached = await getOriginal(file?.sha256);
  if (cached) return cached.blob;
  if (file?.sha256) {
    const restored = await getRestoredFile({ sha256: file.sha256 }).catch(() => undefined);
    if (restored) return restored;
  }
  if (file?.documentId) return getRestoredFile({ documentId: String(file.documentId) }).catch(() => undefined);
  return undefined;
}

/**
 * Centre pane of the review screen: the source document with the selected
 * field's locator highlighted and scrolled into view. DOCX renders through
 * docx-preview, PDF through pdf.js (page canvas + text layer), XLSX as a cell
 * grid, everything else as the extracted block view; version clusters can be
 * compared as a word diff.
 */
export function SourceViewer({ societyId, file, extract, locator, versions }: { societyId: string; file: any; extract: any; locator?: ViewerLocator; versions: ClusterVersion[] }) {
  const kind = kindOf(file?.name ?? "");
  const [blob, setBlob] = useState<Blob | null | undefined>(undefined);
  const [previewOpen, setPreviewOpen] = useState(false);
  const loadPreview = useCallback(async (signal: AbortSignal) => {
    if (!blob) throw new Error("The original is not available on this device.");
    signal.throwIfAborted();
    return verifyPreviewBytes(await blob.arrayBuffer(), file?.sha256);
  }, [blob, file?.sha256]);
  const [mode, setMode] = useState<Mode>("text");
  const [compareFileId, setCompareFileId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setBlob(undefined);
    setPreviewOpen(false);
    void loadOriginalBlob(file).then((value) => {
      if (!alive) return;
      setBlob(value ?? null);
      setMode(value && (kind === "docx" || kind === "pdf") ? "original" : "text");
    });
    return () => { alive = false; };
  }, [file?._id, file?.sha256, kind]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when the file changes
  useEffect(() => setCompareFileId(versions.find((version) => version.fileId)?.fileId), [file?._id, versions]);

  // The locator's cell or block text disambiguates repeated quotes in renderings.
  const context = useMemo(() => {
    if (!locator || !extract?.blocks) return undefined;
    const block = (extract.blocks as IntakeBlock[]).find((candidate) => candidate.index === locator.blockIndex);
    if (!block) return undefined;
    const text: string = extract.text ?? "";
    const cell = locator.cell ? block.rows?.flatMap((row) => row.cells).find((candidate) => candidate.cell === locator.cell) : undefined;
    if (cell) return text.slice(cell.charStart ?? 0, cell.charEnd ?? 0) || cell.text;
    return block.kind === "table" ? undefined : (text.slice(block.charStart, block.charEnd) || block.text).slice(0, 2000);
  }, [locator, extract]);
  const restricted = file?.sensitivity === "restricted";
  const canOriginal = Boolean(blob) && (kind === "docx" || kind === "pdf");
  return (
    <div className="intake-pane intake-pane--viewer" aria-label="Source document">
      {previewOpen && blob && <FilePreviewDialog file={{ id: file?._id ?? file?.sha256 ?? "intake-source", name: file?.name ?? "Source", bytes: blob.size, mimeType: blob.type, sha256: file?.sha256 }} loadBytes={loadPreview} onClose={() => setPreviewOpen(false)} />}
      <div className="intake-pane__head">
        <FileText size={14} aria-hidden />
        <h2 title={file?.path}>{file?.name ?? "Source"}</h2>
        {blob && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPreviewOpen(true)}>Expand preview</button>}
        {restricted && <span className="intake-chip intake-chip--conflicting"><Lock size={10} /> restricted</span>}
        <div className="segmented" role="tablist" aria-label="Viewer mode" style={{ marginLeft: "auto" }}>
          <button type="button" role="tab" aria-selected={mode === "original"} className={`segmented__btn${mode === "original" ? " is-active" : ""}`} disabled={!canOriginal} onClick={() => setMode("original")} title={canOriginal ? "Rendered original" : blob === null ? "The original is not stored on this device; showing the extracted text" : "Original rendering is available for DOCX and PDF"}>Original</button>
          <button type="button" role="tab" aria-selected={mode === "text"} className={`segmented__btn${mode === "text" ? " is-active" : ""}`} onClick={() => setMode("text")}>{kind === "xlsx" ? "Grid" : "Text"}</button>
          {versions.length > 0 && <button type="button" role="tab" aria-selected={mode === "diff"} className={`segmented__btn${mode === "diff" ? " is-active" : ""}`} onClick={() => setMode("diff")}><GitCompare size={12} /> Versions ({versions.length})</button>}
        </div>
      </div>
      <div className="intake-pane__body">
        {mode === "original" && blob && kind === "docx" && <DocxView blob={blob} quote={locator?.quote} context={context} />}
        {mode === "original" && blob && kind === "pdf" && <PdfView blob={blob} locator={locator} context={context} />}
        {mode === "text" && <BlockView extract={extract} locator={locator} />}
        {mode === "diff" && <VersionDiff societyId={societyId} extract={extract} versions={versions} compareFileId={compareFileId} onCompare={setCompareFileId} />}
      </div>
    </div>
  );
}

function DocxView({ blob, quote, context }: { blob: Blob; quote?: string; context?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setReady(false);
    setError(null);
    void (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (!container.current || !alive) return;
        container.current.innerHTML = "";
        await renderAsync(blob, container.current, undefined, { className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true, renderHeaders: true, renderFooters: true });
        if (alive) setReady(true);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "This document could not be rendered.");
      }
    })();
    return () => { alive = false; };
  }, [blob]);
  // Fit the letter-width page to the pane (docx-preview renders at 96 dpi page size).
  useEffect(() => {
    const element = container.current;
    if (!ready || !element) return;
    const fit = () => {
      const wrapper = element.querySelector<HTMLElement>(".docx-wrapper");
      const page = wrapper?.querySelector<HTMLElement>("section.docx");
      if (!wrapper || !page) return;
      wrapper.style.setProperty("zoom", String(Math.min(1, Math.max(0.4, (element.clientWidth - 24) / page.offsetWidth))));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    if (!ready || !container.current) return;
    const mark = highlightQuote(container.current, quote, context);
    mark?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [ready, quote, context]);
  return (
    <>
      {error && <p className="muted" style={{ padding: 12 }}>Could not render the original ({error}). Use the Text view.</p>}
      {quote && ready && !findQuoteInDom(container.current, quote) && <p className="muted" style={{ padding: "8px 12px", margin: 0 }}>The quoted span is not visible in this rendering (header, footer or text box); see the Text view.</p>}
      <div ref={container} className="intake-docx" data-testid="intake-docx" />
    </>
  );
}

function findQuoteInDom(root: HTMLElement | null, quote: string) {
  return Boolean(root?.querySelector("mark.intake-hl")) || (root ? Boolean(findQuote(root.textContent ?? "", quote)) : false);
}

function PdfView({ blob, locator, context }: { blob: Blob; locator?: ViewerLocator; context?: string }) {
  // Every drawn page gets its highlight; only the locator's page scrolls to it.
  const highlight = useCallback((elements: HTMLElement[], text: string[], { focus }: PdfTextLayerInfo) => {
    const first = highlightSpans(elements, text, locator?.quote, context);
    if (focus) first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [locator?.quote, context]);
  return <PdfPreview blob={blob} pageNumber={locator?.page} focusKey={locator?.quote} onTextLayerReady={highlight} testId="intake-pdf" />;
}

function columnLetter(index: number) {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

/** Extracted blocks (paragraphs, real tables, sheet grids) with the locator span highlighted. */
export function BlockView({ extract, locator }: { extract: any; locator?: ViewerLocator }) {
  const root = useRef<HTMLDivElement>(null);
  const blocks: IntakeBlock[] = useMemo(() => extract?.blocks ?? [], [extract]);
  const text: string = extract?.text ?? "";
  const activeBlock = useMemo(() => {
    if (!locator) return undefined;
    if (typeof locator.blockIndex === "number") return locator.blockIndex;
    if (typeof locator.charStart === "number") return blocks.find((block) => block.charStart <= locator.charStart! && locator.charStart! <= block.charEnd)?.index;
    if (locator.quote) return blocks.find((block) => findQuote(block.text, locator.quote!))?.index;
    return undefined;
  }, [locator, blocks]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    clearHighlights(element);
    if (activeBlock === undefined) return;
    const blockElement = element.querySelector<HTMLElement>(`[data-block-index="${activeBlock}"]`);
    if (!blockElement) return;
    const cell = locator?.cell ? blockElement.querySelector<HTMLElement>(`[data-cell="${CSS.escape(locator.cell)}"]`) : null;
    const scope = cell ?? blockElement;
    const mark = highlightQuote(scope, locator?.quote) ?? scope;
    mark.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeBlock, locator?.quote, locator?.cell]);
  if (!extract) return <p className="muted" style={{ padding: 12 }}>No stored text for this file. When a run is compacted, a promoted file keeps its text on the promoted document and its original under Original.</p>;
  if (!blocks.length) return <p className="muted" style={{ padding: 12 }}>{extract.warnings?.[0] ?? "No text could be extracted (a scan without a text layer?)."}</p>;
  let lastSheet: string | undefined;
  return (
    <div ref={root} className="intake-viewer" data-testid="intake-blocks">
      {extract.warnings?.length > 0 && <p className="muted" style={{ fontSize: 12 }}>{extract.warnings.join(" ")}</p>}
      {blocks.map((block) => {
        const active = block.index === activeBlock;
        const sheetHeader = block.sheet && block.sheet !== lastSheet ? <div className="intake-sheet__name">Sheet {block.sheet}</div> : null;
        lastSheet = block.sheet ?? lastSheet;
        if (block.kind === "page_break") return <Fragment key={block.index}><hr className="intake-page-break" /><div className="intake-page-label">page {block.page}</div></Fragment>;
        if (block.kind === "table") {
          const width = Math.max(0, ...(block.rows ?? []).map((row) => row.cells.length));
          const isSheet = Boolean(block.sheet);
          return (
            <Fragment key={block.index}>
              {sheetHeader}
              <table className={`intake-table${active ? " intake-block--active" : ""}`} data-block-index={block.index}>
                {isSheet && <thead><tr><th className="intake-grid-ref" />{Array.from({ length: width }, (_, index) => <th key={index} className="intake-grid-ref">{columnLetter(index)}</th>)}</tr></thead>}
                <tbody>
                  {(block.rows ?? []).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {isSheet && <td className="intake-grid-ref">{/^[A-Z]+(\d+)$/.exec(row.cells[0]?.cell ?? "")?.[1] ?? rowIndex + 1}</td>}
                      {row.cells.map((cell, cellIndex) => {
                        const Tag = cell.header ? "th" : "td";
                        return <Tag key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} data-cell={cell.cell} className={active && locator?.cell === cell.cell ? "intake-cell--active" : undefined}>{text.slice(cell.charStart ?? 0, cell.charEnd ?? 0) || cell.text}</Tag>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Fragment>
          );
        }
        return (
          <Fragment key={block.index}>
            {sheetHeader}
            <div className={`intake-block intake-block--${block.kind}${active ? " intake-block--active" : ""}`} data-block-index={block.index} role={block.kind === "heading" ? "heading" : undefined} aria-level={block.kind === "heading" ? Math.min(6, (block.level ?? 1) + 2) : undefined}>
              <span className="intake-block__ref">b{block.index}{block.page ? ` · p${block.page}` : ""}</span>
              {block.kind === "list_item" ? "• " : ""}{text.slice(block.charStart, block.charEnd) || block.text}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function VersionDiff({ societyId, extract, versions, compareFileId, onCompare }: { societyId: string; extract: any; versions: ClusterVersion[]; compareFileId?: string; onCompare: (id: string) => void }) {
  const other = useQuery(api.intake.getFileExtract, compareFileId ? { societyId, fileId: compareFileId } : "skip") as any;
  const chunks = useMemo(() => (other?.extract && extract ? versionDiff(String(other.extract.text ?? ""), String(extract.text ?? "")) : []), [other, extract]);
  const changes = chunks.filter((chunk) => chunk.kind !== "same" && chunk.text.trim()).length;
  return (
    <div className="intake-diff">
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <label className="muted" htmlFor="intake-compare">Compare this copy with</label>
        <select id="intake-compare" className="input" style={{ maxWidth: 360 }} value={compareFileId ?? ""} onChange={(event) => onCompare(event.target.value)}>
          {versions.filter((version) => version.fileId).map((version) => <option key={version.fileKey} value={version.fileId}>{version.name} ({version.relation.replace(/-/g, " ")})</option>)}
        </select>
      </div>
      {!other && compareFileId && <p className="muted">Loading…</p>}
      {other && !other.extract && <p className="muted">That copy has no stored text (catalogued or unreadable).</p>}
      {other?.extract && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>{changes ? `${changes} changed passage${changes === 1 ? "" : "s"}` : "No wording differences"} · <del>removed in this copy</del> · <ins>added in this copy</ins></p>
          <div>
            {chunks.map((chunk, index) => (chunk.kind === "add" ? <ins key={index}>{chunk.text}</ins> : chunk.kind === "del" ? <del key={index}>{chunk.text}</del> : <span key={index}>{chunk.text}</span>))}
          </div>
        </>
      )}
    </div>
  );
}

/** Word diff for short documents, line diff when the LCS table would be too large; adjacent chunks merged. */
function versionDiff(rawBefore: string, rawAfter: string): Chunk[] {
  // Copies extracted by different engines (DOCX vs PDF) differ in line breaks and tabs; compare words only.
  const before = rawBefore.replace(/\s+/g, " ").trim();
  const after = rawAfter.replace(/\s+/g, " ").trim();
  let a = tokenize(before);
  let b = tokenize(after);
  if (a.length * b.length > 3_000_000) {
    a = before.split(/(?<=[.;:!?] )/);
    b = after.split(/(?<=[.;:!?] )/);
  }
  if (a.length * b.length > 12_000_000) return [{ kind: "del", text: before }, { kind: "add", text: after }];
  const merged: Chunk[] = [];
  for (const chunk of diffTokens(a, b)) {
    const last = merged[merged.length - 1];
    if (last && last.kind === chunk.kind) last.text += chunk.text;
    else merged.push({ ...chunk });
  }
  return merged;
}

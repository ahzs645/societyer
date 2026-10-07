/** DOCX → intake blocks. Real Word tables stay tables (never "|"-flattened);
 * `w:lastRenderedPageBreak` and explicit page breaks give page numbers. */
import JSZip from "jszip";
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeRow } from "../blocks";
import { attr, childrenNamed, firstChild, isNode, local, parseXml, type XmlNode } from "../xml";

type Ctx = { page: number; drafts: DraftBlock[]; part: string; numbering: Map<string, number>; textPage?: number };

function paragraphStyle(p: XmlNode): string | undefined {
  return attr(firstChild(firstChild(p, "pPr"), "pStyle"), "val");
}

/** Collect a paragraph's visible text; deleted runs are skipped, insertions kept. */
function runText(node: XmlNode, ctx: Ctx, boxes: XmlNode[]): string {
  let out = "";
  for (const child of node.children) {
    if (!isNode(child)) continue;
    const name = local(child.name);
    if (name === "t") {
      const value = child.children.filter((c) => typeof c === "string").join("");
      if (value.trim() && ctx.textPage === undefined) ctx.textPage = ctx.page;
      out += value;
    }
    else if (name === "tab" && local(node.name) === "r") out += "\t";
    else if (name === "br") {
      if (attr(child, "type") === "page") ctx.page += 1;
      out += "\n";
    } else if (name === "cr") out += "\n";
    else if (name === "noBreakHyphen") out += "-";
    else if (name === "softHyphen") out += "";
    else if (name === "sym") out += "•";
    else if (name === "lastRenderedPageBreak") ctx.page += 1;
    else if (name === "del" || name === "delText" || name === "instrText" || name === "pPr" || name === "rPr" || name === "fldData") continue;
    else if (name === "txbxContent") boxes.push(child);
    else out += runText(child, ctx, boxes);
  }
  return out;
}

function paragraphDraft(p: XmlNode, ctx: Ctx): DraftBlock[] {
  const startPage = ctx.page;
  ctx.textPage = undefined;
  const boxes: XmlNode[] = [];
  // Page breaks before the first text belong to the new page.
  const text = runText(p, ctx, boxes).replace(/[  ]+$/gm, "").replace(/ /g, " ");
  const style = paragraphStyle(p);
  const pPr = firstChild(p, "pPr");
  const numPr = firstChild(pPr, "numPr");
  const heading = style ? /^(?:heading|titre|berschrift)\s*(\d)$/i.exec(style.replace(/[^a-z0-9 ]/gi, " ").replace(/(\D)(\d)$/, "$1 $2")) : null;
  const drafts: DraftBlock[] = [];
  const page = ctx.textPage ?? startPage;
  if (text.trim()) {
    if (heading || /^title$/i.test(style ?? "")) drafts.push({ kind: "heading", text, level: heading ? Number(heading[1]) : 1, style, page, part: ctx.part });
    else if (numPr) {
      const level = Number(attr(firstChild(numPr, "ilvl"), "val") ?? 0);
      drafts.push({ kind: "list_item", text, level, style, page, part: ctx.part });
    } else drafts.push({ kind: "paragraph", text, style, page, part: ctx.part });
  }
  for (const box of boxes) for (const inner of bodyDrafts(box, ctx)) drafts.push({ ...inner, part: inner.part ?? ctx.part });
  return drafts;
}

function cellText(tc: XmlNode, ctx: Ctx): string {
  const lines: string[] = [];
  for (const child of tc.children) {
    if (!isNode(child)) continue;
    const name = local(child.name);
    if (name === "p") {
      const boxes: XmlNode[] = [];
      const text = runText(child, ctx, boxes).replace(/ /g, " ").replace(/\s+$/g, "");
      const numbered = firstChild(firstChild(child, "pPr"), "numPr");
      if (text.trim()) lines.push(numbered ? `• ${text.trim()}` : text);
    } else if (name === "tbl") {
      for (const row of childrenNamed(child, "tr")) lines.push(childrenNamed(row, "tc").map((cell) => cellText(cell, ctx).replace(/\n/g, " ")).join(" ; "));
    } else if (name === "sdt") {
      const content = firstChild(child, "sdtContent");
      if (content) lines.push(cellText(content, ctx));
    }
  }
  return lines.join("\n");
}

function tableDraft(tbl: XmlNode, ctx: Ctx): DraftBlock {
  const page = ctx.page;
  const rows: IntakeRow[] = [];
  const pendingVertical: Record<number, { rowIndex: number; cellIndex: number }> = {};
  childrenNamed(tbl, "tr").forEach((tr) => {
    const cells: IntakeRow["cells"] = [];
    let column = 0;
    const header = Boolean(firstChild(firstChild(tr, "trPr"), "tblHeader"));
    const cellNodes = tr.children.filter((c): c is XmlNode => isNode(c) && (local(c.name) === "tc" || local(c.name) === "sdt"));
    for (const node of cellNodes) {
      const tc = local(node.name) === "sdt" ? firstChild(firstChild(node, "sdtContent"), "tc") : node;
      if (!tc) continue;
      const tcPr = firstChild(tc, "tcPr");
      const span = Number(attr(firstChild(tcPr, "gridSpan"), "val") ?? 1) || 1;
      const vMerge = firstChild(tcPr, "vMerge");
      const text = cellText(tc, ctx);
      if (vMerge && attr(vMerge, "val") !== "restart") {
        // Continuation of a vertically merged cell: credit the span to its origin.
        const origin = pendingVertical[column];
        if (origin) {
          const originCell = rows[origin.rowIndex]?.cells[origin.cellIndex];
          if (originCell) {
            originCell.rowSpan = (originCell.rowSpan ?? 1) + 1;
            if (text.trim()) originCell.text = `${originCell.text}\n${text}`;
          }
        }
        cells.push({ text: "", cell: `R${rows.length + 1}C${column + 1}`, ...(span > 1 ? { colSpan: span } : {}) });
      } else {
        if (vMerge) pendingVertical[column] = { rowIndex: rows.length, cellIndex: cells.length };
        else delete pendingVertical[column];
        cells.push({ text, cell: `R${rows.length + 1}C${column + 1}`, ...(span > 1 ? { colSpan: span } : {}), ...(header ? { header: true } : {}) });
      }
      column += span;
    }
    rows.push({ cells });
  });
  return { kind: "table", rows, page, part: ctx.part };
}

function bodyDrafts(body: XmlNode, ctx: Ctx): DraftBlock[] {
  const out: DraftBlock[] = [];
  for (const child of body.children) {
    if (!isNode(child)) continue;
    const name = local(child.name);
    if (name === "p") out.push(...paragraphDraft(child, ctx));
    else if (name === "tbl") out.push(tableDraft(child, ctx));
    else if (name === "sdt") {
      const content = firstChild(child, "sdtContent");
      if (content) out.push(...bodyDrafts(content, ctx));
    } else if (name === "customXml" || name === "ins" || name === "smartTag") out.push(...bodyDrafts(child, ctx));
  }
  return out;
}

export async function extractDocx(bytes: Uint8Array | ArrayBuffer): Promise<IntakeExtract> {
  const zip = await JSZip.loadAsync(bytes);
  const warnings: string[] = [];
  const main = zip.file("word/document.xml");
  if (!main) throw new Error("Not a Word document: word/document.xml is missing.");
  const ctx: Ctx = { page: 1, drafts: [], part: "body", numbering: new Map() };
  const drafts: DraftBlock[] = [];
  // Headers carry titles and dates in many minutes templates; keep distinct ones once.
  const seenHeaderText = new Set<string>();
  const headerFiles = Object.keys(zip.files).filter((name) => /^word\/header\d*\.xml$/.test(name)).sort();
  for (const name of headerFiles) {
    const root = parseXml(await zip.file(name)!.async("string"));
    const hdr = root.children.find(isNode);
    if (!hdr) continue;
    const headerCtx: Ctx = { page: 1, drafts: [], part: "header", numbering: new Map() };
    for (const draft of bodyDrafts(hdr, headerCtx)) {
      const key = (draft.text ?? JSON.stringify(draft.rows ?? "")).trim();
      if (!key || seenHeaderText.has(key)) continue;
      seenHeaderText.add(key);
      drafts.push({ ...draft, page: 1, part: "header" });
    }
  }
  const document = parseXml(await main.async("string"));
  const body = firstChild(document.children.find(isNode), "body");
  if (!body) warnings.push("Document body is empty.");
  else drafts.push(...bodyDrafts(body, ctx));
  if (zip.file("word/footnotes.xml")) {
    const root = parseXml(await zip.file("word/footnotes.xml")!.async("string"));
    const notes = root.children.find(isNode);
    if (notes) for (const note of childrenNamed(notes, "footnote")) {
      if (Number(attr(note, "id")) <= 0) continue;
      for (const draft of bodyDrafts(note, { ...ctx, part: "footnote" })) drafts.push({ ...draft, part: "footnote" });
    }
  }
  const { blocks, text } = finalizeBlocks(drafts);
  const pageCount = Math.max(1, ...blocks.map((block) => block.page ?? 1));
  return { method: "docx-ooxml", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, pageCount, warnings };
}

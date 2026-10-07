/** Presentations and XPS without LibreOffice.
 *
 * - PPTX/POTX (OOXML): slides in presentation order, one heading per slide, paragraphs from
 *   text bodies, real table blocks from graphic-frame tables, speaker notes after the slide.
 * - PPT (PowerPoint 97–2003): text atoms of the "PowerPoint Document" stream in stream order,
 *   grouped by slide where the slide list says so. Master and handout text is skipped.
 * - XPS / OXPS: fixed pages' glyph runs become positioned text and are laid out like a PDF page
 *   (lines, columns, tables). */
import JSZip from "jszip";
import { finalizeBlocks, INTAKE_EXTRACT_VERSION, type DraftBlock, type IntakeExtract, type IntakeRow } from "../blocks";
import { attr, childrenNamed, descendants, firstChild, isNode, local, parseXml, textContent, type XmlNode } from "../xml";
import { readCompoundStreams } from "./doc";
import { layoutPages, linesFromItems, type PdfItem, type PdfLayoutPage } from "./pdf";

function resolveTarget(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

async function relationships(zip: JSZip, part: string): Promise<Map<string, { target: string; type: string }>> {
  const relsPath = part.replace(/([^/]+)$/, "_rels/$1.rels");
  const xml = await zip.file(relsPath)?.async("string");
  const map = new Map<string, { target: string; type: string }>();
  if (!xml) return map;
  for (const rel of descendants(parseXml(xml), "Relationship")) map.set(attr(rel, "Id") ?? "", { target: resolveTarget(part, attr(rel, "Target") ?? ""), type: attr(rel, "Type") ?? "" });
  return map;
}

function paragraphsOf(body: XmlNode): string[] {
  return childrenNamed(body, "p").map((p) => {
    let text = "";
    for (const child of p.children) {
      if (!isNode(child)) continue;
      const name = local(child.name);
      if (name === "r" || name === "fld") text += descendants(child, "t").map(textContent).join("");
      else if (name === "br") text += "\n";
    }
    return text.replace(/[ \t]+$/g, "");
  }).filter((text) => text.trim());
}

function slideDrafts(root: XmlNode, page: number, part?: string): DraftBlock[] {
  const drafts: DraftBlock[] = [];
  const visit = (node: XmlNode) => {
    for (const child of node.children) {
      if (!isNode(child)) continue;
      const name = local(child.name);
      if (name === "txBody") {
        const isTitle = /title/i.test(attr(descendants(node, "ph")[0], "type") ?? "");
        for (const text of paragraphsOf(child)) drafts.push(isTitle ? { kind: "heading", text, level: 3, page, ...(part ? { part } : {}) } : { kind: "paragraph", text, page, ...(part ? { part } : {}) });
      } else if (name === "tbl") {
        const rows: IntakeRow[] = childrenNamed(child, "tr").map((tr, rowIndex) => ({
          cells: childrenNamed(tr, "tc").map((tc, column) => ({ text: (firstChild(tc, "txBody") ? paragraphsOf(firstChild(tc, "txBody")!) : []).join("\n"), cell: `R${rowIndex + 1}C${column + 1}` })),
        }));
        if (rows.length) drafts.push({ kind: "table", rows, page, ...(part ? { part } : {}) });
      } else visit(child);
    }
  };
  visit(root);
  return drafts;
}

export async function extractPptx(bytes: Uint8Array): Promise<IntakeExtract> {
  const zip = await JSZip.loadAsync(bytes);
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentation) throw new Error("Not a presentation: ppt/presentation.xml is missing.");
  const rels = await relationships(zip, "ppt/presentation.xml");
  // <p:sldId id="256" r:id="rId2"/>: the relationship id is the namespaced one.
  const relId = (sld: XmlNode) => Object.entries(sld.attrs).find(([key]) => /:id$/.test(key))?.[1] ?? "";
  const order = descendants(parseXml(presentation), "sldId").map((sld) => rels.get(relId(sld))?.target).filter((target): target is string => Boolean(target));
  const drafts: DraftBlock[] = [];
  const warnings: string[] = [];
  let page = 0;
  for (const slidePath of order) {
    const xml = await zip.file(slidePath)?.async("string");
    page += 1;
    if (page > 1) drafts.push({ kind: "page_break", page });
    if (!xml) {
      warnings.push(`Slide ${page} could not be read.`);
      continue;
    }
    drafts.push({ kind: "heading", text: `Slide ${page}`, level: 2, page, style: "slide" });
    drafts.push(...slideDrafts(parseXml(xml), page));
    const notes = [...(await relationships(zip, slidePath)).values()].find((rel) => /notesSlide$/.test(rel.type));
    const notesXml = notes ? await zip.file(notes.target)?.async("string") : undefined;
    if (notesXml) {
      // Notes pages repeat the slide image and number placeholders; only the body placeholder is the notes text.
      const body = descendants(parseXml(notesXml), "sp").filter((sp) => attr(descendants(sp, "ph")[0], "type") === "body");
      for (const sp of body) for (const text of descendants(sp, "txBody").flatMap(paragraphsOf)) drafts.push({ kind: "paragraph", text, page, part: "notes" });
    }
  }
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "pptx-ooxml", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, pageCount: page, warnings };
}

/** PowerPoint 97–2003 binary: record headers are 8 bytes (ver/instance u16, type u16, length u32);
 * containers have version 0xF. Text atoms are collected per slide: placeholder text from the
 * slide list (one SlidePersistAtom per slide), text boxes from each Slide container, speaker
 * notes from each Notes container (all in stream order, which follows the slide order). */
export function extractPpt(bytes: Uint8Array): IntakeExtract {
  const streams = readCompoundStreams(bytes);
  const stream = streams.get("PowerPoint Document");
  if (!stream) throw new Error("Not a PowerPoint 97–2003 file: no PowerPoint Document stream.");
  if (streams.has("EncryptedSummary")) throw new Error("This presentation is password-protected (encrypted).");
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const SKIP_CONTAINERS = new Set([0x03f8 /* MainMaster */, 0x0fc9 /* Handout */, 0x07d0 /* Environment */, 0x1388 /* ProgTags */, 0x0ff5 /* VBAInfo */]);
  const slides: Array<{ text: string[]; notes: string[] }> = [];
  const slideAt = (index: number) => (slides[index] ??= { text: [], notes: [] });
  let listSlide = -1;
  const slideIds: number[] = [];
  let containerSlide = -1;
  let notesSlide = -1;
  let context: "list" | "slide" | "notes" | "other" = "other";
  const loose: string[] = [];
  const clean = (raw: string) => raw.replace(/\r/g, "\n").replace(/\u000b/g, "\n").replace(/\u0000/g, "").trim();
  const push = (raw: string) => {
    const text = clean(raw);
    if (!text || /^\*$|^click to edit/i.test(text)) return;
    const target = context === "list" && listSlide >= 0 ? slideAt(listSlide).text
      : context === "slide" && containerSlide >= 0 ? slideAt(containerSlide).text
        : context === "notes" && notesSlide >= 0 ? slideAt(notesSlide).notes : loose;
    if (!target.includes(text)) target.push(text);
  };
  const walk = (start: number, end: number) => {
    let offset = start;
    while (offset + 8 <= end) {
      const verInstance = view.getUint16(offset, true);
      const type = view.getUint16(offset + 2, true);
      const length = view.getUint32(offset + 4, true);
      const bodyStart = offset + 8;
      const bodyEnd = Math.min(end, bodyStart + length);
      if ((verInstance & 0x0f) === 0x0f) {
        if (!SKIP_CONTAINERS.has(type)) {
          const previous = context;
          if (type === 0x0ff0) context = verInstance >> 4 === 0 ? "list" : "other";
          else if (type === 0x03ee) {
            containerSlide += 1;
            context = "slide";
          } else if (type === 0x03f0) {
            notesSlide = -1;
            context = "notes";
          }
          walk(bodyStart, bodyEnd);
          context = previous;
        }
      } else if (type === 0x03f3 && context === "list") {
        listSlide += 1;
        if (bodyStart + 16 <= bodyEnd) slideIds.push(view.getUint32(bodyStart + 12, true));
      } else if (type === 0x03f1 && context === "notes" && bodyStart + 4 <= bodyEnd) {
        // NotesAtom.slideIdRef: which slide these notes belong to (0 = the notes master).
        const slideId = view.getUint32(bodyStart, true);
        notesSlide = slideIds.indexOf(slideId);
      }
      else if (type === 0x0fa0) {
        let text = "";
        for (let index = bodyStart; index + 1 < bodyEnd; index += 2) text += String.fromCharCode(view.getUint16(index, true));
        push(text);
      } else if (type === 0x0fa8) {
        let text = "";
        for (let index = bodyStart; index < bodyEnd; index++) text += String.fromCharCode(stream[index]);
        push(text);
      }
      if (bodyEnd <= offset) break;
      offset = bodyEnd;
    }
  };
  walk(0, stream.length);
  const drafts: DraftBlock[] = [];
  slides.forEach((slide, index) => {
    if (!slide) return;
    const page = index + 1;
    if (drafts.length) drafts.push({ kind: "page_break", page });
    drafts.push({ kind: "heading", text: `Slide ${page}`, level: 2, page, style: "slide" });
    slide.text.forEach((text, position) => drafts.push(position === 0 && !text.includes("\n") && text.length < 120 ? { kind: "heading", text, level: 3, page } : { kind: "paragraph", text, page }));
    for (const text of slide.notes) drafts.push({ kind: "paragraph", text, page, part: "notes" });
  });
  for (const text of loose) drafts.push({ kind: "paragraph", text });
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "ppt-binary", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, ...(slides.length ? { pageCount: slides.length } : {}), warnings: ["Read from the PowerPoint 97–2003 binary: slide text by slide; layout and tables are not kept."] };
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
function parseMatrix(value: string | undefined): Matrix | undefined {
  const numbers = value?.split(/[\s,]+/).map(Number);
  return numbers && numbers.length === 6 && numbers.every(Number.isFinite) ? (numbers as Matrix) : undefined;
}

/** XPS (OpenXPS) fixed pages: glyph runs in 1/96-inch units become PDF-point text items. */
export async function extractXps(bytes: Uint8Array): Promise<IntakeExtract> {
  const zip = await JSZip.loadAsync(bytes);
  const pagePaths = Object.keys(zip.files).filter((name) => /\.fpage$/i.test(name)).sort((a, b) => {
    const da = a.replace(/\/Pages\/.*$/i, ""), db = b.replace(/\/Pages\/.*$/i, "");
    if (da !== db) return da.localeCompare(db, undefined, { numeric: true });
    return a.localeCompare(b, undefined, { numeric: true });
  });
  if (!pagePaths.length) throw new Error("Not an XPS document: no fixed pages.");
  const pages: PdfLayoutPage[] = [];
  const toPoints = 72 / 96;
  for (const [index, pagePath] of pagePaths.entries()) {
    const root = parseXml((await zip.file(pagePath)!.async("string")).replace(/^﻿/, ""));
    const fixedPage = descendants(root, "FixedPage")[0] ?? root;
    const height = Number(attr(fixedPage, "Height") ?? 1056);
    const items: PdfItem[] = [];
    const visit = (node: XmlNode, matrix: Matrix) => {
      for (const child of node.children) {
        if (!isNode(child)) continue;
        const name = local(child.name);
        const own = parseMatrix(attr(child, "RenderTransform"));
        const next = own ? multiply(own, matrix) : matrix;
        if (name === "Glyphs") {
          const text = attr(child, "UnicodeString")?.replace(/^\{\}/, "") ?? "";
          if (!text.trim()) continue;
          const size = Number(attr(child, "FontRenderingEmSize") ?? 12);
          const ox = Number(attr(child, "OriginX") ?? 0), oy = Number(attr(child, "OriginY") ?? 0);
          const x = ox * next[0] + oy * next[2] + next[4];
          const y = ox * next[1] + oy * next[3] + next[5];
          const scale = Math.hypot(next[0], next[1]) || 1;
          items.push({ str: text, x: x * toPoints, y: (height - y) * toPoints, w: text.length * size * scale * 0.5 * toPoints, h: size * scale * toPoints });
        } else visit(child, next);
      }
    };
    visit(fixedPage, IDENTITY);
    pages.push({ pageNumber: index + 1, lines: linesFromItems(items) });
  }
  const { drafts, emptyPages } = layoutPages(pages);
  const { blocks, text } = finalizeBlocks(drafts);
  return { method: "xps-fixedpage", methodVersion: INTAKE_EXTRACT_VERSION, blocks, text, pageCount: pages.length, emptyPages, warnings: emptyPages.length ? [`No text on page(s) ${emptyPages.join(", ")} (scanned XPS pages are not read by OCR).`] : [] };
}

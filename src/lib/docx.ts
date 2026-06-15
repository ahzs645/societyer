// HTML → .docx (Office Open XML) generator. Produces a real OOXML package
// that Word, Google Docs, LibreOffice, and Pages all open natively. Handles
// paragraphs, headings, lists, tables, hyperlinks, inline formatting
// (bold/italic/underline/strike/color/background), code/pre blocks, and embeds
// inline <img> as media parts so letterheads survive the trip into Word.
//
// Floating images (style="float: right" / align="right") are emitted as a
// wp:anchor inside the next paragraph so the text wraps around them — this is
// what makes the letterhead sit beside the title in the meeting minutes.

import { createStoredZip, ensureExtension, triggerBlobDownload } from "./zip";

/**
 * Build a real .docx (Office Open XML) Blob from an HTML body fragment.
 * Async because images are fetched (bytes + natural dimensions) before the
 * archive is assembled. Images that fail to fetch (CORS, 404, opaque response)
 * are silently dropped so the build still succeeds.
 *
 * Exposed separately from {@link exportWordDocx} so the on-screen preview can
 * render the *exact same bytes* the user downloads (via docx-preview) instead
 * of a separately-styled approximation.
 */
export async function buildWordDocxBlob({
  bodyHtml,
}: {
  bodyHtml: string;
}): Promise<Blob> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${bodyHtml}</body>`, "text/html");

  const rels = createDocxRels();
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (src) relForImage(rels, src);
  }
  for (const a of Array.from(doc.querySelectorAll("a"))) {
    const href = a.getAttribute("href");
    if (href && /^(https?:|mailto:)/i.test(href)) relForHyperlink(rels, href);
  }

  await Promise.all(Array.from(rels.images.values()).map(fetchImageForDocx));
  for (const [url, entry] of Array.from(rels.images.entries())) {
    if (!entry.bytes) {
      rels.images.delete(url);
    } else {
      rels.imageExtensions.add(entry.extension);
    }
  }

  const documentXml = buildDocxDocumentXml(doc.body, rels);
  const documentRelsXml = buildDocxDocumentRels(rels);
  const contentTypesXml = buildDocxContentTypes(rels);

  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": contentTypesXml,
    "_rels/.rels": DOCX_ROOT_RELS,
    "word/document.xml": documentXml,
    "word/styles.xml": DOCX_STYLES,
    "word/_rels/document.xml.rels": documentRelsXml,
  };
  for (const image of rels.images.values()) {
    if (image.bytes) files[`word/${image.partPath}.${image.extension}`] = image.bytes;
  }

  const zipBytes = createStoredZip(files);
  return new Blob([zipBytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/**
 * Build a real .docx (Office Open XML) from an HTML body fragment and
 * download it.
 */
export async function exportWordDocx({
  filename,
  title: _title,
  bodyHtml,
}: {
  filename: string;
  title: string;
  bodyHtml: string;
}): Promise<void> {
  const blob = await buildWordDocxBlob({ bodyHtml });
  triggerBlobDownload(blob, ensureExtension(filename, "docx"));
}

// OOXML namespace URIs. Declared once on the document root so per-element
// prefixes resolve cleanly throughout.
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DRAWINGML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const HYPERLINK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const STYLES_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";

// English Metric Units — 914400 EMU per inch, 12700 per point. Used for image
// sizing in the drawing XML.
const EMU_PER_POINT = 12700;
const MAX_INLINE_IMAGE_HEIGHT_PT = 36;

const DOCX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="40"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="320" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="220" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>`;

type DocxImage = {
  url: string;
  relId: string;
  partPath: string;
  contentType: string;
  extension: string;
  bytes: Uint8Array | null;
  widthEmu: number;
  heightEmu: number;
};

type DocxRels = {
  hyperlinks: Map<string, string>;
  images: Map<string, DocxImage>;
  imageExtensions: Set<string>;
  nextId: number;
  nextImageNum: number;
};

function createDocxRels(): DocxRels {
  return {
    hyperlinks: new Map(),
    images: new Map(),
    imageExtensions: new Set(),
    // rId1 is reserved for styles.xml. Everything else starts at 100 to make
    // it obvious which IDs are user-allocated vs. reserved.
    nextId: 100,
    nextImageNum: 1,
  };
}

function relForHyperlink(rels: DocxRels, url: string): string {
  let id = rels.hyperlinks.get(url);
  if (!id) {
    id = `rId${rels.nextId++}`;
    rels.hyperlinks.set(url, id);
  }
  return id;
}

function relForImage(rels: DocxRels, url: string): DocxImage {
  let entry = rels.images.get(url);
  if (!entry) {
    const num = rels.nextImageNum++;
    entry = {
      url,
      relId: `rId${rels.nextId++}`,
      partPath: `media/image${num}`,
      contentType: "image/png",
      extension: "png",
      bytes: null,
      widthEmu: 0,
      heightEmu: 0,
    };
    rels.images.set(url, entry);
  }
  return entry;
}

function extensionForContentType(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpeg";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("bmp")) return "bmp";
  if (ct.includes("svg")) return "svg";
  return "png";
}

async function fetchImageForDocx(image: DocxImage): Promise<void> {
  try {
    let bytes: Uint8Array;
    let contentType = "image/png";

    if (image.url.startsWith("data:")) {
      const match = image.url.match(/^data:([^,;]*)(;base64)?,(.*)$/s);
      if (!match) return;
      contentType = match[1] || "image/png";
      if (match[2]) {
        const binary = atob(match[3]);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      } else {
        bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
      }
    } else {
      const res = await fetch(image.url, { credentials: "include" }).catch(() => null);
      if (!res || !res.ok) return;
      contentType = res.headers.get("content-type") || contentType;
      bytes = new Uint8Array(await res.arrayBuffer());
    }

    const naturalSize = await loadImageNaturalSize(image.url).catch(() => null);
    const ratio = naturalSize && naturalSize.height > 0 ? naturalSize.width / naturalSize.height : 1;
    const heightEmu = MAX_INLINE_IMAGE_HEIGHT_PT * EMU_PER_POINT;
    const widthEmu = Math.max(1, Math.round(heightEmu * ratio));

    image.bytes = bytes;
    image.contentType = contentType;
    image.extension = extensionForContentType(contentType);
    image.widthEmu = widthEmu;
    image.heightEmu = heightEmu;
  } catch {
    // Swallow — caller checks image.bytes and drops anything that failed.
  }
}

function loadImageNaturalSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

function buildDocxContentTypes(rels: DocxRels): string {
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
  ];
  for (const ext of rels.imageExtensions) {
    const ct =
      ext === "jpeg" ? "image/jpeg" :
      ext === "png" ? "image/png" :
      ext === "gif" ? "image/gif" :
      ext === "bmp" ? "image/bmp" :
      ext === "svg" ? "image/svg+xml" :
      "application/octet-stream";
    defaults.push(`<Default Extension="${ext}" ContentType="${ct}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  ${defaults.join("\n  ")}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function buildDocxDocumentRels(rels: DocxRels): string {
  const items: string[] = [
    `<Relationship Id="rId1" Type="${STYLES_REL_TYPE}" Target="styles.xml"/>`,
  ];
  for (const [url, id] of rels.hyperlinks.entries()) {
    items.push(`<Relationship Id="${id}" Type="${HYPERLINK_REL_TYPE}" Target="${escapeXml(url)}" TargetMode="External"/>`);
  }
  for (const image of rels.images.values()) {
    items.push(`<Relationship Id="${image.relId}" Type="${IMAGE_REL_TYPE}" Target="${image.partPath}.${image.extension}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${items.join("\n  ")}
</Relationships>`;
}

function buildDocxDocumentXml(body: HTMLElement, rels: DocxRels): string {
  // We do a single body walk so that a leading floating <img> (e.g. the
  // right-aligned letterhead from renderDocumentHeader) can be deferred and
  // re-emitted as a wp:anchor inside the *next* paragraph. That's the only way
  // Word will wrap the title text to the left of the image — emitting the
  // image as its own paragraph just stacks it above the title.
  const blocks: string[] = [];
  let pendingFloat: string | null = null;

  const flushPendingAsOwnParagraph = () => {
    if (!pendingFloat) return;
    blocks.push(`<w:p>${pendingFloat}</w:p>`);
    pendingFloat = null;
  };

  for (const node of Array.from(body.childNodes)) {
    if (node instanceof HTMLElement && node.tagName.toLowerCase() === "img") {
      const direction = getFloatDirection(node);
      const src = node.getAttribute("src");
      const entry = src ? rels.images.get(src) : undefined;
      if (entry?.bytes && direction) {
        flushPendingAsOwnParagraph();
        pendingFloat = buildAnchorImageRun(entry, direction, imageDimensionsFor(entry, node));
        continue;
      }
      const inlineBlock = docxBlockFromNode(node, rels);
      if (inlineBlock) blocks.push(inlineBlock);
      continue;
    }

    const block = docxBlockFromNode(node, rels);
    if (!block) continue;

    if (pendingFloat && block.startsWith("<w:p>")) {
      // Inject the anchor run after the paragraph's <w:pPr> (if any), so the
      // image is anchored to that paragraph and text wraps around it.
      const headMatch = block.match(/^<w:p>(<w:pPr>[\s\S]*?<\/w:pPr>)?/);
      if (headMatch) {
        const prefixLen = headMatch[0].length;
        blocks.push(block.slice(0, prefixLen) + pendingFloat + block.slice(prefixLen));
        pendingFloat = null;
        continue;
      }
    }

    flushPendingAsOwnParagraph();
    blocks.push(block);
  }

  flushPendingAsOwnParagraph();

  const content = blocks.join("") || docxParagraph("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}" xmlns:wp="${WP_NS}" xmlns:a="${DRAWINGML_NS}" xmlns:pic="${PIC_NS}">
  <w:body>
    ${content}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="936" w:right="936" w:bottom="936" w:left="936" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function getFloatDirection(node: HTMLElement): "left" | "right" | null {
  const styles = parseInlineStyle(node.getAttribute("style") ?? "");
  const float = styles["float"];
  const align = node.getAttribute("align");
  if (float === "right" || align === "right") return "right";
  if (float === "left" || align === "left") return "left";
  return null;
}

function imageDimensionsFor(image: DocxImage, node: HTMLElement): { width: number; height: number } {
  if (image.widthEmu <= 0 || image.heightEmu <= 0) {
    return { width: image.widthEmu, height: image.heightEmu };
  }
  const styles = parseInlineStyle(node.getAttribute("style") ?? "");
  const heightPt = parsePoints(styles["height"]) ?? parsePoints(styles["max-height"]);
  if (heightPt && heightPt > 0) {
    const heightEmu = Math.max(1, Math.round(heightPt * EMU_PER_POINT));
    const ratio = image.widthEmu / image.heightEmu;
    return { width: Math.max(1, Math.round(heightEmu * ratio)), height: heightEmu };
  }
  return { width: image.widthEmu, height: image.heightEmu };
}

function parsePoints(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = String(value).trim().match(/^([\d.]+)(pt|in|px|pc|mm|cm)?$/i);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = (match[2] ?? "px").toLowerCase();
  switch (unit) {
    case "pt": return n;
    case "in": return n * 72;
    case "px": return n * (72 / 96);
    case "pc": return n * 12;
    case "mm": return n * (72 / 25.4);
    case "cm": return n * (72 / 2.54);
    default: return n;
  }
}

function buildAnchorImageRun(
  image: DocxImage,
  direction: "left" | "right",
  dims: { width: number; height: number },
): string {
  const docPrId = String(parseInt(image.relId.replace(/[^\d]/g, ""), 10) || 1);
  // wrapText is the side(s) of the image where surrounding text appears.
  // For a right-anchored image, text should be on the left.
  const wrapSide = direction === "right" ? "left" : "right";
  return `<w:r><w:drawing>
    <wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251660288" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/>
      <wp:positionH relativeFrom="margin"><wp:align>${direction}</wp:align></wp:positionH>
      <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
      <wp:extent cx="${dims.width}" cy="${dims.height}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:wrapSquare wrapText="${wrapSide}"/>
      <wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>
      <wp:cNvGraphicFramePr/>
      <a:graphic>
        <a:graphicData uri="${PIC_NS}">
          <pic:pic>
            <pic:nvPicPr>
              <pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${image.relId}"/>
              <a:stretch><a:fillRect/></a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${dims.width}" cy="${dims.height}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:anchor>
  </w:drawing></w:r>`;
}

function docxBlockFromNode(node: ChildNode, rels: DocxRels): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text.trim() ? docxParagraphFromRuns(docxRun(collapseWhitespace(text))) : "";
  }
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case "h1":
      return docxParagraphFromRuns(docxInlineRuns(node, rels), "Title");
    case "h2":
      return docxParagraphFromRuns(docxInlineRuns(node, rels), "Heading1");
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return docxParagraphFromRuns(docxInlineRuns(node, rels), "Heading2");
    case "p":
      return docxParagraphFromRuns(docxInlineRuns(node, rels));
    case "blockquote":
      return docxParagraphFromRuns(docxInlineRuns(node, rels), undefined, { left: 720 });
    case "pre":
      return docxParagraphFromRuns(
        docxRun(node.textContent ?? "", '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/>'),
        undefined,
        { left: 200 },
      );
    case "ul":
      return docxList(node, false, rels);
    case "ol":
      return docxList(node, true, rels);
    case "table":
      return docxTable(node, rels);
    case "hr":
      return docxParagraph("");
    case "img":
      return docxImageParagraph(node as HTMLImageElement, rels);
    case "br":
      return docxParagraph("");
    case "div":
    case "section":
    case "article":
    case "header":
    case "footer":
    case "main":
    case "aside":
      return Array.from(node.childNodes)
        .map((child) => docxBlockFromNode(child, rels))
        .join("");
    default:
      // Treat anything else as inline-only: wrap its inline runs in a paragraph
      // so we don't drop content silently.
      return docxParagraphFromRuns(docxInlineRuns(node, rels));
  }
}

function docxImageParagraph(img: HTMLImageElement, rels: DocxRels): string {
  const src = img.getAttribute("src");
  if (!src) return "";
  const entry = rels.images.get(src);
  if (!entry || !entry.bytes) return "";
  return `<w:p>${buildImageRun(entry, imageDimensionsFor(entry, img))}</w:p>`;
}

function buildImageRun(image: DocxImage, dims: { width: number; height: number }): string {
  const docPrId = String(parseInt(image.relId.replace(/[^\d]/g, ""), 10) || 1);
  return `<w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${dims.width}" cy="${dims.height}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="${docPrId}" name="Picture ${docPrId}"/>
      <wp:cNvGraphicFramePr/>
      <a:graphic>
        <a:graphicData uri="${PIC_NS}">
          <pic:pic>
            <pic:nvPicPr>
              <pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${image.relId}"/>
              <a:stretch><a:fillRect/></a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${dims.width}" cy="${dims.height}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r>`;
}

function docxInlineRuns(node: ChildNode, rels: DocxRels, props = ""): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = collapseWhitespace(node.textContent ?? "");
    return text ? docxRun(text, props) : "";
  }
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName.toLowerCase();

  if (tag === "br") return "<w:r><w:br/></w:r>";

  if (tag === "img") {
    const src = node.getAttribute("src");
    const entry = src ? rels.images.get(src) : undefined;
    return entry?.bytes ? buildImageRun(entry, imageDimensionsFor(entry, node)) : "";
  }

  if (tag === "a") {
    const href = (node as HTMLAnchorElement).getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) {
      const relId = relForHyperlink(rels, href);
      const linkProps = `${props}<w:rStyle w:val="Hyperlink"/>`;
      const innerRuns = Array.from(node.childNodes)
        .map((child) => docxInlineRuns(child, rels, linkProps))
        .join("");
      return `<w:hyperlink r:id="${relId}" w:history="1">${innerRuns}</w:hyperlink>`;
    }
  }

  const nextProps = `${props}${inlineTagProps(tag)}${inlineStyleProps(node)}`;
  return Array.from(node.childNodes)
    .map((child) => docxInlineRuns(child, rels, nextProps))
    .join("");
}

function inlineTagProps(tag: string): string {
  switch (tag) {
    case "strong":
    case "b":
      return "<w:b/>";
    case "em":
    case "i":
      return "<w:i/>";
    case "u":
      return '<w:u w:val="single"/>';
    case "s":
    case "strike":
    case "del":
      return "<w:strike/>";
    case "code":
    case "kbd":
    case "samp":
    case "tt":
      return '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
    case "sup":
      return '<w:vertAlign w:val="superscript"/>';
    case "sub":
      return '<w:vertAlign w:val="subscript"/>';
    default:
      return "";
  }
}

function inlineStyleProps(node: HTMLElement): string {
  const style = node.getAttribute("style");
  if (!style) return "";
  const declared = parseInlineStyle(style);
  const out: string[] = [];

  const color = declared["color"];
  if (color) {
    const hex = cssColorToHex(color);
    if (hex) out.push(`<w:color w:val="${hex}"/>`);
  }
  const bg = declared["background-color"] ?? declared["background"];
  if (bg) {
    const hex = cssColorToHex(bg);
    if (hex) out.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`);
  }
  const decoration = declared["text-decoration"];
  if (decoration) {
    if (/line-through/i.test(decoration)) out.push("<w:strike/>");
    if (/underline/i.test(decoration)) out.push('<w:u w:val="single"/>');
  }
  const fontWeight = declared["font-weight"];
  if (fontWeight && (fontWeight === "bold" || parseInt(fontWeight, 10) >= 600)) {
    out.push("<w:b/>");
  }
  if (declared["font-style"] === "italic") out.push("<w:i/>");
  const fontFamily = declared["font-family"];
  if (fontFamily && /(consolas|courier|monospace)/i.test(fontFamily)) {
    out.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  }
  return out.join("");
}

function parseInlineStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const key = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

const NAMED_COLORS: Record<string, string> = {
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  black: "000000",
  white: "FFFFFF",
  yellow: "FFFF00",
  orange: "FFA500",
  purple: "800080",
  gray: "808080",
  grey: "808080",
};

function cssColorToHex(value: string): string | null {
  const trimmed = value.trim();
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named) return named;
  const hex = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const v = hex[1];
    if (v.length === 3) return Array.from(v).map((c) => `${c}${c}`).join("").toUpperCase();
    if (v.length === 6) return v.toUpperCase();
    if (v.length === 8) return v.slice(0, 6).toUpperCase();
  }
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const r = parseInt(rgb[1], 10).toString(16).padStart(2, "0");
    const g = parseInt(rgb[2], 10).toString(16).padStart(2, "0");
    const b = parseInt(rgb[3], 10).toString(16).padStart(2, "0");
    return `${r}${g}${b}`.toUpperCase();
  }
  return null;
}

function docxParagraph(text: string | null | undefined, style?: "Title" | "Heading1" | "Heading2") {
  return docxParagraphFromRuns(docxRun(collapseWhitespace(text ?? "")), style);
}

function docxParagraphFromRuns(runs: string, style?: "Title" | "Heading1" | "Heading2", indent?: { left: number; hanging?: number }) {
  const paragraphProps = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    indent ? `<w:ind w:left="${indent.left}"${indent.hanging ? ` w:hanging="${indent.hanging}"` : ""}/>` : "",
    '<w:spacing w:after="120"/>',
  ].filter(Boolean).join("");
  return `<w:p>${paragraphProps ? `<w:pPr>${paragraphProps}</w:pPr>` : ""}${runs}</w:p>`;
}

function docxList(node: HTMLElement, ordered: boolean, rels: DocxRels) {
  return Array.from(node.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li")
    .map((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : "• ";
      return docxParagraphFromRuns(`${docxRun(prefix)}${docxInlineRuns(item, rels)}`, undefined, { left: 720, hanging: 360 });
    })
    .join("");
}

function docxTable(table: HTMLElement, rels: DocxRels) {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return "";
  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="0" w:type="auto"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
        <w:left w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
        <w:right w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
      </w:tblBorders>
    </w:tblPr>
    ${rows.map((row) => docxTableRow(row, rels)).join("")}
  </w:tbl>`;
}

function docxTableRow(row: HTMLTableRowElement, rels: DocxRels) {
  return `<w:tr>${Array.from(row.cells).map((cell) => docxTableCell(cell, rels)).join("")}</w:tr>`;
}

const CELL_BLOCK_TAGS = new Set(["p", "ul", "ol", "blockquote", "table", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "div"]);

function docxTableCell(cell: HTMLTableCellElement, rels: DocxRels) {
  const isHeader = cell.tagName.toLowerCase() === "th";
  const hasBlockChild = Array.from(cell.children).some((child) =>
    CELL_BLOCK_TAGS.has(child.tagName.toLowerCase()),
  );
  const content = hasBlockChild
    ? Array.from(cell.childNodes).map((node) => docxBlockFromNode(node, rels)).join("")
    : docxParagraphFromRuns(docxInlineRuns(cell, rels, isHeader ? "<w:b/>" : ""));
  return `<w:tc>
    <w:tcPr>
      <w:tcW w:w="0" w:type="auto"/>
      ${isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F1F1"/>' : ""}
    </w:tcPr>
    ${content || docxParagraphFromRuns("")}
  </w:tc>`;
}

function docxRun(text: string, props = "") {
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

// Collapse runs of whitespace (including newlines) to a single space without
// trimming the edges. Trimming would destroy the spaces between adjacent inline
// runs (e.g. "<strong>X</strong> Y" → "XY" because the leading space on the
// text-node child got stripped).
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

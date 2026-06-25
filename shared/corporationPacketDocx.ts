import type { CORPORATION_DOCUMENT_PACKETS } from "./corporationDocumentPackets";
import { renderText, renderSections } from "./packetRendering";
import type { TemplateValues } from "./templateAssembly";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type CorporationDocumentPacket = (typeof CORPORATION_DOCUMENT_PACKETS)[number];

// Optional grammar/data context: when provided, packet prose renders through the
// template engine (shared/packetRendering.ts) so {token}/{#if}/{#each} markup
// binds. Omitted → token-free packets render byte-identically to before.
export function corporationPacketDocxBytes(packet: CorporationDocumentPacket, context?: TemplateValues) {
  return buildDocxPackage(packet.packageName, corporationPacketDocxBlocks(packet, context));
}

export function corporationPacketDocxDataUrl(packet: CorporationDocumentPacket, context?: TemplateValues) {
  const bytes = corporationPacketDocxBytes(packet, context);
  return `data:${DOCX_MIME_TYPE};base64,${base64FromBytes(bytes)}`;
}

export function corporationPacketDocxFileName(packet: CorporationDocumentPacket) {
  return `${slugifyForFile(packet.packageName)}.docx`;
}

export function corporationPacketDocxMimeType() {
  return DOCX_MIME_TYPE;
}

function corporationPacketDocxBlocks(packet: CorporationDocumentPacket, context?: TemplateValues) {
  const sections = renderSections(packet.sections, context);
  return [
    { kind: "title", text: packet.packageName },
    { kind: "paragraph", text: renderText(packet.summary, context) },
    { kind: "heading", text: "Deliverable" },
    { kind: "paragraph", text: renderText(packet.deliverable, context) },
    { kind: "heading", text: "Review terms" },
    { kind: "paragraph", text: renderText(packet.terms, context) },
    { kind: "heading", text: "Required data" },
    ...packet.requiredDataFields.map((text) => ({ kind: "listItem", text })),
    { kind: "heading", text: "Review data" },
    ...packet.reviewDataFields.map((text) => ({ kind: "listItem", text })),
    { kind: "heading", text: "Packet sections" },
    ...sections.flatMap((section) => [
      { kind: "heading", text: section.heading },
      ...section.body.map((text) => ({ kind: "paragraph", text })),
    ]),
    { kind: "heading", text: "Required signers" },
    ...(packet.requiredSigners?.length ? packet.requiredSigners : ["Review signing requirements before use."])
      .map((text) => ({ kind: "listItem", text })),
  ];
}

function buildDocxPackage(title: string, blocks: Array<{ kind: string; text: string }>) {
  return createStoredZip({
    "[Content_Types].xml": contentTypesXml(),
    "_rels/.rels": rootRelsXml(),
    "word/document.xml": documentXml(title, blocks),
    "word/styles.xml": stylesXml(),
  });
}

function documentXml(title: string, blocks: Array<{ kind: string; text: string }>) {
  const body = blocks.map(docxParagraph).join("") || docxParagraph({ kind: "title", text: title });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function docxParagraph(block: { kind: string; text: string }) {
  const style = block.kind === "title" ? "Title" : block.kind === "heading" ? "Heading1" : "Normal";
  const prefix = block.kind === "listItem" ? "- " : "";
  const runs = `${prefix}${block.text}`.split("\n").map((part, index) => `${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join("");
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:spacing w:after="120"/></w:pPr><w:r>${runs}</w:r></w:p>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:pPr><w:spacing w:after="240"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:pPr><w:spacing w:before="280" w:after="120"/></w:pPr></w:style>
</w:styles>`;
}

function createStoredZip(files: Record<string, string | Uint8Array>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const localHeader = concatBytes(
      le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), nameBytes,
    );
    const centralHeader = concatBytes(
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), nameBytes,
    );
    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(...centralParts);
  return concatBytes(
    ...localParts,
    centralDirectory,
    le32(0x06054b50), le16(0), le16(0), le16(centralParts.length), le16(centralParts.length), le32(centralDirectory.length), le32(offset), le16(0),
  );
}

function le16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function le32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function base64FromBytes(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += i + 1 < bytes.length ? alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] : "=";
    output += i + 2 < bytes.length ? alphabet[c & 63] : "=";
  }
  return output;
}

function slugifyForFile(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "corporation-packet";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

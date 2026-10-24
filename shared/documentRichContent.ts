/** Safe, portable rich document markup. No browser parser, scripts, CSS or remote images. */
export type DocumentRichNode = { type: "text"; value: string } | { type: "element"; tag: string; attrs: Record<string, string>; children: DocumentRichNode[] };
const tags = new Set(["p", "div", "span", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "img", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "td", "th", "hr", "blockquote"]);
const voidTags = new Set(["br", "img", "hr"]);
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function decodeDocumentEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[\da-f]{1,6});/gi, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const number = /^&#x/i.test(entity) ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : "";
  });
}
export function cleanDocumentImage(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 240000 || !/^data:image\/(?:png|jpeg);base64,[a-z\d+/]+={0,2}$/i.test(value)) throw new Error("Choose a PNG or JPEG image smaller than 175 KB.");
  const base64 = value.slice(value.indexOf(",") + 1);
  const png = /^iVBORw0KGgo/.test(base64), jpeg = /^\/9j\//.test(base64);
  if (/^data:image\/png;/i.test(value) ? !png : !jpeg) throw new Error("The image content does not match its PNG or JPEG type.");
  documentImageDimensions(value);
  return value;
}
export function documentImageDimensions(value: string): { width: number; height: number } {
  const raw = Uint8Array.from(atob(value.slice(value.indexOf(",") + 1)), (character) => character.charCodeAt(0));
  let width = 0, height = 0;
  if (/^data:image\/png;/i.test(value)) {
    const integer = (offset: number) => raw[offset] * 16777216 + raw[offset + 1] * 65536 + raw[offset + 2] * 256 + raw[offset + 3];
    width = integer(16); height = integer(20);
  } else {
    let cursor = 2;
    while (cursor + 8 < raw.length) {
      if (raw[cursor] !== 255) { cursor++; continue; }
      const marker = raw[cursor + 1]; cursor += 2;
      if (marker === 216 || marker === 217 || marker === 0) continue;
      const length = raw[cursor] * 256 + raw[cursor + 1];
      if (length < 2 || cursor + length > raw.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) { height = raw[cursor + 3] * 256 + raw[cursor + 4]; width = raw[cursor + 5] * 256 + raw[cursor + 6]; break; }
      cursor += length;
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 12000000) throw new Error("Use an image no larger than 4096 pixels per side or 12 megapixels.");
  return { width, height };
}
export function cleanDocumentLink(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020<>"']/u.test(value)) throw new Error("Use an HTTPS payment link or a mailto address.");
  if (value.startsWith("https://")) { try { const url = new URL(value); if (!url.hostname || url.username || url.password) throw new Error(); } catch { throw new Error("Use a valid HTTPS link."); } }
  else if (!/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) throw new Error("Use an HTTPS payment link or a mailto address.");
  return value;
}
export function parseDocumentHtml(value: unknown): DocumentRichNode[] {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string" || value.length > 1000000) throw new Error("Document rich content is too large.");
  if (value.replace(/data:image\/(?:png|jpeg);base64,[a-z\d+/=]+/gi, "").length > 20000) throw new Error("Keep document rich text below 20,000 characters.");
  const root: DocumentRichNode[] = [], stack: Array<{ tag: string; children: DocumentRichNode[] }> = [{ tag: "root", children: root }];
  const tokens = value.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join("") !== value) throw new Error("Invalid document markup.");
  let imageCount = 0;
  for (const token of tokens) {
    if (!token.startsWith("<")) { stack.at(-1)!.children.push({ type: "text", value: decodeDocumentEntities(token) }); continue; }
    const closing = token.match(/^<\/([a-z][a-z\d]*)\s*>$/i);
    if (closing) { const tag = closing[1].toLowerCase(); if (stack.length <= 1 || stack.at(-1)!.tag !== tag) throw new Error("Close document rich-text tags in order."); stack.pop(); continue; }
    const opening = token.match(/^<([a-z][a-z\d]*)([\s\S]*?)\/?\s*>$/i);
    if (!opening || !tags.has(opening[1].toLowerCase())) throw new Error("This document HTML tag is not supported.");
    const tag = opening[1].toLowerCase(), attrs: Record<string, string> = {};
    let attributes = opening[2].trim();
    while (attributes) {
      const attribute = attributes.match(/^([a-z][a-z\d-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/i);
      if (!attribute) throw new Error("Quote document HTML attribute values.");
      const key = attribute[1].toLowerCase(), entry = decodeDocumentEntities(attribute[2] ?? attribute[3]);
      if (key in attrs) throw new Error("Duplicate document HTML attribute.");
      if (tag === "a" && key === "href") attrs.href = cleanDocumentLink(entry);
      else if (tag === "img" && key === "src") { attrs.src = cleanDocumentImage(entry); if (++imageCount > 4) throw new Error("Use at most four images per rich section."); }
      else if ((key === "title" || tag === "img" && key === "alt") && entry.length <= 200) attrs[key] = entry;
      else if (tag === "img" && ["width", "height"].includes(key) && /^\d{1,3}$/.test(entry) && Number(entry) >= 8 && Number(entry) <= 800) attrs[key] = entry;
      else if (["p", "div", "span", "td", "th", "h1", "h2", "h3", "h4"].includes(tag) && key === "align" && ["left", "center", "right"].includes(entry)) attrs[key] = entry;
      else if (["td", "th"].includes(tag) && key === "colspan" && /^[1-9]$/.test(entry)) attrs[key] = entry;
      else throw new Error(`Unsupported document HTML attribute: ${key}.`);
      attributes = attributes.slice(attribute[0].length).trim();
    }
    if (tag === "img" && !attrs.src) throw new Error("Document images need PNG or JPEG data.");
    const node: DocumentRichNode = { type: "element", tag, attrs, children: [] };
    stack.at(-1)!.children.push(node);
    if (!voidTags.has(tag)) { if (stack.length > 20) throw new Error("Document HTML is nested too deeply."); stack.push(node); }
  }
  if (stack.length !== 1) throw new Error("Close document rich-text tags.");
  return root;
}
export function sanitizeDocumentHtml(value: unknown): string {
  const serialize = (node: DocumentRichNode): string => node.type === "text" ? escape(node.value) : `<${node.tag}${Object.entries(node.attrs).map(([key, item]) => ` ${key}="${escape(item)}"`).join("")}>${voidTags.has(node.tag) ? "" : `${node.children.map(serialize).join("")}</${node.tag}>`}`;
  return parseDocumentHtml(value).map(serialize).join("");
}
export function documentHtmlText(value: unknown): string {
  const flatten = (nodes: DocumentRichNode[]): string => nodes.map((node) => node.type === "text" ? node.value : node.tag === "img" ? node.attrs.alt || "" : `${flatten(node.children)}${["br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4"].includes(node.tag) ? "\n" : ""}`).join("");
  return flatten(parseDocumentHtml(value));
}

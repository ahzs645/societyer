/** Minimal, dependency-free XML reader for OOXML parts (DOCX/XLSX).
 * It is runtime-neutral (Node CLI, Convex node actions, browser, Electron) and
 * tolerant: it never evaluates DTDs or external entities, so a hostile document
 * cannot expand entities or reach the network. */
export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlChild[] };
export type XmlChild = XmlNode | string;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(source))) {
    const text = source.slice(last, match.index);
    if (text) stack[stack.length - 1].children.push(decodeXmlEntities(text));
    last = tag.lastIndex;
    if (match[5] !== undefined) {
      stack[stack.length - 1].children.push(match[5]);
      continue;
    }
    if (!match[2]) continue; // comment, processing instruction or doctype
    const [, closing, name, rawAttrs, selfClosing] = match;
    if (closing) {
      // Pop to the matching element; tolerate stray closers.
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].name === name) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const attr of rawAttrs.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[attr[1]] = decodeXmlEntities(attr[2] ?? attr[3] ?? "");
    }
    const node: XmlNode = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const tail = source.slice(last);
  if (tail.trim()) stack[stack.length - 1].children.push(decodeXmlEntities(tail));
  return root;
}

export const isNode = (child: XmlChild | undefined): child is XmlNode => typeof child === "object" && child !== null;
export const local = (name: string) => name.slice(name.indexOf(":") + 1);
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child): child is XmlNode => isNode(child) && local(child.name) === name);
}
export function firstChild(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node ? childrenNamed(node, name)[0] : undefined;
}
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const child of node.children) {
    if (!isNode(child)) continue;
    if (local(child.name) === name) out.push(child);
    descendants(child, name, out);
  }
  return out;
}
export function attr(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  if (node.attrs[name] !== undefined) return node.attrs[name];
  for (const [key, value] of Object.entries(node.attrs)) if (local(key) === name) return value;
  return undefined;
}
export function textContent(node: XmlChild): string {
  if (!isNode(node)) return node;
  return node.children.map(textContent).join("");
}

import { createElement, type ReactNode } from "react";
import { View, Text, Strong, Em, Link, Image, Table, Row, Cell, type Style } from "@formepdf/react";
import { parseDocumentHtml, type DocumentRichNode } from "../../../shared/documentRichContent";

/** Safe React elements from the same portable whitelist used for persisted templates. */
export function DocumentRichContent({ html }: { html: string }) {
  const render = (node: DocumentRichNode, index: number): ReactNode => {
    if (node.type === "text") return node.value;
    const attributes: Record<string, unknown> = { ...node.attrs };
    if (attributes.colspan) { attributes.colSpan = Number(attributes.colspan); delete attributes.colspan; }
    return createElement(node.tag, { key: index, ...attributes,
      ...(node.tag === "img" ? { alt: node.attrs.alt || "Document artwork", style: { maxWidth: "100%", objectFit: "contain" } } : {}),
      ...(node.attrs.align ? { style: { textAlign: node.attrs.align } } : {}),
    }, ...node.children.map(render));
  };
  return <div className="document-rich-content">{parseDocumentHtml(html).map(render)}</div>;
}
const inlineTags = new Set(["span", "strong", "b", "em", "i", "u", "a", "br"]);
function inline(node: DocumentRichNode, index: number): ReactNode {
  if (node.type === "text") return node.value;
  const children = node.children.map(inline);
  if (node.tag === "br") return "\n";
  if (["strong", "b"].includes(node.tag)) return <Strong key={index}>{children}</Strong>;
  if (["em", "i"].includes(node.tag)) return <Em key={index}>{children}</Em>;
  if (node.tag === "u") return <Strong key={index} style={{ fontWeight: 400, textDecoration: "underline" }}>{children}</Strong>;
  if (node.tag === "a" && node.attrs.href) return <Link key={index} href={node.attrs.href}>{children}</Link>;
  return children;
}
/** Native searchable rich text, inline emphasis/links, raster artwork and repeating tables. */
export function DocumentRichPdf({ html, style = {}, width = 500 }: { html: string; style?: Style; width?: number }) {
  const renderChildren = (nodes: DocumentRichNode[], inherited = style, available = width): ReactNode[] => {
    const rendered: ReactNode[] = []; let pending: DocumentRichNode[] = [];
    const flush = () => { if (pending.length) { rendered.push(<Text key={`inline-${rendered.length}`} style={inherited}>{pending.map(inline)}</Text>); pending = []; } };
    nodes.forEach((node, index) => {
      if (node.type === "text" || inlineTags.has(node.tag)) { pending.push(node); return; }
      flush();
      const key = `block-${index}`, aligned: Style = node.attrs.align ? { ...inherited, textAlign: node.attrs.align as "left" | "center" | "right" } : inherited;
      if (node.tag === "img") rendered.push(<Image key={key} src={node.attrs.src} width={Math.min(Number(node.attrs.width || available), available)} {...(node.attrs.height ? { height: Number(node.attrs.height) } : {})} alt={node.attrs.alt || "Document artwork"} />);
      else if (node.tag === "hr") rendered.push(<View key={key} style={{ borderBottomWidth: 0.5, borderColor: String(inherited.color || "#888888"), marginVertical: 4 }} />);
      else if (/^h[1-4]$/.test(node.tag)) rendered.push(<View key={key} style={{ marginBottom: 4 }}>{renderChildren(node.children, { ...aligned, fontWeight: 700, fontSize: Number(inherited.fontSize || 10) * ({ h1: 1.8, h2: 1.5, h3: 1.25, h4: 1.1 }[node.tag] || 1) }, available)}</View>);
      else if (node.tag === "ul" || node.tag === "ol") rendered.push(<View key={key}>{node.children.filter((child) => child.type === "element" && child.tag === "li").map((child, row) => <View key={row} style={{ flexDirection: "row", marginBottom: 3 }}><Text style={{ ...inherited, width: 18 }}>{node.tag === "ol" ? `${row + 1}.` : "•"}</Text><View style={{ flex: 1 }}>{renderChildren(child.type === "element" ? child.children : [], inherited, available - 18)}</View></View>)}</View>);
      else if (node.tag === "table") {
        const rows: Extract<DocumentRichNode, { type: "element" }>[] = [];
        const collect = (children: DocumentRichNode[]) => children.forEach((child) => { if (child.type === "element") { if (child.tag === "tr") rows.push(child); else collect(child.children); } });
        collect(node.children);
        const count = Math.max(1, ...rows.map((row) => row.children.reduce((sum, cell) => sum + (cell.type === "element" && ["td", "th"].includes(cell.tag) ? Number(cell.attrs.colspan || 1) : 0), 0)));
        rendered.push(<Table key={key} columns={Array.from({ length: count }, () => ({ width: { fixed: available / count } }))}>{rows.map((row, rowIndex) => <Row key={rowIndex} header={row.children.some((cell) => cell.type === "element" && cell.tag === "th")}>{row.children.filter((cell) => cell.type === "element" && ["td", "th"].includes(cell.tag)).map((cell, cellIndex) => cell.type === "element" && <Cell key={cellIndex} colSpan={Number(cell.attrs.colspan || 1)} style={{ padding: 3, borderBottomWidth: 0.4, borderColor: "#d4d4d8" }}>{renderChildren(cell.children, { ...inherited, ...(cell.tag === "th" ? { fontWeight: 700 } : {}), ...(cell.attrs.align ? { textAlign: cell.attrs.align as "left" | "center" | "right" } : {}) }, available / count * Number(cell.attrs.colspan || 1) - 6)}</Cell>)}</Row>)}</Table>);
      } else rendered.push(<View key={key} style={{ marginBottom: ["p", "div", "blockquote"].includes(node.tag) ? 4 : 0, ...(node.tag === "blockquote" ? { paddingLeft: 12, borderLeftWidth: 1, borderColor: "#bbbbbb" } : {}) }}>{renderChildren(node.children, aligned, available)}</View>);
    });
    flush(); return rendered;
  };
  return <View>{renderChildren(parseDocumentHtml(html))}</View>;
}

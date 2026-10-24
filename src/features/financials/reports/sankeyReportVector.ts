import type { SankeyLinkInput, SankeyNodeInput, SankeyTone } from "../../../components/charts/SankeyChart";

const COLORS: Record<SankeyTone, string> = { in: "#16745b", out: "#b44b55", neutral: "#264969", muted: "#9ba7b3" };

/** Passive geometry from the same node/link model as the interactive cash-flow chart. */
export function sankeyReportVector(nodes: SankeyNodeInput[], inputLinks: SankeyLinkInput[], width = 500, height = 300, currency = "CAD") {
  const links = inputLinks.filter((link) => Number.isFinite(link.value) && link.value > 0);
  const incoming = new Map<string, number>(), outgoing = new Map<string, number>();
  for (const link of links) {
    incoming.set(link.target, (incoming.get(link.target) ?? 0) + link.value);
    outgoing.set(link.source, (outgoing.get(link.source) ?? 0) + link.value);
  }
  const value = (id: string) => Math.max(incoming.get(id) ?? 0, outgoing.get(id) ?? 0);
  const last = Math.max(0, ...nodes.map((node) => node.column));
  const columns = Array.from({ length: last + 1 }, (_, column) => nodes.filter((node) => node.column === column && value(node.id) > 0));
  const gap = 10, pad = 8, gutter = 110, nodeWidth = 10;
  const rawScale = Math.min(...columns.filter((column) => column.length).map((column) => (height - 2 * pad - gap * Math.max(0, column.length - 1)) / column.reduce((sum, node) => sum + value(node.id), 0)));
  const scale = Number.isFinite(rawScale) ? Math.max(0, rawScale) : 0;
  type Node = SankeyNodeInput & { x: number; y: number; h: number };
  const laid = new Map<string, Node>();
  columns.forEach((column, index) => {
    const used = column.reduce((sum, node) => sum + value(node.id) * scale, 0) + gap * Math.max(0, column.length - 1);
    let y = Math.max(pad, (height - used) / 2);
    for (const node of column) {
      const h = value(node.id) * scale;
      laid.set(node.id, { ...node, x: gutter + index * (width - 2 * gutter - nodeWidth) / Math.max(1, last), y, h });
      y += h + gap;
    }
  });
  const usedOut = new Map<string, number>(), usedIn = new Map<string, number>();
  const n = (value: number) => String(Number(value.toFixed(3)));
  const paths: string[] = [];
  for (const link of links) {
    const source = laid.get(link.source), target = laid.get(link.target);
    if (!source || !target) continue;
    const x1 = source.x + nodeWidth, x2 = target.x, dx = (x2 - x1) / 2;
    const y1 = source.y + (usedOut.get(source.id) ?? 0), y2 = target.y + (usedIn.get(target.id) ?? 0), h = link.value * scale;
    usedOut.set(source.id, (usedOut.get(source.id) ?? 0) + h);
    usedIn.set(target.id, (usedIn.get(target.id) ?? 0) + h);
    const path = `M${n(x1)} ${n(y1)}C${n(x1 + dx)} ${n(y1)} ${n(x2 - dx)} ${n(y2)} ${n(x2)} ${n(y2)}L${n(x2)} ${n(y2 + h)}C${n(x2 - dx)} ${n(y2 + h)} ${n(x1 + dx)} ${n(y1 + h)} ${n(x1)} ${n(y1 + h)}Z`;
    paths.push(`<path d="${path}" fill="${COLORS[source.tone === "neutral" ? target.tone : source.tone]}" opacity="0.35"/>`);
  }
  const rectangles = [...laid.values()].map((node) => `<rect x="${n(node.x)}" y="${n(node.y)}" width="${nodeWidth}" height="${n(node.h)}" fill="${COLORS[node.tone]}"/>`);
  const annotations: Array<{ text: string; x: number; y: number; width: number; align: "left" | "center" | "right" }> = [];
  for (const column of columns) {
    const placed = column.map((node) => laid.get(node.id)!);
    const positions = placed.map((node) => node.y + node.h / 2 - 12);
    for (let i = 1; i < positions.length; i++) positions[i] = Math.max(positions[i], positions[i - 1] + 32);
    if (positions.length && positions.at(-1)! > height - 30) {
      positions[positions.length - 1] = height - 30;
      for (let i = positions.length - 2; i >= 0; i--) positions[i] = Math.min(positions[i], positions[i + 1] - 32);
    }
    placed.forEach((node, index) => {
      const label = node.label.length > 36 ? `${node.label.slice(0, 33)}…` : node.label;
      const amount = new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value(node.id) / 100);
      annotations.push({ text: `${label}\n${amount}`, x: node.column === 0 ? 0 : node.column === last ? node.x + nodeWidth + 6 : node.x + nodeWidth + 4, y: Math.max(0, positions[index]), width: node.column === 0 || node.column === last ? gutter - 8 : 90, align: node.column === 0 ? "right" : "left" });
    });
  }
  return { width, height, content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${paths.join("")}${rectangles.join("")}</svg>`, annotations };
}

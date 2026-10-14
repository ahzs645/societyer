import { useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { formatMoney, formatMoneyCompact } from "../../lib/money";
import { ChartTooltip } from "./ChartTooltip";
import { useElementWidth } from "./hooks";
import { estimateTextWidth } from "./scales";
import type { TooltipRow, ValueFormatter } from "./types";

/**
 * Hand-rolled Sankey (flow) diagram: columns of nodes joined by bands whose
 * thickness is the amount moving between them. Built for money in → funds →
 * money out, but nothing here is finance-specific.
 *
 * Colour carries direction only (money in, money out, a neutral middle and a
 * recessive balancing node); every node is direct-labelled with its name and
 * amount, so identity never rests on colour. Below `compactWidth` the diagram
 * becomes two ranked bar lists, which read far better on a phone.
 */

export type SankeyTone = "in" | "out" | "neutral" | "muted";

export type SankeyNodeInput = {
  id: string;
  label: string;
  column: number;
  tone: SankeyTone;
  /** Clicking (or Enter) reports the node through `onSelect`. */
  selectable?: boolean;
  /** Extra tooltip lines, e.g. refunds netted or a transaction count. */
  details?: Array<{ label: string; value: string }>;
};

export type SankeyLinkInput = { source: string; target: string; value: number };

type LaidNode = SankeyNodeInput & { value: number; x: number; y: number; h: number; labelY: number; displayLabel: string };
type LaidLink = SankeyLinkInput & { index: number; path: string; width: number; sy: number; ty: number; tone: SankeyTone };

type Active = { kind: "node"; id: string } | { kind: "link"; index: number };

const TONE_COLOR: Record<SankeyTone, string> = {
  in: "var(--dv-in)",
  out: "var(--dv-out)",
  neutral: "var(--dv-net)",
  muted: "var(--dv-previous)",
};

const NODE_W = 10;
const MIN_GAP = 14;
const LABEL_STEP = 32;
const HEAD_H = 22;
const PAD_Y = 6;

export type SankeyChartProps = {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
  ariaLabel: string;
  /** Column headings, e.g. ["Money in", "Funds", "Money out"]. */
  columnTitles?: string[];
  /** How shares are worded for the first and last columns. */
  shareLabels?: { first: string; last: string };
  formatValue?: ValueFormatter;
  formatCompact?: ValueFormatter;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  height?: number;
  /** Container width below which the ranked-bars layout is used. */
  compactWidth?: number;
};

function percent(value: number, base: number) {
  if (!base) return "—";
  const pct = (value / base) * 100;
  return `${pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%`;
}

function truncate(label: string, maxWidth: number) {
  if (estimateTextWidth(label) <= maxWidth) return label;
  const chars = Math.max(3, Math.floor(maxWidth / 6.6) - 1);
  return `${label.slice(0, chars).trimEnd()}…`;
}

/** Spread label centres so two-line labels never overlap, keeping them in bounds. */
function spreadLabels(centres: number[], top: number, bottom: number) {
  const ys = [...centres];
  for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i], ys[i - 1] + LABEL_STEP);
  const overflow = ys.length ? ys[ys.length - 1] - bottom : 0;
  if (overflow > 0) {
    ys[ys.length - 1] -= overflow;
    for (let i = ys.length - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i], ys[i + 1] - LABEL_STEP);
  }
  return ys.map((y) => Math.max(top, y));
}

function useSankeyLayout(nodesIn: SankeyNodeInput[], linksIn: SankeyLinkInput[], width: number, height: number, formatCompact: ValueFormatter) {
  return useMemo(() => {
    const links = linksIn.filter((link) => link.value > 0);
    const valueIn = new Map<string, number>();
    const valueOut = new Map<string, number>();
    for (const link of links) {
      valueOut.set(link.source, (valueOut.get(link.source) ?? 0) + link.value);
      valueIn.set(link.target, (valueIn.get(link.target) ?? 0) + link.value);
    }
    const lastColumn = Math.max(0, ...nodesIn.map((node) => node.column));
    const columns: SankeyNodeInput[][] = Array.from({ length: lastColumn + 1 }, () => []);
    for (const node of nodesIn) {
      if (Math.max(valueIn.get(node.id) ?? 0, valueOut.get(node.id) ?? 0) > 0) columns[node.column].push(node);
    }
    const valueOf = (id: string) => Math.max(valueIn.get(id) ?? 0, valueOut.get(id) ?? 0);

    // Label gutters sized to the widest first/last-column label (name or amount).
    const gutter = (column: SankeyNodeInput[]) =>
      Math.min(Math.max(72, ...column.map((node) => Math.max(estimateTextWidth(node.label), estimateTextWidth(formatCompact(valueOf(node.id)))) + 14)), Math.round(width * 0.3));
    const left = gutter(columns[0] ?? []);
    const right = lastColumn > 0 ? gutter(columns[lastColumn] ?? []) : 0;
    const innerW = Math.max(40, width - left - right);
    const columnX = (column: number) => (lastColumn === 0 ? left : left + ((innerW - NODE_W) * column) / lastColumn);

    const top = HEAD_H + PAD_Y;
    const plotH = Math.max(60, height - top - PAD_Y);
    let k = Infinity;
    for (const column of columns) {
      const total = column.reduce((sum, node) => sum + valueOf(node.id), 0);
      if (!total) continue;
      k = Math.min(k, (plotH - MIN_GAP * Math.max(0, column.length - 1)) / total);
    }
    if (!Number.isFinite(k) || k <= 0) k = 0;

    const laid = new Map<string, LaidNode>();
    const ordered: LaidNode[] = [];
    columns.forEach((column, c) => {
      const total = column.reduce((sum, node) => sum + valueOf(node.id), 0);
      const used = total * k + MIN_GAP * Math.max(0, column.length - 1);
      let y = top + Math.max(0, (plotH - used) / 2);
      const placed = column.map((node) => {
        const value = valueOf(node.id);
        const h = Math.max(1, value * k);
        const entry: LaidNode = { ...node, value, x: columnX(c), y, h, labelY: y + h / 2, displayLabel: node.label };
        y += h + MIN_GAP;
        return entry;
      });
      if (c === 0 || c === lastColumn) {
        const ys = spreadLabels(placed.map((node) => node.y + node.h / 2), top + 10, top + plotH - 10);
        placed.forEach((node, i) => {
          node.labelY = ys[i];
          node.displayLabel = truncate(node.label, (c === 0 ? left : right) - 14);
        });
      } else {
        const room = (innerW - NODE_W) / Math.max(1, lastColumn) / 2 - 14;
        placed.forEach((node) => {
          node.displayLabel = truncate(node.label, room);
        });
      }
      for (const node of placed) {
        laid.set(node.id, node);
        ordered.push(node);
      }
    });

    // Stack each node's bands in the order of the nodes at their other end,
    // which keeps crossings to a minimum.
    const outOffset = new Map<string, number>();
    const inOffset = new Map<string, number>();
    const sorted = links
      .map((link, index) => ({ link, index }))
      .filter(({ link }) => laid.has(link.source) && laid.has(link.target))
      .sort((a, b) => laid.get(a.link.target)!.y - laid.get(b.link.target)!.y);
    const sy = new Map<number, number>();
    for (const { link, index } of sorted) {
      const source = laid.get(link.source)!;
      const offset = outOffset.get(link.source) ?? 0;
      sy.set(index, source.y + offset);
      outOffset.set(link.source, offset + link.value * k);
    }
    const bySource = [...sorted].sort((a, b) => laid.get(a.link.source)!.y - laid.get(b.link.source)!.y);
    const laidLinks: LaidLink[] = [];
    for (const { link, index } of bySource) {
      const source = laid.get(link.source)!;
      const target = laid.get(link.target)!;
      const offset = inOffset.get(link.target) ?? 0;
      const ty = target.y + offset;
      inOffset.set(link.target, offset + link.value * k);
      const w = Math.max(1, link.value * k);
      const s = sy.get(index)!;
      const x0 = source.x + NODE_W;
      const x1 = target.x;
      const xm = (x0 + x1) / 2;
      const path = `M${x0},${s}C${xm},${s} ${xm},${ty} ${x1},${ty}L${x1},${ty + w}C${xm},${ty + w} ${xm},${s + w} ${x0},${s + w}Z`;
      // A band wears the colour of its category end.
      const tone = source.column === 0 ? source.tone : target.column === lastColumn ? target.tone : "neutral";
      laidLinks.push({ ...link, index, path, width: w, sy: s, ty, tone });
    }

    const columnTotal = (c: number) => (columns[c] ?? []).filter((node) => node.tone !== "muted").reduce((sum, node) => sum + valueOf(node.id), 0);
    return { nodes: ordered, byId: laid, links: laidLinks, left, right, innerW, lastColumn, columnX, columnTotal, top, plotH };
  }, [formatCompact, height, linksIn, nodesIn, width]);
}

type SankeyGeometry = ReturnType<typeof useSankeyLayout>;

/**
 * Share of a node, worded from the side it belongs to. A balancing node
 * (muted) is measured against the opposite side: "from cash on hand" pays for
 * part of the money out; a "net increase" keeps part of the money in.
 */
function shareOf(geo: SankeyGeometry, node: LaidNode, labels: { first: string; last: string }) {
  if (node.column === 0) return node.tone === "muted" ? { base: geo.columnTotal(geo.lastColumn), label: labels.last } : { base: geo.columnTotal(0), label: labels.first };
  if (node.column === geo.lastColumn) return node.tone === "muted" ? { base: geo.columnTotal(0), label: labels.first } : { base: geo.columnTotal(geo.lastColumn), label: labels.last };
  return null;
}

/** Tooltip content for whatever is hovered or keyboard-focused. */
function sankeyTooltip(geo: SankeyGeometry, active: Active, pointer: { x: number; y: number } | null, labels: { first: string; last: string }, formatValue: ValueFormatter) {
  if (active.kind === "node") {
    const node = geo.byId.get(active.id);
    if (!node) return null;
    const share = shareOf(geo, node, labels);
    const rows: TooltipRow[] = [{ key: "amount", label: "Amount", value: formatValue(node.value), color: TONE_COLOR[node.tone], swatch: "bar" }];
    if (share) rows.push({ key: "share", label: share.label, value: percent(node.value, share.base), color: "transparent" });
    for (const detail of node.details ?? []) rows.push({ key: detail.label, label: detail.label, value: detail.value, color: "transparent" });
    const anchorX = node.column === geo.lastColumn ? node.x : node.x + NODE_W;
    return { x: pointer?.x ?? anchorX, y: Math.max(0, (pointer?.y ?? node.y) - 8), title: node.label, rows };
  }
  const link = geo.links.find((l) => l.index === active.index);
  if (!link) return null;
  const source = geo.byId.get(link.source)!;
  const target = geo.byId.get(link.target)!;
  // A band is measured against the side of its category end.
  const end = source.column === 0 ? source : target;
  const share = shareOf(geo, end, labels);
  const rows: TooltipRow[] = [{ key: "amount", label: "Amount", value: formatValue(link.value), color: TONE_COLOR[link.tone], swatch: "bar" }];
  if (share) rows.push({ key: "share", label: share.label, value: percent(link.value, share.base), color: "transparent" });
  if (end.value !== link.value) rows.push({ key: "of-end", label: `of ${end.label}`, value: percent(link.value, end.value), color: "transparent" });
  return { x: pointer?.x ?? (source.x + target.x) / 2, y: Math.max(0, (pointer?.y ?? link.sy) - 8), title: `${source.label} → ${target.label}`, rows };
}

export function SankeyChart({
  nodes,
  links,
  ariaLabel,
  columnTitles,
  shareLabels = { first: "of money in", last: "of money out" },
  formatValue = (v) => formatMoney(v),
  formatCompact = (v) => formatMoneyCompact(v),
  selectedId = null,
  onSelect,
  height: heightProp,
  compactWidth = 560,
}: SankeyChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<Active | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const tallest = Math.max(1, ...Array.from({ length: 3 }, (_, c) => nodes.filter((node) => node.column === c).length));
  const height = heightProp ?? Math.min(480, Math.max(260, tallest * 40 + HEAD_H + 24));
  const compact = width > 0 && width < compactWidth;
  const geo = useSankeyLayout(nodes, links, compact ? 0 : width, height, formatCompact);

  const shareFor = (node: LaidNode) => shareOf(geo, node, shareLabels);

  const describeNode = (node: LaidNode) => {
    const share = shareFor(node);
    return `${node.label}: ${formatValue(node.value)}${share ? `, ${percent(node.value, share.base)} ${share.label}` : ""}${node.details?.length ? `. ${node.details.map((d) => `${d.label} ${d.value}`).join(", ")}` : ""}`;
  };

  const related = useMemo(() => {
    const focus: Active | null = active ?? (selectedId ? { kind: "node", id: selectedId } : null);
    if (!focus) return null;
    if (focus.kind === "link") return { links: new Set([focus.index]), nodes: new Set<string>() };
    const linkSet = new Set(geo.links.filter((link) => link.source === focus.id || link.target === focus.id).map((link) => link.index));
    const nodeSet = new Set<string>([focus.id]);
    for (const link of geo.links) if (linkSet.has(link.index)) nodeSet.add(link.source === focus.id ? link.target : link.source);
    return { links: linkSet, nodes: nodeSet };
  }, [active, geo.links, selectedId]);

  const keyboardOrder = geo.nodes;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (compact || !keyboardOrder.length) return;
    const currentIndex = active?.kind === "node" ? keyboardOrder.findIndex((node) => node.id === active.id) : -1;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(keyboardOrder.length - 1, currentIndex + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = currentIndex <= 0 ? 0 : currentIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = keyboardOrder.length - 1;
    else if ((event.key === "Enter" || event.key === " ") && currentIndex >= 0) {
      const node = keyboardOrder[currentIndex];
      if (node.selectable && onSelect) {
        event.preventDefault();
        onSelect(selectedId === node.id ? null : node.id);
      }
      return;
    } else if (event.key === "Escape") {
      if (active) setActive(null);
      else if (selectedId && onSelect) onSelect(null);
      return;
    }
    if (next == null) return;
    event.preventDefault();
    setPointer(null);
    setActive({ kind: "node", id: keyboardOrder[next].id });
    setAnnouncement(describeNode(keyboardOrder[next]));
  };

  const trackPointer = (event: ReactPointerEvent<SVGElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    setPointer({ x: event.clientX - box.left, y: event.clientY - box.top });
  };

  const tooltip = active && !compact ? sankeyTooltip(geo, active, pointer, shareLabels, formatValue) : null;

  const select = (node: LaidNode | SankeyNodeInput) => {
    if (!node.selectable || !onSelect) return;
    onSelect(selectedId === node.id ? null : node.id);
  };

  return (
    <div className={`chart chart--sankey${compact ? " is-compact" : ""}`}>
      <div
        className="chart__plot"
        ref={containerRef}
        style={compact ? undefined : { height }}
        tabIndex={compact ? undefined : 0}
        role={compact ? undefined : "group"}
        aria-label={compact ? undefined : `${ariaLabel}. Use the arrow keys to read each amount${onSelect ? "; Enter filters to a category" : ""}.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {compact ? (
          <SankeyBars nodes={nodes} links={links} columnTitles={columnTitles} shareLabels={shareLabels} formatValue={formatValue} selectedId={selectedId} onSelect={onSelect ? select : undefined} ariaLabel={ariaLabel} />
        ) : width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => { setActive(null); setPointer(null); }}>
            {columnTitles && <SankeyHeads geo={geo} titles={columnTitles} formatCompact={formatCompact} />}
            <g className="sankey__links">
              {geo.links.map((link) => {
                const dim = related ? !related.links.has(link.index) : false;
                const on = related ? related.links.has(link.index) : false;
                return (
                  <path
                    key={link.index}
                    d={link.path}
                    className={`sankey__link sankey__link--${link.tone}${dim ? " is-dimmed" : ""}${on ? " is-on" : ""}`}
                    onPointerEnter={(event) => { trackPointer(event); setActive({ kind: "link", index: link.index }); }}
                    onPointerMove={trackPointer}
                  />
                );
              })}
            </g>
            <g className="sankey__nodes">
              {geo.nodes.map((node) => {
                const dim = related ? !related.nodes.has(node.id) : false;
                const isSelected = selectedId === node.id;
                const isFirst = node.column === 0;
                const isLast = node.column === geo.lastColumn && geo.lastColumn > 0;
                const labelX = isFirst ? node.x - 8 : isLast ? node.x + NODE_W + 8 : node.x + NODE_W + 6;
                const anchor = isFirst ? "end" : "start";
                const middle = !isFirst && !isLast;
                const labelY = middle ? node.y + node.h / 2 : node.labelY;
                return (
                  <g
                    key={node.id}
                    className={`sankey__node sankey__node--${node.tone}${dim ? " is-dimmed" : ""}${isSelected ? " is-selected" : ""}${node.selectable && onSelect ? " is-selectable" : ""}${active?.kind === "node" && active.id === node.id ? " is-active" : ""}`}
                    onPointerEnter={(event) => { trackPointer(event); setActive({ kind: "node", id: node.id }); }}
                    onPointerMove={trackPointer}
                    onClick={() => select(node)}
                  >
                    {/* Generous invisible hit target around thin nodes and their labels. */}
                    <rect className="sankey__hit" x={isFirst ? node.x - geo.left : node.x - 4} y={Math.min(node.y, labelY - 14) - 2} width={isFirst ? geo.left + NODE_W : isLast ? geo.right + NODE_W : NODE_W + 8} height={Math.max(node.h, 28) + 4} />
                    <rect className="sankey__bar" x={node.x} y={node.y} width={NODE_W} height={node.h} rx={2} />
                    {isSelected && <rect className="sankey__ring" x={node.x - 3} y={node.y - 3} width={NODE_W + 6} height={node.h + 6} rx={4} />}
                    <text x={labelX} y={labelY} textAnchor={anchor} className={`sankey__label${middle ? " sankey__label--middle" : ""}`}>
                      <tspan x={labelX} dy={middle ? "-0.2em" : "-0.15em"} className="sankey__name">{node.displayLabel}</tspan>
                      <tspan x={labelX} dy="1.25em" className="sankey__value">{formatCompact(node.value)}</tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {tooltip && <ChartTooltip x={tooltip.x} y={tooltip.y} containerWidth={width} title={tooltip.title} rows={tooltip.rows} />}
        <span className="sr-only" aria-live="polite">{announcement}</span>
      </div>
    </div>
  );
}

/** Column headings, with the side totals on the first and last columns. */
function SankeyHeads({ geo, titles, formatCompact }: { geo: SankeyGeometry; titles: string[]; formatCompact: ValueFormatter }) {
  return (
    <g className="sankey__heads" aria-hidden="true">
      {titles.map((title, c) => {
        if (c > geo.lastColumn) return null;
        const x = c === 0 ? geo.columnX(0) + NODE_W : c === geo.lastColumn ? geo.columnX(c) : geo.columnX(c) + NODE_W / 2;
        const anchor = c === 0 ? "end" : c === geo.lastColumn ? "start" : "middle";
        const total = c === 0 || c === geo.lastColumn ? geo.columnTotal(c) : null;
        return (
          <text key={title} x={x} y={14} textAnchor={anchor} className="sankey__head">
            {title}
            {total != null && <tspan className="sankey__head-total" dx={6}>{formatCompact(total)}</tspan>}
          </text>
        );
      })}
    </g>
  );
}

/**
 * Phone layout: the first and last columns as ranked bar lists, with the
 * middle column summarised in one line between them.
 */
function SankeyBars({
  nodes,
  links,
  columnTitles,
  shareLabels,
  formatValue,
  selectedId,
  onSelect,
  ariaLabel,
}: {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
  columnTitles?: string[];
  shareLabels: { first: string; last: string };
  formatValue: ValueFormatter;
  selectedId: string | null;
  onSelect?: (node: SankeyNodeInput) => void;
  ariaLabel: string;
}) {
  const values = new Map<string, number>();
  const valueIn = new Map<string, number>();
  const valueOut = new Map<string, number>();
  for (const link of links) {
    if (link.value <= 0) continue;
    valueOut.set(link.source, (valueOut.get(link.source) ?? 0) + link.value);
    valueIn.set(link.target, (valueIn.get(link.target) ?? 0) + link.value);
  }
  for (const node of nodes) values.set(node.id, Math.max(valueIn.get(node.id) ?? 0, valueOut.get(node.id) ?? 0));
  const lastColumn = Math.max(0, ...nodes.map((node) => node.column));
  const columnNodes = (c: number) => nodes.filter((node) => node.column === c && (values.get(node.id) ?? 0) > 0);
  const total = (c: number) => columnNodes(c).filter((node) => node.tone !== "muted").reduce((sum, node) => sum + (values.get(node.id) ?? 0), 0);
  const middles = nodes.filter((node) => node.column > 0 && node.column < lastColumn && (values.get(node.id) ?? 0) > 0);
  const scale = Math.max(1, ...nodes.filter((node) => node.column === 0 || node.column === lastColumn).map((node) => values.get(node.id) ?? 0));

  const renderSide = (c: number) => {
    const sideTotal = total(c);
    const opposite = total(c === 0 ? lastColumn : 0);
    return (
      <section className="sankey-bars__side" aria-label={columnTitles?.[c]}>
        {columnTitles?.[c] && (
          <h3 className="sankey-bars__title">
            <span>{columnTitles[c]}</span>
            <strong>{formatValue(sideTotal)}</strong>
          </h3>
        )}
        <ul className="sankey-bars__list">
          {columnNodes(c).map((node) => {
            const value = values.get(node.id) ?? 0;
            const muted = node.tone === "muted";
            const share = muted ? percent(value, opposite) : percent(value, sideTotal);
            const shareLabel = muted ? (c === 0 ? shareLabels.last : shareLabels.first) : c === 0 ? shareLabels.first : shareLabels.last;
            const body = (
              <>
                <span className="sankey-bars__head">
                  <span className="sankey-bars__label">{node.label}</span>
                  <span className="sankey-bars__amount">{formatValue(value)}</span>
                </span>
                <span className="sankey-bars__track" aria-hidden="true">
                  <span className={`sankey-bars__fill sankey-bars__fill--${node.tone}`} style={{ width: `${Math.max(1, (value / scale) * 100)}%` }} />
                </span>
                <span className="sankey-bars__share">{share} {shareLabel}</span>
              </>
            );
            return (
              <li key={node.id}>
                {node.selectable && onSelect ? (
                  <button type="button" className={`sankey-bars__row${selectedId === node.id ? " is-selected" : ""}`} aria-pressed={selectedId === node.id} onClick={() => onSelect(node)}>
                    {body}
                  </button>
                ) : (
                  <div className="sankey-bars__row sankey-bars__row--static">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  return (
    <div className="sankey-bars" role="group" aria-label={ariaLabel}>
      {renderSide(0)}
      {middles.length > 0 && (
        <p className="sankey-bars__through">
          {columnTitles?.[1] ? `${columnTitles[1]}: ` : ""}
          {middles.map((node, i) => (
            <span key={node.id}>
              {i > 0 && " · "}
              {node.label} {formatValue(values.get(node.id) ?? 0)}
            </span>
          ))}
        </p>
      )}
      {lastColumn > 0 && renderSide(lastColumn)}
    </div>
  );
}

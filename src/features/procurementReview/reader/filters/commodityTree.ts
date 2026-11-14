/**
 * The UNSPSC hierarchy behind the commodity code picker. A code's level and
 * parent follow from its digits: segment 72000000 → family 72100000 → class
 * 72101500 → commodity 72101507. A tree is built either from the full code
 * list (the catalog service's, ~90k terms) or, where there is none, from the
 * codes the loaded notices carry, titled where the notices name them.
 *
 * Loaded only with the picker (CommodityPicker.tsx), never with the list.
 */
import { matchesBcBidSourceFilters, unspscPrefix, type BcBidSourceFilters } from "../../../../../shared/bcBidSourceFilters";
import type { ListRow, TaxonomyCodeList } from "../source";

export const LEVEL_NAMES = ["Segment", "Family", "Class", "Commodity"] as const;

/** 0 segment, 1 family, 2 class, 3 commodity. */
export function unspscLevel(code: string): number {
  return code.endsWith("000000") ? 0 : code.endsWith("0000") ? 1 : code.endsWith("00") ? 2 : 3;
}

export function unspscParent(code: string): string | null {
  const level = unspscLevel(code);
  return level === 0 ? null : code.slice(0, 2 * level).padEnd(8, "0");
}

/** Root first, without the code itself. */
export function unspscAncestors(code: string): string[] {
  const chain: string[] = [];
  for (let parent = unspscParent(code); parent; parent = unspscParent(parent)) chain.unshift(parent);
  return chain;
}

export type CommodityNode = { code: string; title: string; level: number; children: string[] };
export type CommodityTree = {
  nodes: Map<string, CommodityNode>;
  roots: string[];
  /** The whole release (from the service), not just the codes notices carry. */
  complete: boolean;
  version?: string;
};

const isCode = (value: unknown): value is string => typeof value === "string" && /^\d{8}$/.test(value);

function link(nodes: Map<string, CommodityNode>, complete: boolean, version?: string): CommodityTree {
  // Any code whose parent is missing gets an untitled parent, so every code sits on a path from a segment.
  for (const code of [...nodes.keys()]) {
    for (const ancestor of unspscAncestors(code)) {
      if (!nodes.has(ancestor)) nodes.set(ancestor, { code: ancestor, title: "", level: unspscLevel(ancestor), children: [] });
    }
  }
  const roots: string[] = [];
  for (const code of [...nodes.keys()].sort()) {
    const parent = unspscParent(code);
    if (parent) nodes.get(parent)!.children.push(code);
    else roots.push(code);
  }
  return { nodes, roots, complete, version };
}

export function treeFromList(list: TaxonomyCodeList): CommodityTree {
  const nodes = new Map<string, CommodityNode>();
  for (const [code, title] of list.terms) if (isCode(code)) nodes.set(code, { code, title, level: unspscLevel(code), children: [] });
  return link(nodes, true, list.version);
}

type Classification = { code?: unknown; title?: unknown; ancestors?: { code?: unknown; title?: unknown }[] };
type CommodityFacts = { classificationCodes?: unknown; commodityClassifications?: unknown };

function facts(row: ListRow): CommodityFacts {
  try {
    const parsed: unknown = JSON.parse(row.analyticsJson || "{}");
    return parsed && typeof parsed === "object" ? (parsed as CommodityFacts) : {};
  } catch {
    return {};
  }
}

/** Titles the notices themselves give their codes and those codes' ancestors (the demo keeps them; the service's thin list doesn't). */
export function titlesFromRows(rows: readonly ListRow[], only?: string): Map<string, string> {
  const titles = new Map<string, string>();
  const note = (code: unknown, title: unknown) => {
    if (isCode(code) && typeof title === "string" && title && (!only || code === only)) titles.set(code, title);
  };
  for (const row of rows) {
    if (!row.analyticsJson?.includes("commodityClassifications")) continue;
    const list = facts(row).commodityClassifications;
    if (!Array.isArray(list)) continue;
    for (const entry of list as Classification[]) {
      note(entry?.code, entry?.title);
      if (Array.isArray(entry?.ancestors)) for (const ancestor of entry.ancestors) note(ancestor?.code, ancestor?.title);
    }
    if (only && titles.has(only)) break;
  }
  return titles;
}

/** The fallback tree: the codes the loaded notices carry, with their ancestors. */
export function treeFromRows(rows: readonly ListRow[]): CommodityTree {
  const titles = titlesFromRows(rows);
  const nodes = new Map<string, CommodityNode>();
  for (const row of rows) {
    const codes = facts(row).classificationCodes;
    if (!Array.isArray(codes)) continue;
    for (const code of codes) if (isCode(code) && !nodes.has(code)) nodes.set(code, { code, title: "", level: unspscLevel(code), children: [] });
  }
  const tree = link(nodes, false);
  for (const node of tree.nodes.values()) node.title = titles.get(node.code) ?? "";
  return tree;
}

/**
 * How many of `rows` each code would show, as the filter matches (shared
 * matcher, prefix rules): a notice counts once under each code it falls
 * under. `filters` are the draft's other BC Bid filters.
 */
export function noticeCounts(rows: readonly ListRow[], filters: BcBidSourceFilters): Map<string, number> {
  const others: BcBidSourceFilters = { ...filters };
  delete others.commodityCode;
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.analyticsJson?.includes("classificationCodes") || !matchesBcBidSourceFilters(row, others)) continue;
    const data = facts(row) as CommodityFacts & { historicalTypeReferenceId?: unknown; taxonomyReleaseId?: unknown };
    // As the matcher: only UNSPSC-classified notices (pre-2023 ones used GSIN).
    if (data.historicalTypeReferenceId || !String(data.taxonomyReleaseId ?? "").startsWith("taxonomy-release:UNSPSC:")) continue;
    const under = new Set<string>();
    for (const code of Array.isArray(data.classificationCodes) ? data.classificationCodes : []) {
      if (!isCode(code)) continue;
      // A family-level code (72100000) is under its segment and itself, not under the classes below it.
      under.add(code);
      for (const ancestor of unspscAncestors(code)) under.add(ancestor);
    }
    for (const code of under) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

/**
 * Codes whose code starts with a typed number, or whose title has every
 * typed word; segments before families before classes, then by code.
 */
export function searchTree(tree: CommodityTree, query: string, keep: (code: string) => boolean): CommodityNode[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const numbers = words.filter((word) => /^\d+$/.test(word)).map((word) => (word.length === 8 ? unspscPrefix(word) || word : word));
  const text = words.filter((word) => !/^\d+$/.test(word));
  const found: CommodityNode[] = [];
  for (const node of tree.nodes.values()) {
    if (numbers.some((number) => !node.code.startsWith(number))) continue;
    if (text.length) {
      const title = node.title.toLowerCase();
      if (!text.every((word) => title.includes(word))) continue;
    }
    if (keep(node.code)) found.push(node);
  }
  return found.sort((a, b) => a.level - b.level || (a.code < b.code ? -1 : 1));
}

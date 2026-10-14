/**
 * Resolved two-level navigation tree plus the lookups other surfaces need
 * (breadcrumbs, the command palette's "Finance › Reconciliation" paths, the
 * sidebar's active-parent detection). Pure data — no React — so the palette
 * and page headers can import it without pulling in the shell.
 */
import { FINANCE_PARENT_ID, NAV_TREE, OPTIONAL_NAV_ROUTES, type NavArea, type NavAreaChoice } from "./navConfig";
import { GROUP_TONES, ROUTE_IDENTITY, type IconTone, type LucideIcon } from "./routeIdentity";

export type NavTreeChild = {
  to: string;
  /** Label used inside the tree only (e.g. "Overview" for Financials). */
  treeLabel?: string;
  end?: boolean;
};

export type NavTreeParentNode = {
  kind: "parent";
  id: string;
  label: string;
  i18nKey?: string;
  icon: LucideIcon;
  tone: IconTone;
  defaultOpen?: boolean;
  /** Workspace area (sidebar area switcher); governance unless tagged. */
  area: NavArea;
  children: NavTreeChild[];
};

export type NavTreeLeafNode = { kind: "item"; to: string; end?: boolean };

export type NavTreeNode = NavTreeLeafNode | NavTreeParentNode;

function assertRoute(to: string): boolean {
  if (ROUTE_IDENTITY[to]) return true;
  if (OPTIONAL_NAV_ROUTES.has(to)) return false;
  throw new Error(`routeIdentity: no entry for ${to}. Add it to ROUTE_IDENTITY.`);
}

function resolveTree(): NavTreeNode[] {
  const placed = new Set<string>();
  const nodes: NavTreeNode[] = [];
  for (const entry of NAV_TREE) {
    if (entry.kind === "item") {
      if (!assertRoute(entry.to)) continue;
      placed.add(entry.to);
      nodes.push({ kind: "item", to: entry.to, ...(entry.end ? { end: true } : {}) });
      continue;
    }
    const children: NavTreeChild[] = [];
    for (const child of entry.children) {
      const config = typeof child === "string" ? { to: child } : child;
      if (!assertRoute(config.to) || placed.has(config.to)) continue;
      placed.add(config.to);
      children.push({
        to: config.to,
        ...(config.label ? { treeLabel: config.label } : {}),
        ...(config.end ? { end: true } : {}),
      });
    }
    if (children.length === 0) continue;
    const firstIdentity = ROUTE_IDENTITY[children[0].to];
    nodes.push({
      kind: "parent",
      id: entry.id,
      label: entry.label,
      ...(entry.i18nKey ? { i18nKey: entry.i18nKey } : {}),
      icon: entry.icon,
      tone: GROUP_TONES[firstIdentity.group],
      ...(entry.defaultOpen ? { defaultOpen: true } : {}),
      area: entry.area ?? "governance",
      children,
    });
  }
  // A finance page registered elsewhere (for example by a feature branch)
  // still gets a home: it joins the Finance parent instead of vanishing.
  const finance = nodes.find(
    (node): node is NavTreeParentNode => node.kind === "parent" && node.id === FINANCE_PARENT_ID,
  );
  if (finance) {
    for (const [path, identity] of Object.entries(ROUTE_IDENTITY)) {
      if (identity.group !== "finance" || placed.has(path)) continue;
      placed.add(path);
      finance.children.push({ to: path });
    }
  }
  return nodes;
}

export const RESOLVED_NAV_TREE: readonly NavTreeNode[] = resolveTree();

/** Every route the tree links to, in tree order. */
export const NAV_TREE_ROUTES: readonly string[] = RESOLVED_NAV_TREE.flatMap((node) =>
  node.kind === "item" ? [node.to] : node.children.map((child) => child.to),
);

const PARENT_BY_ROUTE = new Map<string, NavTreeParentNode>();
for (const node of RESOLVED_NAV_TREE) {
  if (node.kind !== "parent") continue;
  for (const child of node.children) PARENT_BY_ROUTE.set(child.to, node);
}

/** The L1 parent a nav route sits under, if any. */
export function navParentForRoute(to: string): NavTreeParentNode | null {
  return PARENT_BY_ROUTE.get(to) ?? null;
}

function routeMatches(to: string, pathname: string, end?: boolean) {
  if (end) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * The nav route that owns a pathname: the longest tree route that matches it.
 * `/app/financials/accounting/x` resolves to Accounting, not Financials.
 */
export function navRouteForPath(pathname: string): string | null {
  let best: string | null = null;
  for (const node of RESOLVED_NAV_TREE) {
    const candidates = node.kind === "item" ? [node] : node.children;
    for (const candidate of candidates) {
      // `end` only constrains highlighting; for ownership a detail path under
      // Financials still belongs to it.
      if (!routeMatches(candidate.to, pathname, candidate.to === "/app")) continue;
      if (!best || candidate.to.length > best.length) best = candidate.to;
    }
  }
  return best;
}

/** The L1 parent that should be expanded for the current pathname. */
export function navParentForPath(pathname: string): NavTreeParentNode | null {
  const route = navRouteForPath(pathname);
  return route ? navParentForRoute(route) : null;
}

/**
 * The workspace area a pathname belongs to: the area of the section that owns
 * it. Top-level pages (the dashboard, the portfolio) and unknown paths belong
 * to no single area and return null, so they never force an area switch.
 */
export function navAreaForPath(pathname: string): NavArea | null {
  return navParentForPath(pathname)?.area ?? null;
}

/** Whether a sidebar section (by parent id) or top-level route shows in an area. */
export function navEntryInArea(entry: { kind: "item" } | { kind: "parent"; id: string }, area: NavAreaChoice): boolean {
  if (area === "all") return true;
  if (entry.kind === "item") return area === "governance";
  return (PARENT_BY_ID.get(entry.id)?.area ?? "governance") === area;
}

const PARENT_BY_ID = new Map<string, NavTreeParentNode>(
  RESOLVED_NAV_TREE.filter((node): node is NavTreeParentNode => node.kind === "parent").map((node) => [node.id, node]),
);

/**
 * Pages below a list route that aren't in the registry but deserve their own
 * crumb (so a grant source reads Finance › Grants › Grant sources › Name).
 */
const INTERMEDIATE_CRUMBS: Record<string, string> = {
  "/app/grants/sources": "Grant sources",
};

export type BreadcrumbTrailEntry = {
  /** Default English label; callers translate/adapt it. */
  label: string;
  to?: string;
  /** Registry route whose label should be adapted for the organization. */
  routeKey?: string;
  /** L1 parent entry (label is the parent's name). */
  parent?: NavTreeParentNode;
};

/**
 * Breadcrumb trail for a detail page, derived from route identity: L1 parent
 * → list page → any registered intermediate pages. Returns null for pages
 * that are themselves nav destinations (no trail needed) or that hang off the
 * dashboard root. The current record's title is appended by the caller.
 */
export function breadcrumbTrailForPath(pathname: string): BreadcrumbTrailEntry[] | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (ROUTE_IDENTITY[clean]) return null;
  const segments = clean.split("/").filter(Boolean);
  let ancestor: string | null = null;
  for (let i = segments.length - 1; i > 0; i -= 1) {
    const candidate = `/${segments.slice(0, i).join("/")}`;
    if (ROUTE_IDENTITY[candidate]) {
      ancestor = candidate;
      break;
    }
  }
  if (!ancestor || ancestor === "/app") return null;
  const trail: BreadcrumbTrailEntry[] = [];
  const parent = navParentForRoute(ancestor);
  if (parent) trail.push({ label: parent.label, parent });
  trail.push({ label: ROUTE_IDENTITY[ancestor].label, to: ancestor, routeKey: ancestor });
  const ancestorDepth = ancestor.split("/").filter(Boolean).length;
  for (let i = ancestorDepth + 1; i < segments.length; i += 1) {
    const candidate = `/${segments.slice(0, i).join("/")}`;
    const label = INTERMEDIATE_CRUMBS[candidate];
    if (label) trail.push({ label, to: candidate });
  }
  return trail;
}

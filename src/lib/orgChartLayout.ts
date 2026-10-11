/**
 * Org chart structure + tidy-tree layout, kept free of React so it can be
 * reasoned about (and tested) on its own.
 *
 * The chart reads as an organization, not a list of record types: the entity
 * at the top, then its Board, Staff and Volunteers branches. A saved
 * reporting line moves a person under their manager; anyone without one hangs
 * from their own branch. Cycles in saved lines (A → B → A) fall back to the
 * branch so the chart always renders as a tree.
 */

export type OrgPersonType = "director" | "employee" | "volunteer";

export type OrgPerson = {
  type: OrgPersonType;
  id: string;
  name: string;
  role: string;
  status?: string;
  href: string;
};

export type OrgTreeNode = {
  key: string;
  kind: "root" | "group" | OrgPersonType;
  label: string;
  role?: string;
  person?: OrgPerson;
  children: OrgTreeNode[];
};

export const GROUP_LABEL: Record<OrgPersonType, string> = {
  director: "Board of directors",
  employee: "Staff",
  volunteer: "Volunteers",
};

export const personKey = (person: Pick<OrgPerson, "type" | "id">) => `${person.type}:${person.id}`;

export function buildOrgTree(
  entityName: string,
  people: OrgPerson[],
  managerOf: (key: string) => string | undefined,
): OrgTreeNode {
  const byKey = new Map(people.map((person) => [personKey(person), person]));
  const nodes = new Map<string, OrgTreeNode>(
    people.map((person) => [
      personKey(person),
      { key: personKey(person), kind: person.type, label: person.name || "Unnamed", role: person.role, person, children: [] },
    ]),
  );
  const groups = new Map<OrgPersonType, OrgTreeNode>();
  const groupFor = (type: OrgPersonType) => {
    let group = groups.get(type);
    if (!group) {
      group = { key: `group:${type}`, kind: "group", label: GROUP_LABEL[type], children: [] };
      groups.set(type, group);
    }
    return group;
  };
  // A manager is usable when it is on the chart and following the chain up
  // from it never comes back to this person.
  const usableManager = (key: string): string | undefined => {
    const manager = managerOf(key);
    if (!manager || manager === key || !byKey.has(manager)) return undefined;
    const seen = new Set([key]);
    let cursor: string | undefined = manager;
    while (cursor) {
      if (seen.has(cursor)) return undefined;
      seen.add(cursor);
      const next = managerOf(cursor);
      cursor = next && byKey.has(next) ? next : undefined;
    }
    return manager;
  };
  for (const person of people) {
    const key = personKey(person);
    const manager = usableManager(key);
    const parent = manager ? nodes.get(manager)! : groupFor(person.type);
    parent.children.push(nodes.get(key)!);
  }
  const order: OrgPersonType[] = ["director", "employee", "volunteer"];
  return {
    key: "root",
    kind: "root",
    label: entityName,
    children: order.map((type) => groups.get(type)).filter((group): group is OrgTreeNode => Boolean(group)),
  };
}

export const NODE_WIDTH = 196;
export const NODE_GAP_X = 24;
export const LEVEL_GAP_Y = 56;
const PERSON_HEIGHT = 52;
const GROUP_HEIGHT = 34;
const TEAM_HEADER = 34;
const TEAM_ROW = 40;
/** A branch whose people have no reports of their own becomes one card once it has this many. */
const TEAM_MIN = 3;

export type ChartNode =
  | { key: string; kind: "root" | "group" | OrgPersonType; label: string; role?: string; count?: number }
  | { key: string; kind: "team"; label: string; members: OrgPerson[] };

export type PositionedNode = { node: ChartNode; x: number; y: number; height: number; depth: number; parentKey?: string };

/**
 * Turn the tree into chart nodes. A group (or manager) whose people have no
 * reports of their own is drawn as a single "team" card listing them, so a
 * seven-person board reads as one card instead of seven boxes in a row.
 */
function toChartTree(node: OrgTreeNode): { chart: ChartNode; children: ReturnType<typeof toChartTree>[] } {
  const leaves = node.children.filter((child) => child.children.length === 0 && child.person);
  const branches = node.children.filter((child) => !(child.children.length === 0 && child.person));
  const chart: ChartNode = { key: node.key, kind: node.kind, label: node.label, role: node.role, count: node.kind === "group" ? node.children.length : undefined };
  if (node.kind === "group" && leaves.length > 0 && branches.length === 0) {
    // A branch of people with no reports is just a team card.
    return { chart: { key: node.key, kind: "team", label: node.label, members: leaves.map((leaf) => leaf.person!) }, children: [] };
  }
  if (leaves.length >= TEAM_MIN) {
    const team: ChartNode = { key: `${node.key}:team`, kind: "team", label: node.kind === "group" ? "Others" : `Reports to ${node.label}`, members: leaves.map((leaf) => leaf.person!) };
    return { chart, children: [{ chart: team, children: [] }, ...branches.map(toChartTree)] };
  }
  return { chart, children: node.children.map(toChartTree) };
}

const heightOf = (node: ChartNode) =>
  node.kind === "team" ? TEAM_HEADER + node.members.length * TEAM_ROW + 8
    : node.kind === "group" ? GROUP_HEIGHT
    : node.kind === "root" ? 40
    : PERSON_HEIGHT;

/** Tidy tree: each subtree gets its children's width, parents centre over them, rows size to their tallest card. */
export function layoutOrgTree(root: OrgTreeNode): PositionedNode[] {
  type Tree = ReturnType<typeof toChartTree>;
  const tree = toChartTree(root);
  const widths = new Map<string, number>();
  const rowHeights: number[] = [];
  const measure = (node: Tree, depth: number): number => {
    rowHeights[depth] = Math.max(rowHeights[depth] ?? 0, heightOf(node.chart));
    const childWidth = node.children.reduce((sum, child, index) => sum + measure(child, depth + 1) + (index ? NODE_GAP_X : 0), 0);
    const width = Math.max(NODE_WIDTH, childWidth);
    widths.set(node.chart.key, width);
    return width;
  };
  measure(tree, 0);
  const rowTop: number[] = [];
  rowHeights.forEach((height, depth) => { rowTop[depth] = depth ? rowTop[depth - 1] + rowHeights[depth - 1] + LEVEL_GAP_Y : 0; });
  const out: PositionedNode[] = [];
  const place = (node: Tree, left: number, depth: number, parentKey?: string) => {
    const width = widths.get(node.chart.key)!;
    out.push({ node: node.chart, x: left + width / 2 - NODE_WIDTH / 2, y: rowTop[depth], height: heightOf(node.chart), depth, parentKey });
    const childrenWidth = node.children.reduce((sum, child, index) => sum + widths.get(child.chart.key)! + (index ? NODE_GAP_X : 0), 0);
    let cursor = left + (width - childrenWidth) / 2;
    for (const child of node.children) {
      place(child, cursor, depth + 1, node.chart.key);
      cursor += widths.get(child.chart.key)! + NODE_GAP_X;
    }
  };
  place(tree, 0, 0);
  return out;
}

/** Everyone below a node (used to keep a person from reporting to their own report). */
export function descendantKeys(node: OrgTreeNode): Set<string> {
  const out = new Set<string>();
  const walk = (current: OrgTreeNode) => {
    for (const child of current.children) {
      out.add(child.key);
      walk(child);
    }
  };
  walk(node);
  return out;
}

export function findNode(root: OrgTreeNode, key: string): OrgTreeNode | undefined {
  if (root.key === key) return root;
  for (const child of root.children) {
    const found = findNode(child, key);
    if (found) return found;
  }
  return undefined;
}

/**
 * Nest report rows by the chart-of-accounts hierarchy: each sub-account sits
 * under its parent, and a parent's amounts are its own posted lines plus all
 * of its sub-accounts. A parent with no lines of its own still appears when a
 * sub-account has activity. Used by the statements and the trial balance.
 */
import { accountSection, compareAccounts, type HierarchyAccount } from "../../../../shared/accountHierarchy";

export type RollupLeaf = { accountId: string; code?: string; name: string; values: Record<string, number> };

export type RollupNode = {
  accountId: string;
  code?: string;
  name: string;
  /** This account's own posted amounts; null for a parent with no lines of its own. */
  own: Record<string, number> | null;
  /** Own plus every sub-account. */
  total: Record<string, number>;
  /** This account and every sub-account below it (for drilldown). */
  accountIds: string[];
  children: RollupNode[];
};

function add(into: Record<string, number>, from: Record<string, number>) {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + (value ?? 0);
}

/**
 * Turn flat per-account rows into a tree. Ancestors are taken from `chart`
 * only while they stay in the leaf's statement section and currency, so a
 * malformed parent can never move amounts between sections.
 */
export function rollupAccounts(leaves: RollupLeaf[], chart: HierarchyAccount[] | undefined): RollupNode[] {
  const index = new Map((chart ?? []).map((account) => [String(account._id), account]));
  const nodes = new Map<string, RollupNode>();
  const parentOf = new Map<string, string | null>();

  const ensure = (accountId: string, fallback?: RollupLeaf): RollupNode => {
    let node = nodes.get(accountId);
    if (!node) {
      const account = index.get(accountId);
      node = {
        accountId,
        code: fallback?.code ?? account?.code ?? undefined,
        name: fallback?.name ?? account?.name ?? "Account",
        own: null,
        total: {},
        accountIds: [accountId],
        children: [],
      };
      nodes.set(accountId, node);
    }
    return node;
  };

  for (const leaf of leaves) {
    const node = ensure(leaf.accountId, leaf);
    node.code = leaf.code ?? node.code;
    node.name = leaf.name;
    node.own = { ...leaf.values };
    // Walk up the chart while the parent is a valid ancestor.
    const self = index.get(leaf.accountId);
    let current = self;
    const seen = new Set([leaf.accountId]);
    let childId = leaf.accountId;
    while (current?.parentAccountId) {
      const parentId = String(current.parentAccountId);
      const parent = index.get(parentId);
      if (!parent || seen.has(parentId)) break;
      if (accountSection(parent.accountType) !== accountSection(self?.accountType) || (parent.currency ?? "") !== (self?.currency ?? "")) break;
      seen.add(parentId);
      if (!parentOf.has(childId)) parentOf.set(childId, parentId);
      ensure(parentId);
      childId = parentId;
      current = parent;
    }
    if (!parentOf.has(childId)) parentOf.set(childId, null);
  }

  const roots: RollupNode[] = [];
  for (const [id, node] of nodes) {
    const parentId = parentOf.get(id) ?? null;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: RollupNode, b: RollupNode) => compareAccounts({ _id: a.accountId, code: a.code, name: a.name, accountType: "" }, { _id: b.accountId, code: b.code, name: b.name, accountType: "" });
  const finish = (node: RollupNode): RollupNode => {
    node.children.sort(order).forEach(finish);
    node.total = {};
    if (node.own) add(node.total, node.own);
    for (const child of node.children) {
      add(node.total, child.total);
      node.accountIds.push(...child.accountIds);
    }
    return node;
  };
  return roots.sort(order).map(finish);
}

/** Whether a parent's own amounts deserve their own line under it (any non-zero value). */
export function hasOwnAmounts(node: RollupNode) {
  return Boolean(node.own && Object.values(node.own).some((value) => value !== 0));
}

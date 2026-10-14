/**
 * Chart-of-accounts hierarchy: an account may sit under a parent account
 * (`financialAccounts.parentAccountId`), e.g. "5210 Hall and venue rental"
 * under "5200 Facilities and utilities". Statements roll sub-accounts up into
 * their parent. These pure helpers are shared by the mutation, the in-browser
 * demo and the UI, so the same rules apply everywhere:
 *  - no account is its own ancestor (no cycles);
 *  - a parent is in the same statement section (assets, liabilities, equity,
 *    revenue, expenses) and the same currency;
 *  - nesting stops at MAX_ACCOUNT_DEPTH levels.
 */

export type HierarchyAccount = {
  _id: string;
  code?: string | null;
  name: string;
  accountType: string;
  currency?: string | null;
  parentAccountId?: string | null;
};

/** Levels including the top one: a top-level account, a sub-account, a sub-sub-account. */
export const MAX_ACCOUNT_DEPTH = 3;

const SECTION_BY_TYPE: Record<string, string> = {
  Asset: "assets",
  Bank: "assets",
  Liability: "liabilities",
  Credit: "liabilities",
  Equity: "equity",
  Income: "income",
  Expense: "expenses",
};

/** Statement section of an account type; unknown types only nest under the same type. */
export function accountSection(accountType: string | undefined | null): string {
  const type = String(accountType ?? "");
  return SECTION_BY_TYPE[type] ?? `type:${type}`;
}

function byId<T extends HierarchyAccount>(accounts: T[]) {
  return new Map(accounts.map((account) => [String(account._id), account]));
}

/** The parent id when it points at another account in the list, else null. */
function parentOf<T extends HierarchyAccount>(account: T, index: Map<string, T>): string | null {
  const parent = account.parentAccountId ? String(account.parentAccountId) : null;
  return parent && parent !== String(account._id) && index.has(parent) ? parent : null;
}

/** Ids of every account below `accountId`. Stops on a malformed cycle. */
export function descendantIds<T extends HierarchyAccount>(accounts: T[], accountId: string): Set<string> {
  const children = new Map<string, string[]>();
  const index = byId(accounts);
  for (const account of accounts) {
    const parent = parentOf(account, index);
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(String(account._id));
    children.set(parent, list);
  }
  const out = new Set<string>();
  const stack = [...(children.get(accountId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || id === accountId) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Ancestors of `accountId`, nearest first. Stops on a malformed cycle. */
export function ancestorIds<T extends HierarchyAccount>(accounts: T[], accountId: string): string[] {
  const index = byId(accounts);
  const out: string[] = [];
  const seen = new Set([accountId]);
  let current = index.get(accountId);
  while (current) {
    const parent = parentOf(current, index);
    if (!parent || seen.has(parent)) break;
    out.push(parent);
    seen.add(parent);
    current = index.get(parent);
  }
  return out;
}

/** 1 for a top-level account, 2 for a sub-account, … */
export function accountDepth<T extends HierarchyAccount>(accounts: T[], accountId: string): number {
  return ancestorIds(accounts, accountId).length + 1;
}

/** Levels in the subtree rooted at `accountId` (1 when it has no sub-accounts). */
function subtreeHeight<T extends HierarchyAccount>(accounts: T[], accountId: string): number {
  const index = byId(accounts);
  let height = 1;
  for (const id of descendantIds(accounts, accountId)) {
    let depth = 1;
    let current = index.get(id);
    while (current && String(current._id) !== accountId) {
      depth += 1;
      const parent = parentOf(current, index);
      current = parent ? index.get(parent) : undefined;
      if (depth > accounts.length) break;
    }
    height = Math.max(height, depth);
  }
  return height;
}

/**
 * Why `parentId` can't be the parent of `accountId`, or null when it can.
 * A null/undefined `parentId` (move to the top level) is always allowed.
 */
export function accountParentError<T extends HierarchyAccount>(accounts: T[], accountId: string, parentId: string | null | undefined): string | null {
  if (!parentId) return null;
  const index = byId(accounts);
  const account = index.get(accountId);
  const parent = index.get(parentId);
  if (!account) return "That account no longer exists.";
  if (!parent) return "Choose a parent account from this chart of accounts.";
  if (parentId === accountId) return "An account can't be its own parent.";
  if (descendantIds(accounts, accountId).has(parentId)) return `${label(parent)} is already under ${label(account)}, so it can't also be its parent.`;
  if (accountSection(parent.accountType) !== accountSection(account.accountType)) {
    return `${label(account)} is ${sectionWord(account.accountType)}, so its parent must be ${sectionWord(account.accountType)} too.`;
  }
  if ((parent.currency ?? "") !== (account.currency ?? "")) return `${label(parent)} is in ${parent.currency || "another currency"}; a sub-account must use the same currency as its parent.`;
  if (accountDepth(accounts, parentId) + subtreeHeight(accounts, accountId) > MAX_ACCOUNT_DEPTH) {
    return `Accounts can be nested at most ${MAX_ACCOUNT_DEPTH} levels deep.`;
  }
  return null;
}

/** Accounts that `accountId` may move under, in chart order. */
export function eligibleParents<T extends HierarchyAccount>(accounts: T[], accountId: string): T[] {
  return accounts
    .filter((candidate) => String(candidate._id) !== accountId && accountParentError(accounts, accountId, String(candidate._id)) === null)
    .sort(compareAccounts);
}

export function compareAccounts(a: HierarchyAccount, b: HierarchyAccount) {
  return String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true }) || a.name.localeCompare(b.name);
}

export type AccountTreeNode<T extends HierarchyAccount> = { account: T; depth: number; children: AccountTreeNode<T>[] };

/** The accounts as a forest in chart order. Unknown or cyclic parents fall back to the top level. */
export function buildAccountTree<T extends HierarchyAccount>(accounts: T[]): AccountTreeNode<T>[] {
  const index = byId(accounts);
  const cyclic = new Set<string>();
  for (const account of accounts) {
    const id = String(account._id);
    if (ancestorIds(accounts, id).includes(id) || descendantIds(accounts, id).has(id)) cyclic.add(id);
  }
  const childrenOf = new Map<string | null, T[]>();
  for (const account of accounts) {
    const parent = cyclic.has(String(account._id)) ? null : parentOf(account, index);
    const list = childrenOf.get(parent) ?? [];
    list.push(account);
    childrenOf.set(parent, list);
  }
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): AccountTreeNode<T>[] =>
    (childrenOf.get(parent) ?? [])
      .slice()
      .sort(compareAccounts)
      .filter((account) => !seen.has(String(account._id)))
      .map((account) => {
        seen.add(String(account._id));
        return { account, depth, children: walk(String(account._id), depth + 1) };
      });
  const roots = walk(null, 1);
  // Anything unreachable (a cycle the checks above missed) is shown at the top level.
  for (const account of accounts) {
    if (!seen.has(String(account._id))) roots.push({ account, depth: 1, children: [] });
  }
  return roots;
}

function label(account: HierarchyAccount) {
  return account.code ? `${account.code} ${account.name}` : account.name;
}

function sectionWord(accountType: string) {
  switch (accountSection(accountType)) {
    case "assets":
      return "an asset account";
    case "liabilities":
      return "a liability account";
    case "equity":
      return "an equity / net assets account";
    case "income":
      return "a revenue account";
    case "expenses":
      return "an expense account";
    default:
      return `a ${accountType || "untyped"} account`;
  }
}

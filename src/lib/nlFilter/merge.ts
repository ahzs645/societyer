import type { ViewFilter, ViewFilterGroup } from "../../platform/record-engine/types";
import { childFilterGroups, pruneFilterTree, rootFilterGroup } from "../../platform/record-engine/record-table/utils/filterTree";

export type ApplyMode = "replace" | "merge";

type Tree = { filters: ViewFilter[]; filterGroups: ViewFilterGroup[] };

/** Whether "add to current filters" can keep the current tree as it is. */
export function canMergeFilters(current: Tree): boolean {
  if (current.filters.length === 0) return true;
  const root = rootFilterGroup(current.filterGroups);
  if (!root || root.logicalOperator === "and") return true;
  // An any-of root nests under a new all-of root only if it has no groups of its own.
  return childFilterGroups(current.filterGroups, root.id).length === 0;
}

/**
 * The view's next filter tree after applying a parsed one.
 *
 * - replace: the parsed tree as is.
 * - merge: the parsed conditions are ANDed onto the current filters. A current
 *   top-level condition on a column the request also constrains at the top
 *   level is dropped ("this year" replaces "last month").
 */
export function combineFilterTrees(current: Tree, parsedTree: Tree, mode: ApplyMode): Tree {
  const parsed: Tree = { filters: parsedTree.filters, filterGroups: parsedTree.filterGroups };
  if (mode === "replace" || current.filters.length === 0 || !canMergeFilters(current)) return parsed;
  const parsedRoot = rootFilterGroup(parsed.filterGroups);
  if (!parsedRoot) return parsed;
  const currentRoot = rootFilterGroup(current.filterGroups);

  if (parsedRoot.logicalOperator === "or") {
    // (current) and (parsed any-of): keep current at the root, parsed becomes a nested group.
    const base = normaliseAndRoot(current, currentRoot);
    if (!base) return parsed;
    const nested = parsed.filterGroups.map((group) =>
      group.id === parsedRoot.id ? { ...group, parentViewFilterGroupId: base.rootId, positionInViewFilterGroup: base.nextGroupPosition } : group,
    );
    const nestedHasChildren = parsed.filterGroups.some((group) => group.parentViewFilterGroupId === parsedRoot.id);
    if (nestedHasChildren) return parsed; // Would nest two levels deep; the editor can't show that.
    return pruneFilterTree([...base.filters, ...parsed.filters], [...base.filterGroups, ...nested]);
  }

  const base = normaliseAndRoot(current, currentRoot);
  if (!base) return parsed;
  const parsedTopFields = new Set(parsed.filters.filter((filter) => filter.viewFilterGroupId === parsedRoot.id).map((filter) => filter.fieldMetadataId));
  const kept = base.filters.filter((filter) => filter.viewFilterGroupId !== base.rootId || !parsedTopFields.has(filter.fieldMetadataId));
  let position = kept.filter((filter) => filter.viewFilterGroupId === base.rootId).length;
  const moved = parsed.filters.map((filter) =>
    filter.viewFilterGroupId === parsedRoot.id ? { ...filter, viewFilterGroupId: base.rootId, positionInViewFilterGroup: position++ } : filter,
  );
  let groupPosition = base.nextGroupPosition;
  const movedGroups = parsed.filterGroups
    .filter((group) => group.id !== parsedRoot.id)
    .map((group) => (group.parentViewFilterGroupId === parsedRoot.id ? { ...group, parentViewFilterGroupId: base.rootId, positionInViewFilterGroup: groupPosition++ } : group));
  return pruneFilterTree([...kept, ...moved], [...base.filterGroups, ...movedGroups]);
}

/** The current tree with an all-of root (wrapping an any-of root as a nested group). */
function normaliseAndRoot(current: Tree, currentRoot: ViewFilterGroup | undefined) {
  if (!currentRoot) {
    const rootId = `nlfg_root_${Date.now().toString(36)}`;
    return {
      rootId,
      filters: current.filters.map((filter, index) => ({ ...filter, viewFilterGroupId: rootId, positionInViewFilterGroup: index })),
      filterGroups: [{ id: rootId, parentViewFilterGroupId: null, logicalOperator: "and" as const, positionInViewFilterGroup: 0 }],
      nextGroupPosition: 1,
    };
  }
  if (currentRoot.logicalOperator === "and") {
    return {
      rootId: currentRoot.id,
      filters: current.filters,
      filterGroups: current.filterGroups,
      nextGroupPosition: childFilterGroups(current.filterGroups, currentRoot.id).length + 1,
    };
  }
  if (childFilterGroups(current.filterGroups, currentRoot.id).length > 0) return null;
  const rootId = `nlfg_root_${Date.now().toString(36)}`;
  return {
    rootId,
    filters: current.filters,
    filterGroups: [
      { id: rootId, parentViewFilterGroupId: null, logicalOperator: "and" as const, positionInViewFilterGroup: 0 },
      { ...currentRoot, parentViewFilterGroupId: rootId, positionInViewFilterGroup: 1 },
    ],
    nextGroupPosition: 2,
  };
}

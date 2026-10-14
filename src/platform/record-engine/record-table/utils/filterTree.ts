import type { ViewFilter, ViewFilterGroup } from "../../types/View";

/** The root group (top-level AND/OR) or undefined for a flat legacy list. */
export function rootFilterGroup(filterGroups: ViewFilterGroup[]) {
  return filterGroups.find((group) => !group.parentViewFilterGroupId);
}

/** Groups nested directly under `parentId`, in order. */
export function childFilterGroups(filterGroups: ViewFilterGroup[], parentId: string) {
  return filterGroups
    .filter((group) => group.parentViewFilterGroupId === parentId)
    .sort((a, b) => (a.positionInViewFilterGroup ?? 0) - (b.positionInViewFilterGroup ?? 0));
}

/**
 * Remove one filter; a nested group left with no conditions goes too, and a
 * tree with no filters at all collapses back to the empty state.
 */
export function removeFilter(filters: ViewFilter[], filterGroups: ViewFilterGroup[], target: ViewFilter) {
  const nextFilters = filters.filter((filter) => filter !== target);
  return pruneFilterTree(nextFilters, filterGroups);
}

/** Remove a nested group with everything inside it. */
export function removeFilterGroup(filters: ViewFilter[], filterGroups: ViewFilterGroup[], groupId: string) {
  const doomed = new Set<string>([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const group of filterGroups) {
      if (group.parentViewFilterGroupId && doomed.has(group.parentViewFilterGroupId) && !doomed.has(group.id)) {
        doomed.add(group.id);
        grew = true;
      }
    }
  }
  return pruneFilterTree(
    filters.filter((filter) => !filter.viewFilterGroupId || !doomed.has(filter.viewFilterGroupId)),
    filterGroups.filter((group) => !doomed.has(group.id)),
  );
}

/** Drop nested groups that hold no filters (directly or below); empty tree → no groups. */
export function pruneFilterTree(filters: ViewFilter[], filterGroups: ViewFilterGroup[]) {
  if (filters.length === 0) return { filters: [] as ViewFilter[], filterGroups: [] as ViewFilterGroup[] };
  const holds = (groupId: string): boolean =>
    filters.some((filter) => filter.viewFilterGroupId === groupId) ||
    filterGroups.some((group) => group.parentViewFilterGroupId === groupId && holds(group.id));
  return {
    filters,
    filterGroups: filterGroups.filter((group) => !group.parentViewFilterGroupId || holds(group.id)),
  };
}

/** A comparable fingerprint of what the filters mean (ids and positions aside). */
export function filterTreeSignature(filters: ViewFilter[], filterGroups: ViewFilterGroup[]): string {
  const root = rootFilterGroup(filterGroups);
  const describe = (groupId: string | null, operator: string): unknown => ({
    operator,
    filters: filters
      .filter((filter) => (groupId ? filter.viewFilterGroupId === groupId : !filter.viewFilterGroupId || filter.viewFilterGroupId === root?.id))
      .sort((a, b) => (a.positionInViewFilterGroup ?? 0) - (b.positionInViewFilterGroup ?? 0))
      .map((filter) => [filter.fieldMetadataId, filter.operator, filter.value ?? null]),
    groups: groupId || root
      ? childFilterGroups(filterGroups, groupId ?? root!.id).map((group) => describe(group.id, group.logicalOperator))
      : [],
  });
  return JSON.stringify(describe(null, root?.logicalOperator ?? "and"));
}

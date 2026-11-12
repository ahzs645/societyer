import type { ViewFilter, ViewFilterGroup, ViewFilterOperator } from "../../types/View";
import { pruneFilterTree, rootFilterGroup } from "./filterTree";

/** What a column's header menu sets: one condition, or none. */
export type ColumnFilterValue = { operator: ViewFilterOperator; value: unknown };

const atRoot = (filter: ViewFilter, rootId: string | undefined) =>
  !filter.viewFilterGroupId || filter.viewFilterGroupId === rootId;

/**
 * The conditions a column's header menu owns: the top-level ones on that
 * field. Conditions inside nested groups belong to the filter editor.
 */
export function columnFilters(
  filters: readonly ViewFilter[],
  filterGroups: readonly ViewFilterGroup[],
  fieldMetadataId: string,
): ViewFilter[] {
  const rootId = rootFilterGroup([...filterGroups])?.id;
  return filters.filter((filter) => filter.fieldMetadataId === fieldMetadataId && atRoot(filter, rootId));
}

/**
 * Set (or with `null`, clear) a column's one top-level condition. The first
 * existing condition on the field is updated in place, keeping its id and
 * position; any others on it are dropped, so the menu never stacks a second
 * "Buyer contains" on top of the first.
 */
export function withColumnFilter(
  filters: readonly ViewFilter[],
  filterGroups: readonly ViewFilterGroup[],
  fieldMetadataId: string,
  next: ColumnFilterValue | null,
): { filters: ViewFilter[]; filterGroups: ViewFilterGroup[] } {
  const existingRoot = rootFilterGroup([...filterGroups]);
  const isMine = (filter: ViewFilter) => filter.fieldMetadataId === fieldMetadataId && atRoot(filter, existingRoot?.id);

  if (!next) return pruneFilterTree(filters.filter((filter) => !isMine(filter)), [...filterGroups]);

  const root: ViewFilterGroup = existingRoot ?? {
    id: `fg_${Date.now()}`,
    logicalOperator: "and",
    parentViewFilterGroupId: null,
    positionInViewFilterGroup: 0,
  };
  const out: ViewFilter[] = [];
  let placed = false;
  filters.forEach((filter, index) => {
    if (isMine(filter)) {
      if (!placed) out.push({ ...filter, operator: next.operator, value: next.value, viewFilterGroupId: root.id });
      placed = true;
      return;
    }
    // A flat legacy list joins the root group, as the filter editor does.
    out.push(filter.viewFilterGroupId ? filter : { ...filter, viewFilterGroupId: root.id, positionInViewFilterGroup: index });
  });
  if (!placed) {
    out.push({
      id: `f_${Date.now()}`,
      fieldMetadataId,
      operator: next.operator,
      value: next.value,
      viewFilterGroupId: root.id,
      positionInViewFilterGroup: out.length,
    });
  }
  return { filters: out, filterGroups: existingRoot ? [...filterGroups] : [root, ...filterGroups] };
}

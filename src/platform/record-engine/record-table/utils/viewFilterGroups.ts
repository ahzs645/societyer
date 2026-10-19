import type { RecordField, ViewFilter, ViewFilterGroup } from "../../types/View";
import { compileRecordFilter, type RecordPredicate } from "./filterRecords";
import type { DateRangeContext } from "../../../../lib/dateRanges";

export type SerializedViewFilters = {
  filters?: Record<string, Record<string, string | string[]>>;
  filterGroup?: SerializedViewFilterGroup;
};

export type SerializedViewFilterGroup = {
  operator: "and" | "or";
  filters?: Array<{
    field: string;
    op: ViewFilter["operator"];
    value: string;
    subField?: string;
  }>;
  groups?: SerializedViewFilterGroup[];
};

export function recordMatchesViewFilters({
  record,
  columns,
  filters,
  filterGroups,
  dateContext,
}: {
  record: Record<string, unknown>;
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  dateContext?: DateRangeContext;
}) {
  return compileViewFilters({ columns, filters, filterGroups, dateContext })(record);
}

/**
 * The view's filter tree as one predicate: each condition compiled once and
 * the AND / OR groups resolved up front, so filtering a long list does no
 * per-record lookups of fields, groups or positions.
 */
export function compileViewFilters({
  columns,
  filters,
  filterGroups,
  dateContext,
}: {
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  dateContext?: DateRangeContext;
}): RecordPredicate {
  const fieldById = new Map(columns.map((column) => [column.fieldMetadataId, column]));
  const compile = (filter: ViewFilter) => compileRecordFilter(fieldById.get(filter.fieldMetadataId), filter, dateContext);
  const all = (predicates: RecordPredicate[]): RecordPredicate =>
    predicates.length === 1 ? predicates[0] : (record) => predicates.every((predicate) => predicate(record));
  const rootGroups = (filterGroups ?? []).filter((group) => !group.parentViewFilterGroupId);
  if (!filterGroups || filterGroups.length === 0 || rootGroups.length === 0) {
    return filters.length === 0 ? () => true : all(filters.map(compile));
  }

  const byPosition = (a: { positionInViewFilterGroup?: number | null }, b: { positionInViewFilterGroup?: number | null }) =>
    (a.positionInViewFilterGroup ?? 0) - (b.positionInViewFilterGroup ?? 0);
  const compileGroup = (group: ViewFilterGroup, seen: Set<string>): RecordPredicate => {
    // A malformed tree that loops back on itself matches rather than recursing forever.
    if (seen.has(group.id)) return () => true;
    const path = new Set(seen).add(group.id);
    const children: RecordPredicate[] = [
      ...filters
        .filter((filter) => filter.viewFilterGroupId === group.id)
        .sort(byPosition)
        .map(compile),
      ...filterGroups
        .filter((child) => child.parentViewFilterGroupId === group.id)
        .sort(byPosition)
        .map((child) => compileGroup(child, path)),
    ];
    if (children.length === 0) return () => true;
    return group.logicalOperator === "or"
      ? (record) => children.some((child) => child(record))
      : all(children);
  };
  return all(rootGroups.map((group) => compileGroup(group, new Set())));
}

export function serializeViewFiltersToUrl({
  filters,
  filterGroups,
}: {
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
}): SerializedViewFilters {
  const quickFilters = filters.filter((filter) => !filter.viewFilterGroupId);
  const serialized: SerializedViewFilters = {};
  if (quickFilters.length > 0) {
    serialized.filters = {};
    for (const filter of quickFilters) {
      serialized.filters[filter.fieldMetadataId] ??= {};
      serialized.filters[filter.fieldMetadataId][filter.operator] = Array.isArray(filter.value)
        ? filter.value.map(String)
        : String(filter.value ?? "");
    }
  }

  const root = filterGroups?.find((group) => !group.parentViewFilterGroupId);
  if (root) {
    serialized.filterGroup = serializeGroup(root, filters, filterGroups ?? []);
  }
  return serialized;
}

function serializeGroup(
  group: ViewFilterGroup,
  filters: ViewFilter[],
  groups: ViewFilterGroup[],
): SerializedViewFilterGroup {
  return {
    operator: group.logicalOperator,
    filters: filters
      .filter((filter) => filter.viewFilterGroupId === group.id)
      .map((filter) => ({
        field: filter.fieldMetadataId,
        op: filter.operator,
        value: typeof filter.value === "object" && filter.value !== null ? JSON.stringify(filter.value) : String(filter.value ?? ""),
        subField: filter.subFieldName ?? undefined,
      })),
    groups: groups
      .filter((child) => child.parentViewFilterGroupId === group.id)
      .map((child) => serializeGroup(child, filters, groups)),
  };
}

export function deserializeViewFiltersFromUrl(
  value: SerializedViewFilters,
): { filters: ViewFilter[]; filterGroups: ViewFilterGroup[] } {
  const filters: ViewFilter[] = [];
  const filterGroups: ViewFilterGroup[] = [];

  for (const [fieldMetadataId, operators] of Object.entries(value.filters ?? {})) {
    for (const [operator, filterValue] of Object.entries(operators)) {
      filters.push({
        fieldMetadataId,
        operator: operator as ViewFilter["operator"],
        value: filterValue,
      });
    }
  }

  if (value.filterGroup) {
    inflateGroup(value.filterGroup, null, filters, filterGroups);
  }

  return { filters, filterGroups };
}

function inflateGroup(
  group: SerializedViewFilterGroup,
  parentId: string | null,
  filters: ViewFilter[],
  filterGroups: ViewFilterGroup[],
) {
  const id = `fg_${filterGroups.length + 1}`;
  filterGroups.push({
    id,
    parentViewFilterGroupId: parentId,
    logicalOperator: group.operator,
    positionInViewFilterGroup: filterGroups.length,
  });
  group.filters?.forEach((filter, index) => {
    filters.push({
      id: `f_${filters.length + 1}`,
      fieldMetadataId: filter.field,
      operator: filter.op,
      value: filter.value,
      subFieldName: filter.subField,
      viewFilterGroupId: id,
      positionInViewFilterGroup: index,
    });
  });
  group.groups?.forEach((child) => inflateGroup(child, id, filters, filterGroups));
}

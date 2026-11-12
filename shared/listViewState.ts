/**
 * The saved state of a list whose columns are defined in code
 * (`RecordListTable` / `staticRecordTable`): column order, visibility, widths
 * and totals, sorts, filters and filter groups, grouping and display mode,
 * density and (for named views) a search. It is what a named list view
 * (`listViews.stateJson`) stores and what a browser remembers of a list's last
 * state, so both read the same way.
 *
 * Fields are named by the static table's field ids (`staticFieldId`). The
 * server knows nothing of a table's fields (they live in client code), so it
 * checks only the shape and size here; the client drops whatever names a field
 * the table no longer has when it applies a state.
 *
 * The types mirror the record engine's view types (src/platform/record-engine/
 * types/View.ts) so a state converts to and from a view without casts.
 */

export const LIST_VIEW_STATE_VERSION = 1 as const;
/** Bytes of `stateJson` a saved view may hold. */
export const LIST_VIEW_STATE_MAX_BYTES = 32_000;
export const LIST_VIEW_NAME_MAX_LENGTH = 100;
export const LIST_VIEW_TABLE_ID_MAX_LENGTH = 120;
/** Named views per list in a workspace. */
export const LIST_VIEWS_PER_TABLE_MAX = 200;

const LIMITS = { columns: 300, sorts: 20, filters: 100, filterGroups: 50, groups: 400, id: 200, text: 1000, search: 500 } as const;

export const LIST_VIEW_FILTER_OPERATORS = [
  "eq", "neq", "contains", "notContains", "startsWith", "endsWith", "gt", "gte", "lt", "lte",
  "in", "notIn", "isEmpty", "isNotEmpty", "isTrue", "isFalse", "between",
] as const;
export type ListViewFilterOperator = (typeof LIST_VIEW_FILTER_OPERATORS)[number];

export const LIST_VIEW_AGGREGATE_OPERATIONS = [
  "sum", "avg", "count", "countEmpty", "countNotEmpty", "countUniqueValues", "percentageEmpty", "percentageNotEmpty", "min", "max",
] as const;
export type ListViewAggregateOperation = (typeof LIST_VIEW_AGGREGATE_OPERATIONS)[number];

export type ListViewSortDirection = "asc" | "desc";
export type ListViewColumnState = {
  fieldMetadataId: string;
  position: number;
  size: number;
  isVisible: boolean;
  aggregateOperation?: ListViewAggregateOperation | null;
};
export type ListViewSortState = { id?: string; fieldMetadataId: string; direction: ListViewSortDirection };
export type ListViewFilterState = {
  id?: string;
  fieldMetadataId: string;
  operator: ListViewFilterOperator;
  value: unknown;
  viewFilterGroupId?: string | null;
  positionInViewFilterGroup?: number | null;
  subFieldName?: string | null;
};
export type ListViewFilterGroupState = {
  id: string;
  parentViewFilterGroupId?: string | null;
  logicalOperator: "and" | "or";
  positionInViewFilterGroup?: number | null;
};
export type ListViewGroupState = {
  id: string;
  fieldValue: string;
  position: number;
  isVisible: boolean;
  groupBy?: {
    fieldMetadataId: string;
    dateGranularity?: "day" | "month" | "quarter" | "year";
    sort?: "field" | "label" | "count" | "sum";
    direction?: ListViewSortDirection;
    sumFieldMetadataId?: string;
  };
  display?: { mode: "continuous" | "pages"; pageSize?: number };
};
export type ListViewState = {
  version: typeof LIST_VIEW_STATE_VERSION;
  columns: ListViewColumnState[];
  sorts: ListViewSortState[];
  filters: ListViewFilterState[];
  filterGroups: ListViewFilterGroupState[];
  /** Group-by, display mode and per-group entries (the engine's `viewGroups`). */
  groups: ListViewGroupState[];
  density: "compact" | "comfortable";
  /** Named views only; a browser's remembered state never carries a search. */
  searchTerm?: string;
};

/** The field id `staticRecordTable` gives a field: `<table id>:field:<name>`. */
export function staticFieldId(tableObjectId: string, fieldName: string) {
  return `${tableObjectId}:field:${fieldName}`;
}

class ListViewStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListViewStateError";
  }
}
const invalid = (what: string): never => {
  throw new ListViewStateError(`Choose a valid saved view (${what}).`);
};

type Source = Record<string, unknown>;
const isRecord = (value: unknown): value is Source => !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

function text(value: unknown, what: string, max: number = LIMITS.id): string {
  if (typeof value !== "string" || value.length > max) return invalid(what);
  return value;
}
function id(value: unknown, what: string): string {
  const out = text(value, what);
  if (!out) return invalid(what);
  return out;
}
function optionalText(value: unknown, what: string): string | undefined {
  return value === undefined ? undefined : text(value, what);
}
function nullableText(value: unknown, what: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  return text(value, what);
}
function finite(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return invalid(what);
  return value;
}
function nullableFinite(value: unknown, what: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  return finite(value, what, -1_000_000, 1_000_000);
}
function list(value: unknown, what: string, max: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return invalid(what);
  return value;
}

/** A filter value: plain JSON of bounded depth and size (dates, numbers, option keys, a date range). */
function filterValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return finite(value, "filter value", -Number.MAX_VALUE, Number.MAX_VALUE);
  if (typeof value === "string") return text(value, "filter value", LIMITS.text);
  if (depth >= 3) return invalid("filter value");
  if (Array.isArray(value)) return list(value, "filter value", 200).map((entry) => filterValue(entry, depth + 1));
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 20) return invalid("filter value");
    return Object.fromEntries(entries.map(([key, entry]) => [text(key, "filter value"), filterValue(entry, depth + 1)]));
  }
  if (value === undefined) return null;
  return invalid("filter value");
}

function cleanColumn(value: unknown): ListViewColumnState {
  if (!isRecord(value)) return invalid("column");
  const aggregate = value.aggregateOperation;
  if (aggregate !== undefined && aggregate !== null && !oneOf(LIST_VIEW_AGGREGATE_OPERATIONS, aggregate)) return invalid("column total");
  if (typeof value.isVisible !== "boolean") return invalid("column visibility");
  return {
    fieldMetadataId: id(value.fieldMetadataId, "column field"),
    position: Math.round(finite(value.position, "column position", 0, 10_000)),
    size: Math.round(finite(value.size, "column width", 20, 2000)),
    isVisible: value.isVisible,
    ...(aggregate === undefined ? {} : { aggregateOperation: aggregate }),
  };
}

function cleanSort(value: unknown): ListViewSortState {
  if (!isRecord(value) || (value.direction !== "asc" && value.direction !== "desc")) return invalid("sort");
  const sortId = optionalText(value.id, "sort");
  return { ...(sortId === undefined ? {} : { id: sortId }), fieldMetadataId: id(value.fieldMetadataId, "sort field"), direction: value.direction };
}

function cleanFilter(value: unknown): ListViewFilterState {
  if (!isRecord(value) || !oneOf(LIST_VIEW_FILTER_OPERATORS, value.operator)) return invalid("filter");
  const filterId = optionalText(value.id, "filter");
  const groupId = nullableText(value.viewFilterGroupId, "filter group");
  const position = nullableFinite(value.positionInViewFilterGroup, "filter position");
  const subField = nullableText(value.subFieldName, "filter field");
  return {
    ...(filterId === undefined ? {} : { id: filterId }),
    fieldMetadataId: id(value.fieldMetadataId, "filter field"),
    operator: value.operator,
    value: filterValue(value.value),
    ...(groupId === undefined ? {} : { viewFilterGroupId: groupId }),
    ...(position === undefined ? {} : { positionInViewFilterGroup: position }),
    ...(subField === undefined ? {} : { subFieldName: subField }),
  };
}

function cleanFilterGroup(value: unknown): ListViewFilterGroupState {
  if (!isRecord(value) || (value.logicalOperator !== "and" && value.logicalOperator !== "or")) return invalid("filter group");
  const parent = nullableText(value.parentViewFilterGroupId, "filter group");
  const position = nullableFinite(value.positionInViewFilterGroup, "filter group position");
  return {
    id: id(value.id, "filter group"),
    ...(parent === undefined ? {} : { parentViewFilterGroupId: parent }),
    logicalOperator: value.logicalOperator,
    ...(position === undefined ? {} : { positionInViewFilterGroup: position }),
  };
}

function cleanGroup(value: unknown): ListViewGroupState {
  if (!isRecord(value) || typeof value.isVisible !== "boolean") return invalid("grouping");
  const out: ListViewGroupState = {
    id: id(value.id, "grouping"),
    fieldValue: text(value.fieldValue, "grouping", LIMITS.text),
    position: finite(value.position, "grouping position", -10, 100_000),
    isVisible: value.isVisible,
  };
  if (value.groupBy !== undefined) {
    const groupBy = value.groupBy;
    if (!isRecord(groupBy)) return invalid("grouping");
    const granularity = groupBy.dateGranularity, sort = groupBy.sort, direction = groupBy.direction;
    if (granularity !== undefined && !oneOf(["day", "month", "quarter", "year"] as const, granularity)) return invalid("grouping");
    if (sort !== undefined && !oneOf(["field", "label", "count", "sum"] as const, sort)) return invalid("grouping");
    if (direction !== undefined && direction !== "asc" && direction !== "desc") return invalid("grouping");
    const sumField = optionalText(groupBy.sumFieldMetadataId, "grouping");
    out.groupBy = {
      fieldMetadataId: id(groupBy.fieldMetadataId, "grouping field"),
      ...(granularity === undefined ? {} : { dateGranularity: granularity }),
      ...(sort === undefined ? {} : { sort }),
      ...(direction === undefined ? {} : { direction }),
      ...(sumField === undefined ? {} : { sumFieldMetadataId: sumField }),
    };
  }
  if (value.display !== undefined) {
    const display = value.display;
    if (!isRecord(display) || (display.mode !== "continuous" && display.mode !== "pages")) return invalid("display");
    out.display = display.pageSize === undefined
      ? { mode: display.mode }
      : { mode: display.mode, pageSize: Math.round(finite(display.pageSize, "page size", 5, 1000)) };
  }
  return out;
}

/**
 * A list state from untrusted input, rebuilt from known keys only. Throws a
 * readable error for anything out of shape or over the limits.
 */
export function cleanListViewState(input: unknown): ListViewState {
  if (!isRecord(input)) return invalid("state");
  if (input.version !== LIST_VIEW_STATE_VERSION) return invalid("version");
  if (input.density !== "compact" && input.density !== "comfortable") return invalid("density");
  const searchTerm = input.searchTerm === undefined ? undefined : text(input.searchTerm, "search", LIMITS.search);
  return {
    version: LIST_VIEW_STATE_VERSION,
    columns: list(input.columns, "columns", LIMITS.columns).map(cleanColumn),
    sorts: list(input.sorts, "sorts", LIMITS.sorts).map(cleanSort),
    filters: list(input.filters, "filters", LIMITS.filters).map(cleanFilter),
    filterGroups: list(input.filterGroups, "filter groups", LIMITS.filterGroups).map(cleanFilterGroup),
    groups: list(input.groups, "grouping", LIMITS.groups).map(cleanGroup),
    density: input.density,
    ...(searchTerm ? { searchTerm } : {}),
  };
}

/** Parses stored or submitted `stateJson`, enforcing the size cap before parsing. */
export function parseListViewStateJson(json: unknown): ListViewState {
  if (typeof json !== "string" || !json) return invalid("state");
  if (json.length > LIST_VIEW_STATE_MAX_BYTES) throw new ListViewStateError("This view is too large to save. Remove some filters or columns.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalid("state");
  }
  return cleanListViewState(parsed);
}

/** The canonical `stateJson` for untrusted input: parsed, cleaned and re-serialized. */
export function canonicalListViewStateJson(json: unknown): string {
  const out = JSON.stringify(parseListViewStateJson(json));
  if (out.length > LIST_VIEW_STATE_MAX_BYTES) throw new ListViewStateError("This view is too large to save. Remove some filters or columns.");
  return out;
}

export function cleanListViewName(name: unknown): string {
  const out = typeof name === "string" ? name.trim() : "";
  if (!out || out.length > LIST_VIEW_NAME_MAX_LENGTH) throw new ListViewStateError(`Name the view using at most ${LIST_VIEW_NAME_MAX_LENGTH} characters.`);
  return out;
}

/** A list's `tableId` (see RecordListTable): letters, digits and `: . _ / -`. */
export function cleanListViewTableId(tableId: unknown): string {
  if (typeof tableId !== "string" || !tableId || tableId.length > LIST_VIEW_TABLE_ID_MAX_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(tableId)) {
    throw new ListViewStateError("Choose a valid list.");
  }
  return tableId;
}

import type { FieldMetadata } from "./FieldMetadata";
import { hydrateFieldMetadata } from "./FieldMetadata";

/**
 * Per-view column — a viewField row joined to its fieldMetadata. The
 * RecordTable renders one header/cell per RecordField.
 */
export type RecordField = {
  viewFieldId: string;
  fieldMetadataId: string;
  position: number;
  size: number;
  isVisible: boolean;
  aggregateOperation?: "sum" | "avg" | "count" | "min" | "max" | "countUniqueValues" | null;
  field: FieldMetadata;
};

export type ViewFilter = {
  fieldMetadataId: string;
  operator: ViewFilterOperator;
  value: unknown;
};

export type ViewFilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "isEmpty"
  | "isNotEmpty"
  | "isTrue"
  | "isFalse";

export type ViewSort = {
  fieldMetadataId: string;
  direction: "asc" | "desc";
};

export type View = {
  _id: string;
  objectMetadataId: string;
  name: string;
  icon?: string;
  type: "table" | "kanban" | "board";
  kanbanFieldMetadataId?: string;
  filters: ViewFilter[];
  sorts: ViewSort[];
  searchTerm?: string;
  density: "compact" | "comfortable";
  isShared: boolean;
  isSystem: boolean;
  position: number;
};

export type HydratedView = {
  view: View;
  columns: RecordField[];
};

export function hydrateView(raw: any): View {
  return {
    _id: String(raw._id),
    objectMetadataId: String(raw.objectMetadataId),
    name: raw.name,
    icon: raw.icon,
    type: (raw.type ?? "table") as View["type"],
    kanbanFieldMetadataId: raw.kanbanFieldMetadataId
      ? String(raw.kanbanFieldMetadataId)
      : undefined,
    filters: parseJsonArray<ViewFilter>(raw.filtersJson),
    sorts: parseJsonArray<ViewSort>(raw.sortsJson),
    searchTerm: raw.searchTerm,
    density: (raw.density ?? "compact") as View["density"],
    isShared: !!raw.isShared,
    isSystem: !!raw.isSystem,
    position: Number(raw.position ?? 0),
  };
}

export function hydrateHydratedView(raw: any): HydratedView | null {
  if (!raw) return null;
  const view = hydrateView(raw.view);
  const columns: RecordField[] = (raw.columns ?? []).map((entry: any) => ({
    viewFieldId: String(entry.viewField._id),
    fieldMetadataId: String(entry.viewField.fieldMetadataId),
    position: Number(entry.viewField.position ?? 0),
    size: Number(entry.viewField.size ?? 160),
    isVisible: entry.viewField.isVisible !== false,
    aggregateOperation: entry.viewField.aggregateOperation ?? null,
    field: hydrateFieldMetadata(entry.field),
  }));
  return { view, columns };
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

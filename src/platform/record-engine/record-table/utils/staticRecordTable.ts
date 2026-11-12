import type { AggregateOperation, FieldMetadata, HydratedView, ObjectMetadata, ViewGroupBy, ViewOpenRecordIn, ViewSortDirection } from "../../types";
import { withViewGroupBy } from "./groupRecords";
import { staticFieldId } from "../../../../../shared/listViewState";

/** One column of a table whose shape is fixed in code. */
export type StaticFieldDefinition = Pick<FieldMetadata, "name" | "label" | "fieldType"> & {
  config?: Record<string, unknown>;
  /** Column width in px (default 160). */
  size?: number;
  /** Shown by default; hidden columns stay in the column picker. */
  isVisible?: boolean;
  /** Cells are read-only unless a column says otherwise. */
  isReadOnly?: boolean;
  /** The column's footer total when the table shows totals (e.g. "sum" for money); none unless set. */
  aggregate?: AggregateOperation;
};

/** The default view's group-by, naming its field by `name` (the reader can still change it). */
export type StaticGroupByDefinition = Omit<ViewGroupBy, "fieldMetadataId" | "sumFieldMetadataId"> & { field: string };

/**
 * Object metadata and a default view for a table defined in code rather than
 * in the workspace's object metadata: read-only data from another system
 * (procurement catalogs) or fixtures. The table gets the shared toolbar,
 * column picker, density, phone cards and keyboard navigation without seeding
 * metadata. `RecordListTable` remembers a person's column choices in their
 * browser and keeps named views in `listViews` (shared/listViewState.ts), both
 * by the field ids made here (`staticFieldId`).
 */
export function staticRecordTable({
  id,
  nameSingular,
  namePlural,
  labelSingular,
  labelPlural,
  labelIdentifierFieldName,
  icon,
  routePath,
  fields,
  viewName = `All ${labelPlural.toLowerCase()}`,
  openRecordIn = "page",
  density = "compact",
  sorts = [],
  groupBy,
}: {
  id: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  labelIdentifierFieldName: string;
  icon?: string;
  routePath?: string;
  fields: StaticFieldDefinition[];
  viewName?: string;
  openRecordIn?: ViewOpenRecordIn;
  density?: "compact" | "comfortable";
  /** The default view's sort, by field `name`, first key first. */
  sorts?: { field: string; direction: ViewSortDirection }[];
  /** The default view's grouping, e.g. `{ field: "jurisdiction", sort: "label", direction: "asc" }`. */
  groupBy?: StaticGroupByDefinition;
}): { objectMetadata: ObjectMetadata; hydratedView: HydratedView } {
  const metadata: FieldMetadata[] = fields.map((definition, position) => ({
    _id: staticFieldId(id, definition.name),
    objectMetadataId: id,
    name: definition.name,
    label: definition.label,
    fieldType: definition.fieldType,
    config: definition.config ?? {},
    defaultValue: undefined,
    isSystem: false,
    isHidden: false,
    isNullable: true,
    isReadOnly: definition.isReadOnly ?? true,
    position,
  }));
  const fieldId = (name: string) => {
    if (!fields.some((field) => field.name === name)) throw new Error(`staticRecordTable "${id}": no field "${name}"`);
    return staticFieldId(id, name);
  };
  return {
    objectMetadata: {
      _id: id,
      nameSingular,
      namePlural,
      labelSingular,
      labelPlural,
      icon,
      labelIdentifierFieldName,
      isSystem: true,
      isActive: true,
      routePath,
      fields: metadata,
    },
    hydratedView: {
      view: {
        _id: `${id}:view`,
        objectMetadataId: id,
        name: viewName,
        type: "table",
        filters: [],
        filterGroups: [],
        sorts: sorts.map((sort) => ({ id: sort.field, fieldMetadataId: fieldId(sort.field), direction: sort.direction })),
        fieldGroups: [],
        groups: groupBy ? withViewGroupBy([], viewGroupBy(groupBy, fieldId(groupBy.field))) : [],
        density,
        visibility: "system",
        openRecordIn,
        isShared: true,
        isSystem: true,
        position: 0,
      },
      columns: metadata.map((field, position) => ({
        viewFieldId: `${id}:view-field:${field.name}`,
        fieldMetadataId: field._id,
        position,
        size: fields[position].size ?? 160,
        isVisible: fields[position].isVisible ?? true,
        aggregateOperation: fields[position].aggregate ?? null,
        viewFieldGroupId: null,
        field,
      })),
    },
  };
}

function viewGroupBy({ field: _field, ...options }: StaticGroupByDefinition, fieldMetadataId: string): ViewGroupBy {
  return { ...options, fieldMetadataId };
}

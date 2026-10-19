import type { FieldMetadata, HydratedView, ObjectMetadata, ViewOpenRecordIn } from "../../types";

/** One column of a table whose shape is fixed in code. */
export type StaticFieldDefinition = Pick<FieldMetadata, "name" | "label" | "fieldType"> & {
  config?: Record<string, unknown>;
  /** Column width in px (default 160). */
  size?: number;
  /** Shown by default; hidden columns stay in the column picker. */
  isVisible?: boolean;
  /** Cells are read-only unless a column says otherwise. */
  isReadOnly?: boolean;
};

/**
 * Object metadata and a default view for a table defined in code rather than
 * in the workspace's object metadata: read-only data from another system
 * (procurement catalogs) or fixtures. The table gets the shared toolbar,
 * column picker, density, phone cards and keyboard navigation without seeding
 * metadata; column choices last for the visit and aren't saved.
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
}): { objectMetadata: ObjectMetadata; hydratedView: HydratedView } {
  const metadata: FieldMetadata[] = fields.map((definition, position) => ({
    _id: `${id}:field:${definition.name}`,
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
        sorts: [],
        fieldGroups: [],
        groups: [],
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
        aggregateOperation: null,
        viewFieldGroupId: null,
        field,
      })),
    },
  };
}

import type { FieldMetadata } from "./FieldMetadata";
import { hydrateFieldMetadata } from "./FieldMetadata";

/**
 * Runtime representation of an object definition. Bundled with its fields
 * because the RecordTable always needs both.
 */
export type ObjectMetadata = {
  _id: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  labelIdentifierFieldName?: string;
  imageIdentifierFieldName?: string;
  isSystem: boolean;
  isActive: boolean;
  routePath?: string;
  fields: FieldMetadata[];
};

export function hydrateObjectMetadata(raw: {
  object: any;
  fields: any[];
}): ObjectMetadata {
  return {
    _id: String(raw.object._id),
    nameSingular: raw.object.nameSingular,
    namePlural: raw.object.namePlural,
    labelSingular: raw.object.labelSingular,
    labelPlural: raw.object.labelPlural,
    description: raw.object.description,
    icon: raw.object.icon,
    iconColor: raw.object.iconColor,
    labelIdentifierFieldName: raw.object.labelIdentifierFieldName,
    imageIdentifierFieldName: raw.object.imageIdentifierFieldName,
    isSystem: !!raw.object.isSystem,
    isActive: raw.object.isActive !== false,
    routePath: raw.object.routePath,
    fields: raw.fields.map(hydrateFieldMetadata),
  };
}

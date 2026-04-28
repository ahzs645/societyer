import { FieldDisplay } from "@/modules/object-record/record-field/components/FieldDisplay";
import type { FieldMetadata, ObjectMetadata, RecordField, ViewFieldGroup } from "@/modules/object-record";
import type { RecordSummaryItem } from "./RecordShowPage";

export type MetadataRecordSummaryGroup = {
  id: string;
  label: string;
  items: RecordSummaryItem[];
};

export function buildMetadataRecordSummary({
  objectMetadata,
  fields,
  record,
  limit = 8,
}: {
  objectMetadata: ObjectMetadata;
  fields: Array<FieldMetadata | RecordField>;
  record: any;
  limit?: number;
}): RecordSummaryItem[] {
  const normalizedFields = fields
    .map((entry) => ("field" in entry ? entry.field : entry))
    .filter((field) => !field.isHidden)
    .sort((a, b) => a.position - b.position);

  const identifierFirst = normalizedFields.sort((a, b) => {
    if (a.name === objectMetadata.labelIdentifierFieldName) return -1;
    if (b.name === objectMetadata.labelIdentifierFieldName) return 1;
    return a.position - b.position;
  });

  return identifierFirst.slice(0, limit).map((field) => ({
    id: `field:${field.name}`,
    label: field.label,
    value: (
      <FieldDisplay
        value={record?.[field.name]}
        record={record}
        field={field}
      />
    ),
  }));
}

export function buildMetadataRecordSummaryGroups({
  objectMetadata,
  fields,
  fieldGroups,
  record,
}: {
  objectMetadata: ObjectMetadata;
  fields: Array<FieldMetadata | RecordField>;
  fieldGroups: ViewFieldGroup[];
  record: any;
}): MetadataRecordSummaryGroup[] {
  const recordFields = fields
    .map((entry) => ("field" in entry ? entry : { field: entry, fieldMetadataId: entry._id, viewFieldGroupId: null }))
    .filter((entry) => !entry.field.isHidden)
    .sort((a, b) => a.field.position - b.field.position);
  const groupById = new Map(fieldGroups.map((group) => [group.id, group]));
  const fieldsByGroup = new Map<string, typeof recordFields>();

  for (const entry of recordFields) {
    const groupId = "viewFieldGroupId" in entry && entry.viewFieldGroupId
      ? entry.viewFieldGroupId
      : "ungrouped";
    const list = fieldsByGroup.get(groupId) ?? [];
    list.push(entry);
    fieldsByGroup.set(groupId, list);
  }

  const orderedGroupIds = [
    ...fieldGroups
      .filter((group) => group.isVisible !== false)
      .sort((a, b) => a.position - b.position)
      .map((group) => group.id),
    "ungrouped",
  ];

  const result: MetadataRecordSummaryGroup[] = [];
  for (const groupId of orderedGroupIds) {
      const group = groupById.get(groupId);
      const groupFields = fieldsByGroup.get(groupId) ?? [];
      if (groupFields.length === 0) continue;
      result.push({
        id: `summary-group:${groupId}`,
        label: group?.name ?? objectMetadata.labelSingular,
        items: groupFields.map((entry) => ({
          id: `field:${entry.field.name}`,
          label: entry.field.label,
          value: (
            <FieldDisplay
              value={record?.[entry.field.name]}
              record={record}
              field={entry.field}
            />
          ),
        })),
      });
  }
  return result;
}

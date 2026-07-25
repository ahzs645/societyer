import {
  FIELD_TYPES,
  type FieldMetadata,
  type HydratedView,
  type ObjectMetadata,
} from "../../types";

export type LabRecord = Record<string, unknown> & { _id: string };

const OBJECT_ID = "record-table-field-lab";

export const LAB_FIELD_DEFINITIONS: Array<
  Pick<FieldMetadata, "name" | "label" | "fieldType"> & {
    config?: Record<string, unknown>;
    initial: unknown;
  }
> = [
  { name: "text", label: "Text", fieldType: FIELD_TYPES.TEXT, initial: "Alpha" },
  { name: "number", label: "Number", fieldType: FIELD_TYPES.NUMBER, initial: 12 },
  { name: "currency", label: "Currency", fieldType: FIELD_TYPES.CURRENCY, config: { currencyCode: "CAD", isCents: true, decimals: 2 }, initial: 1250 },
  { name: "boolean", label: "Boolean", fieldType: FIELD_TYPES.BOOLEAN, config: { trueLabel: "Enabled", falseLabel: "Disabled" }, initial: true },
  { name: "date", label: "Date", fieldType: FIELD_TYPES.DATE, initial: "2026-07-14" },
  { name: "dateTime", label: "Date & time", fieldType: FIELD_TYPES.DATE_TIME, initial: "2026-07-14T10:30" },
  {
    name: "select",
    label: "Select",
    fieldType: FIELD_TYPES.SELECT,
    config: { options: [
      { value: "planned", label: "Planned", color: "blue" },
      { value: "active", label: "Active", color: "green" },
      { value: "blocked", label: "Blocked", color: "red" },
    ] },
    initial: "planned",
  },
  {
    name: "multiSelect",
    label: "Multi-select",
    fieldType: FIELD_TYPES.MULTI_SELECT,
    config: { options: [
      { value: "governance", label: "Governance", color: "purple" },
      { value: "finance", label: "Finance", color: "green" },
      { value: "people", label: "People", color: "teal" },
    ] },
    initial: ["governance"],
  },
  { name: "email", label: "Email", fieldType: FIELD_TYPES.EMAIL, initial: "alpha@example.ca" },
  { name: "phone", label: "Phone", fieldType: FIELD_TYPES.PHONE, initial: "+1 604 555 0112" },
  { name: "link", label: "Link", fieldType: FIELD_TYPES.LINK, initial: "https://example.ca/alpha" },
  {
    name: "relation",
    label: "Relation",
    fieldType: FIELD_TYPES.RELATION,
    config: {
      targetObjectNamePlural: "members",
      options: [
        { value: "member-avery", label: "Avery Chen", hint: "member-avery" },
        { value: "member-morgan", label: "Morgan Patel", hint: "member-morgan" },
        { value: "member-phil", label: "Phil Schiler", hint: "member-phil" },
      ],
    },
    initial: "member-avery",
  },
  { name: "rating", label: "Rating", fieldType: FIELD_TYPES.RATING, config: { max: 5 }, initial: 3 },
  { name: "uuid", label: "UUID", fieldType: FIELD_TYPES.UUID, initial: "d3b07384-d9a0-4f65-a380-cf0dc20c31d1" },
  { name: "array", label: "Array", fieldType: FIELD_TYPES.ARRAY, initial: ["alpha", "beta"] },
  {
    name: "address",
    label: "Address",
    fieldType: FIELD_TYPES.ADDRESS,
    initial: {
      addressStreet1: "1280 Main Street",
      addressStreet2: "Suite 200",
      addressCity: "Vancouver",
      addressState: "British Columbia",
      addressPostcode: "V6A 2T1",
      addressCountry: "Canada",
    },
  },
  { name: "fullName", label: "Full name", fieldType: FIELD_TYPES.FULL_NAME, initial: { firstName: "Avery", lastName: "Chen" } },
  { name: "richText", label: "Rich text", fieldType: FIELD_TYPES.RICH_TEXT, initial: "Board-approved operating notes." },
  { name: "rawJson", label: "Raw JSON", fieldType: FIELD_TYPES.RAW_JSON, initial: { source: "demo", active: true } },
  { name: "emails", label: "Emails", fieldType: FIELD_TYPES.EMAILS, initial: { primaryEmail: "avery@example.ca", additionalEmails: ["board@example.ca"] } },
  { name: "phones", label: "Phones", fieldType: FIELD_TYPES.PHONES, initial: { primaryPhoneNumber: "604 555 0112", primaryPhoneCallingCode: "+1", additionalPhones: [] } },
  { name: "links", label: "Links", fieldType: FIELD_TYPES.LINKS, initial: { primaryLinkUrl: "https://example.ca", primaryLinkLabel: "Website", secondaryLinks: [] } },
  { name: "files", label: "Files", fieldType: FIELD_TYPES.FILES, initial: [{ fileId: "file-1", name: "minutes.pdf", label: "Approved minutes", url: "https://example.ca/minutes.pdf", mimeType: "application/pdf" }] },
];

export const LAB_FIELDS: FieldMetadata[] = LAB_FIELD_DEFINITIONS.map((definition, position) => ({
  _id: `lab-field-${definition.name}`,
  objectMetadataId: OBJECT_ID,
  name: definition.name,
  label: definition.label,
  fieldType: definition.fieldType,
  config: definition.config ?? {},
  defaultValue: undefined,
  isSystem: false,
  isHidden: false,
  isNullable: true,
  isReadOnly: false,
  position,
}));

export const LAB_OBJECT: ObjectMetadata = {
  _id: OBJECT_ID,
  nameSingular: "fieldLabRecord",
  namePlural: "fieldLabRecords",
  labelSingular: "Field lab record",
  labelPlural: "Field lab records",
  description: "Demo-only record table field coverage",
  icon: "FlaskConical",
  iconColor: "violet",
  labelIdentifierFieldName: "text",
  isSystem: true,
  isActive: true,
  routePath: "/app/table-field-lab",
  fields: LAB_FIELDS,
};

export const LAB_VIEW: HydratedView = {
  view: {
    _id: "record-table-field-lab-view",
    objectMetadataId: OBJECT_ID,
    name: "All field types",
    type: "table",
    filters: [],
    filterGroups: [],
    sorts: [],
    fieldGroups: [],
    groups: [],
    density: "compact",
    visibility: "system",
    openRecordIn: "drawer",
    isShared: true,
    isSystem: true,
    position: 0,
  },
  columns: LAB_FIELDS.map((field, position) => ({
    viewFieldId: `lab-view-field-${field.name}`,
    fieldMetadataId: field._id,
    position,
    size:
      field.fieldType === FIELD_TYPES.UUID ? 250
        : field.fieldType === FIELD_TYPES.LINK || field.fieldType === FIELD_TYPES.LINKS ? 210
          : field.fieldType === FIELD_TYPES.ADDRESS ? 260
            : 150,
    isVisible: true,
    aggregateOperation: null,
    viewFieldGroupId: null,
    field,
  })),
};

export const LAB_EDIT_VALUES: Record<string, unknown> = {
  text: "Bravo",
  number: 27,
  currency: 4275,
  boolean: false,
  date: "2026-08-21",
  dateTime: "2026-08-21T14:45",
  select: "active",
  multiSelect: ["finance", "people"],
  email: "bravo@example.ca",
  phone: "+1 604 555 0199",
  link: "https://example.ca/bravo",
  relation: "member-morgan",
  rating: 5,
  uuid: "8f14e45f-ea7d-4f31-9da8-d4f12bd2f812",
  array: ["bravo", "charlie"],
  address: {
    addressStreet1: "455 Granville Street",
    addressStreet2: null,
    addressCity: "Vancouver",
    addressState: "British Columbia",
    addressPostcode: "V6C 1T1",
    addressCountry: "Canada",
  },
  fullName: { firstName: "Morgan", middleName: "R.", lastName: "Patel" },
  richText: "Updated governance notes.",
  rawJson: { source: "acceptance", active: false, version: 2 },
  emails: { primaryEmail: "morgan@example.ca", additionalEmails: ["finance@example.ca"] },
  phones: { primaryPhoneNumber: "604 555 0199", primaryPhoneCallingCode: "+1", additionalPhones: [{ number: "778 555 0100" }] },
  links: { primaryLinkUrl: "https://example.ca/updated", primaryLinkLabel: "Updated website", secondaryLinks: [{ url: "https://example.ca/docs", label: "Docs" }] },
  files: [{ fileId: "file-2", name: "report.pdf", label: "Annual report", url: "https://example.ca/report.pdf", mimeType: "application/pdf" }],
};

export function initialLabRecord(): LabRecord {
  const record: LabRecord = { _id: "field-lab-record-1" };
  for (const definition of LAB_FIELD_DEFINITIONS) record[definition.name] = definition.initial;
  record.relationLabel = "Avery Chen";
  return record;
}

export function applyLabEdit(
  record: LabRecord,
  fieldName: string,
  value: unknown,
  relationLabels: ReadonlyMap<string, string>,
): LabRecord {
  return {
    ...record,
    [fieldName]: value,
    ...(fieldName === "relation"
      ? { relationLabel: relationLabels.get(String(value)) ?? String(value) }
      : {}),
  };
}

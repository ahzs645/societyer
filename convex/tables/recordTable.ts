import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Record-table metadata tables (Twenty-style generic RecordTable architecture),
 * extracted from convex/schema.ts (modularization). objectMetadata + fieldMetadata
 * + views + viewFields + commandMenuItems. Spread back into defineSchema({...});
 * generated data model and runtime are byte-identical.
 */
export const recordTableTables = {
  objectMetadata: defineTable({
    societyId: v.id("societies"),
    // Stable identifier — matches the physical Convex table name, e.g. "members".
    nameSingular: v.string(),      // "member"
    namePlural: v.string(),        // "members" — usually matches the Convex table
    labelSingular: v.string(),     // "Member"
    labelPlural: v.string(),       // "Members"
    description: v.optional(v.string()),
    icon: v.optional(v.string()),  // lucide icon name
    iconColor: v.optional(v.string()),
    permissionConfig: v.optional(v.any()),
    // Field id used as the record's "identifier" — shown as the headline cell,
    // becomes the click target. References fieldMetadata.name, resolved lazily.
    labelIdentifierFieldName: v.optional(v.string()),
    imageIdentifierFieldName: v.optional(v.string()),
    isSystem: v.boolean(),
    isActive: v.boolean(),
    // Route for viewing the index page (e.g. "/app/members").
    routePath: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_name", ["societyId", "nameSingular"])
    .index("by_society_name_plural", ["societyId", "namePlural"]),

  fieldMetadata: defineTable({
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),              // property on the record, e.g. "firstName"
    label: v.string(),             // "First name"
    description: v.optional(v.string()),
    icon: v.optional(v.string()),  // lucide icon name
    // Drives cell rendering. Must be one of FIELD_TYPES from the frontend registry.
    fieldType: v.string(),
    // Type-specific config, stored as JSON for forward compat.
    //   TEXT:        { placeholder? }
    //   NUMBER:      { decimals?, prefix?, suffix? }
    //   CURRENCY:    { currencyCode?: "USD" | "CAD" | ... }
    //   DATE/DATETIME: { includeTime? }
    //   BOOLEAN:     { trueLabel?, falseLabel? }
    //   SELECT:      { options: [{ value, label, color? }] }
    //   MULTI_SELECT:same as SELECT
    //   EMAIL / PHONE / LINK: {}
    //   RELATION:    { targetObjectMetadataId, kind: "many-to-one" | "one-to-many" }
    //   RATING:      { max?: number }
    configJson: v.optional(v.string()),
    permissionConfig: v.optional(v.any()),
    // Default value for new records (serialized).
    defaultValueJson: v.optional(v.string()),
    // When true, the field can't be removed and its type can't be changed.
    isSystem: v.boolean(),
    // When true, the field stays hidden from field pickers — used for
    // internal fields like `_id` / `_creationTime`.
    isHidden: v.boolean(),
    isNullable: v.boolean(),
    // When true, the cell is rendered but the inline editor is disabled.
    // Use for computed / server-managed columns (timestamps, identifiers,
    // joined data, derived status). Defaults to false so existing rows
    // keep their current behaviour.
    isReadOnly: v.optional(v.boolean()),
    // Field position on the default detail page.
    position: v.number(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_object", ["objectMetadataId"])
    .index("by_object_name", ["objectMetadataId", "name"]),

  views: defineTable({
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),              // "All members"
    icon: v.optional(v.string()),
    type: v.string(),              // "table" | "kanban" | "board" | "calendar"
    // When kanban, which SELECT/RELATION field splits columns.
    kanbanFieldMetadataId: v.optional(v.id("fieldMetadata")),
    kanbanAggregateOperation: v.optional(v.string()),
    kanbanAggregateOperationFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarLayout: v.optional(v.string()),
    // Filter & sort live on the view, not on each load — serialized.
    //   filtersJson: [{ fieldMetadataId, operator, value, operandKind }]
    //   sortsJson:   [{ fieldMetadataId, direction }]
    filtersJson: v.optional(v.string()),
    viewFilterGroupsJson: v.optional(v.string()),
    sortsJson: v.optional(v.string()),
    viewGroupsJson: v.optional(v.string()),
    viewFieldGroupsJson: v.optional(v.string()),
    // Search term pre-applied to the view.
    searchTerm: v.optional(v.string()),
    anyFieldFilterValue: v.optional(v.string()),
    // DataTable-specific column state (hidden ids, widths, ordering).
    columnStateJson: v.optional(v.string()),
    // Compact vs comfortable.
    density: v.optional(v.string()),
    // "Shared" views are visible to the whole society; personal views only
    // to the creator.
    isShared: v.boolean(),
    visibility: v.optional(v.string()), // "personal" | "shared" | "system"
    openRecordIn: v.optional(v.string()), // "drawer" | "page"
    // System views are seeded (e.g. "All members") — users can't delete them
    // but can clone them.
    isSystem: v.boolean(),
    createdByUserId: v.optional(v.id("users")),
    position: v.number(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_object", ["objectMetadataId"])
    .index("by_object_position", ["objectMetadataId", "position"]),

  viewFields: defineTable({
    societyId: v.id("societies"),
    viewId: v.id("views"),
    fieldMetadataId: v.id("fieldMetadata"),
    viewFieldGroupId: v.optional(v.string()),
    isVisible: v.boolean(),
    position: v.number(),
    size: v.number(), // pixels
    // Aggregation displayed in the table footer for this column
    // ("sum" | "avg" | "count" | "min" | "max" | "countUniqueValues" | null).
    aggregateOperation: v.optional(v.string()),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_view", ["viewId"])
    .index("by_view_position", ["viewId", "position"])
    .index("by_field", ["fieldMetadataId"]),

  commandMenuItems: defineTable({
    societyId: v.id("societies"),
    label: v.string(),
    category: v.string(),
    iconName: v.optional(v.string()),
    commandKey: v.string(),
    scopeType: v.string(), // global | page | object | record | selection
    pagePath: v.optional(v.string()),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    requiredSelection: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    isPinned: v.boolean(),
    isSystem: v.boolean(),
    position: v.number(),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_society_scope", ["societyId", "scopeType"])
    .index("by_object", ["objectMetadataId"]),
};

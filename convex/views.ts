import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listForObjectPortable,
  getPortable,
  getHydratedPortable,
  createPortable,
  updatePortable,
  listSharedForDataTablePortable,
  createSharedDataTableViewPortable,
  deleteSharedDataTableViewPortable,
  seedGovernanceDataTableViewsPortable,
  removePortable,
  listFieldsForViewPortable,
  addFieldPortable,
  updateFieldPortable,
  removeFieldPortable,
  reorderFieldsPortable,
} from "../shared/functions/views";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Views — per-user or society-shared saved configurations of the RecordTable
 * for a given object (columns, filters, sort, density). A view owns
 * `viewFields` which are the actual columns.
 */

export const listForObject = query({
  args: { objectMetadataId: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => listForObjectPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("views") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

/**
 * Returns the view plus its ordered viewFields with the underlying
 * fieldMetadata joined in — the exact shape the RecordTable consumes.
 */
export const getHydrated = query({
  args: { id: v.id("views") },
  returns: v.any(),
  handler: async (ctx, args) => getHydratedPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),
    icon: v.optional(v.string()),
    type: v.optional(v.string()), // default "table"
    kanbanFieldMetadataId: v.optional(v.id("fieldMetadata")),
    kanbanAggregateOperation: v.optional(v.string()),
    kanbanAggregateOperationFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarLayout: v.optional(v.string()),
    filtersJson: v.optional(v.string()),
    viewFilterGroupsJson: v.optional(v.string()),
    sortsJson: v.optional(v.string()),
    viewGroupsJson: v.optional(v.string()),
    viewFieldGroupsJson: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    anyFieldFilterValue: v.optional(v.string()),
    columnStateJson: v.optional(v.string()),
    density: v.optional(v.string()),
    visibility: v.optional(v.string()),
    openRecordIn: v.optional(v.string()),
    isShared: v.optional(v.boolean()),
    isSystem: v.optional(v.boolean()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("views"),
    patch: v.object({
      name: v.optional(v.string()),
      icon: v.optional(v.string()),
      type: v.optional(v.string()),
      kanbanFieldMetadataId: v.optional(v.id("fieldMetadata")),
      kanbanAggregateOperation: v.optional(v.string()),
      kanbanAggregateOperationFieldMetadataId: v.optional(v.id("fieldMetadata")),
      calendarFieldMetadataId: v.optional(v.id("fieldMetadata")),
      calendarLayout: v.optional(v.string()),
      filtersJson: v.optional(v.string()),
      viewFilterGroupsJson: v.optional(v.string()),
      sortsJson: v.optional(v.string()),
      viewGroupsJson: v.optional(v.string()),
      viewFieldGroupsJson: v.optional(v.string()),
      searchTerm: v.optional(v.string()),
      anyFieldFilterValue: v.optional(v.string()),
      columnStateJson: v.optional(v.string()),
      density: v.optional(v.string()),
      isShared: v.optional(v.boolean()),
      visibility: v.optional(v.string()),
      openRecordIn: v.optional(v.string()),
      position: v.optional(v.number()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const listSharedForDataTable = query({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    nameSingular: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => listSharedForDataTablePortable(await toPortableQueryCtx(ctx), args),
});

export const createSharedDataTableView = mutation({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    nameSingular: v.optional(v.string()),
    name: v.string(),
    filtersJson: v.optional(v.string()),
    viewFilterGroupsJson: v.optional(v.string()),
    sortsJson: v.optional(v.string()),
    viewGroupsJson: v.optional(v.string()),
    viewFieldGroupsJson: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    anyFieldFilterValue: v.optional(v.string()),
    columnStateJson: v.optional(v.string()),
    density: v.optional(v.string()),
    openRecordIn: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => createSharedDataTableViewPortable(await toPortableMutationCtx(ctx), args),
});

export const deleteSharedDataTableView = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("views"),
  },
  returns: v.any(),
  handler: async (ctx, args) => deleteSharedDataTableViewPortable(await toPortableMutationCtx(ctx), args),
});

export const seedGovernanceDataTableViews = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => seedGovernanceDataTableViewsPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("views") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

/* ----------------------------- View fields ----------------------------- */

export const listFieldsForView = query({
  args: { viewId: v.id("views") },
  returns: v.any(),
  handler: async (ctx, args) => listFieldsForViewPortable(await toPortableQueryCtx(ctx), args),
});

export const addField = mutation({
  args: {
    societyId: v.id("societies"),
    viewId: v.id("views"),
    fieldMetadataId: v.id("fieldMetadata"),
    isVisible: v.optional(v.boolean()),
    position: v.optional(v.number()),
    size: v.optional(v.number()),
    aggregateOperation: v.optional(v.string()),
    viewFieldGroupId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => addFieldPortable(await toPortableMutationCtx(ctx), args),
});

export const updateField = mutation({
  args: {
    id: v.id("viewFields"),
    patch: v.object({
      isVisible: v.optional(v.boolean()),
      position: v.optional(v.number()),
      size: v.optional(v.number()),
      aggregateOperation: v.optional(v.string()),
      viewFieldGroupId: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updateFieldPortable(await toPortableMutationCtx(ctx), args),
});

export const removeField = mutation({
  args: { id: v.id("viewFields") },
  returns: v.any(),
  handler: async (ctx, args) => removeFieldPortable(await toPortableMutationCtx(ctx), args),
});

/**
 * Bulk-reorder columns. Accepts an array of viewField ids in their new
 * display order. Uses `patch` per row so we remain idempotent if some
 * viewFields are missing.
 */
export const reorderFields = mutation({
  args: {
    viewId: v.id("views"),
    orderedIds: v.array(v.id("viewFields")),
  },
  returns: v.any(),
  handler: async (ctx, args) => reorderFieldsPortable(await toPortableMutationCtx(ctx), args),
});

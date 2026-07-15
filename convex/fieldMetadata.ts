import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listForObjectPortable,
  listForSocietyPortable,
  getPortable,
  getByNamePortable,
  createPortable,
  updatePortable,
  removePortable,
} from "../shared/functions/fieldMetadata";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Field metadata — one row per field on an Object. `fieldType` drives cell
 * rendering via the FieldDisplay registry on the frontend. Type-specific
 * config (options, currency code, target object, etc.) lives in `configJson`.
 */

export const listForObject = query({
  args: { objectMetadataId: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => listForObjectPortable(await toPortableQueryCtx(ctx), args),
});

export const listForSociety = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listForSocietyPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("fieldMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const getByName = query({
  args: {
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => getByNamePortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    fieldType: v.string(),
    configJson: v.optional(v.string()),
    defaultValueJson: v.optional(v.string()),
    isSystem: v.optional(v.boolean()),
    isHidden: v.optional(v.boolean()),
    isNullable: v.optional(v.boolean()),
    isReadOnly: v.optional(v.boolean()),
    position: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("fieldMetadata"),
    patch: v.object({
      label: v.optional(v.string()),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      fieldType: v.optional(v.string()),
      configJson: v.optional(v.string()),
      defaultValueJson: v.optional(v.string()),
      isHidden: v.optional(v.boolean()),
      isNullable: v.optional(v.boolean()),
      isReadOnly: v.optional(v.boolean()),
      position: v.optional(v.number()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("fieldMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

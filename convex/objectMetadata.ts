import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  getPortable,
  getByNameSingularPortable,
  getByNamePluralPortable,
  getWithFieldsPortable,
  getFullTableSetupPortable,
  createPortable,
  updatePortable,
  removePortable,
} from "../shared/functions/objectMetadata";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

/**
 * Object metadata — one row per high-level "Object" the app knows about
 * (members, directors, filings, etc.). Drives the generic RecordTable:
 * columns are resolved by looking up an object's fieldMetadata rows.
 *
 * Mirrors Twenty's `ObjectMetadataEntity`. See convex/schema.ts for the
 * table definition.
 */

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const getByNameSingular = query({
  args: {
    societyId: v.id("societies"),
    nameSingular: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => getByNameSingularPortable(await toPortableQueryCtx(ctx), args),
});

export const getByNamePlural = query({
  args: {
    societyId: v.id("societies"),
    namePlural: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => getByNamePluralPortable(await toPortableQueryCtx(ctx), args),
});

/**
 * Returns the object metadata + every field defined on it, sorted by
 * field position. This is the shape the RecordTable wants.
 */
export const getWithFields = query({
  args: { objectMetadataId: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => getWithFieldsPortable(await toPortableQueryCtx(ctx), args),
});

/**
 * Everything the RecordTable needs in a single round-trip:
 *   - the object + its fieldMetadata (or `null` if not seeded)
 *   - all views for the object (summary only)
 *   - the active view hydrated with its viewFields + joined fieldMetadata
 *
 * Mirrors Twenty's flat denormalized "load all metadata in parallel"
 * approach so we don't chain three sequential Convex queries on mount.
 * Returns `{ object: null, views: [], activeView: null }` when the
 * object hasn't been seeded — callers branch on `object` to show a
 * "metadata not seeded" empty state instead of spinning forever.
 */
export const getFullTableSetup = query({
  args: {
    societyId: v.id("societies"),
    nameSingular: v.string(),
    viewId: v.optional(v.id("views")),
  },
  returns: v.any(),
  handler: async (ctx, args) => getFullTableSetupPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    nameSingular: v.string(),
    namePlural: v.string(),
    labelSingular: v.string(),
    labelPlural: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    iconColor: v.optional(v.string()),
    labelIdentifierFieldName: v.optional(v.string()),
    imageIdentifierFieldName: v.optional(v.string()),
    isSystem: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    routePath: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("objectMetadata"),
    patch: v.object({
      labelSingular: v.optional(v.string()),
      labelPlural: v.optional(v.string()),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      iconColor: v.optional(v.string()),
      labelIdentifierFieldName: v.optional(v.string()),
      imageIdentifierFieldName: v.optional(v.string()),
      isActive: v.optional(v.boolean()),
      routePath: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});

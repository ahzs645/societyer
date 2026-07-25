/**
 * PORTABLE FUNCTIONS: the object-metadata domain
 * (list / get / getByNameSingular / getByNamePlural / getWithFields /
 *  getFullTableSetup / create / update / remove).
 *
 * Object metadata — one row per high-level "Object" the app knows about
 * (members, directors, filings, etc.). Drives the generic RecordTable:
 * columns are resolved by looking up an object's fieldMetadata rows.
 *
 * Mirrors Twenty's `ObjectMetadataEntity`. See convex/schema.ts for the
 * table definition. Each handler runs unchanged on hosted Convex, the local
 * Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

function firstStableMatch<T extends { _id: unknown }>(rows: T[]): T | null {
  return rows.slice().sort((a, b) => String(a._id).localeCompare(String(b._id)))[0] ?? null;
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return ctx.db
    .query("objectMetadata")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function getByNameSingularPortable(
  ctx: PortableQueryCtx,
  { societyId, nameSingular }: { societyId: string; nameSingular: string },
) {
  const rows = await ctx.db
    .query("objectMetadata")
    .withIndex("by_society_name", (q) =>
      q.eq("societyId", societyId).eq("nameSingular", nameSingular),
    )
    .collect();
  return firstStableMatch(rows);
}

export async function getByNamePluralPortable(
  ctx: PortableQueryCtx,
  { societyId, namePlural }: { societyId: string; namePlural: string },
) {
  const rows = await ctx.db
    .query("objectMetadata")
    .withIndex("by_society_name_plural", (q) =>
      q.eq("societyId", societyId).eq("namePlural", namePlural),
    )
    .collect();
  return firstStableMatch(rows);
}

/**
 * Returns the object metadata + every field defined on it, sorted by
 * field position. This is the shape the RecordTable wants.
 */
export async function getWithFieldsPortable(
  ctx: PortableQueryCtx,
  { objectMetadataId }: { objectMetadataId: string },
) {
  const object = await ctx.db.get(objectMetadataId);
  if (!object) return null;
  const fields = await ctx.db
    .query("fieldMetadata")
    .withIndex("by_object", (q) => q.eq("objectMetadataId", objectMetadataId))
    .collect();
  fields.sort((a, b) => a.position - b.position);
  return { object, fields };
}

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
export async function getFullTableSetupPortable(
  ctx: PortableQueryCtx,
  { societyId, nameSingular, viewId }: { societyId: string; nameSingular: string; viewId?: string },
) {
  const matchingObjects = await ctx.db
    .query("objectMetadata")
    .withIndex("by_society_name", (q) =>
      q.eq("societyId", societyId).eq("nameSingular", nameSingular),
    )
    .collect();
  const object = firstStableMatch(matchingObjects);
  if (!object) {
    return { object: null, views: [], activeView: null };
  }

  const [fields, views] = await Promise.all([
    ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", object._id))
      .collect(),
    ctx.db
      .query("views")
      .withIndex("by_object_position", (q) =>
        q.eq("objectMetadataId", object._id),
      )
      .collect(),
  ]);
  fields.sort((a, b) => a.position - b.position);
  views.sort((a, b) => a.position - b.position);

  // Resolve which view to hydrate — explicit pin first, else first by position.
  const targetViewId = viewId ?? views[0]?._id;
  let activeView: {
    view: (typeof views)[number];
    columns: { viewField: any; field: any }[];
  } | null = null;

  if (targetViewId) {
    const view = views.find((v: any) => v._id === targetViewId);
    if (view) {
      const viewFields = await ctx.db
        .query("viewFields")
        .withIndex("by_view_position", (q) => q.eq("viewId", view._id))
        .collect();
      viewFields.sort((a, b) => a.position - b.position);
      const fieldsById = new Map(fields.map((f) => [f._id, f]));
      const columns = viewFields
        .map((vf) => {
          const field = fieldsById.get(vf.fieldMetadataId);
          return field ? { viewField: vf, field } : null;
        })
        .filter((x): x is { viewField: any; field: any } => x !== null);
      activeView = { view, columns };
    }
  }

  return {
    object: { ...object, fields },
    views: views.map((v: any) => ({
      _id: v._id,
      name: v.name,
      position: v.position,
      isSystem: v.isSystem,
      isShared: v.isShared,
      visibility: v.visibility,
      openRecordIn: v.openRecordIn,
      type: v.type,
      kanbanFieldMetadataId: v.kanbanFieldMetadataId,
      kanbanAggregateOperation: v.kanbanAggregateOperation,
      kanbanAggregateOperationFieldMetadataId: v.kanbanAggregateOperationFieldMetadataId,
      calendarFieldMetadataId: v.calendarFieldMetadataId,
      calendarLayout: v.calendarLayout,
      density: v.density,
      filtersJson: v.filtersJson,
      viewFilterGroupsJson: v.viewFilterGroupsJson,
      sortsJson: v.sortsJson,
      viewGroupsJson: v.viewGroupsJson,
      viewFieldGroupsJson: v.viewFieldGroupsJson,
      searchTerm: v.searchTerm,
      anyFieldFilterValue: v.anyFieldFilterValue,
      columnStateJson: v.columnStateJson,
    })),
    activeView,
  };
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    nameSingular: string;
    namePlural: string;
    labelSingular: string;
    labelPlural: string;
    description?: string;
    icon?: string;
    iconColor?: string;
    labelIdentifierFieldName?: string;
    imageIdentifierFieldName?: string;
    isSystem?: boolean;
    isActive?: boolean;
    routePath?: string;
  },
) {
  const now = new Date().toISOString();
  return ctx.db.insert("objectMetadata", {
    societyId: args.societyId,
    nameSingular: args.nameSingular,
    namePlural: args.namePlural,
    labelSingular: args.labelSingular,
    labelPlural: args.labelPlural,
    description: args.description,
    icon: args.icon,
    iconColor: args.iconColor,
    labelIdentifierFieldName: args.labelIdentifierFieldName,
    imageIdentifierFieldName: args.imageIdentifierFieldName,
    isSystem: args.isSystem ?? false,
    isActive: args.isActive ?? true,
    routePath: args.routePath,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  {
    id,
    patch,
  }: {
    id: string;
    patch: {
      labelSingular?: string;
      labelPlural?: string;
      description?: string;
      icon?: string;
      iconColor?: string;
      labelIdentifierFieldName?: string;
      imageIdentifierFieldName?: string;
      isActive?: boolean;
      routePath?: string;
    };
  },
) {
  await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const object = await ctx.db.get(id);
  if (!object) return;
  if (object.isSystem) {
    throw new Error("Cannot delete a system object.");
  }
  // Cascade: remove all fields, views, viewFields.
  const fields = await ctx.db
    .query("fieldMetadata")
    .withIndex("by_object", (q) => q.eq("objectMetadataId", id))
    .collect();
  for (const f of fields) await ctx.db.delete(f._id);

  const views = await ctx.db
    .query("views")
    .withIndex("by_object", (q) => q.eq("objectMetadataId", id))
    .collect();
  for (const view of views) {
    const vfs = await ctx.db
      .query("viewFields")
      .withIndex("by_view", (q) => q.eq("viewId", view._id))
      .collect();
    for (const vf of vfs) await ctx.db.delete(vf._id);
    await ctx.db.delete(view._id);
  }
  await ctx.db.delete(id);
}

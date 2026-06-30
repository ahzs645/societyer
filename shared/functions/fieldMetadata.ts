/**
 * PORTABLE FUNCTIONS: the field-metadata domain
 * (listForObject / listForSociety / get / getByName / create / update / remove).
 *
 * Field metadata — one row per field on an Object. `fieldType` drives cell
 * rendering via the FieldDisplay registry on the frontend. Type-specific
 * config (options, currency code, target object, etc.) lives in `configJson`.
 *
 * Reads/writes the `fieldMetadata` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listForObjectPortable(
  ctx: PortableQueryCtx,
  { objectMetadataId }: { objectMetadataId: string },
) {
  const rows = await ctx.db
    .query("fieldMetadata")
    .withIndex("by_object", (q) => q.eq("objectMetadataId", objectMetadataId))
    .collect();
  rows.sort((a: any, b: any) => a.position - b.position);
  return rows;
}

export async function listForSocietyPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  return ctx.db
    .query("fieldMetadata")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

export async function getByNamePortable(
  ctx: PortableQueryCtx,
  { objectMetadataId, name }: { objectMetadataId: string; name: string },
) {
  return ctx.db
    .query("fieldMetadata")
    .withIndex("by_object_name", (q) =>
      q.eq("objectMetadataId", objectMetadataId).eq("name", name),
    )
    .unique();
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    objectMetadataId: string;
    name: string;
    label: string;
    description?: string;
    icon?: string;
    fieldType: string;
    configJson?: string;
    defaultValueJson?: string;
    isSystem?: boolean;
    isHidden?: boolean;
    isNullable?: boolean;
    isReadOnly?: boolean;
    position?: number;
  },
) {
  const now = new Date().toISOString();
  // Compute the next position if none provided.
  let position = args.position;
  if (position === undefined) {
    const existing = await ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", args.objectMetadataId))
      .collect();
    position = existing.length;
  }
  return ctx.db.insert("fieldMetadata", {
    societyId: args.societyId,
    objectMetadataId: args.objectMetadataId,
    name: args.name,
    label: args.label,
    description: args.description,
    icon: args.icon,
    fieldType: args.fieldType,
    configJson: args.configJson,
    defaultValueJson: args.defaultValueJson,
    isSystem: args.isSystem ?? false,
    isHidden: args.isHidden ?? false,
    isNullable: args.isNullable ?? true,
    isReadOnly: args.isReadOnly ?? false,
    position,
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
      label?: string;
      description?: string;
      icon?: string;
      fieldType?: string;
      configJson?: string;
      defaultValueJson?: string;
      isHidden?: boolean;
      isNullable?: boolean;
      isReadOnly?: boolean;
      position?: number;
    };
  },
) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new Error("Field not found.");
  if (existing.isSystem && patch.fieldType && patch.fieldType !== existing.fieldType) {
    throw new Error("Cannot change the field type of a system field.");
  }
  await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const field = await ctx.db.get(id);
  if (!field) return;
  if (field.isSystem) {
    throw new Error("Cannot delete a system field.");
  }
  // Cascade: any viewFields referencing this field should be removed too.
  const vfs = await ctx.db
    .query("viewFields")
    .withIndex("by_field", (q) => q.eq("fieldMetadataId", id))
    .collect();
  for (const vf of vfs) await ctx.db.delete(vf._id);
  await ctx.db.delete(id);
}

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
import { getOwned, requireSocietyMembership } from "./access";

export async function listForObjectPortable(
  ctx: PortableQueryCtx,
  { objectMetadataId }: { objectMetadataId: string },
) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "objectMetadata", objectMetadataId, societyId);
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
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("fieldMetadata")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  return getOwned(ctx, "fieldMetadata", id, societyId);
}

export async function getByNamePortable(
  ctx: PortableQueryCtx,
  { objectMetadataId, name }: { objectMetadataId: string; name: string },
) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  await getOwned(ctx, "objectMetadata", objectMetadataId, societyId);
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
  await requireSocietyMembership(ctx, args.societyId);
  await getOwned(ctx, "objectMetadata", args.objectMetadataId, args.societyId);
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
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  const existing = await getOwned(ctx, "fieldMetadata", id, societyId);
  if (existing.isSystem && patch.fieldType && patch.fieldType !== existing.fieldType) {
    throw new Error("Cannot change the field type of a system field.");
  }
  await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const societyId = ctx.principal.kind === "anonymous" ? undefined : ctx.principal.societyId;
  if (!societyId) throw new Error("Society membership not found.");
  const field = await getOwned(ctx, "fieldMetadata", id, societyId);
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

/**
 * PORTABLE FUNCTIONS: the record-table metadata seeder
 * (seedSociety / run / runForSociety / ensureForSociety / wipe).
 *
 * Seeds objectMetadata + fieldMetadata + a default "All records" view for each
 * Twenty-style object. Idempotent — re-running tops up missing rows instead of
 * creating duplicates. Reads/writes exclusively through the portable `ctx.db`
 * contract, so each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 *
 * The object/field/view definitions live in `convex/recordTableMetadataDefinitions`
 * (shared/ must not import convex/), so the Convex wrappers pass `objects` in.
 * The maintenance-token gate (`assertMaintenanceToken`, which reads process.env)
 * stays on the Convex side and runs before the portable body.
 */

import type { PortableMutationCtx } from "../portable/ctx";

export async function seedSocietyPortable(ctx: PortableMutationCtx, societyId: string, objects: any[]) {
  const now = new Date().toISOString();
  for (const obj of objects) {
    // Find or create the object metadata row.
    let objectRow: any = await ctx.db
      .query("objectMetadata")
      .withIndex("by_society_name", (q) =>
        q.eq("societyId", societyId).eq("nameSingular", obj.nameSingular),
      )
      .unique();

    if (!objectRow) {
      const objectId = await ctx.db.insert("objectMetadata", {
        societyId,
        nameSingular: obj.nameSingular,
        namePlural: obj.namePlural,
        labelSingular: obj.labelSingular,
        labelPlural: obj.labelPlural,
        icon: obj.icon,
        iconColor: obj.iconColor,
        labelIdentifierFieldName: obj.labelIdentifierFieldName,
        isSystem: true,
        isActive: true,
        routePath: obj.routePath,
        createdAtISO: now,
        updatedAtISO: now,
      });
      objectRow = await ctx.db.get(objectId);
    }

    // Seed fields, skipping any name already present.
    const existingFields = await ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
      .collect();
    const existingByName = new Map(existingFields.map((f: any) => [f.name, f]));

    for (let i = 0; i < obj.fields.length; i++) {
      const field = obj.fields[i];
      const desiredConfigJson = field.config ? JSON.stringify(field.config) : undefined;
      const existing: any = existingByName.get(field.name);
      if (existing) {
        // Reconcile: re-running the seed should pick up changes to
        // SELECT options, flipped isReadOnly flags, swapped fieldType,
        // etc. Only patch the shape fields — don't touch the id or
        // createdAtISO.
        const patch: Record<string, unknown> = {};
        if (existing.label !== field.label) patch.label = field.label;
        if (existing.description !== field.description) patch.description = field.description;
        if (existing.icon !== field.icon) patch.icon = field.icon;
        if (existing.fieldType !== field.fieldType) patch.fieldType = field.fieldType;
        if (existing.configJson !== desiredConfigJson) patch.configJson = desiredConfigJson;
        if (!!existing.isReadOnly !== !!field.isReadOnly) patch.isReadOnly = !!field.isReadOnly;
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, { ...patch, updatedAtISO: now });
        }
        continue;
      }
      await ctx.db.insert("fieldMetadata", {
        societyId,
        objectMetadataId: objectRow._id,
        name: field.name,
        label: field.label,
        description: field.description,
        icon: field.icon,
        fieldType: field.fieldType,
        configJson: desiredConfigJson,
        isSystem: field.isSystem ?? false,
        isHidden: field.isHidden ?? false,
        isNullable: true,
        isReadOnly: field.isReadOnly ?? false,
        position: i,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }

    // Remove orphaned SYSTEM fields dropped from the definition (and their view
    // columns). Only isSystem fields are touched — user-created custom fields
    // (isSystem false, never in the definition) must survive a reseed.
    const definedNames = new Set(obj.fields.map((f: any) => f.name));
    for (const existing of existingFields) {
      if (existing.isSystem && !definedNames.has(existing.name)) {
        const orphanViewFields = await ctx.db
          .query("viewFields")
          .withIndex("by_field", (q) => q.eq("fieldMetadataId", existing._id))
          .collect();
        for (const vf of orphanViewFields) await ctx.db.delete(vf._id);
        await ctx.db.delete(existing._id);
      }
    }

    // Seed the default view (and its columns) if missing.
    const existingViews = await ctx.db
      .query("views")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
      .collect();
    const systemView = existingViews.find((v: any) => v.isSystem);
    if (!systemView) {
      const viewId = await ctx.db.insert("views", {
        societyId,
        objectMetadataId: objectRow._id,
        name: obj.defaultView.name,
        type: "table",
        density: "compact",
        isShared: true,
        isSystem: true,
        position: 0,
        createdAtISO: now,
        updatedAtISO: now,
      });
      // Look up fields again, now that they exist.
      const allFields = await ctx.db
        .query("fieldMetadata")
        .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
        .collect();
      const byName = new Map(allFields.map((f: any) => [f.name, f]));
      for (let i = 0; i < obj.defaultView.columns.length; i++) {
        const col = obj.defaultView.columns[i];
        const field: any = byName.get(col.fieldName);
        if (!field) continue;
        await ctx.db.insert("viewFields", {
          societyId,
          viewId,
          fieldMetadataId: field._id,
          isVisible: true,
          position: col.position ?? i,
          size: col.size ?? 160,
          createdAtISO: now,
          updatedAtISO: now,
        });
      }
    } else {
      // Reconcile the existing system view: add a column for any definition
      // column that doesn't have one yet, and drop columns whose field no
      // longer exists (orphaned, e.g. after a field was removed above). Columns
      // for still-existing fields are left untouched so user reordering/resizing
      // of the system view survives a reseed.
      const allFields = await ctx.db
        .query("fieldMetadata")
        .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
        .collect();
      const byName = new Map(allFields.map((f: any) => [f.name, f]));
      const liveFieldIds = new Set(allFields.map((f: any) => String(f._id)));
      const currentColumns = await ctx.db
        .query("viewFields")
        .withIndex("by_view", (q) => q.eq("viewId", systemView._id))
        .collect();
      const columnFieldIds = new Set(currentColumns.map((vf: any) => String(vf.fieldMetadataId)));
      let nextPosition = currentColumns.reduce((max: number, vf: any) => Math.max(max, vf.position ?? 0), -1) + 1;
      for (let i = 0; i < obj.defaultView.columns.length; i++) {
        const col = obj.defaultView.columns[i];
        const field: any = byName.get(col.fieldName);
        if (!field || columnFieldIds.has(String(field._id))) continue;
        await ctx.db.insert("viewFields", {
          societyId,
          viewId: systemView._id,
          fieldMetadataId: field._id,
          isVisible: true,
          position: nextPosition++,
          size: col.size ?? 160,
          createdAtISO: now,
          updatedAtISO: now,
        });
      }
      // Drop dangling columns (field deleted) to avoid stale view columns.
      for (const vf of currentColumns) {
        if (!liveFieldIds.has(String(vf.fieldMetadataId))) await ctx.db.delete(vf._id);
      }
    }
  }
}

export async function runPortable(ctx: PortableMutationCtx, { objects }: { objects: any[] }) {
  const societies = await ctx.db.query("societies").collect();
  for (const society of societies) {
    await seedSocietyPortable(ctx, String(society._id), objects);
  }
  return { seededSocieties: societies.length, objects: objects.length };
}

export async function runForSocietyPortable(
  ctx: PortableMutationCtx,
  { societyId, objects }: { societyId: string; objects: any[] },
) {
  await seedSocietyPortable(ctx, societyId, objects);
  return { ok: true, objects: objects.length };
}

export async function ensureForSocietyPortable(
  ctx: PortableMutationCtx,
  { societyId, objects }: { societyId: string; objects: any[] },
) {
  const society = await ctx.db.get(societyId);
  if (!society) throw new Error("Society not found.");
  await seedSocietyPortable(ctx, societyId, objects);
  return { ok: true, objects: objects.length };
}

export async function wipePortable(ctx: PortableMutationCtx) {
  for (const name of ["viewFields", "views", "fieldMetadata", "objectMetadata"] as const) {
    const rows = await ctx.db.query(name).collect();
    for (const row of rows) await ctx.db.delete(row._id);
  }
  return { ok: true };
}

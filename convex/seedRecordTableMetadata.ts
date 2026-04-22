/**
 * Seeds objectMetadata + fieldMetadata + a default "All records" view for
 * each Twenty-style object. Idempotent — re-running tops up missing rows
 * instead of creating duplicates.
 *
 * Run with: `node scripts/convex-maintenance.mjs seedRecordTableMetadata:run`
 * Or per-society: `npx convex run seedRecordTableMetadata:runForSociety '{"societyId":"...","serviceToken":"..."}'`
 */

import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { assertMaintenanceToken, serviceTokenValidator } from "./lib/serviceAuth";

import { RECORD_TABLE_OBJECTS } from "./recordTableMetadataDefinitions";

/* ----------------------------- Seed operations ---------------------------- */

async function seedSociety(ctx: any, societyId: any) {
  const now = new Date().toISOString();
  for (const obj of RECORD_TABLE_OBJECTS) {
    // Find or create the object metadata row.
    let objectRow = await ctx.db
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
    const existingFields = (await ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
      .collect()) as Doc<"fieldMetadata">[];
    const existingByName = new Map(existingFields.map((f) => [f.name, f]));

    for (let i = 0; i < obj.fields.length; i++) {
      const field = obj.fields[i];
      const desiredConfigJson = field.config ? JSON.stringify(field.config) : undefined;
      const existing = existingByName.get(field.name);
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

    // Seed the default view (and its columns) if missing.
    const existingViews = await ctx.db
      .query("views")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
      .collect();
    const hasSystemView = existingViews.some((v) => v.isSystem);
    if (!hasSystemView) {
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
      const allFields = (await ctx.db
        .query("fieldMetadata")
        .withIndex("by_object", (q) => q.eq("objectMetadataId", objectRow._id))
        .collect()) as Doc<"fieldMetadata">[];
      const byName = new Map(allFields.map((f) => [f.name, f]));
      for (let i = 0; i < obj.defaultView.columns.length; i++) {
        const col = obj.defaultView.columns[i];
        const field = byName.get(col.fieldName);
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
    }
  }
}

export const run = mutation({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ seededSocieties: v.number(), objects: v.number() }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    const societies = await ctx.db.query("societies").collect();
    for (const society of societies) {
      await seedSociety(ctx, society._id);
    }
    return { seededSocieties: societies.length, objects: RECORD_TABLE_OBJECTS.length };
  },
});

export const runForSociety = mutation({
  args: { societyId: v.id("societies"), serviceToken: serviceTokenValidator },
  returns: v.object({ ok: v.boolean(), objects: v.number() }),
  handler: async (ctx, { societyId, serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    await seedSociety(ctx, societyId);
    return { ok: true, objects: RECORD_TABLE_OBJECTS.length };
  },
});

/**
 * Nukes metadata rows for testing. Leaves underlying record tables alone.
 */
export const wipe = mutation({
  args: { serviceToken: serviceTokenValidator },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { serviceToken }) => {
    await assertMaintenanceToken(serviceToken);
    for (const name of ["viewFields", "views", "fieldMetadata", "objectMetadata"] as const) {
      const rows = await ctx.db.query(name).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    return { ok: true };
  },
});

/**
 * PORTABLE FUNCTIONS: the custom-fields domain
 * (listDefinitions / createDefinition / updateDefinition / deleteDefinition /
 *  listValues / setValue / clearValue).
 *
 * Reads/writes the `customFieldDefinitions` and `customFieldValues` tables over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

const ENTITY_TYPES = ["members", "directors", "volunteers", "employees"] as const;

function assertEntityType(t: string) {
  if (!ENTITY_TYPES.includes(t as (typeof ENTITY_TYPES)[number])) {
    throw new Error(`Unsupported entityType: ${t}`);
  }
}

export async function listDefinitionsPortable(
  ctx: PortableQueryCtx,
  { societyId, entityType }: { societyId: string; entityType?: string },
) {
  if (entityType) {
    const rows = await ctx.db
      .query("customFieldDefinitions")
      .withIndex("by_society_entity", (q) =>
        q.eq("societyId", societyId).eq("entityType", entityType),
      )
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  }
  const rows = await ctx.db
    .query("customFieldDefinitions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.sort((a, b) =>
    a.entityType === b.entityType ? a.order - b.order : a.entityType.localeCompare(b.entityType),
  );
}

export async function createDefinitionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    entityType: string;
    key: string;
    label: string;
    kind: string;
    required?: boolean;
    order?: number;
    description?: string;
  },
) {
  assertEntityType(args.entityType);
  const existing = await ctx.db
    .query("customFieldDefinitions")
    .withIndex("by_society_entity_key", (q) =>
      q.eq("societyId", args.societyId).eq("entityType", args.entityType).eq("key", args.key),
    )
    .first();
  if (existing) {
    throw new Error(`A ${args.entityType} custom field with key "${args.key}" already exists.`);
  }
  const peers = await ctx.db
    .query("customFieldDefinitions")
    .withIndex("by_society_entity", (q) =>
      q.eq("societyId", args.societyId).eq("entityType", args.entityType),
    )
    .collect();
  const nextOrder = args.order ?? (peers.length > 0 ? Math.max(...peers.map((p) => p.order)) + 1 : 0);
  return await ctx.db.insert("customFieldDefinitions", {
    societyId: args.societyId,
    entityType: args.entityType,
    key: args.key,
    label: args.label,
    kind: args.kind,
    required: args.required ?? false,
    order: nextOrder,
    description: args.description,
    createdAtISO: new Date().toISOString(),
  });
}

export async function updateDefinitionPortable(
  ctx: PortableMutationCtx,
  { id, ...patch }: {
    id: string;
    label?: string;
    kind?: string;
    required?: boolean;
    order?: number;
    description?: string;
  },
) {
  const existing = await ctx.db.get(id);
  if (!existing) throw new Error("Custom field definition not found");
  await ctx.db.patch(id, patch);
}

export async function deleteDefinitionPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const existing = await ctx.db.get(id);
  if (!existing) return;
  const values = await ctx.db
    .query("customFieldValues")
    .withIndex("by_definition", (q) => q.eq("definitionId", id))
    .collect();
  for (const v of values) await ctx.db.delete(v._id);
  await ctx.db.delete(id);
}

export async function listValuesPortable(
  ctx: PortableQueryCtx,
  { entityType, entityId }: { entityType: string; entityId: string },
) {
  return await ctx.db
    .query("customFieldValues")
    .withIndex("by_entity", (q) => q.eq("entityType", entityType).eq("entityId", entityId))
    .collect();
}

export async function setValuePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    definitionId: string;
    entityType: string;
    entityId: string;
    value: any;
  },
) {
  assertEntityType(args.entityType);
  const def = await ctx.db.get(args.definitionId);
  if (!def) throw new Error("Custom field definition not found");
  const existing = await ctx.db
    .query("customFieldValues")
    .withIndex("by_entity_def", (q) =>
      q.eq("entityType", args.entityType).eq("entityId", args.entityId).eq("definitionId", args.definitionId),
    )
    .first();
  const nowISO = new Date().toISOString();
  if (existing) {
    await ctx.db.patch(existing._id, { value: args.value, updatedAtISO: nowISO });
    return existing._id;
  }
  return await ctx.db.insert("customFieldValues", {
    societyId: args.societyId,
    definitionId: args.definitionId,
    entityType: args.entityType,
    entityId: args.entityId,
    value: args.value,
    updatedAtISO: nowISO,
  });
}

export async function clearValuePortable(
  ctx: PortableMutationCtx,
  args: { entityType: string; entityId: string; definitionId: string },
) {
  const existing = await ctx.db
    .query("customFieldValues")
    .withIndex("by_entity_def", (q) =>
      q.eq("entityType", args.entityType).eq("entityId", args.entityId).eq("definitionId", args.definitionId),
    )
    .first();
  if (existing) await ctx.db.delete(existing._id);
}

/**
 * PORTABLE FUNCTIONS: the views domain — per-user or society-shared saved
 * configurations of the RecordTable for a given object (columns, filters, sort,
 * density). A view owns `viewFields` which are the actual columns.
 *
 * Reads/writes the `views` and `viewFields` tables (plus `objectMetadata`) over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function listForObjectPortable(
  ctx: PortableQueryCtx,
  { objectMetadataId }: { objectMetadataId: string },
) {
  const rows = await ctx.db
    .query("views")
    .withIndex("by_object_position", (q) =>
      q.eq("objectMetadataId", objectMetadataId),
    )
    .collect();
  return rows;
}

export async function getPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  return ctx.db.get(id);
}

/**
 * Returns the view plus its ordered viewFields with the underlying
 * fieldMetadata joined in — the exact shape the RecordTable consumes.
 */
export async function getHydratedPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const view = await ctx.db.get(id);
  if (!view) return null;
  const viewFields = await ctx.db
    .query("viewFields")
    .withIndex("by_view_position", (q) => q.eq("viewId", id))
    .collect();
  viewFields.sort((a, b) => a.position - b.position);
  const fields = await Promise.all(
    viewFields.map(async (vf: Record<string, any>) => {
      const field = await ctx.db.get(vf.fieldMetadataId);
      return field ? { viewField: vf, field } : null;
    }),
  );
  return {
    view,
    columns: fields.filter((x): x is NonNullable<typeof x> => x !== null),
  };
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    objectMetadataId: string;
    name: string;
    icon?: string;
    type?: string;
    kanbanFieldMetadataId?: string;
    kanbanAggregateOperation?: string;
    kanbanAggregateOperationFieldMetadataId?: string;
    calendarFieldMetadataId?: string;
    calendarLayout?: string;
    filtersJson?: string;
    viewFilterGroupsJson?: string;
    sortsJson?: string;
    viewGroupsJson?: string;
    viewFieldGroupsJson?: string;
    searchTerm?: string;
    anyFieldFilterValue?: string;
    columnStateJson?: string;
    density?: string;
    visibility?: string;
    openRecordIn?: string;
    isShared?: boolean;
    isSystem?: boolean;
    createdByUserId?: string;
  },
) {
  const now = new Date().toISOString();
  const existing = await ctx.db
    .query("views")
    .withIndex("by_object", (q) => q.eq("objectMetadataId", args.objectMetadataId))
    .collect();
  return ctx.db.insert("views", {
    societyId: args.societyId,
    objectMetadataId: args.objectMetadataId,
    name: args.name,
    icon: args.icon,
    type: args.type ?? "table",
    kanbanFieldMetadataId: args.kanbanFieldMetadataId,
    kanbanAggregateOperation: args.kanbanAggregateOperation,
    kanbanAggregateOperationFieldMetadataId: args.kanbanAggregateOperationFieldMetadataId,
    calendarFieldMetadataId: args.calendarFieldMetadataId,
    calendarLayout: args.calendarLayout,
    filtersJson: args.filtersJson,
    viewFilterGroupsJson: args.viewFilterGroupsJson,
    sortsJson: args.sortsJson,
    viewGroupsJson: args.viewGroupsJson,
    viewFieldGroupsJson: args.viewFieldGroupsJson,
    searchTerm: args.searchTerm,
    anyFieldFilterValue: args.anyFieldFilterValue,
    columnStateJson: args.columnStateJson,
    density: args.density ?? "compact",
    isShared: args.visibility ? args.visibility !== "personal" : (args.isShared ?? false),
    visibility: args.visibility ?? (args.isSystem ? "system" : args.isShared ? "shared" : "personal"),
    openRecordIn: args.openRecordIn ?? "drawer",
    isSystem: args.isSystem ?? false,
    createdByUserId: args.createdByUserId,
    position: existing.length,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      name?: string;
      icon?: string;
      type?: string;
      kanbanFieldMetadataId?: string;
      kanbanAggregateOperation?: string;
      kanbanAggregateOperationFieldMetadataId?: string;
      calendarFieldMetadataId?: string;
      calendarLayout?: string;
      filtersJson?: string;
      viewFilterGroupsJson?: string;
      sortsJson?: string;
      viewGroupsJson?: string;
      viewFieldGroupsJson?: string;
      searchTerm?: string;
      anyFieldFilterValue?: string;
      columnStateJson?: string;
      density?: string;
      isShared?: boolean;
      visibility?: string;
      openRecordIn?: string;
      position?: number;
    };
  },
) {
  await ctx.db.patch(id, {
    ...patch,
    ...(patch.visibility ? { isShared: patch.visibility !== "personal" } : {}),
    updatedAtISO: new Date().toISOString(),
  });
}

async function resolveObjectMetadata(
  ctx: any,
  args: {
    societyId: any;
    objectMetadataId?: any;
    nameSingular?: string;
  },
) {
  if (args.objectMetadataId) {
    const object = await ctx.db.get(args.objectMetadataId);
    if (!object || object.societyId !== args.societyId) return null;
    return object;
  }
  if (!args.nameSingular) return null;
  return ctx.db
    .query("objectMetadata")
    .withIndex("by_society_name", (q: any) =>
      q.eq("societyId", args.societyId).eq("nameSingular", args.nameSingular),
    )
    .unique();
}

export async function listSharedForDataTablePortable(
  ctx: PortableQueryCtx,
  args: {
    societyId: string;
    objectMetadataId?: string;
    nameSingular?: string;
  },
) {
  const object = await resolveObjectMetadata(ctx, args);
  if (!object) return [];
  const rows = await ctx.db
    .query("views")
    .withIndex("by_object_position", (q) => q.eq("objectMetadataId", object._id))
    .collect();
  return rows
    .filter((row) => row.isShared || row.isSystem)
    .sort((a, b) => a.position - b.position);
}

export async function createSharedDataTableViewPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    objectMetadataId?: string;
    nameSingular?: string;
    name: string;
    filtersJson?: string;
    viewFilterGroupsJson?: string;
    sortsJson?: string;
    viewGroupsJson?: string;
    viewFieldGroupsJson?: string;
    searchTerm?: string;
    anyFieldFilterValue?: string;
    columnStateJson?: string;
    density?: string;
    openRecordIn?: string;
    createdByUserId?: string;
  },
) {
  const object = await resolveObjectMetadata(ctx, args);
  // No objectMetadata seeded for this table — caller falls back to local-only saved views.
  if (!object) return null;
  const now = new Date().toISOString();
  const existing = await ctx.db
    .query("views")
    .withIndex("by_object", (q) => q.eq("objectMetadataId", object._id))
    .collect();
  return ctx.db.insert("views", {
    societyId: args.societyId,
    objectMetadataId: object._id,
    name: args.name,
    type: "table",
    filtersJson: args.filtersJson,
    viewFilterGroupsJson: args.viewFilterGroupsJson,
    sortsJson: args.sortsJson,
    viewGroupsJson: args.viewGroupsJson,
    viewFieldGroupsJson: args.viewFieldGroupsJson,
    searchTerm: args.searchTerm,
    anyFieldFilterValue: args.anyFieldFilterValue,
    columnStateJson: args.columnStateJson,
    density: args.density ?? "compact",
    isShared: true,
    visibility: "shared",
    openRecordIn: args.openRecordIn ?? "drawer",
    isSystem: false,
    createdByUserId: args.createdByUserId,
    position: existing.length,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function deleteSharedDataTableViewPortable(
  ctx: PortableMutationCtx,
  { societyId, id }: { societyId: string; id: string },
) {
  const view = await ctx.db.get(id);
  if (!view || view.societyId !== societyId) return;
  if (view.isSystem) {
    throw new Error("Cannot delete a system view.");
  }
  const vfs = await ctx.db
    .query("viewFields")
    .withIndex("by_view", (q) => q.eq("viewId", id))
    .collect();
  for (const vf of vfs) await ctx.db.delete(vf._id);
  await ctx.db.delete(id);
}

const GOVERNANCE_VIEW_SEEDS = [
  {
    object: "task",
    name: "Open AGM tasks",
    filters: [
      { fieldId: "status", operator: "is_not", value: "Done" },
      { fieldId: "__any__", operator: "contains", value: "AGM" },
    ],
    sort: { columnId: "dueDate", dir: "asc" },
  },
  {
    object: "filing",
    name: "Missing filing evidence",
    filters: [
      { fieldId: "status", operator: "is_not", value: "Filed" },
      { fieldId: "__any__", operator: "contains", value: "evidence" },
    ],
    sort: { columnId: "dueDate", dir: "asc" },
  },
  {
    object: "directorAttestation",
    name: "Directors needing attestation",
    filters: [{ fieldId: "signed", operator: "is_not", value: "true" }],
    sort: { columnId: "name", dir: "asc" },
  },
  {
    object: "conflict",
    name: "Unresolved conflicts",
    filters: [{ fieldId: "status", operator: "is_not", value: "Resolved" }],
    sort: { columnId: "updatedAtISO", dir: "desc" },
  },
  {
    object: "grant",
    name: "Grant reports due",
    filters: [
      { fieldId: "reportStatus", operator: "is_not", value: "Submitted" },
      { fieldId: "__any__", operator: "contains", value: "report" },
    ],
    sort: { columnId: "reportDueDate", dir: "asc" },
  },
];

export async function seedGovernanceDataTableViewsPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
) {
  const now = new Date().toISOString();
  const created: string[] = [];
  const skipped: string[] = [];
  for (const seed of GOVERNANCE_VIEW_SEEDS) {
    const object = await resolveObjectMetadata(ctx, {
      societyId,
      nameSingular: seed.object,
    });
    if (!object) {
      skipped.push(seed.name);
      continue;
    }
    const existing = await ctx.db
      .query("views")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", object._id))
      .collect();
    if (existing.some((view) => view.name === seed.name)) {
      skipped.push(seed.name);
      continue;
    }
    await ctx.db.insert("views", {
      societyId,
      objectMetadataId: object._id,
      name: seed.name,
      type: "table",
      filtersJson: JSON.stringify(seed.filters),
      viewFilterGroupsJson: JSON.stringify([]),
      sortsJson: JSON.stringify([seed.sort]),
      viewGroupsJson: JSON.stringify([]),
      viewFieldGroupsJson: JSON.stringify([]),
      columnStateJson: JSON.stringify({ hiddenColumns: [], columnWidths: {}, columnOrder: [] }),
      density: "compact",
      isShared: true,
      visibility: "system",
      openRecordIn: "drawer",
      isSystem: true,
      position: existing.length,
      createdAtISO: now,
      updatedAtISO: now,
    });
    created.push(seed.name);
  }
  return { created, skipped };
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const view = await ctx.db.get(id);
  if (!view) return;
  if (view.isSystem) {
    throw new Error("Cannot delete a system view.");
  }
  // Cascade viewFields.
  const vfs = await ctx.db
    .query("viewFields")
    .withIndex("by_view", (q) => q.eq("viewId", id))
    .collect();
  for (const vf of vfs) await ctx.db.delete(vf._id);
  await ctx.db.delete(id);
}

/* ----------------------------- View fields ----------------------------- */

export async function listFieldsForViewPortable(
  ctx: PortableQueryCtx,
  { viewId }: { viewId: string },
) {
  const rows = await ctx.db
    .query("viewFields")
    .withIndex("by_view_position", (q) => q.eq("viewId", viewId))
    .collect();
  rows.sort((a, b) => a.position - b.position);
  return rows;
}

export async function addFieldPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    viewId: string;
    fieldMetadataId: string;
    isVisible?: boolean;
    position?: number;
    size?: number;
    aggregateOperation?: string;
    viewFieldGroupId?: string;
  },
) {
  const now = new Date().toISOString();
  let position = args.position;
  if (position === undefined) {
    const existing = await ctx.db
      .query("viewFields")
      .withIndex("by_view", (q) => q.eq("viewId", args.viewId))
      .collect();
    position = existing.length;
  }
  return ctx.db.insert("viewFields", {
    societyId: args.societyId,
    viewId: args.viewId,
    fieldMetadataId: args.fieldMetadataId,
    isVisible: args.isVisible ?? true,
    position,
    size: args.size ?? 160,
    aggregateOperation: args.aggregateOperation,
    viewFieldGroupId: args.viewFieldGroupId,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updateFieldPortable(
  ctx: PortableMutationCtx,
  { id, patch }: {
    id: string;
    patch: {
      isVisible?: boolean;
      position?: number;
      size?: number;
      aggregateOperation?: string;
      viewFieldGroupId?: string;
    };
  },
) {
  await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
}

export async function removeFieldPortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

/**
 * Bulk-reorder columns. Accepts an array of viewField ids in their new
 * display order. Uses `patch` per row so we remain idempotent if some
 * viewFields are missing.
 */
export async function reorderFieldsPortable(
  ctx: PortableMutationCtx,
  { orderedIds }: { viewId: string; orderedIds: string[] },
) {
  const now = new Date().toISOString();
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const row = await ctx.db.get(id);
    if (!row) continue;
    await ctx.db.patch(id, { position: i, updatedAtISO: now });
  }
}

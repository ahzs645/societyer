/**
 * PORTABLE FUNCTIONS: the command-menu-items domain (listForScope / upsert / remove).
 *
 * Reads/writes the `commandMenuItems` table over `ctx.db`. `listForScope`
 * tolerates a not-yet-provisioned table by returning an empty list. Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export interface CommandMenuItemListArgs {
  societyId: string;
  scopeType?: string;
  objectMetadataId?: string;
  pagePath?: string;
}

export interface CommandMenuItemUpsertArgs {
  societyId: string;
  id?: string;
  label: string;
  category?: string;
  iconName?: string;
  commandKey: string;
  scopeType?: string;
  pagePath?: string;
  objectMetadataId?: string;
  requiredSelection?: string;
  payloadJson?: string;
  isPinned?: boolean;
  isSystem?: boolean;
  position?: number;
}

export async function commandMenuItemsListForScope(ctx: PortableQueryCtx, args: CommandMenuItemListArgs) {
  let rows: any[] = [];
  try {
    rows = await ctx.db
      .query("commandMenuItems")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
  } catch (error: any) {
    const message = String(error?.message ?? error ?? "");
    if (
      message.includes("commandMenuItems") ||
      message.includes("by_society") ||
      message.includes("does not exist")
    ) {
      return [];
    }
    throw error;
  }
  return rows
    .filter((row) => {
      if (row.scopeType === "global") return true;
      if (args.scopeType && row.scopeType !== args.scopeType) return false;
      if (row.objectMetadataId && args.objectMetadataId && row.objectMetadataId !== args.objectMetadataId) return false;
      if (row.pagePath && args.pagePath && row.pagePath !== args.pagePath) return false;
      return true;
    })
    .sort((a, b) => a.position - b.position);
}

export async function commandMenuItemUpsert(ctx: PortableMutationCtx, args: CommandMenuItemUpsertArgs): Promise<string> {
  const now = new Date().toISOString();
  if (args.id) {
    await ctx.db.patch(args.id, {
      label: args.label,
      category: args.category ?? "Actions",
      iconName: args.iconName,
      commandKey: args.commandKey,
      scopeType: args.scopeType ?? "global",
      pagePath: args.pagePath,
      objectMetadataId: args.objectMetadataId,
      requiredSelection: args.requiredSelection,
      payloadJson: args.payloadJson,
      isPinned: args.isPinned ?? false,
      isSystem: args.isSystem ?? false,
      position: args.position ?? 0,
      updatedAtISO: now,
    });
    return args.id;
  }
  const existing = await ctx.db
    .query("commandMenuItems")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  return ctx.db.insert("commandMenuItems", {
    societyId: args.societyId,
    label: args.label,
    category: args.category ?? "Actions",
    iconName: args.iconName,
    commandKey: args.commandKey,
    scopeType: args.scopeType ?? "global",
    pagePath: args.pagePath,
    objectMetadataId: args.objectMetadataId,
    requiredSelection: args.requiredSelection,
    payloadJson: args.payloadJson,
    isPinned: args.isPinned ?? false,
    isSystem: args.isSystem ?? false,
    position: args.position ?? existing.length,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function commandMenuItemRemove(ctx: PortableMutationCtx, { id }: { id: string }): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row) return;
  if (row.isSystem) throw new Error("Cannot delete a system command.");
  await ctx.db.delete(id);
}

/**
 * PORTABLE FUNCTIONS: the motion-templates domain (list / create / update /
 * remove).
 *
 * Reads/writes the `motionTemplates` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `seedDefaults` performs backfill seeding and stays on the native
 * Convex runtime.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

/** Normalize a tag list the same way motions.setTags does: trim, lowercase,
 *  drop blanks, dedupe. Keeps the library filter and the motions filter using
 *  the same vocabulary. */
function normalizeTags(tags?: string[]): string[] {
  return Array.from(
    new Set((tags ?? []).map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean)),
  );
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("motionTemplates")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  rows.sort((a, b) => a.title.localeCompare(b.title));
  return rows;
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    body: string;
    tags?: string[];
    requiresSpecialResolution?: boolean;
    notes?: string;
  },
) {
  const now = new Date().toISOString();
  return await ctx.db.insert("motionTemplates", {
    societyId: args.societyId,
    title: args.title,
    body: args.body,
    tags: normalizeTags(args.tags),
    requiresSpecialResolution: args.requiresSpecialResolution ?? false,
    notes: args.notes,
    usageCount: 0,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  { templateId, tags, ...patch }: {
    templateId: string;
    title?: string;
    body?: string;
    tags?: string[];
    requiresSpecialResolution?: boolean;
    notes?: string;
  },
) {
  const clean: Record<string, unknown> = { updatedAtISO: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  if (tags !== undefined) clean.tags = normalizeTags(tags);
  await ctx.db.patch(templateId, clean);
  return templateId;
}

export async function removePortable(ctx: PortableMutationCtx, { templateId }: { templateId: string }) {
  await ctx.db.delete(templateId);
}

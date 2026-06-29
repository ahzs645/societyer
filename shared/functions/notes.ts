/**
 * PORTABLE FUNCTIONS: the notes domain (listForRecord / create / update / remove).
 *
 * Per-entity freeform notes — straight CRUD over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function notesListForRecordPortable(
  ctx: PortableQueryCtx,
  { societyId, entityType, entityId }: { societyId: string; entityType: string; entityId: string },
) {
  return ctx.db
    .query("notes")
    .withIndex("by_entity", (q) =>
      q.eq("societyId", societyId).eq("entityType", entityType).eq("entityId", entityId),
    )
    .order("desc")
    .take(200);
}

export async function noteCreatePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; entityType: string; entityId: string; author: string; body: string },
) {
  if (!args.body.trim()) throw new Error("Note body is required");
  return ctx.db.insert("notes", {
    ...args,
    createdAtISO: new Date().toISOString(),
  });
}

export async function noteUpdatePortable(
  ctx: PortableMutationCtx,
  { id, body }: { id: string; body: string },
) {
  if (!body.trim()) throw new Error("Note body is required");
  await ctx.db.patch(id, {
    body,
    updatedAtISO: new Date().toISOString(),
  });
}

export async function noteRemovePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

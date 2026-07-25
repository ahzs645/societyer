/**
 * PORTABLE FUNCTIONS: the notes domain (listForRecord / create / update / remove).
 *
 * Per-entity freeform notes — straight CRUD over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { optionalSubjectId, requireSubjectId, type SubjectIdArgs } from "./subjectId";

export async function notesListForRecordPortable(
  ctx: PortableQueryCtx,
  { societyId, entityType, subjectId, entityId }: { societyId: string; entityType: string } & SubjectIdArgs,
) {
  const resolvedSubjectId = requireSubjectId({ subjectId, entityId });
  // TODO(H0-flip): query by_subject after the hosted backfill is complete.
  const rows = await ctx.db
    .query("notes")
    .withIndex("by_entity", (q) =>
      q.eq("societyId", societyId).eq("entityType", entityType).eq("entityId", resolvedSubjectId),
    )
    .order("desc")
    .take(200);
  return rows.filter((row) => optionalSubjectId(row) === resolvedSubjectId);
}

export async function noteCreatePortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; entityType: string; author: string; body: string } & SubjectIdArgs,
) {
  if (!args.body.trim()) throw new Error("Note body is required");
  const subjectId = requireSubjectId(args);
  const { subjectId: _subjectId, entityId: _entityId, ...note } = args;
  return ctx.db.insert("notes", {
    ...note,
    subjectId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: subjectId,
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

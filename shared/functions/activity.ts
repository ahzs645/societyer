/**
 * PORTABLE FUNCTIONS: the activity domain (list / listForRecord / log).
 *
 * Reads/writes the `activity` table over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { optionalSubjectId, requireSubjectId, type SubjectIdArgs } from "./subjectId";

export async function listPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  const rows = await ctx.db
    .query("activity")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 30);
  return rows;
}

export async function listForRecordPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    entityType,
    subjectId,
    entityId,
    limit,
  }: { societyId: string; entityType: string; limit?: number } & SubjectIdArgs,
) {
  const resolvedSubjectId = requireSubjectId({ subjectId, entityId });
  // TODO(H0-flip): query by_subject after the hosted backfill is complete.
  const rows = await ctx.db
    .query("activity")
    .withIndex("by_entity", (q) =>
      q.eq("societyId", societyId).eq("entityType", entityType).eq("entityId", resolvedSubjectId),
    )
    .order("desc")
    .take(limit ?? 100);
  return rows.filter((row) => optionalSubjectId(row) === resolvedSubjectId);
}

export async function logPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    actor: string;
    entityType: string;
    action: string;
    summary: string;
  } & SubjectIdArgs,
) {
  const { subjectId: preferredSubjectId, entityId: legacyEntityId, ...activity } = args;
  const subjectId = optionalSubjectId({ subjectId: preferredSubjectId, entityId: legacyEntityId });
  return ctx.db.insert("activity", {
    ...activity,
    subjectId,
    // TODO(H0-flip): drop the legacy semantic mirror once all readers use subjectId indexes.
    entityId: subjectId,
    createdAtISO: new Date().toISOString(),
  });
}

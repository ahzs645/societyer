/**
 * Nullable record lookups for detail-page `get` queries.
 *
 * `requireOwnedRow` throws for a missing or foreign row. That is right for
 * writes, but a detail page needs to tell "still loading" apart from "this
 * record does not exist": the local runtime turns a thrown query into a
 * permanent `undefined` (indistinguishable from loading), and hosted Convex
 * surfaces it as an error boundary. Detail queries therefore return `null`
 * for missing, wrong-table and foreign-society ids alike, so the response
 * never reveals whether another society's row exists.
 */

import type { PortableQueryCtx, TableName } from "../portable/ctx";
import { requireSocietyMembership, type OwnedPortableRow } from "./access";

export async function findOwnedRow<T extends OwnedPortableRow = OwnedPortableRow>(
  ctx: PortableQueryCtx,
  table: TableName,
  id: string,
): Promise<T | null> {
  let row: T | null = null;
  try {
    row = await ctx.db.get<T>(id, table);
  } catch {
    // Malformed or wrong-table ids are reported as "not found", not as errors.
    return null;
  }
  if (!row || typeof row.societyId !== "string") return null;
  try {
    await requireSocietyMembership(ctx, row.societyId);
  } catch {
    return null;
  }
  return row;
}

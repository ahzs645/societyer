/**
 * PORTABLE FUNCTIONS: the written-resolutions domain
 * (list / create / sign / markFailed / remove).
 *
 * Reads/writes the `writtenResolutions` table over `ctx.db`. Each handler runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, requireSocietyMembership } from "./access";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("writtenResolutions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    text: string;
    kind: string;
    requiredCount: number;
    notes?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  return ctx.db.insert("writtenResolutions", {
    ...args,
    circulatedAtISO: new Date().toISOString(),
    signatures: [],
    status: "Circulating",
  });
}

export async function signPortable(
  ctx: PortableMutationCtx,
  { id, signerName, memberId }: { id: string; signerName: string; memberId?: string },
) {
  const row = await requireOwnedRow(ctx, "writtenResolutions", id);
  const societyId = String(row.societyId);
  if (memberId) await getOwned(ctx, "members", memberId, societyId);
  const signatures = [
    ...row.signatures,
    { signerName, memberId, signedAtISO: new Date().toISOString() },
  ];
  const status =
    signatures.length >= row.requiredCount ? "Carried" : row.status;
  const completedAtISO =
    status === "Carried" ? new Date().toISOString() : row.completedAtISO;
  await ctx.db.patch(id, { signatures, status, completedAtISO });
}

export async function markFailedPortable(
  ctx: PortableMutationCtx,
  { id, note }: { id: string; note?: string },
) {
  await requireOwnedRow(ctx, "writtenResolutions", id);
  await ctx.db.patch(id, { status: "Failed", notes: note });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await requireOwnedRow(ctx, "writtenResolutions", id);
  await ctx.db.delete(id);
}

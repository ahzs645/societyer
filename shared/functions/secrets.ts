/**
 * PORTABLE FUNCTIONS: the secret-vault read/delete surface (list / remove).
 *
 * These touch only `ctx.db` (plus the `requireRolePortable` access gate), so they
 * run unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle. `create` / `update` / `revealSecret` stay on Convex because they
 * encrypt/decrypt stored values with WebCrypto. `publicSecret`, `logActivity`,
 * and `requireVaultWrite` are pure (`ctx.db`-only) helpers shared by these
 * handlers.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("secretVaultItems")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.map(publicSecret);
}

export async function removePortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const existing = await ctx.db.get(id);
  if (!existing) return;
  const { user } = await requireVaultWrite(ctx, String(existing.societyId), actingUserId);
  await ctx.db.delete(id);
  await logActivity(ctx, existing, user.displayName, "deleted", `Deleted access vault record "${existing.name}".`);
}

function publicSecret(row: any) {
  const { secretEncrypted, ...rest } = row;
  return {
    ...rest,
    hasSecretValue: Boolean(secretEncrypted),
  };
}

async function requireVaultWrite(ctx: PortableMutationCtx, societyId: string, actingUserId?: string) {
  if (!actingUserId) {
    throw new Error("Admin role required.");
  }
  return requireRolePortable(ctx, { societyId, actingUserId, required: "Admin" });
}

async function logActivity(ctx: PortableMutationCtx, row: any, actorName: string, action: string, summary: string) {
  await ctx.db.insert("activity", {
    societyId: row.societyId,
    actor: actorName,
    entityType: "secretVaultItem",
    entityId: String(row._id),
    action,
    summary,
    createdAtISO: new Date().toISOString(),
  });
}

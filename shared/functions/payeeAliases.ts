/**
 * PORTABLE FUNCTIONS: payee rename rules (list / upsert / remove).
 *
 * An alias shows a raw bank payee under a readable name in the transactions
 * table and panel, and new CSV imports store the display name as the
 * counterparty. The matching itself lives in `shared/payeeAliases.ts`.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireOwnedRow, requireRolePortable, requireSocietyMembership } from "./access";
import { validatePayeeAlias } from "../payeeAliases";
import { normalizeRuleText } from "../transactionRules";

type AliasRow = { _id: string; societyId: string; match: string; matchType: string; displayName: string; createdAtISO: string; updatedAtISO: string };

/** Most rename rules one organization keeps. */
export const PAYEE_ALIAS_LIMIT = 200;

async function loadAliases(ctx: PortableQueryCtx, societyId: string): Promise<AliasRow[]> {
  return ctx.db
    .query<AliasRow>("payeeAliases")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await loadAliases(ctx, societyId);
  return rows
    .map((row) => ({
      _id: String(row._id),
      match: row.match,
      matchType: row.matchType === "contains" ? "contains" : "exact",
      displayName: row.displayName,
      updatedAtISO: row.updatedAtISO,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.match.localeCompare(b.match));
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: { id?: string; societyId: string; match: string; matchType: string; displayName: string; actingUserId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  const errors = validatePayeeAlias(args);
  if (errors.length) throw new Error(errors[0]);
  const match = args.match.trim();
  const displayName = args.displayName.trim();
  const matchType = args.matchType === "contains" ? "contains" : "exact";
  const nowISO = new Date().toISOString();
  const existing = await loadAliases(ctx, args.societyId);
  const duplicate = existing.find(
    (row) => String(row._id) !== String(args.id ?? "") && row.matchType === matchType && normalizeRuleText(row.match) === normalizeRuleText(match),
  );
  if (args.id) {
    await getOwned(ctx, "payeeAliases", args.id, args.societyId);
    if (duplicate) throw new Error(`Another rename already matches "${duplicate.match}".`);
    await ctx.db.patch(args.id, { match, matchType, displayName, updatedAtISO: nowISO });
    return args.id;
  }
  // Renaming the same payee again replaces the earlier name.
  if (duplicate) {
    await ctx.db.patch(duplicate._id, { displayName, updatedAtISO: nowISO });
    return String(duplicate._id);
  }
  if (existing.length >= PAYEE_ALIAS_LIMIT) throw new Error(`Keep at most ${PAYEE_ALIAS_LIMIT} payee names.`);
  return ctx.db.insert("payeeAliases", {
    societyId: args.societyId,
    match,
    matchType,
    displayName,
    createdByUserId: await principalUserId(ctx, args.societyId).catch(() => undefined),
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id, actingUserId }: { id: string; actingUserId?: string }) {
  const row = await requireOwnedRow<AliasRow>(ctx, "payeeAliases", id);
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Director" });
  await ctx.db.delete(id);
  return { match: row.match, matchType: row.matchType, displayName: row.displayName };
}

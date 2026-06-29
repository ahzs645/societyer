/**
 * PORTABLE FUNCTIONS: external stakeholder portals (list / create / revoke).
 *
 * A society shares a token-scoped, read-only room with an outside party. These
 * handlers read/write the `partyPortals` table over `ctx.db` and run unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle.
 *
 * `center` stays on Convex: its public, token-gated view resolves document
 * download URLs via ctx.storage / the storage provider, which are not part of
 * the portable db contract.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

const VALID_SCOPES = ["board", "publications", "documents"];

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  return (await ctx.db
    .query("partyPortals")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect())
    .sort((a: any, b: any) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)));
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    token: string;
    label: string;
    partyEmail?: string;
    scopes: string[];
    allowDownload: boolean;
    expiresAtISO?: string;
  },
) {
  const scopes = args.scopes.filter((s) => VALID_SCOPES.includes(s));
  return await ctx.db.insert("partyPortals", {
    societyId: args.societyId,
    token: args.token,
    label: args.label,
    partyEmail: args.partyEmail || undefined,
    scopes,
    allowDownload: args.allowDownload,
    expiresAtISO: args.expiresAtISO || undefined,
    createdAtISO: new Date().toISOString(),
  });
}

export async function revokePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.patch(id, { revokedAtISO: new Date().toISOString() });
}

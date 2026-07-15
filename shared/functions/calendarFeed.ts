/** Portable database handlers for configuring the outbound calendar feed. */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

export async function getFeedTokenPortable(
  ctx: PortableQueryCtx,
  { societyId }: { societyId: string },
) {
  const society = await ctx.db.get(societyId);
  return society?.calendarFeedToken ?? null;
}

export async function setFeedTokenPortable(
  ctx: PortableMutationCtx,
  { societyId, token }: { societyId: string; token: string | null },
) {
  await ctx.db.patch(societyId, { calendarFeedToken: token ?? undefined });
  return token;
}
